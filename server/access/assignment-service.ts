/**
 * Finds unassigned jobs, gathers the evidence for who owns them, and records
 * the answer — including jobs shared by two people.
 *
 * Suggestions are never applied automatically. 400 of 420 leads are
 * unassigned; silently reassigning that many would be impossible to unpick,
 * and a wrong owner moves commission.
 */
import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { db } from '../db';
import { leads, teamMembers, repAssignments, appointments } from '../../shared/schema';
import { JobTreadClient } from '../integrations/jobtread';
import { inferOwner, type JobEvidence, type RepIdentity, type Suggestion } from './infer-owner';
import { matchAppointment } from '../storage/appointment-link';
import { atLeast, type TeamRole } from '../../shared/rbac';

/** Roles that can own a job. Production staff and customer service cannot. */
const OWNING_ROLES: TeamRole[] = ['admin', 'sales_director', 'manager', 'sales'];

/**
 * Who can be an owner, and who counts as a field rep.
 *
 * Field reps are the people who actually run jobs — role `sales`. The owner is
 * an admin who also carries jobs, which is exactly why a field rep must beat
 * him when both appear on one job.
 */
export async function loadRepIdentities(): Promise<RepIdentity[]> {
  const rows = await db.select().from(teamMembers);
  return rows
    .filter((m) => m.active && OWNING_ROLES.includes(m.role as TeamRole) && !!m.jobtreadSalesRep)
    .map((m) => ({
      teamMemberId: m.id,
      repName: m.jobtreadSalesRep as string,
      email: m.email,
      isFieldRep: m.role === 'sales',
    }));
}

export interface UnassignedJob {
  externalId: string;
  jobName: string | null;
  customerName: string;
  stage: string | null;
  address: string | null;
  createdAt: string | null;
}

const DONE = ['Closed', 'Lost', 'Complete'];

/**
 * Jobs with nobody on them: no Sales Rep field AND no in-app assignment.
 * Active jobs first — an unassigned live job is the one costing money.
 */
export async function findUnassigned(opts: { activeOnly?: boolean; limit?: number } = {}): Promise<UnassignedJob[]> {
  const assigned = await db.select({ id: repAssignments.jobExternalId }).from(repAssignments);
  const assignedIds = assigned.map((a) => a.id);

  const clauses = [
    sql`coalesce(trim(${leads.jtSalesRep}), '') = ''`,
    sql`${leads.externalId} is not null`,
  ];
  if (assignedIds.length) clauses.push(sql`${leads.externalId} not in ${assignedIds}`);
  if (opts.activeOnly) {
    // NULL stage is a brand-new lead — the most urgent kind, so keep it.
    clauses.push(or(isNull(leads.stage), sql`${leads.stage} not in ${DONE}`)!);
  }

  const rows = await db
    .select({
      externalId: leads.externalId, jobName: leads.jobName, stage: leads.stage,
      firstName: leads.firstName, lastName: leads.lastName,
      address: leads.address, createdAt: leads.createdAt,
    })
    .from(leads)
    .where(and(...clauses))
    .limit(Math.min(opts.limit || 200, 500));

  return rows.map((r) => ({
    externalId: r.externalId as string,
    jobName: r.jobName,
    customerName: [r.firstName, r.lastName]
      .filter((x) => x && String(x).toLowerCase() !== 'null')
      .join(' ')
      .trim() || r.jobName || 'Customer',
    stage: r.stage,
    address: r.address,
    createdAt: r.createdAt ? new Date(r.createdAt).toISOString() : null,
  }));
}

/**
 * Pull the people-signals for one job from JobTread, plus any calendar match.
 * Fails soft: a job whose evidence cannot be read yields an empty set, which
 * simply produces "assign by hand" rather than losing the whole sweep.
 */
export async function gatherEvidence(
  job: UnassignedJob,
  jt: JobTreadClient,
  calendarByJob?: Map<string, string[]>,
): Promise<JobEvidence> {
  const ev: JobEvidence = { taskAssignees: [], commenters: [], calendarMailboxes: [], jtSalesRep: null };
  try {
    const q: any = await jt.paveQuery({
      job: {
        $: { id: job.externalId },
        tasks: { $: { size: 15 }, nodes: { assignedMemberships: { $: { size: 8 }, nodes: { user: { name: {} } } } } },
        comments: { $: { size: 10 }, nodes: { createdByUser: { name: {} } } },
      },
    });
    for (const t of q?.job?.tasks?.nodes || []) {
      for (const m of t?.assignedMemberships?.nodes || []) {
        if (m?.user?.name) ev.taskAssignees.push(String(m.user.name));
      }
    }
    for (const c of q?.job?.comments?.nodes || []) {
      if (c?.createdByUser?.name) ev.commenters.push(String(c.createdByUser.name));
    }
  } catch {
    // Leave the evidence empty — the suggestion degrades to "assign by hand".
  }
  ev.calendarMailboxes = calendarByJob?.get(job.externalId) || [];
  return ev;
}

