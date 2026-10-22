/**
 * Creating and recomputing per-job commission records. Called from three
 * places that all mean "this job just got sold": the hourly leads sync, the
 * in-app stage change, and the client profile being opened on a sold job
 * that somehow has no record yet (jobs sold before this shipped).
 */
import { and, eq } from 'drizzle-orm';
import { db } from '../db';
import { jobCommissions, leads, repAssignments, teamMembers, type JobCommission } from '../../shared/schema';
import {
  COMMISSION_LINES, computeJobCommission, isJobType, resolveLine,
  type CommissionLine, type CommissionSources, type JobCommissionFigures,
} from '../../shared/job-commission';
import { num } from '../../shared/num';

export interface SoldJobLike {
  externalId: string;
  jobName?: string | null;
  jtSalesRep?: string | null;
  insuranceClaim?: boolean | null;
}

/**
 * Who gets paid: the in-app primary assignment wins, else the JobTread
 * "Sales Rep" field matched to a team member's mapped name. Same precedence
 * the client profile shows and the KPI events use.
 */
export async function resolveJobRep(externalId: string, jtSalesRep: string | null | undefined): Promise<{ repName: string | null; teamMemberId: number | null }> {
  const [primary] = await db
    .select({ id: teamMembers.id, name: teamMembers.name })
    .from(repAssignments)
    .innerJoin(teamMembers, eq(repAssignments.teamMemberId, teamMembers.id))
    .where(and(eq(repAssignments.jobExternalId, externalId), eq(repAssignments.role, 'primary')));
  if (primary) return { repName: primary.name, teamMemberId: primary.id };

  if (jtSalesRep) {
    const [m] = await db.select({ id: teamMembers.id, name: teamMembers.name }).from(teamMembers)
      .where(eq(teamMembers.jobtreadSalesRep, jtSalesRep));
    if (m) return { repName: m.name, teamMemberId: m.id };
    return { repName: jtSalesRep, teamMemberId: null };
  }
  return { repName: null, teamMemberId: null };
}

/** The stored figures a recompute writes back — strings, because the columns are NUMERIC. */
export function recomputedColumns(f: JobCommissionFigures): { overheadPct: string | null; profit: string | null; commissionAmount: string | null; balanceDue: string | null } {
  const r = computeJobCommission(f);
  if (!r) return { overheadPct: null, profit: null, commissionAmount: null, balanceDue: null };
  return {
    overheadPct: r.overheadPct.toFixed(2), profit: r.profit.toFixed(2),
    commissionAmount: r.commission.toFixed(2), balanceDue: r.balanceDue.toFixed(2),
  };
}

type FigureRow = Pick<JobCommission, 'leadSource' | 'jobType' | 'revenue' | 'material' | 'labor' | 'other' | 'manualOverheadPct'>
  & Partial<Pick<JobCommission, 'advancesPaid' | 'sources' | 'manualCommission'>>;

export function figuresOf(row: FigureRow): JobCommissionFigures {
  // A line that has been itemised is worth the sum of its pieces. The numeric
  // column is kept in step on every save, so the two agree — reading through
  // the sources here as well means a row written by an older path, or by hand
  // in the database, still totals correctly rather than silently disagreeing.
  const sources = (row.sources ?? {}) as CommissionSources;
  return {
    leadSource: row.leadSource === 'self' || row.leadSource === 'company' ? row.leadSource : null,
    jobType: isJobType(row.jobType) ? row.jobType : 'retail',
    revenue: resolveLine('revenue', sources, num(row.revenue)),
    material: resolveLine('material', sources, num(row.material)),
    labor: resolveLine('labor', sources, num(row.labor)),
    other: resolveLine('other', sources, num(row.other)),
    manualOverheadPct: row.manualOverheadPct == null ? null : num(row.manualOverheadPct),
    advancesPaid: num(row.advancesPaid),
    manualCommission: row.manualCommission == null ? null : num(row.manualCommission),
  };
}

/**
 * The numeric columns for the four money lines, given whatever sources the
 * record now carries. Written alongside every save so the columns every other
 * read path uses never drift from the itemised breakdown.
 */
export function lineColumns(sources: CommissionSources | null | undefined, typed: Record<CommissionLine, number>): Record<CommissionLine, string> {
  const out = {} as Record<CommissionLine, string>;
  for (const line of COMMISSION_LINES) out[line] = resolveLine(line, sources, typed[line]).toFixed(2);
  return out;
}

/**
 * Create the record for a sold job if it doesn't exist. Idempotent — the
 * unique index on job_external_id means two callers racing (sync and a stage
 * change in the same second) can't produce two records. Returns the row and
 * whether this call created it.
 */
export async function ensureJobCommission(job: SoldJobLike, createdBy: string): Promise<{ row: JobCommission; created: boolean }> {
  const [existing] = await db.select().from(jobCommissions).where(eq(jobCommissions.jobExternalId, job.externalId));
  if (existing) {
    await withDefaultSplit(existing.id, { repName: existing.repName, teamMemberId: existing.teamMemberId }, createdBy);
    return { row: existing, created: false };
  }

  const { repName, teamMemberId } = await resolveJobRep(job.externalId, job.jtSalesRep);
  // Revenue starts at zero on purpose. JobTread's projected value is an
  // estimate, and a commission worked out from an estimate that nobody
  // re-checked reads as final. The admin types the contract price in.
  const [inserted] = await db.insert(jobCommissions).values({
    jobExternalId: job.externalId,
    jobName: job.jobName ?? null,
    repName, teamMemberId,
    jobType: job.insuranceClaim ? 'insurance' : 'retail',
    revenue: '0.00',
    createdBy,
  }).onConflictDoNothing({ target: jobCommissions.jobExternalId }).returning();
  if (inserted) {
    await withDefaultSplit(inserted.id, { repName, teamMemberId }, createdBy);
    return { row: inserted, created: true };
  }

  // Lost the race — someone else inserted between our select and insert.
  const [row] = await db.select().from(jobCommissions).where(eq(jobCommissions.jobExternalId, job.externalId));
  return { row, created: false };
}

/**
 * A commission is never left belonging to nobody: the record and its first rep
 * are created together. Imported late because splits.ts needs figuresOf from
 * here, and two modules that import each other at load time is a cycle waiting
 * to bite in one bundler and not the other.
 */
async function withDefaultSplit(jobCommissionId: number, rep: { repName: string | null; teamMemberId: number | null }, createdBy: string): Promise<void> {
  const { ensureDefaultSplit } = await import('./splits');
  await ensureDefaultSplit(jobCommissionId, rep, createdBy);
}

/** Same, by job id — loads the lead first. Null when the job isn't in the read model. */
export async function ensureJobCommissionFor(externalId: string, createdBy: string): Promise<{ row: JobCommission; created: boolean } | null> {
  const [lead] = await db.select({
    externalId: leads.externalId, jobName: leads.jobName, jtSalesRep: leads.jtSalesRep,
    insuranceClaim: leads.insuranceClaim,
  }).from(leads).where(eq(leads.externalId, externalId));
  if (!lead?.externalId) return null;
  const result = await ensureJobCommission({ ...lead, externalId: lead.externalId }, createdBy);
  // Records written before splits existed get their first rep here rather than
  // needing a backfill to have been perfect.
  if (!result.created) await withDefaultSplit(result.row.id, { repName: result.row.repName, teamMemberId: result.row.teamMemberId }, createdBy);
  return result;
}
