/**
 * Crews, crew members, install bookings and install milestones, in the
 * database (migration 0017). docs/archie/02-roof-lee-link.md, "Crews and
 * install dates".
 *
 * Everything here runs as the company (runAsCompany), so another company's
 * crews, people and jobs are simply not there. A person or a job is looked up
 * as the company before a row names it: crew_members has no foreign key to
 * team_members, and crew_assignments names the job by its key.
 *
 * Nothing here ever reads or returns money.
 */
import { and, asc, eq, gte, inArray, lte, ne, notInArray, or, sql, type SQL } from 'drizzle-orm';
import { db } from '../db';
import { crewAssignments, crewMembers, crews, jobMilestones, leads, productionPipeline, teamMembers, type Crew, type CrewAssignment } from '../../shared/schema';
import {
  CREW_ROLE, CREW_STATUS_LABEL, crewMayMove, isCrewId, isCrewStatus, isReschedule, milestoneForStatus,
  type CrewStatus, type InstallBooking, type JobMilestone,
} from '../../shared/crews';
import { isNativeJobId } from '../production/native-jobs';
import { logWrite } from '../writes/log';
import { customerName } from './view';

// What a person is told. Plain words, no codes.
export const CREW_NAME_TAKEN = 'There is already a crew with that name.';
export const CREW_NOT_FOUND = 'That crew isn\'t there any more. Refresh and try again.';
export const CREW_INACTIVE = 'That crew is switched off. Pick another crew.';
export const ONLY_CREW_PEOPLE = 'Only people on the Production role can be on a crew.';
export const CREW_IN_USE = 'This crew still has installs booked. Move them to another crew first.';
export const STARTED_CANNOT_CLEAR = 'The crew has already started this job, so it can\'t be taken off the schedule.';
export const NOT_SCHEDULED = 'This job has no install booked.';
export const CREW_STEP_NOT_ALLOWED = 'Mark the job as started first, then as done.';

type Result<T> = { ok: true; value: T } | { ok: false; status: number; error: string };

const isUniqueViolation = (e: any) => (e?.cause?.code ?? e?.code) === '23505';

// ---------------------------------------------------------------- crews

export interface CrewSummary {
  id: string;
  name: string;
  color: string | null;
  active: boolean;
  members: Array<{ id: number; name: string }>;
}

/** The company's crews, with who is on each. */
export async function listCrews(): Promise<CrewSummary[]> {
  const rows = await db.select().from(crews).orderBy(asc(sql`lower(${crews.name})`));
  const people = await db.select({ crewId: crewMembers.crewId, id: teamMembers.id, name: teamMembers.name })
    .from(crewMembers).innerJoin(teamMembers, eq(teamMembers.id, crewMembers.teamMemberId))
    .orderBy(asc(teamMembers.name));
  return rows.map((c) => ({
    id: c.id, name: c.name, color: c.color, active: c.active,
    members: people.filter((p) => p.crewId === c.id).map((p) => ({ id: p.id, name: p.name })),
  }));
}

/** Everyone who can be on a crew: active team members on the Production role, with the crew they are on. */
export async function crewPeople(): Promise<Array<{ id: number; name: string; crewId: string | null }>> {
  const rows = await db.select({ id: teamMembers.id, name: teamMembers.name, crewId: crewMembers.crewId })
    .from(teamMembers).leftJoin(crewMembers, eq(crewMembers.teamMemberId, teamMembers.id))
    .where(and(eq(teamMembers.role, CREW_ROLE), eq(teamMembers.active, true)))
    .orderBy(asc(teamMembers.name));
  return rows.map((r) => ({ id: r.id, name: r.name, crewId: r.crewId ?? null }));
}

export async function createCrew(name: string, color: string | null, actor: string): Promise<Result<Crew>> {
  try {
    const [row] = await db.insert(crews).values({ name, color, createdBy: actor }).returning();
    await logWrite({ actor, system: 'archie', action: 'crew_create', targetId: row.id, summary: `Crew "${name}" made`, ok: true, error: null });
    return { ok: true, value: row };
  } catch (e) {
    if (isUniqueViolation(e)) return { ok: false, status: 409, error: CREW_NAME_TAKEN };
    throw e;
  }
}

