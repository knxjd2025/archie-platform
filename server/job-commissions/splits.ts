/**
 * Who shares a job's commission, and what has actually been paid to them.
 *
 * The job's money lives on job_commissions and is never copied down here — a
 * split carries only a person, a share of the pool, and a ledger of payments.
 * Everything else is derived, which is the point: "advances paid" is the sum
 * of the draw rows, a split's balance is its commission minus its payments,
 * and the job's own status is a roll-up of its reps'. Nothing is a figure
 * somebody has to remember to keep in step with another figure.
 */
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../db';
import {
  jobCommissions, jobCommissionSplits, jobCommissionPayouts,
  type JobCommission, type JobCommissionSplit, type JobCommissionPayout,
} from '../../shared/schema';
import {
  computeCommissionSplit, computeJobCommission, rollUpCommissionStatus, rollUpColumns, sharesBlocker, evenShares,
  MAX_PAYOUT_REFERENCE,
  type CommissionSplitResult, type JobCommissionStatus,
} from '../../shared/job-commission';
import { figuresOf } from './service';
import { num } from '../../shared/num';

/**
 * The database, or a transaction on it. Settling a job reads balances and
 * writes payouts under a lock, and the reads have to go through the same
 * transaction as the writes or they see the world from before the lock.
 */
export type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface SplitWithPayouts {
  split: JobCommissionSplit;
  payouts: JobCommissionPayout[];
  computed: CommissionSplitResult;
}

/**
 * What the job earned for the reps between them: half the profit, or the
 * figure set by hand. **Null until the rep has said where the lead came from**
 * — the overhead rate depends on it, so there is no pool yet, and the same
 * convention recomputedColumns() keeps applies here: a record with no lead
 * source has null money, not zero money. Zero reads as "we worked it out and
 * it came to nothing", which is a different and wrong claim.
 */
export function poolOf(row: JobCommission): number | null {
  // Payments never change the pool — they are the pool going out, not a cost
  // that makes it smaller.
  return computeJobCommission({ ...figuresOf(row), advancesPaid: 0 })?.commission ?? null;
}

export async function loadSplits(jobCommissionId: number, pool: number | null, exec: Executor = db): Promise<SplitWithPayouts[]> {
  const splits = await exec.select().from(jobCommissionSplits)
    .where(eq(jobCommissionSplits.jobCommissionId, jobCommissionId))
    .orderBy(asc(jobCommissionSplits.id));
  if (!splits.length) return [];
  const payouts = await exec.select().from(jobCommissionPayouts)
    .where(inArray(jobCommissionPayouts.splitId, splits.map((s) => s.id)))
    .orderBy(asc(jobCommissionPayouts.paidAt), asc(jobCommissionPayouts.id));
  return splits.map((split) => {
    const mine = payouts.filter((p) => p.splitId === split.id);
    return {
      split,
      payouts: mine,
      computed: computeCommissionSplit(
        pool ?? 0,
        { sharePct: num(split.sharePct), manualAmount: split.manualAmount == null ? null : num(split.manualAmount) },
        mine.map((p) => ({ amount: num(p.amount), kind: p.kind })),
      ),
    };
  });
}

/**
 * The first rep on a job — created with the record so a commission is never
 * sitting there belonging to nobody. 100% of the pool until somebody says a
 * second person worked it.
 */
export async function ensureDefaultSplit(
  jobCommissionId: number,
  rep: { teamMemberId: number | null; repName: string | null },
  createdBy: string,
): Promise<void> {
  const existing = await db.select({ id: jobCommissionSplits.id }).from(jobCommissionSplits)
    .where(eq(jobCommissionSplits.jobCommissionId, jobCommissionId)).limit(1);
  if (existing.length) return;
  await db.insert(jobCommissionSplits).values({
    jobCommissionId, teamMemberId: rep.teamMemberId, repName: rep.repName,
    sharePct: '100.00', createdBy,
  }).onConflictDoNothing();
}

