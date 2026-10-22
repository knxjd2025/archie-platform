/**
 * Operator-level sign-in limits for the whole Archie deployment, on top of
 * each company's roster. Both are empty unless set.
 *
 * LOGIN_ALLOWLIST (CSV): when set, only these addresses may sign in at all
 * (useful while a deployment is private). LOGIN_BLOCKLIST (CSV): addresses
 * that may never sign in or be put on any roster, whatever a roster says.
 */
const DEFAULT_ALLOWLIST = '';

export function isBlockedLoginEmail(email: string, blocklistCsv?: string): boolean {
  if (!email) return false;
  const raw = blocklistCsv ?? process.env.LOGIN_BLOCKLIST ?? '';
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