export async function updateCrew(id: string, patch: { name?: string; color?: string | null; active?: boolean }, actor: string): Promise<Result<Crew>> {
  if (!isCrewId(id)) return { ok: false, status: 404, error: CREW_NOT_FOUND };
  if (patch.active === false) {
    // A crew with work still ahead of it cannot be switched off: its installs would have nobody.
    const [busy] = await db.select({ id: crewAssignments.id }).from(crewAssignments)
      .where(and(eq(crewAssignments.crewId, id), ne(crewAssignments.status, 'done'))).limit(1);
    if (busy) return { ok: false, status: 409, error: CREW_IN_USE };
  }
  try {
    const [row] = await db.update(crews).set({ ...patch, updatedAt: new Date() }).where(eq(crews.id, id)).returning();
    if (!row) return { ok: false, status: 404, error: CREW_NOT_FOUND };
    await logWrite({ actor, system: 'archie', action: 'crew_update', targetId: id, summary: `Crew "${row.name}" changed`, ok: true, error: null });
    return { ok: true, value: row };
  } catch (e) {
    if (isUniqueViolation(e)) return { ok: false, status: 409, error: CREW_NAME_TAKEN };
    throw e;
  }
}

/**
 * Set who is on a crew. Each person must be an active team member of this
 * company on the Production role; a person on another crew moves to this one.
 */
export async function setCrewMembers(crewId: string, memberIds: unknown, actor: string): Promise<Result<number[]>> {
  if (!isCrewId(crewId)) return { ok: false, status: 404, error: CREW_NOT_FOUND };
  if (!Array.isArray(memberIds) || !memberIds.every((n) => Number.isInteger(n) && n > 0)) return { ok: false, status: 400, error: ONLY_CREW_PEOPLE };
  const ids = [...new Set(memberIds as number[])];
  const [crew] = await db.select().from(crews).where(eq(crews.id, crewId));
  if (!crew) return { ok: false, status: 404, error: CREW_NOT_FOUND };
  if (ids.length) {
    const found = await db.select({ id: teamMembers.id }).from(teamMembers)
      .where(and(inArray(teamMembers.id, ids), eq(teamMembers.role, CREW_ROLE), eq(teamMembers.active, true)));
    if (found.length !== ids.length) return { ok: false, status: 400, error: ONLY_CREW_PEOPLE };
  }
  await db.transaction(async (tx) => {
    await tx.delete(crewMembers).where(ids.length
      ? or(eq(crewMembers.crewId, crewId), inArray(crewMembers.teamMemberId, ids)) as SQL
      : eq(crewMembers.crewId, crewId));
    if (ids.length) await tx.insert(crewMembers).values(ids.map((teamMemberId) => ({ crewId, teamMemberId })));
  });
  await logWrite({ actor, system: 'archie', action: 'crew_members', targetId: crewId, summary: `Crew "${crew.name}" now has ${ids.length} ${ids.length === 1 ? 'person' : 'people'}`, ok: true, error: null });
  return { ok: true, value: ids };
}

// ---------------------------------------------------------------- one job's install

export async function assignmentFor(jobKey: string): Promise<CrewAssignment | null> {
  const [row] = await db.select().from(crewAssignments).where(eq(crewAssignments.jobKey, jobKey));
  return row ?? null;
}

async function recordMilestone(jobKey: string, kind: JobMilestone, actor: string, installDate: string | null = null): Promise<void> {
  await db.insert(jobMilestones).values({ jobKey, kind, actor, installDate });
}

