/**
 * Handing a signed-in session from the system browser back into the app.
 *
 * Google refuses OAuth inside an embedded WebView (`disallowed_useragent`,
 * enforced since 2023), so the native app cannot sign in the way the website
 * does. The flow instead is:
 *
 *   app  →  opens the system browser at /api/auth/login/google?native=1
 *   Google → the ordinary consent screen, in a real browser
 *   server → every existing check runs, then mints a one-time token and
 *            redirects to archie://auth?t=…
 *   app  →  catches the deep link and POSTs the token to /native/exchange
 *            from inside the WebView, so the session cookie lands in the
 *            WebView's own jar — which is the whole point.
 *
 * The token is the only thing that ever travels over the custom scheme, and it
 * is built to be worth as little as possible: two minutes to live, usable
 * once, and only a SHA-256 of it is stored, so a glance at the database yields
 * nothing that can be redeemed.
 *
 * A custom scheme can in principle be claimed by another app on the device.
 * That is why redemption re-runs the authorisation checks rather than trusting
 * the token alone, and why the window is two minutes. Universal Links / App
 * Links close that gap properly and are the upgrade path — they need the Apple
 * Team ID and the Android signing fingerprint, which is why this ships first.
 */
import crypto from 'node:crypto';
import { eq, lt } from 'drizzle-orm';
import { db } from '../db';
import { nativeHandoffs } from '../../shared/schema';
import { requireCompanyId, runAsSystem } from '../tenant/context';

/** The scheme the native shells register. Kept here so both sides agree. */
export const NATIVE_SCHEME = process.env.NATIVE_APP_SCHEME || 'archie';

const TTL_MS = 2 * 60 * 1000;

const hash = (token: string) => crypto.createHash('sha256').update(token).digest('hex');

/** Who a token was minted for, and in which company. */
export interface HandoffGrant { email: string; companyId: string }

/** A one-time token for `email` in the current company, and nothing else. */
export async function mintHandoff(email: string): Promise<string> {
  requireCompanyId();
  const token = crypto.randomBytes(32).toString('base64url');
  await db.insert(nativeHandoffs).values({
    tokenHash: hash(token),
    email: email.toLowerCase(),
    expiresAt: new Date(Date.now() + TTL_MS),
  });
  return token;
}

/**
 * Spend a token. Returns who it was minted for, or null — expired, already
 * used, or never existed all look the same from the outside on purpose.
 *
 * Spent by being presented, in one statement, so two requests racing with the
 * same token cannot both get a session. Before sign-in there is no company
 * yet, so the row is found by its hash alone; native_handoffs is written only
 * by mintHandoff, so the company it names is the one that minted it.
 */
export async function redeemHandoff(token: string): Promise<HandoffGrant | null> {
  if (typeof token !== 'string' || token.length < 20 || token.length > 200) return null;
  const [row] = await runAsSystem('redeem native sign-in token', () =>
    db.delete(nativeHandoffs).where(eq(nativeHandoffs.tokenHash, hash(token))).returning());
  if (!row || Date.now() > row.expiresAt.getTime()) return null;
  return { email: row.email, companyId: row.companyId };
}

/** Drop the current company's tokens nobody came back for. Called opportunistically on mint. */
export async function sweepExpiredHandoffs(): Promise<number> {
  const gone = await db.delete(nativeHandoffs).where(lt(nativeHandoffs.expiresAt, new Date())).returning({ h: nativeHandoffs.tokenHash });
  return gone.length;
}

/** The deep link the browser is sent to once sign-in has succeeded. */
export const handoffUrl = (token: string): string => `${NATIVE_SCHEME}://auth?t=${encodeURIComponent(token)}`;
