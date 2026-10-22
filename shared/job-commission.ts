// Per-job commission record: the admin-side counterpart of the rep's
// Commission Calculator. The calculator stays a free-form tool a rep fills in
// by hand; this record is created automatically the moment a JobTread job is
// sold, pre-filled from the job with what is known for certain (rep, insurance
// flag — never the price, which an admin types from the signed contract), and
// then walked through a short checklist by the rep and the admin so the
// system knows the inputs are real before anything is approved.
//
// The formula itself is calculateCommission() in ./commission — never a copy.

import { calculateCommission, type JobType, type LeadSource } from './commission';
import { roundCents } from './num';
import { atLeast, type TeamRole } from './rbac';

/** Pipeline stages (JobTread "Status") that only a sold job can be in. */
export const SOLD_STAGES: readonly string[] = [
  'Insurance Approved', 'Buyer Approved', 'Permitting', 'Schedule', 'Pre-Construction',
  'Roof Construction', 'Other Construction Work', 'Complete', 'PIF File Warranties', 'Closed',
];
const SOLD_STAGE_SET = new Set(SOLD_STAGES);

/**
 * "Sold" is either JobTread's own job status (approved/paid/closed all map to
 * our `won`) or a pipeline stage past the sale — a rep dragging a job to
 * Buyer Approved has sold it even before JobTread's status catches up.
 */
export function isSoldJob(job: { status?: string | null; stage?: string | null }): boolean {
  if (job.status === 'won') return true;
  return !!job.stage && SOLD_STAGE_SET.has(job.stage);
}

export type CheckOwner = 'rep' | 'admin';

export interface JobCommissionCheck {
  key: string;
  label: string;
  hint?: string;
  /** Who is expected to tick it. Admin can tick anything; a rep only their own. */
  who: CheckOwner;
}

export const JOB_COMMISSION_CHECKS: readonly JobCommissionCheck[] = [
  { key: 'sold_confirmed', who: 'rep', label: 'Sold — signed contract / approved estimate is in JobTread' },
  { key: 'lead_source_confirmed', who: 'rep', label: 'Lead source and job type above are correct', hint: 'This sets the overhead rate, so it has to be right.' },
  { key: 'revenue_final', who: 'admin', label: 'Revenue is the final contract price', hint: 'Change orders and supplements included.' },
  { key: 'material_final', who: 'admin', label: 'Material cost is final', hint: 'Every supplier invoice is in.' },
  { key: 'labor_final', who: 'admin', label: 'Labor cost is final', hint: 'Crew and sub invoices are in.' },
];

export type CheckKey = typeof JOB_COMMISSION_CHECKS[number]['key'];
const CHECK_BY_KEY = new Map(JOB_COMMISSION_CHECKS.map((c) => [c.key, c]));
export function checkByKey(key: string): JobCommissionCheck | undefined { return CHECK_BY_KEY.get(key); }

/** A ticked box records who ticked it and when; an unticked one is absent. */
export type ChecksState = Record<string, { by: string; at: string }>;

export function missingJobCommissionChecks(checks: ChecksState | null | undefined): JobCommissionCheck[] {
  const c = checks || {};
  return JOB_COMMISSION_CHECKS.filter((k) => !c[k.key]);
}

export type JobCommissionStatus = 'open' | 'approved' | 'denied' | 'paid';

export const JOB_COMMISSION_STATUS_LABEL: Record<JobCommissionStatus, string> = {
  open: 'Open',
  approved: 'Approved',
  denied: 'Denied',
  paid: 'Paid',
};

/** A settled record: nothing more is owed and nothing more is expected. */
export function isSettled(status: JobCommissionStatus): boolean {
  return status === 'paid' || status === 'denied';
}

/** Money fields, the overhead override, approval and payout are admin-only. */
export function canEditJobCommissionMoney(role: TeamRole): boolean {
  return atLeast(role, 'admin');
}

/** Rep boxes can be ticked by anyone who can see the job; admin boxes only by an admin. */
export function canTickJobCommissionCheck(role: TeamRole, check: JobCommissionCheck): boolean {
  return check.who === 'rep' ? true : atLeast(role, 'admin');
}

