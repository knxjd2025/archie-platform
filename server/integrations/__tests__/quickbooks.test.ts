import { describe, it, expect } from 'vitest';
import { tokenIssuedAt, accessTokenNeedsRefresh, qboDate, isUnauthorized } from '../quickbooks';

const NOW = Date.parse('2026-10-15T12:00:00Z');
const minutes = (n: number) => n * 60 * 1000;

describe('QuickBooks token expiry', () => {
  it('refreshes a token whose stored expiry has passed', () => {
    // Loading tokens without createdAt stamped them "issued now", so a token
    // that died an hour ago looked fresh and every call 401'd.
    expect(accessTokenNeedsRefresh(new Date(NOW - minutes(60)), NOW)).toBe(true);
  });

  it('refreshes inside the five-minute buffer, not after', () => {
    expect(accessTokenNeedsRefresh(new Date(NOW + minutes(4)), NOW)).toBe(true);
    expect(accessTokenNeedsRefresh(new Date(NOW + minutes(30)), NOW)).toBe(false);
  });

  it('treats a missing expiry as expired', () => {
    expect(accessTokenNeedsRefresh(null, NOW)).toBe(true);
    expect(accessTokenNeedsRefresh(undefined, NOW)).toBe(true);
  });

  it('recovers the issue time from the stored expiry', () => {
    const expiresAt = new Date(NOW + minutes(10));
    expect(tokenIssuedAt(expiresAt, 3600)).toBe(NOW + minutes(10) - minutes(60));
    expect(tokenIssuedAt(null, 3600)).toBe(0);
  });
});

describe('qboDate', () => {
  it('passes a plain date', () => {
    expect(qboDate('2026-10-01')).toBe('2026-10-01');
  });

  it.each([["2026-10-01' OR '1'='1"], ['10/01/2026'], ['2026-10-1'], ['']])('refuses %s', (v) => {
    // These were interpolated straight into `TxnDate >= '...'`.
    expect(() => qboDate(v)).toThrow(/YYYY-MM-DD/);
  });
});

describe('isUnauthorized', () => {
  it('recognises the client library 401 and an HTTP 401', () => {
    expect(isUnauthorized({ code: '401' })).toBe(true);
    expect(isUnauthorized({ response: { status: 401 } })).toBe(true);
    expect(isUnauthorized({ code: '400' })).toBe(false);
    expect(isUnauthorized(new Error('boom'))).toBe(false);
    expect(isUnauthorized(null)).toBe(false);
  });
});
