/**
 * Per-job commission records — the admin's counterpart to the rep's
 * Commission Calculator (server/commission/routes.ts, untouched).
 *
 * Read: anyone who can see the job (ownsLead), except customer service, which
 * is denylisted from money everywhere. Rep-side edits (lead source, job type,
 * the rep's checkboxes) need only job access. Money, the overhead override,
 * admin checkboxes, approve, pay, reopen: admin only.
 */
import type { Express, Request, Response } from 'express';
import { and, count, desc, eq, inArray, isNull, or, sql, sum, type AnyColumn, type SQL } from 'drizzle-orm';
import { db } from '../db';
import { jobCommissions, jobCommissionSplits, jobCommissionPayouts, leads, teamMembers, type JobCommission } from '../../shared/schema';
import { requireAuth, requireRole } from '../auth/middleware';
import { isScoped, ownsLead, type SessionUser } from '../access/rep-scope';
import { canSeeMoney } from '../../shared/rbac';
import {
  canEditJobCommissionMoney, canTickJobCommissionCheck, checkByKey, isJobType, isLeadSource, isSoldJob,
  jobCommissionBlockers, sanitizeSources, sharesBlocker, isPayoutKind,
  MAX_PAYOUT_REFERENCE, MAX_PAYOUT_NOTE,
  type ChecksState, type CommissionLine, type CommissionSources,
} from '../../shared/job-commission';
import { num } from '../../shared/num';
import { ensureJobCommission, figuresOf, lineColumns, recomputedColumns, resolveJobRep } from './service';
import {
  recomputeSplits, splitsPayload, splitWithParent, splitsForJobs, deleteSplitIfUnpaid, reshare,
  settleApprovedSplits, lockJobCommission, loadSplits, poolOf, reopenMovedApprovals,
  type Executor, type SplitWithPayouts,
} from './splits';
import { commissionStatementFilename, commissionStatementPdf } from './statement';
import { JobTreadClient } from '../integrations/jobtread';
import { logWrite } from '../writes/log';
import { sendFailure } from '../lib/failure';

/** Non-negative dollar amount — a negative cost only exists to inflate profit. */
const nonNegNum = (v: unknown): number => Math.max(0, num(v));

/** Whole positive ids off the wire, each once. */
const idList = (v: unknown): number[] => Array.isArray(v)
  ? [...new Set(v.map((x) => Number(x)).filter((n) => Number.isInteger(n) && n > 0))]
  : [];

/** Who is looking, as the roster knows them — the two ways a split can name a person. */
interface Viewer { id: number | null; rep: string | null }

async function viewerOf(user: SessionUser): Promise<Viewer> {
  const [me] = await db
    .select({ id: teamMembers.id, rep: teamMembers.jobtreadSalesRep })
    .from(teamMembers)
    .where(eq(teamMembers.email, user.email.toLowerCase()));
  return { id: me?.id ?? null, rep: me?.rep ?? null };
}

/**
 * Is this split the viewer's own? The same two matches ownCommissionsWhere()
 * makes in SQL: their team member id, or their JobTread rep name on a split
 * that was never given an id.
 */
function isOwnSplit(s: { teamMemberId: number | null; repName: string | null }, me: Viewer): boolean {
  if (me.id != null && s.teamMemberId === me.id) return true;
  return s.teamMemberId == null && !!me.rep && s.repName === me.rep;
}

/**
 * A job's money as one rep on it should see it: their own share, their own
 * payments, their own balance. Being on a job with somebody is not a reason to
 * read what they are paid — so a scoped viewer is handed only their own splits,
 * and the job's roll-up figures are rebuilt from those rather than left as the
 * whole job's. A record with no splits at all is the older single-rep shape and
 * is already theirs, so it is returned as it is.
 */
function ownMoney<T extends { commissionAmount: string | null; balanceDue: string | null; advancesPaid: string }>(
  row: T,
  mine: Array<{ commission: number; paid: number; balanceDue: number }>,
  hadSplits: boolean,
): T {
  if (!hadSplits) return row;
  const total = (pick: (m: { commission: number; paid: number; balanceDue: number }) => number) =>
    (Math.round(mine.reduce((t, m) => t + pick(m), 0) * 100) / 100).toFixed(2);
  // No pool yet is still no pool yet — not a share of zero.
  const noPool = row.commissionAmount == null;
  return {
    ...row,
    commissionAmount: noPool || !mine.length ? null : total((m) => m.commission),
    balanceDue: noPool || !mine.length ? null : total((m) => m.balanceDue),
    advancesPaid: total((m) => m.paid),
  };
}

/**
 * The record and its reps, as this viewer may see them. Anyone who sees the
 * whole company gets it all; a scoped viewer gets their own split and figures
 * built from it. Every response a rep can reach goes through here — the card
 * they read and the save they make from it alike.
 */
async function recordFor(
  user: SessionUser,
  row: JobCommission,
  payload: { pool: number; splits: SplitWithPayouts[] },
): Promise<{ commission: JobCommission; pool: number; splits: SplitWithPayouts[] }> {
  if (!isScoped(user)) return { commission: row, pool: payload.pool, splits: payload.splits };
  const me = await viewerOf(user);
  const mine = payload.splits.filter((s) => isOwnSplit(s.split, me));
  return { commission: ownMoney(row, mine.map((s) => s.computed), payload.splits.length > 0), pool: payload.pool, splits: mine };
}

/**
 * A refusal from inside a job's transaction. Thrown, so nothing the
 * transaction wrote is kept, and answered once it has rolled back.
 */
class Refusal extends Error {
  constructor(readonly status: number, readonly body: Record<string, unknown>) {
    super(String(body.error ?? body.message ?? 'refused'));
  }
}
function refuse(status: number, body: Record<string, unknown>): never {
  throw new Refusal(status, body);
}