/**
 * Recompute every split from the pool and its ledger, then roll the job up.
 *
 * Status follows the money on its own: a rep whose ledger settles their
 * approved commission is paid, and one whose payment was removed goes back to
 * approved. Open and denied are a person's decisions and are left alone.
 */
export async function recomputeSplits(jobCommissionId: number, exec: Executor = db): Promise<SplitWithPayouts[]> {
  const [parent] = await exec.select().from(jobCommissions).where(eq(jobCommissions.id, jobCommissionId));
  if (!parent) return [];
  const pool = poolOf(parent);
  const loaded = await loadSplits(jobCommissionId, pool, exec);

  const now = new Date();
  for (const { split, computed } of loaded) {
    let status: JobCommissionStatus = split.status as JobCommissionStatus;
    // An approved commission of $0 is settled the moment it is approved —
    // there is nothing to hand over, so waiting for a payment first would
    // leave it sitting under Due now for ever, owing nobody anything.
    if (status === 'approved' && computed.settled && (computed.paid > 0 || computed.commission === 0)) status = 'paid';
    else if (status === 'paid' && !computed.settled) status = 'approved';
    // No pool means no figure for anyone on it — not a figure of zero.
    const amount = pool == null ? null : computed.commission.toFixed(2);
    const balance = pool == null ? null : computed.balanceDue.toFixed(2);
    if (split.commissionAmount === amount && split.balanceDue === balance && split.status === status) continue;
    await exec.update(jobCommissionSplits)
      .set({ commissionAmount: amount, balanceDue: balance, status, updatedAt: now })
      .where(eq(jobCommissionSplits.id, split.id));
    split.commissionAmount = amount; split.balanceDue = balance; split.status = status;
  }

  await rollUp(parent, pool, loaded, exec);
  return loaded;
}

/** The latest of some stamps, with who made it — or nulls when there are none. */
function latest(stamps: Array<{ at: Date | null; by: string | null }>): { at: Date | null; by: string | null } {
  const real = stamps.filter((s): s is { at: Date; by: string | null } => s.at != null);
  if (!real.length) return { at: null, by: null };
  return real.reduce((a, b) => (b.at.getTime() > a.at.getTime() ? b : a));
}

const sameInstant = (a: Date | null, b: Date | null) => (a?.getTime() ?? null) === (b?.getTime() ?? null);

/**
 * Write the job's own columns back from its reps'. Every older read path — the
 * L10 agenda, the scorecard, the AI commission tool, the rep-scoping predicate
 * — goes on reading these, so they have to stay true rather than be left to
 * rot the moment a job has two reps on it.
 */
