import type { TeamRole } from '../../shared/rbac';
import { ownsLead, teamMemberIdByEmail, type SessionUser } from '../access/rep-scope';

/**
 * Roles that see every call, including ones with no client attached. The calls
 * list and the recording stream must agree on this, or a call hidden from
 * someone's list can still be played to them by id.
 */
export function seesEveryCall(role: TeamRole): boolean {
  return role === 'admin' || role === 'manager' || role === 'sales_director';
}

export interface CallAccessRow {
  leadExternalId: string | null;
  teamMemberId: number | null;
}

/**
 * May this person hear this call?
 *
 * Everyone else needs a client on the call that is in their scope, or to be the
 * team member who handled it. The recording stream used to skip the check
 * whenever the call had no client, so anyone signed in could play a call with
 * no lead attached by guessing its id.
 */
export async function mayHearCall(user: SessionUser, row: CallAccessRow): Promise<boolean> {
  if (seesEveryCall(user.role)) return true;
  if (row.leadExternalId && (await ownsLead(user, row.leadExternalId))) return true;
  if (row.teamMemberId != null) {
    const me = await teamMemberIdByEmail(user.email);
    if (me != null && me === row.teamMemberId) return true;
  }
  return false;
}
