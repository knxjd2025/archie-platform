import type { Express, Request, Response } from 'express';
import { buildGoogleAuthUrl, exchangeCodeForProfile, newOAuthState, newPkcePair, verifyOAuthState } from './google';
import { handoffUrl, mintHandoff, redeemHandoff, sweepExpiredHandoffs } from './native-handoff';
import { isAllowedLoginEmail, isBlockedLoginEmail, memberCanLogin } from './allowlist';
import { findSignInMember, touchLogin } from '../storage/team';
import { getCurrentCompany } from '../tenant/companies';
import { isLiveCompany, resolveCompanyProfile } from '../../shared/company';
import { runAsCompany } from '../tenant/context';
import { requireAuth } from './middleware';

// Build the Google callback URL from the incoming request's host, so login
// works on whatever domain the app is served from with no env cutover. The auth request and the
// token exchange MUST use the same value — both derive it from the same host.
// Each domain's callback URL must be listed in the Google OAuth client.
function callbackUrl(req: Request): string {
  const host = (req.headers['x-forwarded-host'] as string) || req.get('host');
  if (!host) return process.env.GOOGLE_OAUTH_REDIRECT || '';
  const proto = ((req.headers['x-forwarded-proto'] as string) || req.protocol || 'https').split(',')[0];
  return `${proto}://${host}/api/auth/login/google/callback`;
}

const saveSession = (req: Request): Promise<void> =>
  new Promise((resolve, reject) => req.session.save((err) => (err ? reject(err) : resolve())));

const regenerateSession = (req: Request): Promise<void> =>
  new Promise((resolve, reject) => req.session.regenerate((err) => (err ? reject(err) : resolve())));

type SessionUser = NonNullable<Request['session']['user']>;

/**
 * Sign this browser in on a brand-new session id. The id used to be kept from
 * before sign-in, so anyone who had planted or read a session cookie before the
 * person logged in held a signed-in session afterwards (session fixation). The
 * old session carries nothing worth keeping: the pending sign-in is spent by
 * the time this runs, and `user` is set fresh here.
 */
export async function startSignedInSession(req: Request, user: SessionUser): Promise<void> {
  await regenerateSession(req);
  req.session.user = user;
  await saveSession(req);
}

