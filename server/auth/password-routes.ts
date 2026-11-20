import type { Express, Request, Response } from 'express';
import { waitUntil } from '@vercel/functions';
import { isAllowedLoginEmail, isBlockedLoginEmail, memberCanLogin } from './allowlist';
import { startSignedInSession } from './routes';
import { passwordProblem, hashPassword, verifyPassword } from './password';
import { deletePasswordLinksFor, mintResetLinkUnlessRecent, passwordLinkUrl, redeemPasswordLink } from './password-links';
import { sendPasswordLinkEmail } from './password-mail';
import { endSessionsFor } from './sessions';
import { PASSWORD_LINK_EXPIRED } from '../../shared/password-messages';
import { clearFailedLogins, findSignInMember, recordFailedLogin, setPasswordHash, touchLogin, type SignInMember } from '../storage/team';
import { COMPANY_INACTIVE_CODE, inactiveCompanyMessage, isLiveCompany } from '../../shared/company';
import { runAsCompany } from '../tenant/context';
import { rateLimit } from '../lib/rate-limit';

const TEN_MINUTES = 10 * 60 * 1000;
const ONE_HOUR = 60 * 60 * 1000;
const WRONG = { error: 'Email or password is wrong.' };
const EXPIRED = { error: PASSWORD_LINK_EXPIRED };
const MAX_PASSWORD_TRIED = 1000; // longer than any password we accept; stops a huge body costing a hash

const normalize = (v: unknown): string => (typeof v === 'string' ? v.trim().toLowerCase() : '');

const FORGOT_DEFAULT_MS = 1500;

/**
 * How long "Forgot password?" takes to answer, every time. PASSWORD_FORGOT_MIN_MS
 * may change it; anything that is not a finite number of 0 or more (unset,
 * empty, a typo) means the default, never "no wait at all".
 */