/**
 * Where a money line's figure came from.
 *
 * Revenue, material and labour used to be three typed numbers. On a job with
 * two suppliers and two crews that meant an admin adding four invoices up in
 * their head and typing the total, so a fat-fingered figure looked exactly
 * like a correct one and nobody could tell afterwards which invoices it was
 * meant to cover. A line now carries the pieces it was built from: documents
 * picked off the JobTread job, amounts typed by hand, or a mix, and as many
 * of each as the job actually had.
 *
 * The amount is a snapshot taken when the document was attached. A document
 * that is re-priced in JobTread afterwards does not silently move a commission
 * that has already been worked out — the admin re-attaches it and sees the
 * change.
 */
export const COMMISSION_LINES = ['revenue', 'material', 'labor', 'other'] as const;
export type CommissionLine = typeof COMMISSION_LINES[number];

export const COMMISSION_LINE_LABEL: Record<CommissionLine, string> = {
  revenue: 'Total job revenue',
  material: 'Material cost',
  labor: 'Labor cost',
  other: 'Other expenses',
};

/** Which kind of JobTread document belongs on each line. */
export const COMMISSION_LINE_DOC_TYPE: Record<CommissionLine, 'customerOrder' | 'vendorOrder'> = {
  revenue: 'customerOrder',   // the approved estimate/proposal the customer signed
  material: 'vendorOrder',    // supplier purchase orders
  labor: 'vendorOrder',       // crew and sub work orders
  other: 'vendorOrder',
};

export interface CommissionSource {
  /** Stable within the record, so a row can be removed or edited without ambiguity. */
  id: string;
  kind: 'doc' | 'manual';
  /** Document name, or whatever the admin called a hand-entered amount. */
  label: string;
  amount: number;
  /** Set for kind === 'doc'. */
  docId?: string;
  docNumber?: string | null;
  docStatus?: string | null;
  /**
   * What the document said when it was attached. Every row is editable —
   * a purchase order is what we agreed to pay, not always what we paid — but
   * an amount typed over a document's own figure should say so rather than
   * look like the document said that all along.
   */
  docAmount?: number;
  addedBy?: string;
  addedAt?: string;
  editedBy?: string;
  editedAt?: string;
}

/** True when a document-backed row has been corrected by hand. */
export function isAdjusted(s: CommissionSource): boolean {
  return s.kind === 'doc' && s.docAmount != null && Math.abs(s.amount - s.docAmount) >= 0.005;
}

/** Per-line lists. A line missing from the map has no attached sources. */
export type CommissionSources = Partial<Record<CommissionLine, CommissionSource[]>>;

export const isCommissionLine = (v: unknown): v is CommissionLine =>
  typeof v === 'string' && (COMMISSION_LINES as readonly string[]).includes(v);

/**
 * Cents, not floating point dust: 0.1 + 0.2 has no business reaching a payout.
 * The shared helper, because the Math.round(n * 100) / 100 this used to be
 * turned $1.005 into $1.00.
 */
const round2 = (n: number): number => roundCents(Number(n) || 0);

export function sourcesFor(sources: CommissionSources | null | undefined, line: CommissionLine): CommissionSource[] {
  const list = sources?.[line];
  return Array.isArray(list) ? list : [];
}

export function sourcesTotal(list: readonly CommissionSource[] | null | undefined): number {
  if (!Array.isArray(list)) return 0;
  return round2(list.reduce((t, s) => t + (Number(s?.amount) || 0), 0));
}

/**
 * What a line is worth. Attached sources win over the typed figure — once an
 * admin has itemised a line, the total is the arithmetic, and letting a stale
 * hand-typed number override it is how the two disagree.
 */
export function resolveLine(
  line: CommissionLine,
  sources: CommissionSources | null | undefined,
  typed: number,
): number {
  const list = sourcesFor(sources, line);
  return list.length ? sourcesTotal(list) : round2(typed);
}

/** True once a line is itemised, so the UI knows to show the list, not an input. */
export function isItemised(sources: CommissionSources | null | undefined, line: CommissionLine): boolean {
  return sourcesFor(sources, line).length > 0;
}

/** Already attached? Stops the same purchase order being counted twice. */
export function hasDoc(list: readonly CommissionSource[] | null | undefined, docId: string): boolean {
  return Array.isArray(list) && list.some((s) => s.kind === 'doc' && s.docId === docId);
}

/**
 * Accept one source off the wire. Returns null for anything that isn't a
 * usable row, so a malformed entry is dropped rather than stored as a zero
 * that quietly changes a payout.
 */