async function rollUp(parent: JobCommission, pool: number | null, loaded: SplitWithPayouts[], exec: Executor): Promise<void> {
  const live = loaded.filter((l) => l.split.status !== 'denied');
  const paid = live.reduce((sum, l) => sum + l.computed.paid, 0);
  const status = rollUpCommissionStatus(loaded.map((l) => ({ status: l.split.status as JobCommissionStatus })));

  // Whose name the job shows, and whose scope it falls in for the older
  // single-rep reads: the biggest share, so the job reads as belonging to
  // whoever earned most of it.
  const lead = [...live].sort((a, b) => b.computed.commission - a.computed.commission)[0];

  // The job's approval and payout stamps come from its reps' as well. Since
  // approving moved onto the splits nothing wrote these, so a paid job's
  // statement said "Approved: not yet" — and the PDF is the paper trail an
  // accountant reads. Approved is when the last rep was signed off; paid is
  // the last payment that settled them. A job that is no longer approved or
  // paid loses the stamp, so a reopened record never claims either.
  const signedOff = status === 'approved' || status === 'paid';
  const approved = signedOff
    ? latest(live.map((l) => ({ at: l.split.approvedAt, by: l.split.approvedBy })))
    : { at: null, by: null };
  const lastPayout = latest(live.flatMap((l) => l.payouts.map((p) => ({ at: p.paidAt, by: p.paidBy }))));
  // A $0 commission is paid with no payment at all; it was settled when it was
  // approved, by whoever approved it.
  const paidStamp = status !== 'paid' ? { at: null, by: null }
    : lastPayout.at ? lastPayout
      : { at: parent.paidAt ?? approved.at ?? new Date(), by: parent.paidBy ?? approved.by };

  const next = {
    ...rollUpColumns(pool, paid),
    status,
    teamMemberId: lead?.split.teamMemberId ?? null,
    repName: lead?.split.repName ?? null,
    // A record approved before splits existed keeps the stamp it already has.
    approvedAt: approved.at ?? (signedOff ? parent.approvedAt : null),
    approvedBy: approved.by ?? (signedOff ? parent.approvedBy : null),
    paidAt: paidStamp.at,
    paidBy: paidStamp.by,
  };
  const same = parent.commissionAmount === next.commissionAmount
    && parent.advancesPaid === next.advancesPaid
    && parent.balanceDue === next.balanceDue
    && parent.status === next.status
    && parent.teamMemberId === next.teamMemberId
    && parent.repName === next.repName
    && sameInstant(parent.approvedAt, next.approvedAt) && parent.approvedBy === next.approvedBy
    && sameInstant(parent.paidAt, next.paidAt) && parent.paidBy === next.paidBy;
  if (same) return;
  await exec.update(jobCommissions).set({ ...next, updatedAt: new Date() }).where(eq(jobCommissions.id, parent.id));
}

/** Splits plus their ledgers, for the card and the payouts board. */
export async function splitsPayload(jobCommissionId: number, exec: Executor = db): Promise<{ pool: number; splits: SplitWithPayouts[] }> {
  const [parent] = await exec.select().from(jobCommissions).where(eq(jobCommissions.id, jobCommissionId));
  if (!parent) return { pool: 0, splits: [] };
  const pool = poolOf(parent);
  // The wire carries 0 for "no pool yet"; the card shows the lead-source
  // prompt off the record itself, so it never reads this as a real figure.
  return { pool: pool ?? 0, splits: await loadSplits(jobCommissionId, pool, exec) };
}

/**
 * Lock a job's record for the rest of the transaction. Everything that pays a
 * rep takes this first, so two payments on the same job happen one after the
 * other and the second one sees what the first one paid.
 */
export async function lockJobCommission(tx: Executor, jobCommissionId: number): Promise<void> {
  await tx.execute(sql`SELECT id FROM job_commissions WHERE id = ${jobCommissionId} FOR UPDATE`);
}

export interface SettleResult {
  /** Why nothing was paid, in words an admin can act on. Null when the run went through. */
  refused: { reason: 'gone' | 'status' | 'shares'; message: string } | null;
  /** The payout rows actually written, one per rep who was still owed. */
  payouts: JobCommissionPayout[];
  /** What those rows add up to — the money that really left, not a figure read before it did. */
  amount: number;
}

/**
 * Pay out whatever each approved rep is still owed on a job, as a real row in
 * their ledger. Anyone already settled is left alone, so paying a second time
 * — a stale screen, a double click, a bulk run that overlaps — adds nothing.
 *
 * "Adds nothing" only holds if two runs cannot both read the balance before
 * either has written its payment. Reading then inserting with nothing between
 * them let two clicks a moment apart each see $4,000 owed and each pay it, so
 * the job row is locked first: the second run waits for the first to finish,
 * then reads a balance of zero and pays nothing.
 *
 * `onlySplitIds` pays just those reps — the payouts board pays a person, and
 * paying one rep on a job must not quietly pay their colleague as well.
 */
