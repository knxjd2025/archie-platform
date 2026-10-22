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
 *            redirects to brnapp://auth?t=…
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
import { eq, like } from 'drizzle-orm';
import { db } from '../db';
import { settings } from '../../shared/schema';

/** The scheme the native shells register. Kept here so both sides agree. */
export const NATIVE_SCHEME = process.env.NATIVE_APP_SCHEME || 'brnapp';

const PREFIX = 'native_auth:';
const TTL_MS = 2 * 60 * 1000;

const hash = (token: string) => crypto.createHash('sha256').update(token).digest('hex');

export interface HandoffPayload { email: string; exp: number }

/** A one-time token for `email`, and nothing else. */
export async function mintHandoff(email: string): Promise<string> {
  const token = crypto.randomBytes(32).toString('base64url');
  const payload: HandoffPayload = { email: email.toLowerCase(), exp: Date.now() + TTL_MS };
  await db.insert(settings)
    .values({ key: `${PREFIX}${hash(token)}`, value: payload })
    .onConflictDoUpdate({ target: settings.key, set: { value: payload, updatedAt: new Date() } });
  return token;
}

/**
 * Spend a token. Returns the email it was minted for, or null — expired, already
 * used, or never existed all look the same from the outside on purpose.
 */
export async function redeemHandoff(token: string): Promise<string | null> {
  if (typeof token !== 'string' || token.length < 20 || token.length > 200) return null;
  const key = `${PREFIX}${hash(token)}`;
  // Spent by being presented, whatever happens next — and in one statement.
  // This was a select then a delete, so two requests racing with the same
  // token (a double-fired deep link, or someone who intercepted it) could both
  // read the row before either deleted it, and both get a session.
  const [row] = await db.delete(settings).where(eq(settings.key, key)).returning();
  if (!row) return null;
  const payload = row.value as HandoffPayload | null;
  if (!payload?.email || typeof payload.exp !== 'number' || Date.now() > payload.exp) return null;
  return payload.email;
}

/**
 * Drop tokens nobody came back for. Called opportunistically on mint — the
 * table is shared with real settings and should not silently accumulate rows
 * that stopped meaning anything two minutes after they were written.
 */
export async function sweepExpiredHandoffs(): Promise<number> {
  const rows = await db.select().from(settings).where(like(settings.key, `${PREFIX}%`));
  const dead = rows.filter((r) => {
    const p = r.value as HandoffPayload | null;
    return !p || typeof p.exp !== 'number' || Date.now() > p.exp;
  });
  for (const r of dead) await db.delete(settings).where(eq(settings.key, r.key));
  return dead.length;
}

/** The deep link the browser is sent to once sign-in has succeeded. */
export const handoffUrl = (token: string): string => `${NATIVE_SCHEME}://auth?t=${encodeURIComponent(token)}`;