/**
 * Which calendars carry an appointment for each job.
 * Built once for the whole sweep — matching every job against every
 * appointment individually would be O(jobs x appts) round trips.
 */
export async function buildCalendarIndex(jobs: UnassignedJob[]): Promise<Map<string, string[]>> {
  const appts = await db
    .select({ title: appointments.title, address: appointments.address, calendarSource: appointments.calendarSource })
    .from(appointments);
  const candidates = jobs.map((j) => ({
    externalId: j.externalId, jobName: j.jobName, firstName: null, lastName: null,
    address: j.address, phone: null, email: null,
  }));
  const out = new Map<string, string[]>();
  for (const a of appts) {
    const m = matchAppointment({ title: a.title, address: a.address }, candidates);
    if (!m || !a.calendarSource) continue;
    const list = out.get(m.externalId) || [];
    if (!list.includes(a.calendarSource)) list.push(a.calendarSource);
    out.set(m.externalId, list);
  }
  return out;
}

export interface JobSuggestion extends UnassignedJob {
  suggestion: Suggestion;
}

/** Suggest owners for unassigned jobs. Read-only — applies nothing. */
export async function suggestOwners(opts: { activeOnly?: boolean; limit?: number } = {}): Promise<JobSuggestion[]> {
  const [jobs, reps] = await Promise.all([findUnassigned(opts), loadRepIdentities()]);
  if (!jobs.length) return [];
  const calendarIndex = await buildCalendarIndex(jobs);
  const jt = new JobTreadClient();

  const out: JobSuggestion[] = [];
  for (const job of jobs) {
    const ev = await gatherEvidence(job, jt, calendarIndex);
    out.push({ ...job, suggestion: inferOwner(ev, reps) });
  }
  // Confident suggestions first: those are the quick accepts.
  const rank = { high: 0, medium: 1, low: 2 } as const;
  return out.sort((a, b) => rank[a.suggestion.confidence] - rank[b.suggestion.confidence]);
}

export interface ApplyInput {
  jobExternalId: string;
  primaryTeamMemberId: number;
  secondaryTeamMemberIds?: number[];
  source?: string;
  confidence?: string | null;
  evidence?: string | null;
  assignedBy: string;
}

/**
 * Record who owns a job, replacing any previous assignment for it.
 *
 * Written as delete-then-insert inside a transaction: the database enforces one
 * primary per job, so editing rows in place could transiently violate it and
 * fail for a legitimate change.
 */
export async function applyAssignment(input: ApplyInput): Promise<{ ok: true }> {
  const secondary = (input.secondaryTeamMemberIds || []).filter((id) => id !== input.primaryTeamMemberId);
  await db.transaction(async (tx) => {
    await tx.delete(repAssignments).where(eq(repAssignments.jobExternalId, input.jobExternalId));
    await tx.insert(repAssignments).values([
      {
        jobExternalId: input.jobExternalId,
        teamMemberId: input.primaryTeamMemberId,
        role: 'primary',
        source: input.source || 'manual',
        confidence: input.confidence ?? null,
        evidence: input.evidence ?? null,
        assignedBy: input.assignedBy,
      },
      ...Array.from(new Set(secondary)).map((id) => ({
        jobExternalId: input.jobExternalId,
        teamMemberId: id,
        role: 'secondary' as const,
        source: input.source || 'manual',
        confidence: input.confidence ?? null,
        evidence: input.evidence ?? null,
        assignedBy: input.assignedBy,
      })),
    ]);
  });
  return { ok: true };
}

/** How many jobs still have nobody on them — drives the dashboard flag. */
export async function unassignedCount(): Promise<{ total: number; active: number }> {
  const [all, active] = await Promise.all([findUnassigned({ limit: 500 }), findUnassigned({ activeOnly: true, limit: 500 })]);
  return { total: all.length, active: active.length };
}