export async function settleApprovedSplits(
  jobCommissionId: number,
  actor: string,
  reference: string,
  onlySplitIds?: readonly number[],
): Promise<SettleResult> {
  return db.transaction(async (tx) => {
    await lockJobCommission(tx, jobCommissionId);
    const [parent] = await tx.select().from(jobCommissions).where(eq(jobCommissions.id, jobCommissionId));
    if (!parent) return { refused: { reason: 'gone', message: 'no longer exists' }, payouts: [], amount: 0 };
    // Checked again under the lock: somebody may have reopened or paid it
    // since the screen asking to pay it was drawn.
    if (parent.status !== 'approved') return { refused: { reason: 'status', message: `already ${parent.status}` }, payouts: [], amount: 0 };

    const pool = poolOf(parent);
    const loaded = await loadSplits(jobCommissionId, pool, tx);
    // Shares that stopped adding up after approval would pay out more, or
    // less, than the job earned. Refuse rather than pay the wrong money.
    const bad = sharesBlocker(loaded.map((l) => ({
      sharePct: num(l.split.sharePct), manualAmount: l.split.manualAmount == null ? null : num(l.split.manualAmount),
    })));
    if (bad) return { refused: { reason: 'shares', message: `The shares on this job don't add up, so nothing was paid: ${bad} Reopen the job to fix them.` }, payouts: [], amount: 0 };

    const only = onlySplitIds ? new Set(onlySplitIds) : null;
    const now = new Date();
    const rows = loaded
      .filter((l) => l.split.status === 'approved' && l.computed.balanceDue > 0.005)
      .filter((l) => !only || only.has(l.split.id))
      .map((l) => ({
        splitId: l.split.id,
        amount: l.computed.balanceDue.toFixed(2),
        kind: 'balance',
        reference: reference.trim().slice(0, MAX_PAYOUT_REFERENCE) || null,
        paidAt: now,
        paidBy: actor,
      }));
    const payouts = rows.length ? await tx.insert(jobCommissionPayouts).values(rows).returning() : [];
    // recompute turns a settled approved split into a paid one and rolls the job up.
    await recomputeSplits(jobCommissionId, tx);
    const amount = Math.round(payouts.reduce((t, p) => t + num(p.amount), 0) * 100) / 100;
    return { refused: null, payouts, amount };
  });
}

/**
 * Even the shares out after a rep is added or taken off.
 *
 * Only among the reps whose share is still open to change. Somebody who has
 * already been paid anything — a draw, the balance — keeps the share they were
 * paid on; re-evening it would leave them overpaid, or owed, on money that has
 * already moved. Whatever percentage they hold is set aside and only the rest
 * is divided. A rep on an agreed figure isn't on a share at all.
 *
 * A rep whose share moves after they were approved goes back to open: the
 * figure they were signed off on is no longer the figure, so the job needs
 * approving again, which is what the card warns before a rep is added.
 */
export async function reshare(jobCommissionId: number, exec: Executor = db): Promise<void> {
  const all = await exec.select().from(jobCommissionSplits)
    .where(eq(jobCommissionSplits.jobCommissionId, jobCommissionId)).orderBy(asc(jobCommissionSplits.id));
  const byShare = all.filter((a) => a.manualAmount == null);
  if (!byShare.length) return;
  const paidRows = await exec.select({ splitId: jobCommissionPayouts.splitId }).from(jobCommissionPayouts)
    .where(inArray(jobCommissionPayouts.splitId, byShare.map((s) => s.id)));
  const hasPayouts = new Set(paidRows.map((p) => p.splitId));
  const isFixed = (s: JobCommissionSplit) => s.status === 'paid' || hasPayouts.has(s.id);
  const movable = byShare.filter((s) => !isFixed(s));
  const taken = byShare.filter(isFixed).reduce((t, s) => t + num(s.sharePct), 0);
  const shares = evenShares(movable.length, 100 - taken);

  const now = new Date();
  for (let i = 0; i < movable.length; i++) {
    const s = movable[i];
    const pct = shares[i].toFixed(2);
    if (num(s.sharePct).toFixed(2) === pct) continue;
    await exec.update(jobCommissionSplits)
      .set(s.status === 'approved'
        ? { sharePct: pct, status: 'open', approvedBy: null, approvedAt: null, updatedAt: now }
        : { sharePct: pct, updatedAt: now })
      .where(eq(jobCommissionSplits.id, s.id));
  }
}