/**
 * Change a job's reps under the job's lock, in one transaction, reading what
 * the change decides on under that lock.
 *
 * Settling and drawing lock the job row and then write its splits. Every other
 * change to the splits — a share, approve, deny, adding or removing a rep —
 * wrote the splits first and then rolled the job up, with no lock at all, so
 * two of them at once could take the same two rows in opposite orders, and
 * Postgres settles that by killing one. Everything that changes a job's reps
 * now takes the job first and its splits second.
 */
async function inJobLock<T>(id: number, work: (tx: Executor, row: JobCommission) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await lockJobCommission(tx, id);
    const [row] = await tx.select().from(jobCommissions).where(eq(jobCommissions.id, id));
    if (!row) refuse(404, { error: 'Not found' });
    return work(tx, row);
  });
}

export function registerJobCommissionRoutes(app: Express) {
  // The record for a job. Created on the spot when the job is sold and none
  // exists yet — jobs sold before this shipped get theirs the first time
  // someone opens the profile.
  app.get('/api/clients/:externalId/commission', requireAuth, async (req: Request, res: Response) => {
    try {
      const user = req.session.user! as SessionUser;
      if (!canSeeMoney(user.role, 'commissions')) return res.status(403).json({ message: 'Forbidden' });
      const externalId = req.params.externalId;
      const [lead] = await db.select().from(leads).where(eq(leads.externalId, externalId));
      if (!lead?.externalId) return res.status(404).json({ error: 'Client not found' });
      if (!(await ownsLead(user, lead.externalId))) return res.status(404).json({ error: 'Client not found' });

      const sold = isSoldJob(lead);
      let [row] = await db.select().from(jobCommissions).where(eq(jobCommissions.jobExternalId, lead.externalId));
      let autoCreated = false;
      if (!row && sold) {
        const r = await ensureJobCommission({ ...lead, externalId: lead.externalId }, `system:view:${user.email}`);
        row = r.row; autoCreated = r.created;
      }
      if (!row) return res.json({ commission: null, sold, autoCreated, pool: 0, splits: [] });
      // A rep sees their own share of the job, not their co-rep's.
      const view = await recordFor(user, row, await splitsPayload(row.id));
      res.json({ ...view, sold, autoCreated });
    } catch (error: any) {
      return sendFailure(res, error, 'GET /api/clients/:externalId/commission');
    }
  });

  // Admin starts one by hand on a job the system hasn't flagged as sold yet.
  app.post('/api/clients/:externalId/commission', requireAuth, requireRole('admin'), async (req: Request, res: Response) => {
    try {
      const user = req.session.user! as SessionUser;
      const [lead] = await db.select().from(leads).where(eq(leads.externalId, req.params.externalId));
      if (!lead?.externalId) return res.status(404).json({ error: 'Client not found' });
      const { row, created } = await ensureJobCommission({ ...lead, externalId: lead.externalId }, user.email);
      res.json({ ok: true, commission: row, created });
    } catch (error: any) {
      return sendFailure(res, error, 'POST /api/clients/:externalId/commission');
    }
  });

  /**
   * The JobTread documents on this job, for the money lines to be built from.
   *
   * Both kinds in one call: the customer orders the revenue line is picked
   * from, and the vendor orders the material and labor lines are. Live from
   * JobTread rather than the read model, because an admin closing out a job is
   * looking for the purchase order that was raised this morning.
   */
  app.get('/api/clients/:externalId/commission-documents', requireAuth, requireRole('admin'), async (req: Request, res: Response) => {
    try {
      const user = req.session.user! as SessionUser;
      const [lead] = await db.select().from(leads).where(eq(leads.externalId, req.params.externalId));
      if (!lead?.externalId) return res.status(404).json({ error: 'Client not found' });
      if (!(await ownsLead(user, lead.externalId))) return res.status(404).json({ error: 'Client not found' });
      // RoofLink and GoHighLevel clients have no JobTread job to read from —
      // an empty list, not an error, so the screen offers manual entry.
      if (lead.source !== 'jobtread') return res.json({ documents: [], reason: 'not-a-jobtread-job' });
      const r = await new JobTreadClient().getJobDocuments(lead.externalId, { limit: 50 });
      res.json({ documents: r.documents });
    } catch (error: any) {
      return sendFailure(res, error, 'GET /api/clients/:externalId/commission-documents');
    }
  });

  // Admin's list — what's open, what's waiting on whom, what's been paid.
  // `totals` is counted in the database over every record, not over the page
  // of rows returned, so the money on the Payouts screen stays true once
  // there are more records than fit in one response.
/**
 * The commission rows that belong to one person.
 *
 * Matched on team member id, and on the JobTread rep name only where no id was
 * ever written — twelve of the thirteen records carry both, the odd one out
 * carries neither and so belongs to nobody, which is right: it stays admin-only
 * until somebody assigns it.
 *
 * Fails closed. A signed-in user the roster cannot place gets a predicate that
 * matches nothing, rather than no predicate at all — which would hand them the
 * whole company's payouts.
 */
function ownCommissionsWhere(me: Viewer): SQL {
  const clauses: SQL[] = [];
  if (me?.id != null) clauses.push(eq(jobCommissions.teamMemberId, me.id));
  if (me?.rep) {
    clauses.push(and(isNull(jobCommissions.teamMemberId), eq(jobCommissions.repName, me.rep))!);
  }
  // A job can have two reps on it now, and the roll-up only names the one with
  // the bigger share. The second rep is on a split, so ask the splits too —
  // otherwise the person who worked half the job cannot see half the job.
  if (me?.id != null) {
    clauses.push(sql`EXISTS (SELECT 1 FROM ${jobCommissionSplits} s WHERE s.job_commission_id = ${jobCommissions.id} AND s.team_member_id = ${me.id})`);
  }
  if (me?.rep) {
    clauses.push(sql`EXISTS (SELECT 1 FROM ${jobCommissionSplits} s WHERE s.job_commission_id = ${jobCommissions.id} AND s.team_member_id IS NULL AND s.rep_name = ${me.rep})`);
  }
  if (!clauses.length) return sql`false`;
  return clauses.length === 1 ? clauses[0] : or(...clauses)!;
}

/** The viewer's own splits, in SQL — the same matches isOwnSplit() makes. Fails closed. */
function ownSplitsWhere(me: Viewer): SQL {
  const clauses: SQL[] = [];
  if (me.id != null) clauses.push(eq(jobCommissionSplits.teamMemberId, me.id));
  if (me.rep) clauses.push(and(isNull(jobCommissionSplits.teamMemberId), eq(jobCommissionSplits.repName, me.rep))!);
  if (!clauses.length) return sql`false`;
  return clauses.length === 1 ? clauses[0] : or(...clauses)!;
}

/**
 * What a row is worth on the board, in SQL: what is still owed, or for a paid
 * row what actually went out. A paid row's balance is zero by definition, so
 * summing balances alone made "Paid to date" read $0 however much was paid.
 * A record written before draws existed has no balance; its commission is its
 * balance. Same rule as payoutAmount() in shared/job-commission.ts.
 */
const boardAmount = (status: AnyColumn, commission: AnyColumn, balance: AnyColumn): SQL =>
  sql`CASE WHEN ${status}::text = 'paid' THEN coalesce(${commission}, 0) - coalesce(${balance}, 0) ELSE coalesce(${balance}, ${commission}) END`;

/**
 * A rep's headline numbers, from their own splits rather than whole jobs — a
 * rep on half a job is owed half of it, and the other half is not theirs to
 * see. An approved share on a job that is open again (a rep was added after
 * sign-off) is counted where the board shows it: in progress, not due, because
 * nobody can pay it until the job is approved again.
 */
async function ownTotals(me: Viewer): Promise<Array<{ status: string; count: number; amount: string | null }>> {
  const status = sql<string>`CASE WHEN ${jobCommissionSplits.status} = 'approved' AND ${jobCommissions.status} <> 'approved' THEN 'open' ELSE ${jobCommissionSplits.status}::text END`;
  return db
    .select({
      status,
      count: count(),
      amount: sum(boardAmount(jobCommissionSplits.status, jobCommissionSplits.commissionAmount, jobCommissionSplits.balanceDue)),
    })
    .from(jobCommissionSplits)
    .innerJoin(jobCommissions, eq(jobCommissionSplits.jobCommissionId, jobCommissions.id))
    .where(ownSplitsWhere(me))
    .groupBy(status);
}

  app.get('/api/job-commissions', requireAuth, async (req: Request, res: Response) => {
    try {
      const user = req.session.user! as SessionUser;
      // The permission model has always said commissions are visible from
      // 'sales' upwards, "own only, unless scope widens" — this route just
      // never implemented the scoping and locked everyone out but an admin.
      if (!canSeeMoney(user.role, 'commissions')) return res.status(403).json({ message: 'Forbidden' });

      const status = req.query.status;
      const statusWhere: SQL | undefined = status === 'open' || status === 'approved' || status === 'denied' || status === 'paid'
        ? eq(jobCommissions.status, status) : undefined;
      const me = isScoped(user) ? await viewerOf(user) : null;
      const ownWhere = me ? ownCommissionsWhere(me) : undefined;
      const where: SQL | undefined = ownWhere && statusWhere ? and(ownWhere, statusWhere) : (ownWhere ?? statusWhere);

      const base = db.select().from(jobCommissions);
      const rows = await (where ? base.where(where) : base).orderBy(desc(jobCommissions.updatedAt)).limit(500);
      const byStatus = me ? await ownTotals(me) : await db
        .select({
          status: jobCommissions.status,
          count: count(),
          amount: sum(boardAmount(jobCommissions.status, jobCommissions.commissionAmount, jobCommissions.balanceDue)),
        })
        .from(jobCommissions)
        .groupBy(jobCommissions.status);
      const totals: Record<string, { count: number; amount: number }> = {
        open: { count: 0, amount: 0 }, approved: { count: 0, amount: 0 },
        denied: { count: 0, amount: 0 }, paid: { count: 0, amount: 0 },
      };
      for (const t of byStatus) totals[t.status] = { count: Number(t.count) || 0, amount: num(t.amount) };
      // Every rep on every listed job, so the board can owe money to a person
      // rather than to whichever name the roll-up happens to carry. A rep only
      // ever gets their own — the job's other reps, and the job-wide figures
      // that add them in, stay with the people allowed to pay them.
      const splitsByJob = await splitsForJobs(rows.map((r) => r.id));
      const commissions = rows.map((r) => {
        const all = splitsByJob.get(r.id) ?? [];
        if (!me) return { ...r, splits: all };
        const mine = all.filter((s) => isOwnSplit(s, me));
        const figures = mine.map((s) => {
          const commission = num(s.commissionAmount);
          const balanceDue = num(s.balanceDue);
          return { commission, balanceDue, paid: commission - balanceDue };
        });
        return { ...ownMoney(r, figures, all.length > 0), splits: mine };
      });
      res.json({ commissions, totals });
    } catch (error: any) {
      return sendFailure(res, error, 'GET /api/job-commissions');
    }
  });

  // Mark a batch paid — whole jobs (`ids`), or particular reps on them
  // (`splitIds`), which is what the payouts board sends: it lists a person per
  // row, and "Mark paid" on Joven's row has to pay Joven, not everybody on the
  // job. Only approved records move, checked under the job's lock, so a record
  // someone reopened or paid a second ago can't be paid twice by a stale
  // screen. Anything left behind comes back in `skipped` rather than being
  // silently dropped.
  app.post('/api/job-commissions/pay', requireAuth, requireRole('admin'), async (req: Request, res: Response) => {
    try {
      const user = req.session.user!;
      const ids = idList(req.body?.ids);
      const splitIds = idList(req.body?.splitIds);
      if (!ids.length && !splitIds.length) return res.status(400).json({ error: 'Pick at least one commission to pay.' });
      if (ids.length + splitIds.length > 200) return res.status(400).json({ error: 'Pay at most 200 at a time.' });
      const reference = String(req.body?.reference || '');

      // Which job each named rep is on. A whole job asked for outright wins
      // over a rep on it asked for as well — it pays them anyway.
      const named = splitIds.length
        ? await db.select({ id: jobCommissionSplits.id, jobCommissionId: jobCommissionSplits.jobCommissionId })
          .from(jobCommissionSplits).where(inArray(jobCommissionSplits.id, splitIds))
        : [];
      const targets = new Map<number, number[] | undefined>(ids.map((id) => [id, undefined]));
      for (const s of named) {
        if (targets.has(s.jobCommissionId) && targets.get(s.jobCommissionId) === undefined) continue;
        targets.set(s.jobCommissionId, [...(targets.get(s.jobCommissionId) ?? []), s.id]);
      }

      const skipped: Array<{ id: number; splitId?: number; reason: string }> = splitIds
        .filter((sid) => !named.some((n) => n.id === sid))
        .map((sid) => ({ id: 0, splitId: sid, reason: 'no longer exists' }));
      const settledJobs: number[] = [];
      let paid = 0;
      let amount = 0;
      for (const [jobId, only] of targets) {
        const r = await settleApprovedSplits(jobId, user.email, reference, only);
        if (r.refused) { skipped.push({ id: jobId, reason: r.refused.message }); continue; }
        settledJobs.push(jobId);
        paid += r.payouts.length;
        amount += r.amount;
        // A rep the board named who turned out to be owed nothing — already
        // settled, or not approved — says so rather than vanishing.
        const paidSplits = new Set(r.payouts.map((p) => p.splitId));
        for (const sid of only ?? []) if (!paidSplits.has(sid)) skipped.push({ id: jobId, splitId: sid, reason: 'nothing owed' });
      }
      const updated = settledJobs.length
        ? await db.select().from(jobCommissions).where(inArray(jobCommissions.id, settledJobs))
        : [];

      res.json({
        ok: true,
        paid,
        // The sum of the payout rows actually written — read after the money
        // moved, so it is never the $0.00 a balance reads once it is settled.
        amount: Math.round(amount * 100) / 100,
        commissions: updated,
        skipped,
      });
    } catch (error: any) {
      return sendFailure(res, error, 'POST /api/job-commissions/pay');
    }
  });

  // Edit. Which fields you may touch depends on role; the record must be open.
  app.patch('/api/job-commissions/:id', requireAuth, async (req: Request, res: Response) => {
    try {
      const user = req.session.user! as SessionUser;
      if (!canSeeMoney(user.role, 'commissions')) return res.status(403).json({ message: 'Forbidden' });
      const id = Number(req.params.id);
      const [found] = await db.select({ jobExternalId: jobCommissions.jobExternalId }).from(jobCommissions).where(eq(jobCommissions.id, id));
      if (!found) return res.status(404).json({ error: 'Not found' });
      if (!(await ownsLead(user, found.jobExternalId))) return res.status(404).json({ error: 'Not found' });

      const body = req.body || {};
      const admin = canEditJobCommissionMoney(user.role);

      await inJobLock(id, async (tx, row) => {
        if (row.status !== 'open') refuse(409, { error: `This commission is ${row.status}. An admin can reopen it to make changes.` });
        const set: Partial<typeof jobCommissions.$inferInsert> = {};

        // Rep-side fields — anyone with job access.
        if (body.leadSource !== undefined) {
          if (body.leadSource !== null && !isLeadSource(body.leadSource)) refuse(400, { error: "leadSource must be 'self' or 'company'." });
          set.leadSource = body.leadSource;
        }
        if (body.jobType !== undefined) {
          if (!isJobType(body.jobType)) refuse(400, { error: "jobType must be 'retail' or 'insurance'." });
          set.jobType = body.jobType;
        }

        // Money and the override — admin only. A rep sending them is refused
        // outright rather than silently dropped, so the UI can't drift into
        // pretending a save happened.
        const moneyKeys = ['revenue', 'material', 'labor', 'other', 'manualOverheadPct', 'notes', 'repName', 'sources', 'advancesPaid', 'teamMemberId', 'manualCommission'] as const;
        const sentMoney = moneyKeys.filter((k) => body[k] !== undefined);
        if (sentMoney.length && !admin) refuse(403, { message: 'Only an admin can change costs, revenue, the overhead rate, or who gets paid.' });
        if (admin) {
          for (const k of ['revenue', 'material', 'labor', 'other'] as const) {
            if (body[k] !== undefined) set[k] = nonNegNum(body[k]).toFixed(2);
          }
          if (body.manualOverheadPct !== undefined) {
            set.manualOverheadPct = body.manualOverheadPct === null || body.manualOverheadPct === ''
              ? null : Math.min(100, nonNegNum(body.manualOverheadPct)).toFixed(2);
          }
          if (body.advancesPaid !== undefined) set.advancesPaid = nonNegNum(body.advancesPaid).toFixed(2);
          // The agreed figure, when a job was settled on something other than
          // half the profit. Null puts it back on the formula.
          if (body.manualCommission !== undefined) {
            set.manualCommission = body.manualCommission === null || body.manualCommission === ''
              ? null : nonNegNum(body.manualCommission).toFixed(2);
          }
          if (body.notes !== undefined) set.notes = String(body.notes || '').slice(0, 4000) || null;
          if (body.repName !== undefined) set.repName = String(body.repName || '').trim().slice(0, 200) || null;

          // Who gets paid. Picked from the roster, so the payout groups by a real
          // person rather than by however their name was spelled that day; the
          // name is taken from the member, not from whatever the browser sent.
          if (body.teamMemberId !== undefined) {
            if (body.teamMemberId === null || body.teamMemberId === '') {
              set.teamMemberId = null;
            } else {
              const memberId = Number(body.teamMemberId);
              if (!Number.isInteger(memberId) || memberId <= 0) refuse(400, { error: 'teamMemberId must be a team member id.' });
              const [member] = await tx.select({ id: teamMembers.id, name: teamMembers.name }).from(teamMembers).where(eq(teamMembers.id, memberId));
              if (!member) refuse(400, { error: 'No such team member.' });
              set.teamMemberId = member.id;
              set.repName = member.name;
            }
          }

          // Itemised lines. Only the lines the browser sent are replaced, so two
          // people editing different lines don't wipe each other's work; an empty
          // array clears a line back to a typed figure.
          if (body.sources !== undefined) {
            if (body.sources === null || typeof body.sources !== 'object' || Array.isArray(body.sources)) {
              refuse(400, { error: 'sources must be an object keyed by money line.' });
            }
            const cleaned = sanitizeSources(body.sources, user.email, new Date().toISOString());
            set.sources = { ...((row.sources as CommissionSources) || {}), ...cleaned };
          }
        }

        // Checklist: { key: true|false }. Admin boxes need an admin.
        if (body.checks && typeof body.checks === 'object') {
          const checks: ChecksState = { ...((row.checks as ChecksState) || {}) };
          for (const [key, on] of Object.entries(body.checks as Record<string, unknown>)) {
            const def = checkByKey(key);
            if (!def) refuse(400, { error: `Unknown check "${key}".` });
            if (!canTickJobCommissionCheck(user.role, def)) refuse(403, { message: `Only an admin can tick "${def.label}".` });
            if (on) checks[key] = { by: user.email, at: new Date().toISOString() };
            else delete checks[key];
          }
          set.checks = checks;
        }

        if (!Object.keys(set).length) refuse(400, { error: 'Nothing to change.' });

        // A line built from documents is worth the sum of them. Recomputed on
        // every save — including saves that only touched a typed figure — so the
        // numeric column and the itemised breakdown can never drift apart.
        if (admin) {
          const mergedSources = (set.sources ?? row.sources ?? {}) as CommissionSources;
          const typed = {
            revenue: num(set.revenue ?? row.revenue), material: num(set.material ?? row.material),
            labor: num(set.labor ?? row.labor), other: num(set.other ?? row.other),
          } as Record<CommissionLine, number>;
          Object.assign(set, lineColumns(mergedSources, typed));
        }

        const merged = { ...row, ...set };
        Object.assign(set, recomputedColumns(figuresOf(merged)));
        set.updatedAt = new Date();

        // Each rep's figure as it stood, so a rep approved on the old pool can
        // be told apart from one whose figure the new pool leaves where it was.
        const before = await loadSplits(id, poolOf(row), tx);
        await tx.update(jobCommissions).set(set).where(eq(jobCommissions.id, id));
        // The pool just moved, so every rep's share of it did too.
        const after = await recomputeSplits(id, tx);
        if (await reopenMovedApprovals(before, after, tx)) await recomputeSplits(id, tx);
      });
      const [updated] = await db.select().from(jobCommissions).where(eq(jobCommissions.id, id));
      res.json({ ok: true, ...(await recordFor(user, updated, await splitsPayload(id))) });
    } catch (error: any) {
      if (error instanceof Refusal) return res.status(error.status).json(error.body);
      return sendFailure(res, error, 'PATCH /api/job-commissions/:id');
    }
  });

  /**
   * Save the record as a PDF on the job itself, in JobTread's files, so the
   * paperwork sits with the job where an accountant or a rep can find it
   * without a login to this app. Admin only, like every other money action.
   */
  app.post('/api/job-commissions/:id/pdf', requireAuth, requireRole('admin'), async (req: Request, res: Response) => {
    try {
      const user = req.session.user!;
      const [row] = await db.select().from(jobCommissions).where(eq(jobCommissions.id, Number(req.params.id)));
      if (!row) return res.status(404).json({ error: 'Not found' });

      const pdf = commissionStatementPdf(row, user.email);
      const name = commissionStatementFilename(row);
      const saved = await new JobTreadClient().uploadJobFile(row.jobExternalId, {
        name, contentType: 'application/pdf', data: pdf,
        description: `Commission statement saved from the Team App by ${user.name}`,
        folder: 'Commissions',
      });

      await logWrite({
        actor: user.email, system: 'jobtread', action: 'commission_pdf', targetId: row.jobExternalId,
        summary: `${name} (${(pdf.length / 1024).toFixed(0)} KB)`, ok: saved.ok, error: saved.error ?? null,
      });
      if (!saved.ok) return res.status(502).json({ error: saved.error || "JobTread wouldn't accept the file." });
      res.json({ ok: true, fileId: saved.fileId, name, bytes: pdf.length });
    } catch (error: any) {
      return sendFailure(res, error, 'POST /api/job-commissions/:id/pdf');
    }
  });

  /** The same statement streamed back, for anyone who just wants to read or print it. */
  app.get('/api/job-commissions/:id/pdf', requireAuth, requireRole('admin'), async (req: Request, res: Response) => {
    try {
      const user = req.session.user!;
      const [row] = await db.select().from(jobCommissions).where(eq(jobCommissions.id, Number(req.params.id)));
      if (!row) return res.status(404).json({ error: 'Not found' });
      const pdf = commissionStatementPdf(row, user.email);
      res.setHeader('Content-Type', 'application/pdf');
      // Inline: the browser's own viewer is a better preview than a download.
      res.setHeader('Content-Disposition', `inline; filename="${commissionStatementFilename(row).replace(/[^\x20-\x7E]/g, '-').replace(/"/g, '')}"`);
      res.send(pdf);
    } catch (error: any) {
      return sendFailure(res, error, 'GET /api/job-commissions/:id/pdf');
    }
  });

  // Approve: every box ticked, source known, revenue in. Locks the record.
  app.post('/api/job-commissions/:id/approve', requireAuth, requireRole('admin'), async (req: Request, res: Response) => {
    try {
      const user = req.session.user!;
      const id = Number(req.params.id);
      const already = await inJobLock(id, async (tx, row) => {
        if (row.status === 'approved') return row; // idempotent
        if (row.status !== 'open') refuse(400, { error: `This commission is ${row.status}. Reopen it before approving.` });

        const blockers = jobCommissionBlockers({ ...figuresOf(row), checks: row.checks as ChecksState });
        if (blockers.length) refuse(400, { error: `Not ready to approve: ${blockers.join(', ')}.`, blockers });

        // Approving the job approves everybody on it, and the shares have to add
        // up before any of it is owed to anyone.
        const { splits } = await splitsPayload(id, tx);
        const bad = sharesBlocker(splits.map((x) => ({
          sharePct: num(x.split.sharePct), manualAmount: x.split.manualAmount == null ? null : num(x.split.manualAmount),
        })));
        if (bad) refuse(400, { error: bad, blockers: [bad] });

        await tx.update(jobCommissionSplits)
          .set({ status: 'approved', approvedBy: user.email, approvedAt: new Date(), updatedAt: new Date() })
          .where(and(eq(jobCommissionSplits.jobCommissionId, id), eq(jobCommissionSplits.status, 'open')));
        await recomputeSplits(id, tx);
        return null;
      });
      if (already) return res.json({ ok: true, commission: already });
      const [updated] = await db.select().from(jobCommissions).where(eq(jobCommissions.id, id));
      const after = await splitsPayload(id);
      res.json({ ok: true, commission: updated, pool: after.pool, splits: after.splits });
    } catch (error: any) {
      if (error instanceof Refusal) return res.status(error.status).json(error.body);
      return sendFailure(res, error, 'POST /api/job-commissions/:id/approve');
    }
  });

  /**
   * Deny: this commission is not going to be paid.
   *
   * Approve was the only way out of an open record, so anything wrong — a job
   * that lost money, a record raised against the wrong job, a figure nobody
   * could agree on — sat open for ever and cluttered the board. A denial ends
   * it, carries the reason, and Reopen undoes it if the decision changes.
   */
  app.post('/api/job-commissions/:id/deny', requireAuth, requireRole('admin'), async (req: Request, res: Response) => {
    try {
      const user = req.session.user!;
      const id = Number(req.params.id);
      const reason = String(req.body?.reason || '').trim().slice(0, 1000);
      // A bare "denied" tells the rep nothing and tells the next admin less.
      if (!reason) return res.status(400).json({ error: 'Say why it was denied — the rep will want to know.' });

      const already = await inJobLock(id, async (tx, row) => {
        if (row.status === 'paid') refuse(400, { error: 'This commission has already been paid. Reopen it first if it needs undoing.' });
        if (row.status === 'denied') return row;

        await tx.update(jobCommissionSplits)
          .set({ status: 'denied', deniedBy: user.email, deniedAt: new Date(), deniedReason: reason, updatedAt: new Date() })
          .where(and(eq(jobCommissionSplits.jobCommissionId, id), sql`${jobCommissionSplits.status} <> 'paid'`));
        await tx.update(jobCommissions)
          .set({ deniedBy: user.email, deniedAt: new Date(), deniedReason: reason, updatedAt: new Date() })
          .where(eq(jobCommissions.id, id));
        await recomputeSplits(id, tx);
        return null;
      });
      if (already) return res.json({ ok: true, commission: already });
      const [updated] = await db.select().from(jobCommissions).where(eq(jobCommissions.id, id));
      const after = await splitsPayload(id);
      res.json({ ok: true, commission: updated, pool: after.pool, splits: after.splits });
    } catch (error: any) {
      if (error instanceof Refusal) return res.status(error.status).json(error.body);
      return sendFailure(res, error, 'POST /api/job-commissions/:id/deny');
    }
  });

  // Paid: the payout went out. Only from approved.
  app.post('/api/job-commissions/:id/paid', requireAuth, requireRole('admin'), async (req: Request, res: Response) => {
    try {
      const user = req.session.user!;
      const id = Number(req.params.id);
      const [row] = await db.select().from(jobCommissions).where(eq(jobCommissions.id, id));
      if (!row) return res.status(404).json({ error: 'Not found' });
      if (row.status === 'paid') return res.json({ ok: true, commission: row });
      if (row.status !== 'approved') return res.status(400).json({ error: 'Approve the commission before marking it paid.' });

      // "Paid" is the balance actually going out to each rep who is still
      // owed something, written into their ledger. Status follows from that
      // rather than being set beside it.
      const settled = await settleApprovedSplits(id, user.email, String(req.body?.reference || ''));
      if (settled.refused?.reason === 'shares') return res.status(400).json({ error: settled.refused.message });
      if (settled.refused?.reason === 'status' && settled.refused.message !== 'already paid') {
        return res.status(400).json({ error: 'Approve the commission before marking it paid.' });
      }
      const [updated] = await db.select().from(jobCommissions).where(eq(jobCommissions.id, id));
      const after = await splitsPayload(id);
      res.json({ ok: true, commission: updated, pool: after.pool, splits: after.splits });
    } catch (error: any) {
      return sendFailure(res, error, 'POST /api/job-commissions/:id/paid');
    }
  });

  /**
   * Put another rep on the job. Shares are evened out across everybody rather
   * than left for the admin to fix up: two reps become 50/50, three 34/33/33,
   * which is right far more often than it is wrong and is one click to change.
   */
  app.post('/api/job-commissions/:id/splits', requireAuth, requireRole('admin'), async (req: Request, res: Response) => {
    try {
      const user = req.session.user!;
      const id = Number(req.params.id);
      const teamMemberId = req.body?.teamMemberId == null ? null : Number(req.body.teamMemberId);
      await inJobLock(id, async (tx, row) => {
        if (row.status === 'paid') refuse(400, { error: 'This job is paid. Reopen it before changing who is on it.' });

        let repName = String(req.body?.repName || '').trim().slice(0, 200) || null;
        if (teamMemberId != null) {
          if (!Number.isInteger(teamMemberId)) refuse(400, { error: 'Unknown rep.' });
          const [m] = await tx.select({ name: teamMembers.name }).from(teamMembers).where(eq(teamMembers.id, teamMemberId));
          if (!m) refuse(400, { error: 'Unknown rep.' });
          repName = m.name;
        }
        if (teamMemberId == null && !repName) refuse(400, { error: 'Pick a rep.' });

        const existing = await tx.select().from(jobCommissionSplits).where(eq(jobCommissionSplits.jobCommissionId, id));
        if (teamMemberId != null && existing.some((e) => e.teamMemberId === teamMemberId)) {
          refuse(400, { error: `${repName} is already on this job.` });
        }
        if (existing.length >= 6) refuse(400, { error: 'Six reps on one job is already more than enough.' });

        await tx.insert(jobCommissionSplits).values({
          jobCommissionId: id, teamMemberId, repName, sharePct: '0.00', createdBy: user.email,
        });

        // Even the shares out, leaving anybody on an agreed figure of their own,
        // and anybody already paid on the share they had, alone.
        await reshare(id, tx);
        await recomputeSplits(id, tx);
      });
      const after = await splitsPayload(id);
      res.json({ ok: true, pool: after.pool, splits: after.splits });
    } catch (error: any) {
      if (error instanceof Refusal) return res.status(error.status).json(error.body);
      return sendFailure(res, error, 'POST /api/job-commissions/:id/splits');
    }
  });

  /** Change one rep's share, their agreed figure, or the note against them. */
  app.patch('/api/job-commissions/:id/splits/:splitId', requireAuth, requireRole('admin'), async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      const splitId = Number(req.params.splitId);
      const body = req.body || {};
      await inJobLock(id, async (tx) => {
        const found = await splitWithParent(splitId, tx);
        if (!found || found.split.jobCommissionId !== id) refuse(404, { error: 'Not found' });
        if (found.split.status === 'paid') refuse(400, { error: 'This rep has been paid. Reopen the record before changing their share.' });
        // An approved share is the figure somebody signed off. Moving it after
        // the fact would pay out more, or less, than the job earned without
        // anyone approving that — so it takes a reopen, and approving again
        // checks the shares still come to 100%. The note is not money and stays
        // editable.
        if (found.split.status === 'approved' && ('sharePct' in body || 'manualAmount' in body)) {
          refuse(400, { error: "This rep's share has been approved. Reopen the job to change it — it will need approving again." });
        }

        const set: Record<string, unknown> = {};
        if ('sharePct' in body) {
          const pct = num(body.sharePct);
          if (!(pct >= 0 && pct <= 100)) refuse(400, { error: 'A share is between 0 and 100 percent.' });
          set.sharePct = pct.toFixed(2);
        }
        if ('manualAmount' in body) {
          set.manualAmount = body.manualAmount == null || body.manualAmount === ''
            ? null : nonNegNum(body.manualAmount).toFixed(2);
        }
        if ('notes' in body) set.notes = String(body.notes ?? '').trim().slice(0, 1000) || null;
        if (!Object.keys(set).length) refuse(400, { error: 'Nothing to change.' });
        set.updatedAt = new Date();

        await tx.update(jobCommissionSplits).set(set).where(eq(jobCommissionSplits.id, splitId));
        await recomputeSplits(id, tx);
      });
      const after = await splitsPayload(id);
      res.json({ ok: true, pool: after.pool, splits: after.splits });
    } catch (error: any) {
      if (error instanceof Refusal) return res.status(error.status).json(error.body);
      return sendFailure(res, error, 'PATCH /api/job-commissions/:id/splits/:splitId');
    }
  });

  /**
   * Take a rep off the job. Refused once they have been paid anything —
   * deleting the row would delete the record of money that actually left.
   */
  app.delete('/api/job-commissions/:id/splits/:splitId', requireAuth, requireRole('admin'), async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      const splitId = Number(req.params.splitId);
      await inJobLock(id, async (tx) => {
        const found = await splitWithParent(splitId, tx);
        if (!found || found.split.jobCommissionId !== id) refuse(404, { error: 'Not found' });

        const all = await tx.select({ id: jobCommissionSplits.id }).from(jobCommissionSplits).where(eq(jobCommissionSplits.jobCommissionId, id));
        if (all.length <= 1) refuse(400, { error: 'Somebody has to be on the job. Change the rep instead of removing them.' });
        // Under the job's lock, so a draw recorded in the same moment is either
        // seen here and the rep stays, or lands after and finds them gone.
        if (!(await deleteSplitIfUnpaid(splitId, tx))) {
          refuse(400, { error: 'This rep has already been paid on this job — remove the payouts first if that was wrong.' });
        }

        await reshare(id, tx);
        await recomputeSplits(id, tx);
      });
      const after = await splitsPayload(id);
      res.json({ ok: true, pool: after.pool, splits: after.splits });
    } catch (error: any) {
      if (error instanceof Refusal) return res.status(error.status).json(error.body);
      return sendFailure(res, error, 'DELETE /api/job-commissions/:id/splits/:splitId');
    }
  });

  /**
   * Record money handed to a rep — a draw off a customer check as it lands, or
   * the balance at the end. The check it came out of goes in `reference`, so
   * months later the row still says which payment it was part of.
   */
  app.post('/api/job-commissions/:id/splits/:splitId/payouts', requireAuth, requireRole('admin'), async (req: Request, res: Response) => {
    try {
      const user = req.session.user!;
      const id = Number(req.params.id);
      const splitId = Number(req.params.splitId);
      const amount = nonNegNum(req.body?.amount);
      if (amount <= 0) return res.status(400).json({ error: 'How much went out?' });
      const kind = isPayoutKind(req.body?.kind) ? req.body.kind : 'draw';

      // Under the same lock as a settle-up, so a draw recorded in the same
      // moment as "Mark paid" is seen by it rather than paid on top of.
      await inJobLock(id, async (tx, job) => {
        // Read under the lock, not before it. Checked first and locked after,
        // a "Mark paid" landing in between settled the rep, and the draw was
        // then paid on top of a balance that had already gone out.
        const found = await splitWithParent(splitId, tx);
        if (!found || found.split.jobCommissionId !== id) refuse(404, { error: 'Not found' });
        if (found.split.status === 'open') refuse(400, { error: 'Approve this rep\'s commission before paying any of it out.' });
        if (found.split.status === 'denied') refuse(400, { error: 'This commission was denied. Reopen it before paying anything.' });
        if (found.split.status === 'paid') refuse(400, { error: 'This rep has already been paid in full. Reopen the job if they are owed more.' });
        // An approved rep on a job that is open again (somebody was added after
        // sign-off) is not payable either: nothing on the job is until it is
        // approved again, which is what the board shows.
        if (job.status !== 'approved') refuse(400, { error: `This job is ${job.status}. Approve it again before paying anything out.` });

        await tx.insert(jobCommissionPayouts).values({
          splitId, amount: amount.toFixed(2), kind,
          reference: String(req.body?.reference ?? '').trim().slice(0, MAX_PAYOUT_REFERENCE) || null,
          note: String(req.body?.note ?? '').trim().slice(0, MAX_PAYOUT_NOTE) || null,
          paidAt: req.body?.paidAt ? new Date(String(req.body.paidAt)) : new Date(),
          paidBy: user.email,
        });
        await recomputeSplits(id, tx);
      });
      const after = await splitsPayload(id);
      res.json({ ok: true, pool: after.pool, splits: after.splits });
    } catch (error: any) {
      if (error instanceof Refusal) return res.status(error.status).json(error.body);
      return sendFailure(res, error, 'POST /api/job-commissions/:id/splits/:splitId/payouts');
    }
  });

  /** Undo a payout that was entered wrongly. */
  app.delete('/api/job-commissions/:id/splits/:splitId/payouts/:payoutId', requireAuth, requireRole('admin'), async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      const splitId = Number(req.params.splitId);
      const payoutId = Number(req.params.payoutId);
      await inJobLock(id, async (tx) => {
        const found = await splitWithParent(splitId, tx);
        if (!found || found.split.jobCommissionId !== id) refuse(404, { error: 'Not found' });
        const deleted = await tx.delete(jobCommissionPayouts)
          .where(and(eq(jobCommissionPayouts.id, payoutId), eq(jobCommissionPayouts.splitId, splitId)))
          .returning();
        if (!deleted.length) refuse(404, { error: 'Not found' });
        await recomputeSplits(id, tx);
      });
      const after = await splitsPayload(id);
      res.json({ ok: true, pool: after.pool, splits: after.splits });
    } catch (error: any) {
      if (error instanceof Refusal) return res.status(error.status).json(error.body);
      return sendFailure(res, error, 'DELETE /api/job-commissions/:id/splits/:splitId/payouts/:payoutId');
    }
  });

  // Reopen an approved/paid record so it can be corrected. Clears the
  // approval and payout stamps — they'll be re-earned on the way back.
  app.post('/api/job-commissions/:id/reopen', requireAuth, requireRole('admin'), async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      const already = await inJobLock(id, async (tx, row) => {
        if (row.status === 'open') return row;

        // Payouts are not cleared: that money really did leave the building, and
        // a reopened record that forgets it would pay the rep twice.
        await tx.update(jobCommissionSplits)
          .set({ status: 'open', approvedBy: null, approvedAt: null, deniedBy: null, deniedAt: null, deniedReason: null, updatedAt: new Date() })
          .where(eq(jobCommissionSplits.jobCommissionId, id));
        await tx.update(jobCommissions)
          .set({
            status: 'open', approvedBy: null, approvedAt: null, paidBy: null, paidAt: null,
            deniedBy: null, deniedAt: null, deniedReason: null, updatedAt: new Date(),
          })
          .where(eq(jobCommissions.id, id));
        await recomputeSplits(id, tx);
        return null;
      });
      if (already) return res.json({ ok: true, commission: already });
      const [updated] = await db.select().from(jobCommissions).where(eq(jobCommissions.id, id));
      const after = await splitsPayload(id);
      res.json({ ok: true, commission: updated, pool: after.pool, splits: after.splits });
    } catch (error: any) {
      if (error instanceof Refusal) return res.status(error.status).json(error.body);
      return sendFailure(res, error, 'POST /api/job-commissions/:id/reopen');
    }
  });
}