export function forgotFloorMs(): number {
  const raw = process.env.PASSWORD_FORGOT_MIN_MS;
  if (raw === undefined || raw.trim() === '') return FORGOT_DEFAULT_MS;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : FORGOT_DEFAULT_MS;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Look up, mint and mail a reset link. Never throws: failures are logged and never reach the answer. */
async function sendResetIfMember(email: string): Promise<void> {
  try {
    const found = await passGate(email);
    if (!found) return;
    const token = await runAsCompany(found.company.id, () => mintResetLinkUnlessRecent(email));
    if (!token) return; // a link went to this email in the last 2 minutes
    // In the company's context: the email goes out through that company's own sender.
    await runAsCompany(found.company.id, () => sendPasswordLinkEmail({
      to: email,
      name: found.member.name,
      companyName: found.company.name,
      purpose: 'reset',
      url: passwordLinkUrl(token),
    }));
  } catch (err) {
    console.error('[auth] password reset email failed', err);
  }
}

/**
 * The same gate Google sign-in applies: not blocklisted, on LOGIN_ALLOWLIST
 * when that is set, on a roster with login enabled, in a live company.
 * Written here once for all three routes so the Google callback stays untouched.
 */
async function passGate(email: string): Promise<SignInMember | null> {
  if (!email || isBlockedLoginEmail(email)) return null;
  if (process.env.LOGIN_ALLOWLIST && !isAllowedLoginEmail(email)) return null;
  const found = await findSignInMember(email);
  if (!found || !memberCanLogin(found.member) || !isLiveCompany(found.company)) return null;
  return found;
}

/**
 * For sign-in only: the gate's answer, plus the member of a paused or
 * cancelled company who would otherwise have passed. They are told their
 * company is paused, but only after their password checks out, so the answer
 * never tells a stranger that an email is on a roster.
 */
async function passGateOrInactive(email: string): Promise<{ found: SignInMember | null; inactive: SignInMember | null }> {
  if (!email || isBlockedLoginEmail(email)) return { found: null, inactive: null };
  if (process.env.LOGIN_ALLOWLIST && !isAllowedLoginEmail(email)) return { found: null, inactive: null };
  const found = await findSignInMember(email);
  if (!found || !memberCanLogin(found.member)) return { found: null, inactive: null };
  return isLiveCompany(found.company) ? { found, inactive: null } : { found: null, inactive: found };
}

const startSession = (req: Request, { member, company }: SignInMember, email: string) =>
  startSignedInSession(req, { email, name: member.name, role: member.role, companyId: company.id });

export function registerPasswordRoutes(app: Express): void {
  app.post('/api/auth/login/password', rateLimit(20, TEN_MINUTES), async (req: Request, res: Response) => {
    try {
      const email = normalize(req.body?.email);
      const password = typeof req.body?.password === 'string' ? req.body.password : '';
      const { found, inactive } = await passGateOrInactive(email);

      // A locked account answers exactly like a wrong password (a distinct answer
      // would tell a stranger the email is on a roster), and still pays for a verify.
      const locked = !!found?.member.lockedUntil && found.member.lockedUntil.getTime() > Date.now();

      // Always hash-compare, even with nobody to compare against, so an unknown
      // email takes as long as a wrong password.
      const ok = password.length <= MAX_PASSWORD_TRIED && await verifyPassword(password, (found ?? inactive)?.member.passwordHash ?? null);
      if (inactive && ok && !(inactive.member.lockedUntil && inactive.member.lockedUntil.getTime() > Date.now())) {
        const message = inactiveCompanyMessage(inactive.company.status);
        return res.status(403).json({ error: message, code: COMPANY_INACTIVE_CODE });
      }
      if (!found || locked || !ok) {
        if (found && !locked) await runAsCompany(found.company.id, () => recordFailedLogin(email));
        return res.status(401).json(WRONG);
      }

      // The lock was read before the slow verify; a parallel wrong guess may have
      // set it since. The database decides, in the same statement that clears the count.
      const cleared = await runAsCompany(found.company.id, async () => {
        if (!(await clearFailedLogins(email))) return false;
        await touchLogin(email);
        return true;
      });
      if (!cleared) return res.status(401).json(WRONG);
      await startSession(req, found, email);
      res.json({ ok: true });
    } catch (err) {
      console.error('[auth] password sign-in error', err);
      res.status(500).json({ error: 'Could not sign you in. Try again.' });
    }
  });

  app.post('/api/auth/password/forgot', rateLimit(5, ONE_HOUR), async (req: Request, res: Response) => {
    // The answer comes at the same moment whatever happened: on a roster or
    // not, mail fast, slow or failing. The lookup and the send run on their
    // own; if they are still going at the mark they finish after the answer
    // (kept alive on Vercel by waitUntil).
    const answerAt = Date.now() + forgotFloorMs();
    waitUntil(sendResetIfMember(normalize(req.body?.email)));
    await sleep(Math.max(0, answerAt - Date.now()));
    res.json({ ok: true });
  });

  app.post('/api/auth/password/set', rateLimit(20, TEN_MINUTES), async (req: Request, res: Response) => {
    try {
      const password = req.body?.password;
      // Checked before the link is spent, so a too-short password can be fixed and retried.
      const problem = passwordProblem(password);
      if (problem) return res.status(400).json({ error: problem });

      const grant = await redeemPasswordLink(String(req.body?.token || ''));
      if (!grant) return res.status(400).json(EXPIRED);

      // The link says who it was for when it was sent, not who may sign in now.
      const email = normalize(grant.email);
      const found = await passGate(email);
      if (!found || found.company.id !== grant.companyId) return res.status(400).json(EXPIRED);

      const hash = await hashPassword(password);
      // Whoever else had this password, or another link, is shut out: every
      // session of theirs ends, then their other links are cancelled. Sessions
      // end first, so if that fails the password is left as it was and the
      // error below is true. Both happen before the new session is saved, so
      // the new one is the one that survives.
      await endSessionsFor(email);
      await runAsCompany(found.company.id, async () => {
        await setPasswordHash(email, hash);
        await touchLogin(email);
        await deletePasswordLinksFor(email);
      });
      await startSession(req, found, email);
      res.json({ ok: true });
    } catch (err) {
      console.error('[auth] set password error', err);
      res.status(500).json({ error: 'Could not save your password. Try again.' });
    }
  });
}
