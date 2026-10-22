import crypto from 'node:crypto';
import { google } from 'googleapis';
import { timingSafeEqualStr } from '../security-config';

// The OAuth redirect URI can be passed in (derived from the request's host, so
// login works on any domain the app is served from). Falls back to the GOOGLE_OAUTH_REDIRECT env.
function client(redirectUri?: string) {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    redirectUri || process.env.GOOGLE_OAUTH_REDIRECT,
  );
}

type AuthUrlOptions = NonNullable<Parameters<ReturnType<typeof client>['generateAuthUrl']>[0]>;

export function buildGoogleAuthUrl(redirectUri?: string, state?: string, codeChallenge?: string): string {
  return client(redirectUri).generateAuthUrl({
    access_type: 'online',
    prompt: 'select_account',
    scope: ['openid', 'email', 'profile'],
    // Carries the per-sign-in nonce, and whether this sign-in began in the
    // native app so the callback knows to hand a token back to it rather than
    // redirect to the website. See newOAuthState.
    ...(state ? { state } : {}),
    ...(codeChallenge
      ? { code_challenge: codeChallenge, code_challenge_method: 'S256' as AuthUrlOptions['code_challenge_method'] }
      : {}),
  });
}

// ============================================================
// Sign-in state: the login CSRF check
// ============================================================

/**
 * `state` used to be just 'native' or nothing, so the callback would finish any
 * sign-in it was handed. An attacker could start a Google sign-in with their
 * own account, stop at the callback, and send that URL to someone: opening it
 * signed the victim's browser in as the attacker. The state is now a random
 * nonce tied to the browser that started the sign-in (held in its session),
 * and the callback refuses one it did not issue.
 */
export interface OAuthState { native: boolean; nonce: string }

/** Long enough that an unexpired one can only come from the session that holds it. */
export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

export function newOAuthState(native: boolean): { state: string; nonce: string } {
  const nonce = crypto.randomBytes(24).toString('base64url');
  return { state: `${native ? 'native' : 'web'}.${nonce}`, nonce };
}

/** The state Google echoed back, or null when it is not one this app issues. */
export function parseOAuthState(raw: unknown): OAuthState | null {
  if (typeof raw !== 'string') return null;
  const m = /^(native|web)\.([A-Za-z0-9_-]{32})$/.exec(raw);
  return m ? { native: m[1] === 'native', nonce: m[2] } : null;
}

export interface PendingSignIn { nonce: string; verifier?: string; at: number }

/**
 * Did this browser start this sign-in, recently? `pending` is what the login
 * route stored in the session. Compared in constant time so a nonce cannot be
 * worked out from how long a refusal takes.
 */
export function verifyOAuthState(raw: unknown, pending: PendingSignIn | undefined, now = Date.now()): OAuthState | null {
  const parsed = parseOAuthState(raw);
  if (!parsed || !pending?.nonce) return null;
  if (typeof pending.at !== 'number' || now - pending.at > OAUTH_STATE_TTL_MS) return null;
  return timingSafeEqualStr(parsed.nonce, pending.nonce) ? parsed : null;
}

/**
 * PKCE: the code Google returns is only redeemable alongside a verifier that
 * never leaves the server, so an authorization code lifted from a URL or a log
 * is worth nothing on its own.
 */
export async function newPkcePair(redirectUri?: string): Promise<{ verifier: string; challenge: string }> {
  const { codeVerifier, codeChallenge } = await client(redirectUri).generateCodeVerifierAsync();
  if (!codeChallenge) throw new Error('PKCE challenge was not generated');
  return { verifier: codeVerifier, challenge: codeChallenge };
}

export interface GoogleUserinfo {
  email?: string | null;
  verified_email?: boolean | null;
  name?: string | null;
  id?: string | null;
}

/**
 * The profile sign-in trusts. The address is the whole identity check — it is
 * matched against the roster — so an address Google has not verified is
 * refused rather than taken at its word. Any Google account may sign in;
 * the company roster decides who gets in.
 */
export function profileFromUserinfo(data: GoogleUserinfo): { email: string; name: string; sub: string } {
  if (!data.email) throw new Error('Google profile missing email');
  if (data.verified_email !== true) throw new Error('Google email is not verified');
  return { email: data.email, name: data.name ?? data.email, sub: data.id ?? '' };
}

export async function exchangeCodeForProfile(
  code: string,
  redirectUri?: string,
  codeVerifier?: string,
): Promise<{ email: string; name: string; sub: string }> {
  const oauth2 = client(redirectUri);
  const { tokens } = await oauth2.getToken({ code, codeVerifier });
  oauth2.setCredentials(tokens);
  const api = google.oauth2({ version: 'v2', auth: oauth2 });
  const { data } = await api.userinfo.get();
  return profileFromUserinfo(data);
}
