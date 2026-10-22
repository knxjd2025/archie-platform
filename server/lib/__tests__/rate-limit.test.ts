import { describe, it, expect, vi } from 'vitest';
import type { Request, Response } from 'express';
import { __resetRateLimits, rateLimit, rateLimitKeyCount } from '../rate-limit';

const res = () => {
  const r: any = { statusCode: 0, body: null, sent: null, headers: {} as Record<string, string> };
  r.status = vi.fn((c: number) => { r.statusCode = c; return r; });
  r.json = vi.fn((b: unknown) => { r.body = b; return r; });
  r.set = vi.fn(() => r);
  r.send = vi.fn((b: unknown) => { r.sent = b; return r; });
  // A real Express response has this, and the limiter sets Retry-After on a
  // refusal. A fake that leaves it out fails the code for being correct.
  r.setHeader = vi.fn((k: string, v: string) => { r.headers[k] = v; return r; });
  return r as Response & { statusCode: number; body: any; sent: any; headers: Record<string, string> };
};

const req = (over: Partial<Request> = {}) => ({ ip: '10.0.0.1', params: {}, ...over }) as Request;

/** A distinct IP per test, so the module-level buckets don't leak between them. */
let n = 0;
const freshIp = () => `10.9.0.${++n}`;

describe('rateLimit', () => {
  it('gives each limiter its own allowance for the same person', () => {
    const ip = freshIp();
    const assist = rateLimit(1, 60_000);
    const sms = rateLimit(1, 60_000);
    const next = vi.fn();
    assist(req({ ip }), res(), next);
    const refused = res();
    assist(req({ ip }), refused, next);
    expect(refused.statusCode).toBe(429);
    // Spending the assist allowance must not cost the same rep their SMS.
    sms(req({ ip }), res(), next);
    expect(next).toHaveBeenCalledTimes(2);
  });

  it('lets the allowance through and stops the next one', () => {
    const ip = freshIp();
    const limit = rateLimit(3, 60_000);
    const next = vi.fn();
    for (let i = 0; i < 3; i++) limit(req({ ip }), res(), next);
    expect(next).toHaveBeenCalledTimes(3);

    const blocked = res();
    limit(req({ ip }), blocked, next);
    expect(next).toHaveBeenCalledTimes(3);
    expect(blocked.statusCode).toBe(429);
    // The wording is pinned by its own test below; here all that matters is
    // that the refusal is a refusal and carries something a person can read.
    expect(blocked.body.error).toEqual(expect.any(String));
    expect(blocked.body.error.length).toBeGreaterThan(10);
  });

  it('answers a public page with a page, not a JSON error', () => {
    const ip = freshIp();
    const limit = rateLimit(1, 60_000, (_r, out) => { out.set('Content-Type', 'text/html'); out.send('<h1>Give it a moment</h1>'); });
    const next = vi.fn();
    limit(req({ ip }), res(), next);

    const blocked = res();
    limit(req({ ip }), blocked, next);
    expect(blocked.statusCode).toBe(429);
    expect(blocked.sent).toContain('Give it a moment');
    expect(blocked.body).toBeNull();      // never the JSON shape for a customer
  });

  /**
   * The one that matters for signing: two people on one home connection sign
   * two different documents. Keyed by IP they would share a budget and the
   * second person would be turned away from signing their own document.
   */
  it('can be keyed by something other than the connection', () => {
    const limit = rateLimit(2, 60_000, undefined, (r) => `sign:${r.params.token}`);
    const next = vi.fn();
    const ip = freshIp();

    for (let i = 0; i < 2; i++) limit(req({ ip, params: { token: 'aaa' } as any }), res(), next);
    const hammered = res();
    limit(req({ ip, params: { token: 'aaa' } as any }), hammered, next);
    expect(hammered.statusCode).toBe(429);

    // Same connection, different document: unaffected.
    const neighbour = res();
    limit(req({ ip, params: { token: 'bbb' } as any }), neighbour, next);
    expect(neighbour.statusCode).toBe(0);
    expect(next).toHaveBeenCalledTimes(3);
  });

  /**
   * The signing limiter keys by link, so every document ever sent leaves a
   * bucket. Without a sweep the map grows for the life of the process.
   */
  it('does not grow a bucket for every key it has ever seen', () => {
    __resetRateLimits();
    // The clock is frozen from the start: on a busy machine the 5200 calls
    // below took longer than the 1s window, so buckets expired mid-loop, the
    // count stayed under the sweep threshold, and the test failed at random.
    vi.useFakeTimers();
    try {
      const limit = rateLimit(5, 1000);
      const next = vi.fn();
      // More keys than the sweep threshold, each used once and never again.
      for (let i = 0; i < 5200; i++) limit(req({ ip: `10.1.${Math.floor(i / 256)}.${i % 256}` }), res(), next);
      const before = rateLimitKeyCount();
      expect(before).toBeGreaterThan(0);

      vi.advanceTimersByTime(2000);            // every bucket above is now expired
      for (let i = 0; i < 40; i++) limit(req({ ip: `10.9.9.${i}` }), res(), next);
      expect(rateLimitKeyCount()).toBeLessThan(before);
      expect(rateLimitKeyCount()).toBeLessThan(200);
    } finally {
      vi.useRealTimers();
      __resetRateLimits();
    }
  });

  it('does not hand back an allowance early when limiters share the map', () => {
    __resetRateLimits();
    vi.useFakeTimers();
    try {
      const slow = rateLimit(1, 60 * 60 * 1000);   // one an hour
      const fast = rateLimit(1, 1000);             // one a second
      const next = vi.fn();
      slow(req({ ip: '10.5.5.1' }), res(), next);

      // Enough fast traffic to trigger a sweep on the fast limiter's clock.
      for (let i = 0; i < 5200; i++) fast(req({ ip: `10.6.${Math.floor(i / 256)}.${i % 256}` }), res(), next);

      // The hourly bucket must survive: its window has not passed.
      const blocked = res();
      slow(req({ ip: '10.5.5.1' }), blocked, next);
      expect(blocked.statusCode).toBe(429);
    } finally {
      vi.useRealTimers();
      __resetRateLimits();
    }
  });

  it('forgets a hit once its window has passed', () => {
    vi.useFakeTimers();
    try {
      const ip = freshIp();
      const limit = rateLimit(1, 1000);
      const next = vi.fn();
      limit(req({ ip }), res(), next);
      const blocked = res();
      limit(req({ ip }), blocked, next);
      expect(blocked.statusCode).toBe(429);

      vi.advanceTimersByTime(1500);
      const later = res();
      limit(req({ ip }), later, next);
      expect(later.statusCode).toBe(0);
      expect(next).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('what a refusal tells you', () => {
  it('says how long to wait, and sets Retry-After to match', () => {
    const ip = freshIp();
    const limit = rateLimit(1, 60_000);
    limit(req({ ip }), res(), vi.fn());

    const blocked = res();
    limit(req({ ip }), blocked, vi.fn());

    expect(blocked.statusCode).toBe(429);
    expect(blocked.body.retryAfterSeconds).toBeGreaterThan(0);
    expect(blocked.body.retryAfterSeconds).toBeLessThanOrEqual(60);
    expect(blocked.headers['Retry-After']).toBe(String(blocked.body.retryAfterSeconds));
    // The old copy was "try again shortly", which makes people retry now.
    expect(blocked.body.error).toMatch(/try again in about/);
    expect(blocked.body.error).not.toMatch(/shortly/);
  });

  it('counts in minutes once seconds stop being useful', () => {
    const ip = freshIp();
    const limit = rateLimit(1, 10 * 60_000);
    limit(req({ ip }), res(), vi.fn());
    const blocked = res();
    limit(req({ ip }), blocked, vi.fn());
    expect(blocked.body.error).toMatch(/about 10 minutes/);
  });

  it('never tells anyone to wait zero seconds', () => {
    const ip = freshIp();
    const limit = rateLimit(1, 1);          // a window already expired
    limit(req({ ip }), res(), vi.fn());
    const blocked = res();
    limit(req({ ip }), blocked, vi.fn());
    // Either it let the request through (the window passed) or it refused with
    // a real number — what it must never do is say "try again in 0 seconds".
    if (blocked.statusCode === 429) expect(blocked.body.retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });
});
