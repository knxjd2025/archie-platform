/**
 * Who is talking to an advisor. Built once per chat request from the session
 * and handed to every tool, so an advisor can only ever fetch what the person
 * asking is allowed to see on the screens themselves.
 *
 * Agents used to be built with no idea who was talking to them, so their tools
 * queried company-wide: a sales rep could ask the sales advisor to list
 * commissions and get every rep's revenue and pay.
 */
import type { TeamRole } from '../../shared/rbac';
import { teamMemberIdByEmail, type SessionUser } from '../access/rep-scope';
import { visibleEmailsFor, visibleIdsFor, visibleRepNamesFor } from '../access/team-scope';

export interface AgentViewer {
  /** Lowercased JobTread "Sales Rep" names this viewer may see. null = unrestricted. */
  repNames: string[] | null;
  /** team_members ids this viewer may see. null = unrestricted. */
  memberIds?: number[] | null;
  /** Lowercased emails this viewer may see (follow-ups, calendars). null = unrestricted. */
  emails?: string[] | null;
  /** The viewer themselves — needed for "my" queries and for creating things on their behalf. */
  email?: string;
  name?: string;
  role?: TeamRole;
  teamMemberId?: number | null;
}

/** Does this viewer own work attributed to `rep`? Unassigned work is not theirs. */
export function viewerOwnsRep(viewer: AgentViewer | undefined, rep: string | null | undefined): boolean {
  if (!viewer || viewer.repNames === null) return true;
  if (!rep) return false;
  return viewer.repNames.includes(String(rep).toLowerCase());
}

/** The SessionUser shape the access helpers take, or null when the viewer is anonymous (tests). */
export function viewerSession(viewer: AgentViewer | undefined): SessionUser | null {
  if (!viewer?.email || !viewer.role) return null;
  return { email: viewer.email, name: viewer.name || viewer.email, role: viewer.role };
}

export async function buildAgentViewer(user: SessionUser): Promise<AgentViewer> {
  const [repNames, memberIds, emails, teamMemberId] = await Promise.all([
    visibleRepNamesFor(user),
    visibleIdsFor(user),
    visibleEmailsFor(user),
    teamMemberIdByEmail(user.email),
  ]);
  return { repNames, memberIds, emails, email: user.email, name: user.name, role: user.role, teamMemberId };
}
