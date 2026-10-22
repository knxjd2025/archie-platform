import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The handoff token is the one thing that crosses from the system browser back
 * into the app, over a custom URL scheme another app could in principle claim.
 * These pin the properties that make that acceptable: short-lived, single-use,
 * and never stored in a form that can be redeemed.
 */
const rows = new Map<string, any>();

vi.mock('../../db', () => ({
  db: {
    insert: () => ({
      values: (v: any) => ({
        onConflictDoUpdate: async () => { rows.set(v.key, v.value); },
      }),
    }),
    select: () => ({
      from: () => ({
        where: async (pred: any) => {
          const key = pred?.__key;
          if (key) return rows.has(key) ? [{ key, value: rows.get(key) }] : [];
          // like(): every handoff row
          return [...rows.entries()].map(([k, value]) => ({ key: k, value }));
        },
      }),
    }),
    // delete().where() is awaited by the sweep and .returning()'d by redeem,
    // which is the atomic take: the row comes back only to the caller that removed it.
    delete: () => ({
      where: (pred: any) => {
        const take = () => {
          if (!pred?.__key || !rows.has(pred.__key)) return [];
          const value = rows.get(pred.__key);
          rows.delete(pred.__key);
          return [{ key: pred.__key, value }];
        };
        return { returning: async () => take(), then: (ok: any, bad: any) => Promise.resolve(take()).then(ok, bad) };
      },
    }),
  },
}));

vi.mock('drizzle-orm', async (orig) => ({
  ...(await orig<any>()),
  eq: (_col: unknown, val: string) => ({ __key: val }),
  like: () => ({}),
}));

const { mintHandoff, redeemHandoff, sweepExpiredHandoffs, handoffUrl, NATIVE_SCHEME } =
  await import('../native-handoff');

beforeEach(() => { rows.clear(); });

describe('the native sign-in handoff', () => {
  it('hands back the email it was minted for', async () => {
    const token = await mintHandoff('Thomas@BestRoofingNow.com');
    expect(await redeemHandoff(token)).toBe('thomas@bestroofingnow.com');
  });

  it('can only be spent once', async () => {
    const token = await mintHandoff('thomas@bestroofingnow.com');
    expect(await redeemHandoff(token)).toBe('thomas@bestroofingnow.com');
    expect(await redeemHandoff(token)).toBeNull();
  });

  it('never stores anything redeemable', async () => {
    const token = await mintHandoff('thomas@bestroofingnow.com');
    const stored = [...rows.keys()].join(' ') + JSON.stringify([...rows.values()]);
    expect(stored).not.toContain(token);
    expect([...rows.keys()][0]).toMatch(/^native_auth:[a-f0-9]{64}$/);
  });

  it('expires', async () => {
    vi.useFakeTimers();
    try {
      const token = await mintHandoff('thomas@bestroofingnow.com');
      vi.advanceTimersByTime(2 * 60 * 1000 + 1);
      expect(await redeemHandoff(token)).toBeNull();
    } finally { vi.useRealTimers(); }
  });

  it('refuses a token that was never minted, and says nothing about why', async () => {
    expect(await redeemHandoff('a'.repeat(43))).toBeNull();
    expect(await redeemHandoff('')).toBeNull();
    expect(await redeemHandoff('short')).toBeNull();
    expect(await redeemHandoff('x'.repeat(500))).toBeNull();
    expect(await redeemHandoff(undefined as any)).toBeNull();
  });

  it('spends a token even when it turns out to be expired', async () => {
    vi.useFakeTimers();
    try {
      const token = await mintHandoff('thomas@bestroofingnow.com');
      vi.advanceTimersByTime(2 * 60 * 1000 + 1);
      await redeemHandoff(token);
      expect(rows.size).toBe(0);            // not left behind for a second attempt
    } finally { vi.useRealTimers(); }
  });

  it('sweeps what nobody came back for, and keeps what is still live', async () => {
    vi.useFakeTimers();
    try {
      await mintHandoff('old@bestroofingnow.com');
      vi.advanceTimersByTime(3 * 60 * 1000);
      const fresh = await mintHandoff('new@bestroofingnow.com');
      expect(await sweepExpiredHandoffs()).toBe(1);
      expect(await redeemHandoff(fresh)).toBe('new@bestroofingnow.com');
    } finally { vi.useRealTimers(); }
  });

  it('builds a deep link the app can parse', async () => {
    const token = await mintHandoff('thomas@bestroofingnow.com');
    const url = handoffUrl(token);
    expect(url.startsWith(`${NATIVE_SCHEME}://auth?t=`)).toBe(true);
    expect(new URL(url).searchParams.get('t')).toBe(token);
  });

  it('escapes a token that would otherwise break the URL', () => {
    expect(handoffUrl('a+b/c=d')).toContain('a%2Bb%2Fc%3Dd');
  });
});
