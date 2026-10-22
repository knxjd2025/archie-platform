const DEFAULT_ALLOWLIST = 'james@bestroofingnow.com,admin@bestroofingnow.com';

/**
 * Addresses that may never sign in or be put on the roster, whatever the
 * roster says. James's call (2026-09-15): the one bestroofingnow.com account
 * that must not get in or join is fred@. LOGIN_BLOCKLIST adds more (CSV).
 */
const DEFAULT_BLOCKLIST = 'fred@bestroofingnow.com';

export function isBlockedLoginEmail(email: string, blocklistCsv?: string): boolean {
  if (!email) return false;
  const raw = [DEFAULT_BLOCKLIST, blocklistCsv ?? process.env.LOGIN_BLOCKLIST ?? ''].join(',');
  const blocked = raw.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
  return blocked.includes(email.trim().toLowerCase());
}

export function isAllowedLoginEmail(email: string, allowlistCsv?: string): boolean {
  if (!email) return false;
  const raw = allowlistCsv ?? process.env.LOGIN_ALLOWLIST ?? DEFAULT_ALLOWLIST;
  const allowed = raw.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
  return allowed.includes(email.trim().toLowerCase());
}

/** The subset of a team_members row the login gate needs. */
export interface LoginGateMember {
  active?: boolean | null;
  canLogin?: boolean | null;
}

/**
 * Whether a rostered team member may sign in.
 *
 * Login is gated only on being an active member with login enabled — role does
 * NOT gate login. Once inside, a member's role scopes what they can see and do
 * (see shared/rbac.ts + requireRole). This lets the whole team log in while
 * still restricting each person to their allowed screens and actions.
 *
 * The Team & Roles roster is the single source of truth for who can log in;
 * flip `active` or `canLogin` off to off-board someone.
 */
export function memberCanLogin(member: LoginGateMember | undefined | null): boolean {
  if (!member) return false;
  return Boolean(member.active) && Boolean(member.canLogin);
}