/** One split, with the job it belongs to — the guard every split route needs. */
export async function splitWithParent(splitId: number, exec: Executor = db): Promise<{ split: JobCommissionSplit; parent: JobCommission } | null> {
  const [row] = await exec.select({ split: jobCommissionSplits, parent: jobCommissions })
    .from(jobCommissionSplits)
    .innerJoin(jobCommissions, eq(jobCommissionSplits.jobCommissionId, jobCommissions.id))
    .where(eq(jobCommissionSplits.id, splitId));
  return row ?? null;
}

/** Every split for a set of jobs, for the payouts board's per-rep grouping. */
export async function splitsForJobs(jobCommissionIds: number[]): Promise<Map<number, JobCommissionSplit[]>> {
  const out = new Map<number, JobCommissionSplit[]>();
  if (!jobCommissionIds.length) return out;
  const rows = await db.select().from(jobCommissionSplits)
    .where(inArray(jobCommissionSplits.jobCommissionId, jobCommissionIds))
    .orderBy(asc(jobCommissionSplits.id));
  for (const r of rows) {
    const list = out.get(r.jobCommissionId) ?? [];
    list.push(r);
    out.set(r.jobCommissionId, list);
  }
  return out;
}

export const payoutsOfSplit = (splitId: number, exec: Executor = db) =>
  exec.select().from(jobCommissionPayouts).where(eq(jobCommissionPayouts.splitId, splitId))
    .orderBy(asc(jobCommissionPayouts.paidAt), asc(jobCommissionPayouts.id));

export const deleteSplitIfUnpaid = async (splitId: number, exec: Executor = db): Promise<boolean> => {
  const paid = await payoutsOfSplit(splitId, exec);
  if (paid.length) return false;
  await exec.delete(jobCommissionSplits).where(eq(jobCommissionSplits.id, splitId));
  return true;
};

/**
 * Send back for approval every approved rep whose figure just moved.
 *
 * A job reopened by adding a rep keeps the reps who were already paid on it
 * approved, and the job itself is open again — so its money could be edited,
 * the pool moved, and an approved rep's figure moved with it. Approving the
 * job again only signs off the open reps, so that new figure was never
 * approved by anybody. It goes back to open instead, the way reshare() treats
 * a share that moves, and the job needs approving again before it is paid.
 * A paid rep is left alone: their status already follows their ledger.
 *
 * Returns whether anyone was sent back, so the caller can roll the job up again.
 */
export async function reopenMovedApprovals(before: SplitWithPayouts[], after: SplitWithPayouts[], exec: Executor = db): Promise<boolean> {
  const was = new Map(before.map((b) => [b.split.id, b]));
  const moved = after.filter((a) => {
    const b = was.get(a.split.id);
    return !!b && b.split.status === 'approved' && a.split.status === 'approved'
      && Math.abs(a.computed.commission - b.computed.commission) > 0.005;
  });
  if (!moved.length) return false;
  await exec.update(jobCommissionSplits)
    .set({ status: 'open', approvedBy: null, approvedAt: null, updatedAt: new Date() })
    .where(inArray(jobCommissionSplits.id, moved.map((m) => m.split.id)));
  return true;
}

export const splitBelongsTo = (splitId: number, jobCommissionId: number) =>
  db.select({ id: jobCommissionSplits.id }).from(jobCommissionSplits)
    .where(and(eq(jobCommissionSplits.id, splitId), eq(jobCommissionSplits.jobCommissionId, jobCommissionId)))
    .limit(1).then((r) => r.length > 0);