export function sanitizeSource(raw: unknown, by: string, at: string, seq: number): CommissionSource | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const kind = r.kind === 'doc' ? 'doc' : r.kind === 'manual' ? 'manual' : null;
  if (!kind) return null;
  const amount = Number(r.amount);
  if (!Number.isFinite(amount) || amount < 0) return null;
  const docId = typeof r.docId === 'string' && r.docId.trim() ? r.docId.trim().slice(0, 64) : undefined;
  if (kind === 'doc' && !docId) return null;
  const label = String(r.label ?? '').trim().slice(0, 200)
    || (kind === 'doc' ? 'JobTread document' : 'Manual amount');
  const id = typeof r.id === 'string' && r.id.trim() ? r.id.trim().slice(0, 64) : `s${seq}-${Date.now().toString(36)}`;
  const docAmount = Number(r.docAmount);
  return {
    id, kind, label, amount: round2(amount),
    ...(kind === 'doc' ? {
      docId,
      docNumber: r.docNumber == null ? null : String(r.docNumber).slice(0, 40),
      docStatus: r.docStatus == null ? null : String(r.docStatus).slice(0, 40),
      ...(Number.isFinite(docAmount) && docAmount >= 0 ? { docAmount: round2(docAmount) } : {}),
    } : {}),
    addedBy: typeof r.addedBy === 'string' && r.addedBy ? r.addedBy.slice(0, 200) : by,
    addedAt: typeof r.addedAt === 'string' && r.addedAt ? r.addedAt.slice(0, 40) : at,
    ...(typeof r.editedBy === 'string' && r.editedBy ? { editedBy: r.editedBy.slice(0, 200) } : {}),
    ...(typeof r.editedAt === 'string' && r.editedAt ? { editedAt: r.editedAt.slice(0, 40) } : {}),
  };
}

/** Cap per line — a real job has a handful of invoices, not a hundred. */
export const MAX_SOURCES_PER_LINE = 40;

/**
 * Accept a whole `{ line: [...] }` map off the wire, dropping unusable rows and
 * de-duplicating documents. An empty array clears that line back to typed entry.
 */
export function sanitizeSources(raw: unknown, by: string, at: string): CommissionSources {
  const out: CommissionSources = {};
  if (!raw || typeof raw !== 'object') return out;
  let seq = 0;
  for (const [line, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!isCommissionLine(line) || !Array.isArray(value)) continue;
    const seen = new Set<string>();
    const list: CommissionSource[] = [];
    for (const item of value.slice(0, MAX_SOURCES_PER_LINE)) {
      const s = sanitizeSource(item, by, at, seq++);
      if (!s) continue;
      if (s.kind === 'doc' && s.docId) {
        if (seen.has(s.docId)) continue;
        seen.add(s.docId);
      }
      list.push(s);
    }
    out[line] = list;
  }
  return out;
}

export interface JobCommissionFigures {
  leadSource: LeadSource | null;
  jobType: JobType;
  revenue: number;
  material: number;
  labor: number;
  other: number;
  manualOverheadPct: number | null;
  /**
   * Draws already paid to the rep on this job — 10% off the top of each
   * customer payment before the final one. Optional so every existing caller
   * keeps working and means "none".
   */
  advancesPaid?: number;
  /**
   * A commission agreed rather than calculated. Null means use the formula.
   * Without this the only way to reach an agreed figure was to bend the costs
   * until the formula produced it, which leaves a record that reads as fact.
   */
  manualCommission?: number | null;
}

export interface JobCommissionResult {
  overheadPct: number;
  overheadAmount: number;
  profit: number;
  /** What the rep earned on the job: half the profit, or the figure set by hand. */
  commission: number;
  /** What the formula would have paid — kept so an override shows what it overrode. */
  calculatedCommission: number;
  isManual: boolean;
  advancesPaid: number;
  /**
   * What is still owed to the rep. Negative means the draws came to more than
   * the job finally earned and the difference has to be recovered — worth
   * seeing rather than being floored away into a tidy zero.
   */
  balanceDue: number;
}

/**
 * Null until the rep has said where the lead came from — the overhead rate
 * depends on it, and a number computed from a guess would be read as fact.
 *
 * Advances come off the rep's half and nothing else. The company's half of the
 * profit is what it was before any draw was taken, because a draw is an early
 * payment of the rep's own money, not a cost of the job.
 */
