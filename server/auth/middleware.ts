import type { Request, Response, NextFunction } from 'express';
import { atLeast, type TeamRole } from '../../shared/rbac';
import { isAllowedLoginEmail, isBlockedLoginEmail, memberCanLogin, type LoginGateMember } from './allowlist';
import { getTeamMemberByEmail } from '../storage/team';

/** A session that belongs to a blocked address is ended on the spot, even one that predates the block. */
function endBlockedSession(req: Request, res: Response): boolean {
  const email = req.session?.user?.email;
  if (!email || !isBlockedLoginEmail(email)) return false;
  req.session.destroy(() => res.status(401).json({ message: 'Not authenticated' }));
  return true;
}

// ============================================================
// Session revalidation
// ============================================================

/**
 * A session used to be trusted for its whole life: someone switched off on the
 * Team & Roles page (active or canLogin off), or demoted from admin to sales,
 * kept their old access until the cookie expired. Each request now re-reads the
 * roster row, through a short cache so it is not a database hit per request.
 */
const REVALIDATE_TTL_MS = 30_000;

type RosterRow = (LoginGateMember & { role: TeamRole; name: string }) | null;
const rosterCache = new Map<string, { row: RosterRow; at: number }>();
/**
 * The lookup in flight, per email. A page load fires a burst of parallel API
 * calls, and on a cold cache every one of them missed and ran its own roster
 * query. They now share the first one's. Only a finished lookup is cached, so
 * a failed one is retried by the next request rather than remembered.
 */
const rosterInflight = new Map<string, Promise<RosterRow>>();

/** Drop cached roster rows — after a roster edit, or between tests. */
export function clearSessionRevalidationCache(email?: string): void {
  if (email) {
    const key = email.trim().toLowerCase();
    rosterCache.delete(key);
    rosterInflight.delete(key);
  } else {
    rosterCache.clear();
    rosterInflight.clear();
  }
}

async function fetchRosterRow(key: string): Promise<RosterRow> {
  const member = await getTeamMemberByEmail(key);
  const row: RosterRow = member
    ? { active: member.active, canLogin: member.canLogin, role: member.role as TeamRole, name: member.name }
    : null;
  rosterCache.set(key, { row, at: Date.now() });
  return row;
}

async function loadRosterRow(email: string): Promise<RosterRow> {
  const key = email.trim().toLowerCase();
  const hit = rosterCache.get(key);
  if (hit && Date.now() - hit.at < REVALIDATE_TTL_MS) return hit.row;
  const pending = rosterInflight.get(key);
  if (pending) return pending;
  const lookup = fetchRosterRow(key);
  rosterInflight.set(key, lookup);
  try {
    return await lookup;
  } finally {
    // Only our own entry: a cache clear mid-lookup may have let a newer one in.
    if (rosterInflight.get(key) === lookup) rosterInflight.delete(key);
  }
}

/**
 * The same rule sign-in applies (server/auth/routes.ts): not blocked, on the
 * optional LOGIN_ALLOWLIST when it is set, and an active roster member with
 * login enabled. Returns the current roster row when the session may continue.
 */
async function currentMember(email: string): Promise<RosterRow> {
  if (isBlockedLoginEmail(email)) return null;
  if (process.env.LOGIN_ALLOWLIST && !isAllowedLoginEmail(email)) return null;
  const row = await loadRosterRow(email);
  return row && memberCanLogin(row) ? row : null;
}

/**
 * Re-check the session against the roster. Ends the session (401) when the
 * person may no longer sign in, and refreshes the session's role and name from
 * the database so a demotion takes effect within the cache window.
 * Resolves true when the request may proceed; false when a response was sent.
 */
async function revalidateSession(req: Request, res: Response): Promise<boolean> {
  const user = req.session?.user;
  if (!user) {
    res.status(401).json({ message: 'Not authenticated' });
    return false;
  }
  if (endBlockedSession(req, res)) return false;
  let member: RosterRow;
  try {
    member = await currentMember(user.email);
  } catch (err) {
    // A roster read failure is not proof the person was removed, and ending
    // every session on a database blip would sign the whole team out. Refuse
    // this one request instead.
    console.error('[auth] session revalidation failed', err);
    res.status(503).json({ message: 'Could not verify your sign-in. Try again.' });
    return false;
  }
  if (!member) {
    console.warn(`[auth] ending session for ${user.email}: no longer allowed to sign in`);
    req.session.destroy(() => res.status(401).json({ message: 'Not authenticated' }));
    return false;
  }
  if (user.role !== member.role || user.name !== member.name) {
    req.session.user = { ...user, role: member.role, name: member.name };
  }
  return true;
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session?.user) {
    return res.status(401).json({ message: 'Not authenticated' });
  }
  void revalidateSession(req, res).then((ok) => { if (ok) next(); }, next);
}

export function requireRole(min: TeamRole) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.session?.user) return res.status(401).json({ message: 'Not authenticated' });
    void revalidateSession(req, res).then((ok) => {
      if (!ok) return;
      // Read the role after revalidation: it now reflects the roster, not
      // whatever the role was when this person signed in.
      if (!atLeast(req.session.user!.role, min)) return res.status(403).json({ message: 'Forbidden' });
      next();
    }, next);
  };
}
