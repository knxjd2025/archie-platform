import type { CookieOptions } from 'express-session';
import type { CorsOptions } from 'cors';
import { timingSafeEqual } from 'crypto';
import { createSessionStore } from './session-store';

/**
 * Plain `===` on a shared secret leaks its length/prefix through response
 * timing. Used for the webhook/cron shared-secret checks (VAPI_SECRET,
 * GHL_WEBHOOK_SECRET, JOBTREAD_WEBHOOK_SECRET, CRON_SECRET) — lower value
 * than a signed request, so worth the same constant-time comparison Twilio's
 * HMAC check already gets.
 */
export function timingSafeEqualStr(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

// Shared by both entrypoints (server/index.ts for local dev, api/index.ts for
// the Vercel serverless bundle) so a security fix here can't drift between
// the two — they were previously two independent, hand-duplicated copies.

/**
 * In production, `cors`'s `origin` option silently falls back to `*` when
 * given `undefined` — so a missing APP_BASE_URL doesn't fail loudly, it just
 * quietly widens who can make credentialed cross-origin requests. Fail loud
 * instead: this is cheap insurance against exactly the kind of "env var typo'd
 * or never set" gap that caused a real 500 earlier in this app (GOOGLEMAPS_API_KEY
 * vs GOOGLE_MAPS_API_KEY).
 */
export function corsOptions(): CorsOptions {
  const isProd = process.env.NODE_ENV === 'production';
  if (isProd && !process.env.APP_BASE_URL) {
    throw new Error('APP_BASE_URL must be set in production — CORS cannot safely default to "*" for a cookie-authenticated app.');
  }
  return {
    origin: isProd ? process.env.APP_BASE_URL : ['http://localhost:5173', 'http://localhost:3000'],
    credentials: true,
  };
}

/**
 * A hardcoded fallback session secret checked into source control is a full
 * auth-bypass if the real one is ever unset in production — anyone can
 * compute a valid session signature for that known string. Fail startup
 * instead of silently signing sessions with a public secret.
 */
export function sessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('SESSION_SECRET must be set in production.');
    }
    return 'dev-secret-change-in-production';
  }
  return secret;
}

export function sessionCookieOptions(): CookieOptions {
  return {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
  };
}

export function sessionOptions() {
  return {
    store: createSessionStore(),
    secret: sessionSecret(),
    resave: false,
    saveUninitialized: false,
    cookie: sessionCookieOptions(),
  };
}

// 10mb so base64 job-site photos fit (the client downscales before upload; the
// photo route enforces its own per-file ceiling). Default would be 100kb —
// applies to both entrypoints so prod can't silently 413 on uploads dev allows.
export const JSON_BODY_LIMIT = '10mb';
