import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * The guard itself is a closure inside registerRoutes, so this tests the rule
 * it encodes rather than the function object: with no secret set the request
 * is accepted and announced; with WEBHOOKS_REQUIRE_SECRET on it is refused;
 * with a secret set only the matching header gets through.
 */
import { timingSafeEqualStr } from '../security-config';

function guard(env: Record<string, string | undefined>, header: string | undefined, envVar: string) {
  const requireSecret = /^(1|true|yes)$/i.test(env.WEBHOOKS_REQUIRE_SECRET || '');
  const expected = env[envVar];
  if (!expected) return requireSecret ? { ok: false, status: 503 } : { ok: true, unverified: true };
  if (!header || !timingSafeEqualStr(header, expected)) return { ok: false, status: 403 };
  return { ok: true, unverified: false };
}

describe('webhook secret guard', () => {
  it('accepts anything when the secret is unset — which is production today', () => {
    expect(guard({}, undefined, 'GHL_WEBHOOK_SECRET')).toEqual({ ok: true, unverified: true });
    expect(guard({}, 'wrong', 'GHL_WEBHOOK_SECRET')).toEqual({ ok: true, unverified: true });
  });

  it('refuses rather than accepts once WEBHOOKS_REQUIRE_SECRET is on', () => {
    const r = guard({ WEBHOOKS_REQUIRE_SECRET: 'true' }, 'wrong', 'GHL_WEBHOOK_SECRET');
    expect(r).toEqual({ ok: false, status: 503 });
  });

  it('with a secret set, only the matching header gets in', () => {
    const env = { GHL_WEBHOOK_SECRET: 'sh-hunter2' };
    expect(guard(env, 'sh-hunter2', 'GHL_WEBHOOK_SECRET')).toEqual({ ok: true, unverified: false });
    expect(guard(env, 'sh-hunter3', 'GHL_WEBHOOK_SECRET')).toEqual({ ok: false, status: 403 });
    expect(guard(env, undefined, 'GHL_WEBHOOK_SECRET')).toEqual({ ok: false, status: 403 });
    // A prefix must not pass: length is checked before the comparison.
    expect(guard(env, 'sh-hunter', 'GHL_WEBHOOK_SECRET')).toEqual({ ok: false, status: 403 });
  });
});
