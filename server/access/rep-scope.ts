import { and, or, eq, inArray, notInArray, sql, type SQL } from 'drizzle-orm';
import { db } from '../db';
import { leads, teamMembers, repAssignments } from '../../shared/schema';
import { isNarrowed, dataScope, type TeamRole } from '../../shared/rbac';

export interface SessionUser {
  email: string;
  name: string;
  role: TeamRole;
}

// ---- Pure core (unit-tested) -------------------------------------------------

export interface JobOwnershipInput {
  externalId: string;
  jtSalesRep: string | null;
}

/**
 * Who owns a job? An in-app override wins; otherwise the JobTread "Sales Rep"
 * value maps to the team member whose `jobtreadSalesRep` equals it. Returns the
 * owning team member id, or null when nobody owns it.
 */
export function ownerOf(
  job: JobOwnershipInput,
  overrides: Map<string, number>,
  repNameToId: Map<string, number>,
): number | null {
  if (overrides.has(job.externalId)) return overrides.get(job.externalId)!;
  if (job.jtSalesRep && repNameToId.has(job.jtSalesRep)) return repNameToId.get(job.jtSalesRep)!;
  return null;
}

// ---- DB-backed helpers -------------------------------------------------------

/**
 * True when this user's queries MUST be filtered — i.e. they do not see the
 * whole company.
 *
 * Was `role === 'sales'`, which had two bugs: a `production` user was treated
 * as unrestricted and could read every lead, and a sales leader could see every
 * team rather than their own. Now driven by the role's data scope, so 'self'
 * and 'team' both narrow and only 'all' does not.
 */
export function isScoped(user: SessionUser | undefined): boolean {
  return user ? isNarrowed(user.role) : true; // no user → narrowest, fail closed
}

/** Resolve a signed-in user's `teamMembers.id`, for attributing an action to them. */
export async function teamMemberIdByEmail(email: string): Promise<number | null> {
  const [row] = await db.select({ id: teamMembers.id }).from(teamMembers).where(eq(teamMembers.email, email));
  return row?.id ?? null;
}

interface ScopeMaps {
  memberId: number | null;
  repName: string | null;
  ownedIds: string[]; // job external ids this member is assigned via override
  allOverriddenIds: string[]; // every overridden job id (any member)
}

async function loadScope(user: SessionUser): Promise<ScopeMaps> {
  const [member] = await db
    .select({ id: teamMembers.id, repName: teamMembers.jobtreadSalesRep })
    .from(teamMembers)
    .where(eq(teamMembers.email, user.email));
  const memberId = member?.id ?? null;

  const allOverrides = await db
    .select({ jobExternalId: repAssignments.jobExternalId, teamMemberId: repAssignments.teamMemberId })
    .from(repAssignments);

  const ownedIds = memberId ? allOverrides.filter((o) => o.teamMemberId === memberId).map((o) => o.jobExternalId) : [];
  const allOverriddenIds = allOverrides.map((o) => o.jobExternalId);
  return { memberId, repName: member?.repName ?? null, ownedIds, allOverriddenIds };
}

/**
 * Drizzle WHERE selecting the leads a user PERSONALLY owns:
 *   externalId IN (their overrides)
 *   OR (externalId NOT IN (any override) AND jt_sales_rep = their JobTread name)
 *
 * Unlike repLeadWhere this ignores role — an admin owns jobs too, and their own
 * account page should show their book, not the whole company's.
 */
export async function ownedLeadWhere(user: SessionUser): Promise<SQL> {
  const { repName, ownedIds, allOverriddenIds } = await loadScope(user);

  const clauses: SQL[] = [];
  if (ownedIds.length) clauses.push(inArray(leads.externalId, ownedIds));

  if (repName) {
    const byName: SQL[] = [eq(leads.jtSalesRep, repName)];
    if (allOverriddenIds.length) byName.push(notInArray(leads.externalId, allOverriddenIds));
    clauses.push(and(...byName) as SQL);
  }

  // No name and no overrides → this person owns nothing. Return a false
  // predicate rather than no predicate, which would match every lead.
  if (!clauses.length) return sql`false`;
  return clauses.length === 1 ? clauses[0] : (or(...clauses) as SQL);
}

/**
 * Drizzle WHERE selecting every lead within the user's DATA SCOPE:
 *   'all'  → undefined (no filter)
 *   'team' → their own book plus each direct report's
 *   'self' → their own book only
 */