// ---- splits: more than one rep on a job ---------------------------------------
//
// A job earns one commission pool — half the profit, or the figure set by
// hand. When two reps worked it, that pool is divided between them by a share
// each, and the shares have to come to the whole pool: a job that pays out 90%
// of what it earned is either a typo or a decision nobody wrote down, and the
// record should not quietly accept either.
//
// The job's money stays on the job. A split carries only who, how much of the
// pool, and what has actually been paid — so revenue is never counted twice,
// which is the trap that doubles a commission.

export const SPLIT_SHARE_SCALE = 100;

export interface CommissionSplitFigures {
  /** This rep's percentage of the pool, 0–100. */
  sharePct: number;
  /** A figure agreed for this rep regardless of the share. Null = use the share. */
  manualAmount?: number | null;
}

/**
 * What one rep earns out of the pool, on their own. With more than one rep on
 * the job use splitAmounts, which makes the cents add up across all of them.
 */
export function splitCommission(pool: number, f: CommissionSplitFigures): number {
  if (f.manualAmount != null) return Math.max(0, round2(f.manualAmount));
  const pct = Math.min(100, Math.max(0, f.sharePct));
  return round2((pool * pct) / 100);
}

/**
 * Every rep's amount at once, in whole cents that add up to the pool.
 *
 * Rounding each rep on their own does not: three reps at 33.34/33.33/33.33 of
 * a $100.01 pool each rounded to $33.34 + $33.33 + $33.33 = $100.00, and the
 * job showed a cent nobody was ever paid. Here each share is floored to the
 * cent and the cents left over go, one at a time, to the reps whose exact
 * share was cut the most (earliest rep first on a tie), so the share-based
 * amounts total the pool times their shares exactly. A rep on a figure of
 * their own keeps that figure and takes no part in the sharing.
 */
export function splitAmounts(pool: number, splits: readonly CommissionSplitFigures[]): number[] {
  const out = splits.map((f) => (f.manualAmount != null ? Math.max(0, round2(f.manualAmount)) : 0));
  const byShare = splits
    .map((f, i) => ({ i, pct: Math.min(100, Math.max(0, Number(f.sharePct) || 0)), manual: f.manualAmount != null }))
    .filter((s) => !s.manual);
  if (!byShare.length) return out;
  const poolCents = Math.round(round2(Math.max(0, Number(pool) || 0)) * 100);
  // Exact cents per rep, cleaned of float noise so 50% of 1001 is 500.5, not 500.49999.
  const exact = byShare.map((s) => Number(((poolCents * s.pct) / 100).toPrecision(12)));
  const target = Math.round(Number(exact.reduce((t, c) => t + c, 0).toPrecision(12)));
  const floors = exact.map((c) => Math.floor(c));
  let left = target - floors.reduce((t, c) => t + c, 0);
  const order = byShare.map((_, k) => k).sort((a, b) => (exact[b] - floors[b]) - (exact[a] - floors[a]) || a - b);
  for (const k of order) {
    if (left <= 0) break;
    floors[k] += 1;
    left -= 1;
  }
  byShare.forEach((s, k) => { out[s.i] = floors[k] / 100; });
  return out;
}

/** Percentages that don't come to 100, or null when they do. */
export function sharesBlocker(splits: readonly CommissionSplitFigures[]): string | null {
  if (!splits.length) return 'Nobody is on this job yet.';
  // A rep on a figure of their own isn't claiming a share of the pool.
  const byShare = splits.filter((s) => s.manualAmount == null);
  if (!byShare.length) return null;
  const total = round2(byShare.reduce((sum, s) => sum + (Number(s.sharePct) || 0), 0));
  if (Math.abs(total - 100) < 0.01) return null;
  return `Shares come to ${total}%, not 100% — ${total > 100 ? 'take' : 'add'} ${round2(Math.abs(100 - total))}%.`;
}

/**
 * Even shares for n reps, the last one carrying the rounding so they still
 * total what was handed out. That is 100 unless somebody's share is already
 * spoken for — a rep who has been paid keeps the share they were paid on, and
 * only what is left of the pool is evened out between everyone else.
 */
export function evenShares(n: number, total = 100): number[] {
  if (n <= 0) return [];
  const whole = Math.max(0, round2(total));
  const each = round2(whole / n);
  const out = Array.from({ length: n }, () => each);
  out[n - 1] = round2(whole - each * (n - 1));
  return out;
}