/** Book (or change) a job's install. Scheduling again (another crew, day or time) is recorded as a milestone. */
export async function bookInstall(jobKey: string, booking: InstallBooking, actor: string): Promise<Result<CrewAssignment>> {
  const [crew] = await db.select().from(crews).where(eq(crews.id, booking.crewId));
  if (!crew) return { ok: false, status: 400, error: CREW_NOT_FOUND };
  if (!crew.active) return { ok: false, status: 400, error: CREW_INACTIVE };
  const before = await assignmentFor(jobKey);
  const again = isReschedule(before, booking);
  const now = new Date();
  const values = {
    crewId: booking.crewId, installDate: booking.installDate, endDate: booking.endDate,
    startTime: booking.startTime, notes: booking.notes, updatedBy: actor, updatedAt: now,
    ...(again ? { scheduledAt: now } : {}),
  };
  const [row] = before
    ? await db.update(crewAssignments).set(values).where(eq(crewAssignments.id, before.id)).returning()
    : await db.insert(crewAssignments).values({ ...values, jobKey, createdBy: actor })
      .onConflictDoUpdate({ target: [crewAssignments.companyId, crewAssignments.jobKey], set: values }).returning();
  if (again) await recordMilestone(jobKey, 'install_scheduled', actor, booking.installDate);
  await logWrite({
    actor, system: 'archie', action: 'install_booked', targetId: jobKey,
    summary: `Install booked with ${crew.name} for ${booking.installDate}${booking.endDate ? ` to ${booking.endDate}` : ''}`, ok: true, error: null,
  });
  return { ok: true, value: row };
}

/** Take a job off the schedule, while the crew has not started it. */
export async function clearInstall(jobKey: string, actor: string): Promise<Result<null>> {
  const before = await assignmentFor(jobKey);
  if (!before) return { ok: false, status: 404, error: NOT_SCHEDULED };
  if (before.status !== 'scheduled') return { ok: false, status: 409, error: STARTED_CANNOT_CLEAR };
  await db.delete(crewAssignments).where(and(eq(crewAssignments.id, before.id), eq(crewAssignments.status, 'scheduled')));
  await logWrite({ actor, system: 'archie', action: 'install_cleared', targetId: jobKey, summary: 'Install taken off the schedule', ok: true, error: null });
  return { ok: true, value: null };
}

/**
 * Move an install's status. A crew moves forward one step at a time
 * (shared/crews.ts crewMayMove); the office may set any status. A start and
 * a finish are each recorded as a milestone, once per change.
 */
export async function setInstallStatus(jobKey: string, to: unknown, actor: string, by: 'crew' | 'office'): Promise<Result<CrewAssignment>> {
  if (!isCrewStatus(to)) return { ok: false, status: 400, error: CREW_STEP_NOT_ALLOWED };
  const before = await assignmentFor(jobKey);
  if (!before) return { ok: false, status: 404, error: NOT_SCHEDULED };
  const from = isCrewStatus(before.status) ? before.status : 'scheduled';
  if (from === to) return { ok: true, value: before };
  if (by === 'crew' && !crewMayMove(from, to)) return { ok: false, status: 409, error: CREW_STEP_NOT_ALLOWED };
  const now = new Date();
  const set: Partial<CrewAssignment> = { status: to, updatedBy: actor, updatedAt: now };
  if (to === 'in_progress') { set.startedAt = before.startedAt ?? now; set.doneAt = null; }
  if (to === 'done') { set.doneAt = now; set.startedAt = before.startedAt ?? now; }
  if (to === 'scheduled') { set.startedAt = null; set.doneAt = null; }
  // Only if nobody changed it meanwhile: two taps record one milestone.
  const [row] = await db.update(crewAssignments).set(set)
    .where(and(eq(crewAssignments.id, before.id), eq(crewAssignments.status, from))).returning();
  if (!row) return { ok: true, value: (await assignmentFor(jobKey)) ?? before };
  const kind = milestoneForStatus(to);
  if (kind) await recordMilestone(jobKey, kind, actor);
  await logWrite({ actor, system: 'archie', action: 'install_status', targetId: jobKey, summary: `Install: ${CREW_STATUS_LABEL[to as CrewStatus]}`, ok: true, error: null });
  return { ok: true, value: row };
}

// ---------------------------------------------------------------- a crew member's own

/** The crew a signed-in person is on, found by their email as the company. Null for anyone not on an active crew. */
export async function crewOfPerson(email: string): Promise<{ memberId: number; crewId: string; crewName: string } | null> {
  const [row] = await db.select({ memberId: teamMembers.id, crewId: crews.id, crewName: crews.name })
    .from(teamMembers)
    .innerJoin(crewMembers, eq(crewMembers.teamMemberId, teamMembers.id))
    .innerJoin(crews, eq(crews.id, crewMembers.crewId))
    .where(and(sql`lower(${teamMembers.email}) = lower(${email})`, eq(teamMembers.role, CREW_ROLE), eq(teamMembers.active, true), eq(crews.active, true)));
  return row ?? null;
}