export async function scopedLeadWhere(user: SessionUser): Promise<SQL> {
  const { visibleRepNamesFor } = await import('./team-scope');
  const repNames = await visibleRepNamesFor(user);
  if (repNames === null) return sql`true`;

  const { allOverriddenIds } = await loadScope(user);
  const visibleIds = await visibleOverriddenIds(user);

  const clauses: SQL[] = [];
  if (visibleIds.length) clauses.push(inArray(leads.externalId, visibleIds));
  if (repNames.length) {
    // jt_sales_rep is stored with original casing; compare case-insensitively
    // because visibleRepNamesFor lowercases.
    const byName: SQL[] = [inArray(sql`lower(${leads.jtSalesRep})`, repNames)];
    if (allOverriddenIds.length) byName.push(notInArray(leads.externalId, allOverriddenIds));
    clauses.push(and(...byName) as SQL);
  }
  // Owns nothing → a FALSE predicate, never an absent one (which matches all).
  if (!clauses.length) return sql`false`;
  return clauses.length === 1 ? clauses[0] : (or(...clauses) as SQL);
}

/** Job-id overrides pointing at anyone within this user's scope. */
async function visibleOverriddenIds(user: SessionUser): Promise<string[]> {
  const { visibleIdsFor } = await import('./team-scope');
  const ids = await visibleIdsFor(user);
  if (ids === null) return [];
  const rows = await db
    .select({ jobExternalId: repAssignments.jobExternalId, teamMemberId: repAssignments.teamMemberId })
    .from(repAssignments);
  return rows.filter((r) => ids.includes(r.teamMemberId)).map((r) => r.jobExternalId);
}

/**
 * Drizzle WHERE enforcing visibility: `undefined` for roles that see the whole
 * company, otherwise a predicate limited to the user's scope.
 */
export async function repLeadWhere(user: SessionUser): Promise<SQL | undefined> {
  if (!isScoped(user)) return undefined;
  return scopedLeadWhere(user);
}

/** The JobTread job names a user personally owns, regardless of role. */
export async function ownedJobNames(user: SessionUser): Promise<string[]> {
  const rows = await db.select({ jobName: leads.jobName }).from(leads).where(await ownedLeadWhere(user));
  return rows.map((r) => r.jobName).filter((n): n is string => !!n);
}

/**
 * The set of JobTread job names a `sales` user owns (for scoping deals /
 * conversations by job). Returns null for admin/manager (all).
 */
export async function repJobNames(user: SessionUser): Promise<string[] | null> {
  if (!isScoped(user)) return null;
  const where = await repLeadWhere(user);
  if (!where) return null;
  const rows = await db.select({ jobName: leads.jobName }).from(leads).where(where);
  return rows.map((r) => r.jobName).filter((n): n is string => !!n);
}

/** The rep's own clients (name + phone), for best-effort conversation matching. */
export async function repClientIdentifiers(user: SessionUser): Promise<{ names: string[]; phones: string[]; jobNames: string[] } | null> {
  if (!isScoped(user)) return null;
  const where = await repLeadWhere(user);
  if (!where) return null;
  const rows = await db
    .select({ firstName: leads.firstName, phone: leads.phone, jobName: leads.jobName })
    .from(leads)
    .where(where);
  const names = rows.map((r) => r.firstName).filter((n): n is string => !!n);
  const phones = rows.map((r) => r.phone).filter((n): n is string => !!n);
  const jobNames = rows.map((r) => r.jobName).filter((n): n is string => !!n);
  return { names, phones, jobNames };
}

/**
 * Guard for single-record fetches: is this job within the user's data scope?
 * A leader passes for their own reps' jobs; a rep only for their own.
 */
export async function ownsLead(user: SessionUser, externalId: string | null): Promise<boolean> {
  if (!isScoped(user)) return true;
  if (!externalId) return false;

  const { visibleRepNamesFor } = await import('./team-scope');
  const repNames = await visibleRepNamesFor(user);
  if (repNames === null) return true;

  const { allOverriddenIds } = await loadScope(user);
  const visibleIds = await visibleOverriddenIds(user);
  if (visibleIds.includes(externalId)) return true;
  if (allOverriddenIds.includes(externalId)) return false; // assigned to someone out of scope
  if (!repNames.length) return false;

  const [row] = await db.select({ jtSalesRep: leads.jtSalesRep }).from(leads).where(eq(leads.externalId, externalId));
  return !!row && !!row.jtSalesRep && repNames.includes(row.jtSalesRep.toLowerCase());
}