export type PayoutKind = 'draw' | 'balance';
export const PAYOUT_KINDS: readonly PayoutKind[] = ['draw', 'balance'];
export const PAYOUT_KIND_LABEL: Record<PayoutKind, string> = {
  draw: 'Draw',
  balance: 'Balance',
};
export const isPayoutKind = (v: unknown): v is PayoutKind => v === 'draw' || v === 'balance';
export const MAX_PAYOUT_REFERENCE = 60;
export const MAX_PAYOUT_NOTE = 300;

/**
 * One payment actually made to a rep. Named apart from `PayoutLike` below,
 * which is a whole commission record sitting on the payouts board — same
 * English word, two different things, and an interface of the same name would
 * silently merge with it rather than clash.
 */
export interface CommissionPayoutLike { amount: number; kind?: string | null }

export interface CommissionSplitResult {
  commission: number;
  isManual: boolean;
  /** Everything already handed to this rep, draws and settle-ups alike. */
  paid: number;
  /** Just the draws — the 10% taken off each check before the final one. */
  drawn: number;
  /** Still owed. Negative means the rep has had more than the job finally earned. */
  balanceDue: number;
  settled: boolean;
}

/**
 * One rep's position on a job. Every payment is a row, so "advances paid" is
 * the sum of the draw rows rather than a figure somebody keeps up to date by
 * hand — the two can't disagree because there is only one of them.
 */
export function computeCommissionSplit(
  pool: number,
  f: CommissionSplitFigures,
  payouts: readonly CommissionPayoutLike[],
  /** This rep's entry from splitAmounts, so the reps on one job add up to its pool. */
  allocated?: number,
): CommissionSplitResult {
  const commission = allocated != null && Number.isFinite(allocated) ? round2(allocated) : splitCommission(pool, f);
  const paid = round2(payouts.reduce((sum, p) => sum + (Number(p.amount) || 0), 0));
  const drawn = round2(payouts.filter((p) => p.kind !== 'balance').reduce((sum, p) => sum + (Number(p.amount) || 0), 0));
  const balanceDue = round2(commission - paid);
  return { commission, isManual: f.manualAmount != null, paid, drawn, balanceDue, settled: Math.abs(balanceDue) < 0.01 };
}

/**
 * The job's own money columns, given the pool and everything paid out of it.
 *
 * Null propagates: a record whose lead source nobody has set has no pool, and
 * so has no commission and no balance — not a commission of zero. Zero is a
 * claim ("we worked it out and it came to nothing"); null is the absence of
 * one, and the payouts board's coalesce(balance_due, commission_amount)
 * depends on being able to tell them apart.
 */
export function rollUpColumns(pool: number | null, paid: number): {
  commissionAmount: string | null; advancesPaid: string; balanceDue: string | null;
} {
  return {
    commissionAmount: pool == null ? null : pool.toFixed(2),
    advancesPaid: round2(paid).toFixed(2),
    balanceDue: pool == null ? null : round2(pool - paid).toFixed(2),
  };
}

/**
 * The job's status, given its reps'. A job is only finished when everybody on
 * it is: one rep paid and another still waiting is an open job, not a paid
 * one, and the payouts board has to keep showing it.
 */
export function rollUpCommissionStatus(splits: readonly { status: JobCommissionStatus }[]): JobCommissionStatus {
  if (!splits.length) return 'open';
  if (splits.every((s) => s.status === 'denied')) return 'denied';
  const live = splits.filter((s) => s.status !== 'denied');
  if (!live.length) return 'denied';
  if (live.every((s) => s.status === 'paid')) return 'paid';
  if (live.every((s) => s.status === 'approved' || s.status === 'paid')) return 'approved';
  return 'open';
}

export function computeJobCommission(f: JobCommissionFigures): JobCommissionResult | null {
  if (!f.leadSource) return null;
  const r = calculateCommission({
    leadSource: f.leadSource, jobType: f.jobType,
    revenue: f.revenue, material: f.material, labor: f.labor, other: f.other,
    manualOverheadPct: f.manualOverheadPct,
  });
  const advancesPaid = Math.max(0, round2(f.advancesPaid ?? 0));
  const isManual = f.manualCommission != null;
  const commission = isManual ? Math.max(0, round2(f.manualCommission as number)) : r.commission;
  return {
    ...r,
    commission,
    calculatedCommission: r.commission,
    isManual,
    advancesPaid,
    balanceDue: round2(commission - advancesPaid),
  };
}

