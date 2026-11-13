import type { Express, Request, Response } from 'express';
import { isAllowedLoginEmail, isBlockedLoginEmail, memberCanLogin } from './allowlist';
import { startSignedInSession } from './routes';
import { passwordProblem, hashPassword, verifyPassword } from './password';
import { mintPasswordLink, passwordLinkUrl, redeemPasswordLink } from './password-links';
import { sendPasswordLinkEmail } from './password-mail';
import { clearFailedLogins, findSignInMember, recordFailedLogin, setPasswordHash, touchLogin, type SignInMember } from '../storage/team';
import { isLiveCompany } from '../../shared/company';
import { runAsCompany } from '../tenant/context';
import { rateLimit } from '../lib/rate-limit';

const TEN_MINUTES = 10 * 60 * 1000;
const ONE_HOUR = 60 * 60 * 1000;
const WRONG = { error: 'Email or password is wrong.' };
const EXPIRED = { error: 'This link has expired. Ask for a new one.' };
const MAX_PASSWORD_TRIED = 1000; // longer than any password we accept; stops a huge body costing a hash

const normalize = (v: unknown): string => (typeof v === 'string' ? v.trim().toLowerCase() : '');

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

const startSession = (req: Request, { member, company }: SignInMember, email: string) =>
  startSignedInSession(req, { email, name: member.name, role: member.role, companyId: company.id });

export function registerPasswordRoutes(app: Express): void {
  app.post('/api/auth/login/password', rateLimit(20, TEN_MINUTES), async (req: Request, res: Response) => {
    try {
      const email = normalize(req.body?.email);
      const password = typeof req.body?.password === 'string' ? req.body.password : '';
      const found = await passGate(email);

      // A locked account answers exactly like a wrong password (a distinct answer
      // would tell a stranger the email is on a roster), and still pays for a verify.
      const locked = !!found?.member.lockedUntil && found.member.lockedUntil.getTime() > Date.now();

      // Always hash-compare, even with nobody to compare against, so an unknown
      // email takes as long as a wrong password.
      const ok = password.length <= MAX_PASSWORD_TRIED && await verifyPassword(password, found?.member.passwordHash ?? null);
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
    const started = Date.now();
    try {
      const email = normalize(req.body?.email);
      const found = await passGate(email);
      if (found) {
        const token = await runAsCompany(found.company.id, () => mintPasswordLink(email, 'reset'));
        await sendPasswordLinkEmail({
          to: email,
          name: found.member.name,
          companyName: found.company.name,
          purpose: 'reset',
          url: passwordLinkUrl(token),
        });
      }
    } catch (err) {
      // Never surfaced: the answer must not depend on whether this email is on a roster.
      console.error('[auth] password reset email failed', err);
    }
    // Sending mail takes far longer than finding nobody; wait out the difference.
    const floor = Number(process.env.PASSWORD_FORGOT_MIN_MS ?? 1500);
    const wait = floor - (Date.now() - started);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
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
      await runAsCompany(found.company.id, async () => {
        await setPasswordHash(email, hash);
        await touchLogin(email);
      });
      await startSession(req, found, email);
      res.json({ ok: true });
    } catch (err) {
      console.error('[auth] set password error', err);
      res.status(500).json({ error: 'Could not save your password. Try again.' });
    }
  });
}
