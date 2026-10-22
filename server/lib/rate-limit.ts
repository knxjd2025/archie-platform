/**
 * A minimal per-user sliding-window limiter for the handful of routes that
 * cost real money or quota per call (SMS, outbound calls, AI vision/LLM
 * report generation). No new dependency — process-local and best-effort,
 * same tradeoff already accepted elsewhere in this app (e.g. the Twilio
 * MessageSid dedupe set) since this runs on a small team, not at a scale
 * where a distributed limiter would earn its complexity.
 */
import type { Request, Response, NextFunction } from 'express';

interface Bucket { hits: number[]; windowMs: number }

const buckets = new Map<string, Bucket>();
let limiterSeq = 0;

function keyFor(req: Request): string {
  return req.session?.user?.email || req.ip || 'anon';
}

/**
 * Keys used to be a signed-in email or an IP — a set that grows with the team.
 * Then the signing limiter started keying by LINK, so every document ever sent
 * out leaves a bucket behind that nothing ever removes. On Vercel the process
 * is recycled often enough to hide it; a long-running server would not be so
 * lucky.
 *
 * Buckets carry their own window because one Map is shared by limiters with
 * different ones — sweeping a 1-hour bucket on a 10-minute limiter's clock
 * would hand somebody their allowance back early.
 */
const MAX_KEYS = 5000;

function sweepExpired(now: number): void {
  for (const [key, bucket] of buckets) {
    const newest = bucket.hits[bucket.hits.length - 1];
    if (newest === undefined || now - newest >= bucket.windowMs) buckets.delete(key);
  }
}

/** Test seam: the module-level Map would otherwise leak state between tests. */
export function __resetRateLimits(): void {
  buckets.clear();
}

/** How many keys are being tracked — for the leak test, and for a health check. */
export const rateLimitKeyCount = (): number => buckets.size;

/**
 * `max` requests per `windowMs`, keyed by signed-in user (falls back to IP).
 *
 * `respond` replaces the JSON refusal, for the public pages: a customer who
 * has been rate-limited is looking at a browser window, and `{"error":...}` is
 * not an answer to give them.
 */
export function rateLimit(
  max: number,
  windowMs: number,
  respond?: (req: Request, res: Response) => void,
  keyBy?: (req: Request) => string,
) {
  // Every limiter used to count into one bucket per person, so a rep who hit
  // the assist limit was also refused SMS, and the bug-report button shared
  // its allowance with everything else. Each limiter now has its own; routes
  // that pass the same limiter object still share it, which is intended.
  const scope = ++limiterSeq;
  return (req: Request, res: Response, next: NextFunction) => {
    const key = `${scope}:${keyBy ? keyBy(req) : keyFor(req)}`;
    const now = Date.now();
    const hits = (buckets.get(key)?.hits || []).filter((t) => now - t < windowMs);
    if (hits.length >= max) {
      // "Try again shortly" makes people retry straight away, which is the one
      // thing this is here to stop. The oldest hit in the window is the one
      // about to expire, so it is exactly when the next request will be let
      // through — say that, and set Retry-After for anything automated.
      // `hits[0]` is undefined if max is 0, and NaN propagates all the way to
      // "try again in about NaN seconds". Nothing passes 0 today; a shared
      // helper should not depend on that staying true.
      const oldest = hits.length ? hits[0] : now;
      const freeInSeconds = Math.max(Math.ceil((oldest + windowMs - now) / 1000), 1);
      const wait = freeInSeconds > 90 ? `${Math.ceil(freeInSeconds / 60)} minutes` : `${freeInSeconds} seconds`;
      res.setHeader('Retry-After', String(freeInSeconds));
      res.status(429);
      if (respond) return respond(req, res);
      return res.json({
        error: `That is as fast as this can go — try again in about ${wait}.`,
        retryAfterSeconds: freeInSeconds,
      });
    }
    hits.push(now);
    buckets.set(key, { hits, windowMs });
    // Only on the way in, which is the only path that adds keys.
    if (buckets.size > MAX_KEYS) sweepExpired(now);
    next();
  };
}
