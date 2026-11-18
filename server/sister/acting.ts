/**
 * The person a request from Roof Lee is for, as Archie knows them.
 *
 * Roof Lee names a person by their shared sign-in id and says what role they
 * hold there. That is a statement, not a sign-in, and it grants nothing by
 * itself (contract rule 4): Archie finds the person on this company's own
 * team and applies its own role rules (shared/rbac.ts) to the role it holds
 * for them.
 *
 * Where the two disagree, the lower one counts. Roof Lee saying "office"
 * about someone Archie still holds as an admin means the team list has not
 * caught up yet, and the person must not keep the wider access meanwhile.
 * Roof Lee saying "owner" about someone Archie holds as production gets them
 * nothing more than production.
 *
 * Must run as the company (runAsCompany).
 */
import { and, eq, sql, type SQL } from 'drizzle-orm';
import { db } from '../db';
import { teamMembers } from '../../shared/schema';
import { ROLE_RANK, canSee, isNarrowed, type TeamRole } from '../../shared/rbac';
import { scopedLeadWhere } from '../access/rep-scope';
import { requireCompanyId } from '../tenant/context';
import { ROOFLI_SOURCE } from './members';
import { ROLE_MAP, type Acting } from './contract';

export interface ActingMember {
  id: number;
  email: string;
  name: string;
  /** The role Archie's rules are applied to: the lower of what Archie holds and what Roof Lee states. */
  role: TeamRole;
  /** The role on Archie's own roster. */
  heldRole: TeamRole;
  authUserId: string;
}

/** The person named, if they are on this company's team right now. Null means: not allowed. */
export async function findActingMember(acting: Acting): Promise<ActingMember | null> {
  const companyId = requireCompanyId();
  const [row] = await db.select().from(teamMembers).where(and(
    eq(teamMembers.companyId, companyId),
    eq(teamMembers.authUserId, acting.authUserId),
    eq(teamMembers.source, ROOFLI_SOURCE),
  ));
  if (!row || !row.active) return null;
  const held = row.role as TeamRole;
  const stated = ROLE_MAP[acting.role];
  const role = ROLE_RANK[stated] < ROLE_RANK[held] ? stated : held;
  return { id: row.id, email: row.email, name: row.name, role, heldRole: held, authUserId: acting.authUserId };
}

/** May this person see and work leads at all? Archie's own rule: sales and up, so not production. */
export function mayWorkLeads(member: ActingMember): boolean {
  return canSee(member.role, 'leads');
}

/**
 * Which leads this person may see: undefined for everyone's, otherwise a
 * filter. The same scope the signed-in app applies (server/access/rep-scope.ts).
 * A person whose role was lowered by Roof Lee's statement, into one that sees
 * only part of the company, has no book of their own to fall back on here and
 * sees nothing.
 */
export async function leadScopeFor(member: ActingMember): Promise<SQL | undefined> {
  if (!isNarrowed(member.role)) return undefined;
  if (member.role !== member.heldRole) return sql`false`;
  return scopedLeadWhere({ email: member.email, name: member.name, role: member.role });
}
