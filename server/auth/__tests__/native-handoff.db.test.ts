import { describe, it, expect, beforeAll, afterAll } from 'vitest';

// Redeeming a handoff token was a select then a delete, so two requests racing
// with the same token could both read the row before either removed it, and
// both walk away with a session. It is one DELETE ... RETURNING now; this runs
// that against real Postgres, where the race actually exists:
//   DATABASE_URL=postgres://postgres@localhost:5432/bra_e2e npx vitest run server/auth
const onE2eDb = (process.env.DATABASE_URL ?? '').includes('bra_e2e');
const email = `handoff-race-${Date.now()}@bestroofingnow.com`;

describe.skipIf(!onE2eDb)('redeemHandoff under concurrency (bra_e2e)', () => {
  let mintHandoff: typeof import('../native-handoff').mintHandoff;
  let redeemHandoff: typeof import('../native-handoff').redeemHandoff;

  beforeAll(async () => {
    ({ mintHandoff, redeemHandoff } = await import('../native-handoff'));
  });
  afterAll(async () => {
    const { db } = await import('../../db');
    const { settings } = await import('../../../shared/schema');
    const { eq, like } = await import('drizzle-orm');
    // Anything this file minted and did not spend.
    const rows = await db.select().from(settings).where(like(settings.key, 'native_auth:%'));
    for (const r of rows) {
      if ((r.value as { email?: string } | null)?.email === email) await db.delete(settings).where(eq(settings.key, r.key));
    }
  });

  it('gives a token to exactly one of many simultaneous redeemers', async () => {
    for (let round = 0; round < 5; round++) {
      const token = await mintHandoff(email);
      const results = await Promise.all(Array.from({ length: 8 }, () => redeemHandoff(token)));
      expect(results.filter((r) => r === email)).toHaveLength(1);
      expect(results.filter((r) => r === null)).toHaveLength(7);
    }
  });

  it('a spent token stays spent', async () => {
    const token = await mintHandoff(email);
    expect(await redeemHandoff(token)).toBe(email);
    expect(await redeemHandoff(token)).toBeNull();
  });
});