/** A crew's installs: everything not done, and what it finished in the last two weeks. */
export async function crewAssignmentsOf(crewId: string, today: string): Promise<CrewAssignment[]> {
  const twoWeeksAgo = new Date(Date.parse(`${today}T12:00:00Z`) - 14 * 86400000).toISOString().slice(0, 10);
  return db.select().from(crewAssignments)
    .where(and(eq(crewAssignments.crewId, crewId), or(ne(crewAssignments.status, 'done'), gte(crewAssignments.installDate, twoWeeksAgo)) as SQL))
    .orderBy(asc(crewAssignments.installDate), asc(crewAssignments.startTime));
}

// ---------------------------------------------------------------- the week

/** Board stages where a job can still need its install booked. */
export const UNBOOKED_STAGES = ['approved', 'waiting_dp', 'pre_production', 'schedule', 'material_check', 'install'] as const;

export interface WeekInstall {
  id: string;
  crewId: string;
  jobKey: string;
  customer: string | null;
  jobName: string | null;
  city: string | null;
  installDate: string;
  endDate: string | null;
  startTime: string | null;
  status: CrewStatus;
}

export interface UnbookedJob { jobKey: string; customer: string | null; jobName: string | null; city: string | null; stage: string }

/**
 * One week of installs (Monday to Sunday, company dates) and the jobs on the
 * production board that have no install yet. Names, towns and dates only:
 * no price, no location (old Archie's board selected both; this one never does).
 */
export async function weekBoard(monday: string, sunday: string): Promise<{ installs: WeekInstall[]; unbooked: UnbookedJob[] }> {
  const rows = await db.select({
    id: crewAssignments.id, crewId: crewAssignments.crewId, jobKey: crewAssignments.jobKey,
    installDate: crewAssignments.installDate, endDate: crewAssignments.endDate, startTime: crewAssignments.startTime, status: crewAssignments.status,
    firstName: leads.firstName, lastName: leads.lastName, jobName: leads.jobName, city: leads.city,
  }).from(crewAssignments)
    .leftJoin(leads, eq(leads.externalId, crewAssignments.jobKey))
    .where(and(lte(crewAssignments.installDate, sunday), sql`coalesce(${crewAssignments.endDate}, ${crewAssignments.installDate}) >= ${monday}`))
    .orderBy(asc(crewAssignments.installDate), asc(crewAssignments.startTime));
  const installs = rows.map((r) => ({
    id: r.id, crewId: r.crewId, jobKey: r.jobKey, customer: customerName({ firstName: r.firstName ?? null, lastName: r.lastName ?? null }), jobName: r.jobName ?? null, city: r.city ?? null,
    installDate: r.installDate, endDate: r.endDate, startTime: r.startTime, status: (isCrewStatus(r.status) ? r.status : 'scheduled') as CrewStatus,
  }));

  const booked = db.select({ k: crewAssignments.jobKey }).from(crewAssignments);
  const open = await db.select({ jobKey: productionPipeline.jobExternalId, stage: productionPipeline.stage, firstName: leads.firstName, lastName: leads.lastName, jobName: leads.jobName, city: leads.city })
    .from(productionPipeline)
    .innerJoin(leads, eq(leads.externalId, productionPipeline.jobExternalId))
    .where(and(inArray(productionPipeline.stage, [...UNBOOKED_STAGES]), notInArray(productionPipeline.jobExternalId, booked), sql`${productionPipeline.jobExternalId} LIKE 'archie-%'`))
    .orderBy(asc(productionPipeline.stageEnteredAt))
    .limit(100);
  const unbooked = open.filter((o) => isNativeJobId(o.jobKey))
    .map((o) => ({ jobKey: o.jobKey, customer: customerName({ firstName: o.firstName, lastName: o.lastName }), jobName: o.jobName ?? null, city: o.city ?? null, stage: o.stage }));
  return { installs, unbooked };
}
