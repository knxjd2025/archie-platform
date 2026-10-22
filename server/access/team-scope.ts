/**
 * Resolves WHOSE records a signed-in user may read.
 *
 * This is the second access axis (see shared/rbac.ts). Rank answers "may you
 * see AR at all"; this answers "whose AR". A sales leader's answer is
 * relational — their own reps and nobody else's — which no rank comparison can
 * express.
 *
 * Deliberately returns team member IDS rather than a Drizzle predicate: the
 * tables that need scoping key off different columns (email, rep name, member
 * id), so each call site builds its own filter from one shared answer.
 */
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { teamMembers } from '../../shared/schema';
import { dataScope, type TeamRole } from '../../shared/rbac';
import type { SessionUser } from './rep-scope';

export interface Member {
  id: number;
  email: string;
  role: TeamRole;
  reportsTo: number | null;
  active: boolean;
}

/** `null` means "everyone" — an unrestricted scope, not an empty one. */
export type VisibleIds = number[] | null;

/**
 * Pure core: which member ids can `me` see, given the roster?
 *
 * Returning null for 'all' rather than a list of every id matters — a caller
 * that receives [] must show nothing, and conflating "everyone" with "nobody"
 * in an `inArray` is how scoping bugs turn into blank screens or leaks.
 */
export function visibleMemberIds(me: Member | null, roster: Member[]): VisibleIds {
  if (!me) return []; // unknown user sees nothing, never everything
  switch (dataScope(me.role)) {
    case 'all':
      return null;
    case 'team': {
      // Direct reports only. Deliberately NOT a recursive walk: a leader of
      // leaders is the sales_director role, which already scopes to 'all'.
      const ids = new Set<number>([me.id]);
      for (const m of roster) {
        if (m.reportsTo === me.id) ids.add(m.id);
      }
      return Array.from(ids).sort((a, b) => a - b);
    }
    case 'self':
    default:
      return [me.id];
  }
}

/**
 * Whether `me` may read records owned by `targetId`.
 * Kept separate from visibleMemberIds so single-record routes (which take an
 * id from the URL) can check ownership without loading the whole roster.
 */
export function canSeeMember(me: Member | null, targetId: number, roster: Member[]): boolean {
  const ids = visibleMemberIds(me, roster);
  return ids === null ? true : ids.includes(targetId);
}

// ---- DB-backed ---------------------------------------------------------------

export async function loadRoster(): Promise<Member[]> {
  const rows = await db
    .select({
      id: teamMembers.id,
      email: teamMembers.email,
      role: teamMembers.role,
      reportsTo: teamMembers.reportsTo,
      active: teamMembers.active,
    })
    .from(teamMembers);
  return rows as Member[];
}

export async function memberByEmail(email: string): Promise<Member | null> {
  const [row] = await db
    .select({
      id: teamMembers.id,
      email: teamMembers.email,
      role: teamMembers.role,
      reportsTo: teamMembers.reportsTo,
      active: teamMembers.active,
    })
    .from(teamMembers)
    .where(eq(teamMembers.email, email));
  return (row as Member) ?? null;
}

/** The ids whose records this session may read. null = unrestricted. */
export async function visibleIdsFor(user: SessionUser | undefined): Promise<VisibleIds> {
  if (!user?.email) return [];
  const me = await memberByEmail(user.email);
  if (!me) return [];
  // Trust the SESSION role over the stored one: a role change must take effect
  // without waiting for the user to sign out, in the restrictive direction too.
  const effective: Member = { ...me, role: user.role };
  if (dataScope(effective.role) === 'all') return null;
  return visibleMemberIds(effective, await loadRoster());
}

/**
 * The JobTread "Sales Rep" names whose records this session may read.
 * null = unrestricted.
 *
 * JobTread attributes work by that dropdown string rather than by email, so
 * anything sourced from JobTread (jobs, commissions) has to be filtered on the
 * name. Members without a mapped name contribute nothing — they own no
 * JobTread work by definition.
 */
export async function visibleRepNamesFor(user: SessionUser | undefined): Promise<string[] | null> {
  const ids = await visibleIdsFor(user);
  if (ids === null) return null;
  if (!ids.length) return [];
  const rows = await db
    .select({ id: teamMembers.id, repName: teamMembers.jobtreadSalesRep })
    .from(teamMembers);
  return rows
    .filter((r) => ids.includes(r.id) && !!r.repName)
    .map((r) => (r.repName as string).toLowerCase());
}

/** The emails whose records this session may read. null = unrestricted. */
export async function visibleEmailsFor(user: SessionUser | undefined): Promise<string[] | null> {
  const ids = await visibleIdsFor(user);
  if (ids === null) return null;
  if (!ids.length) return [];
  const roster = await loadRoster();
  return roster.filter((m) => ids.includes(m.id)).map((m) => m.email.toLowerCase());
}