export interface ReadinessInput extends JobCommissionFigures {
  checks: ChecksState | null | undefined;
}

/** Why a record can't be approved yet — empty when it can. */
export function jobCommissionBlockers(r: ReadinessInput): string[] {
  const out: string[] = [];
  if (!r.leadSource) out.push('Lead source not set');
  // A commission set by hand does not come from revenue, so a job whose
  // revenue nobody is tracking can still be settled.
  if (r.manualCommission == null && !(r.revenue > 0)) out.push('Revenue is zero');
  const missing = missingJobCommissionChecks(r.checks);
  if (missing.length) out.push(`${missing.length} box${missing.length === 1 ? '' : 'es'} unchecked`);
  return out;
}

export const isLeadSource = (v: unknown): v is LeadSource => v === 'self' || v === 'company';
export const isJobType = (v: unknown): v is JobType => v === 'retail' || v === 'insurance';

/**
 * Payout view of the records: what is owed, to whom, right now.
 *
 * "Due" is deliberately narrow — approved but not yet paid. An open record is
 * still being argued about (costs missing, boxes unticked), so counting it as
 * owed would overstate what the company has to pay out this week.
 */
export interface PayoutLike {
  repName: string | null;
  teamMemberId: number | null;
  status: JobCommissionStatus;
  commissionAmount: string | number | null;
  balanceDue?: string | number | null;
}

export function isDue(r: { status: JobCommissionStatus }): boolean {
  return r.status === 'approved';
}

type PayoutFigures = { status?: JobCommissionStatus; commissionAmount: string | number | null; balanceDue?: string | number | null };

const finite = (raw: string | number | null | undefined): number => {
  const n = typeof raw === 'number' ? raw : Number(raw);
  return raw != null && Number.isFinite(n) ? n : 0;
};

/**
 * What a record is worth to the rep right now.
 *
 * The balance, not the gross commission — the draws taken during the job have
 * already been paid, and a payout run that sent the full commission again
 * would pay the rep twice. Records written before draws existed have no
 * balance and fall back to the commission, which for them is the same number.
 *
 * A paid record is the exception: its balance is zero by definition, so the
 * Paid tab and "Paid to date" read nothing but $0 off it. What it is worth
 * there is what actually went out — the commission less anything still owed.
 */
export function payoutAmount(r: PayoutFigures): number {
  if (r.status === 'paid') return round2(finite(r.commissionAmount) - finite(r.balanceDue));
  return finite(r.balanceDue ?? r.commissionAmount);
}

export function payoutTotal(rows: PayoutFigures[]): number {
  // Rounded, or a payroll batch of $0.10 and $0.20 asked to pay $0.30000000000000004.
  return round2(rows.reduce((sum, r) => sum + payoutAmount(r), 0));
}

export interface RepPayouts<T> { key: string; repName: string; teamMemberId: number | null; total: number; rows: T[] }

/**
 * Grouped by the person who gets paid — biggest owed first, so a payroll run
 * starts at the top. Records whose rep was never resolved group under one
 * "Unassigned" heading and sort last however much they're worth, because
 * nobody can be paid until someone says whose job it was.
 */
export function payoutsByRep<T extends PayoutLike>(rows: T[]): Array<RepPayouts<T>> {
  const groups = new Map<string, RepPayouts<T>>();
  for (const r of rows) {
    const name = (r.repName || '').trim();
    const key = r.teamMemberId != null ? `m:${r.teamMemberId}` : name ? `n:${name.toLowerCase()}` : 'unassigned';
    let g = groups.get(key);
    if (!g) { g = { key, repName: name || 'Unassigned', teamMemberId: r.teamMemberId ?? null, total: 0, rows: [] }; groups.set(key, g); }
    g.rows.push(r);
    g.total = round2(g.total + payoutAmount(r));
  }
  return [...groups.values()].sort((a, b) => {
    if ((a.key === 'unassigned') !== (b.key === 'unassigned')) return a.key === 'unassigned' ? 1 : -1;
    return b.total - a.total || a.repName.localeCompare(b.repName);
  });
}