export function registerAuthRoutes(app: Express) {
  app.get('/api/auth/login/google', async (req: Request, res: Response) => {
    // `native=1` means the app opened this in the system browser, because
    // Google will not run OAuth inside a WebView. The flag rides along in
    // `state` so the callback can tell the two apart. The system browser makes
    // both this request and the callback, so the session cookie set here is
    // there when Google sends the person back.
    const native = req.query.native === '1';
    const redirectUri = callbackUrl(req);
    try {
      const { state, nonce } = newOAuthState(native);
      const pkce = await newPkcePair(redirectUri);
      req.session.pendingSignIn = { nonce, verifier: pkce.verifier, at: Date.now() };
      // Saved before the redirect: Google can send the person back faster than
      // an end-of-response save would land in the store.
      await saveSession(req);
      res.redirect(buildGoogleAuthUrl(redirectUri, state, pkce.challenge));
    } catch (err) {
      console.error('[auth] could not start sign-in', err);
      res.redirect('/login?error=auth_failed');
    }
  });

  app.get('/api/auth/login/google/callback', async (req: Request, res: Response) => {
    // Spent by arriving here, whatever happens next: one sign-in per nonce.
    const pending = req.session.pendingSignIn;
    delete req.session.pendingSignIn;
    const code = req.query.code as string | undefined;
    if (!code) return res.redirect('/login?error=missing_code');
    // A callback this browser did not start is someone else's sign-in being
    // pushed onto it (login CSRF). See verifyOAuthState.
    const signIn = verifyOAuthState(req.query.state, pending);
    if (!signIn) {
      console.warn('[auth] callback refused: state does not match a sign-in this browser started');
      return res.redirect('/login?error=auth_failed');
    }
    try {
      const profile = await exchangeCodeForProfile(code, callbackUrl(req), pending?.verifier);
      const email = profile.email.toLowerCase();

      // A blocked address never gets in, even if someone puts it on the roster.
      if (isBlockedLoginEmail(email)) {
        console.warn(`[auth] blocked sign-in attempt: ${email}`);
        return res.redirect('/login?error=not_authorized');
      }

      // The Team & Roles roster is the source of truth for who can log in.
      // LOGIN_ALLOWLIST is an OPTIONAL extra lock: only enforced when explicitly
      // set. Leave it unset to let anyone on the roster (with login enabled) in.
      if (process.env.LOGIN_ALLOWLIST && !isAllowedLoginEmail(email)) {
        return res.redirect('/login?error=not_authorized');
      }

      // Any active member with login enabled may sign in, regardless of role;
      // role scopes what they see/do once inside (rbac.ts + requireRole).
      // Found across every company (nobody knows the company yet), then
      // everything after this runs as that person's company.
      const found = await findSignInMember(email);
      if (!found || !memberCanLogin(found.member)) {
        return res.redirect('/login?error=not_authorized');
      }
      // A paused or cancelled company's team cannot sign in.
      if (!isLiveCompany(found.company)) {
        return res.redirect('/login?error=company_inactive');
      }
      const { member, company } = found;

      await runAsCompany(company.id, () => touchLogin(email, profile.sub));

      // The native app cannot use the session cookie set here: this is the
      // system browser, a different cookie jar from the app's WebView. Hand it
      // a one-time token instead, which the app trades for its own session.
      if (signIn.native) {
        const token = await runAsCompany(company.id, () => mintHandoff(email));
        void runAsCompany(company.id, () => sweepExpiredHandoffs()).catch(() => {});
        return res.redirect(handoffUrl(token));
      }

      await startSignedInSession(req, { email, name: member.name, role: member.role, companyId: company.id });
      res.redirect('/');
    } catch (err) {
      console.error('[auth] callback error', err);
      res.redirect('/login?error=auth_failed');
    }
  });

  /**
   * The app trading its handoff token for a session.
   *
   * Called from inside the WebView, so the cookie this sets lands where the
   * app will actually send it. Every check the browser flow makes is made
   * again here: the token says who signed in two minutes ago, not who is
   * allowed in now, and those can differ if someone was removed in between.
   */
  app.post('/api/auth/native/exchange', async (req: Request, res: Response) => {
    try {
      const grant = await redeemHandoff(String(req.body?.token || ''));
      if (!grant) return res.status(401).json({ error: 'That sign-in link has expired. Try signing in again.' });

      const { email } = grant;
      if (isBlockedLoginEmail(email)) {
        console.warn(`[auth] blocked native exchange: ${email}`);
        return res.status(403).json({ error: 'not authorized' });
      }
      if (process.env.LOGIN_ALLOWLIST && !isAllowedLoginEmail(email)) {
        return res.status(403).json({ error: 'not authorized' });
      }
      const found = await findSignInMember(email);
      if (!found || !memberCanLogin(found.member) || !isLiveCompany(found.company)) return res.status(403).json({ error: 'not authorized' });
      // The token only ever opens the company that minted it.
      if (found.company.id !== grant.companyId) return res.status(403).json({ error: 'not authorized' });
      const { member, company } = found;

      const user = { email, name: member.name, role: member.role, companyId: company.id };
      await startSignedInSession(req, user);
      res.json({ ok: true, user });
    } catch (err) {
      console.error('[auth] native exchange error', err);
      res.status(500).json({ error: 'Could not finish signing in. Try again.' });
    }
  });

  app.post('/api/auth/logout', (req: Request, res: Response) => {
    req.session.destroy(() => res.json({ ok: true }));
  });

  app.get('/api/auth/me', requireAuth, async (req: Request, res: Response) => {
    const company = await getCurrentCompany();
    res.json({
      user: req.session.user,
      company: company && { id: company.id, slug: company.slug, name: company.name, trade: company.trade, branding: company.branding },
      // Everything the app's screens need to say the company's name and use
      // its colors and contact details (shared/company.ts).
      profile: company ? resolveCompanyProfile(company) : null,
    });
  });
}
