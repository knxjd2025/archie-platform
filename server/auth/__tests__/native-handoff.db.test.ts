/**
 * Native sign-in tokens against the real database (scripts/test-db.sh).
 * Redeeming is one DELETE ... RETURNING, so racing redeemers get it once;
 * the grant names the company that minted it.
 */
import { describe, it, expect, beforeAll } from 'vitest';

const url = process.env.DATABASE_URL || '';
const local = /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url);

describe.skipIf(!local)('native sign-in tokens', async () => {
  const { mintHandoff, redeemHandoff, sweepExpiredHandoffs, handoffUrl, NATIVE_SCHEME } = await import('../native-handoff');
  const { makeTestCompany, asCompany } = await import('../../__tests__/helpers/tenant');
  const { db } = await import('../../db');
  const { nativeHandoffs } = await import('../../../shared/schema');
  const email = `handoff-${Date.now()}@example.test`;
  let company = '';

  beforeAll(async () => { company = await makeTestCompany('handoff'); });

  it('gives a token to exactly one of many simultaneous redeemers', async () => {
    for (let round = 0; round < 5; round++) {
      const token = await asCompany(company, () => mintHandoff(email));
      const results = await Promise.all(Array.from({ length: 8 }, () => redeemHandoff(token)));
      expect(results.filter((r) => r?.email === email && r.companyId === company)).toHaveLength(1);
      expect(results.filter((r) => r === null)).toHaveLength(7);
    }
  });

  it('a spent token stays spent, and junk is refused', async () => {
    const token = await asCompany(company, () => mintHandoff(email.toUpperCase()));
    expect(await redeemHandoff(token)).toEqual({ email, companyId: company });
    expect(await redeemHandoff(token)).toBeNull();
    for (const junk of ['', 'short', 'a'.repeat(43)]) expect(await redeemHandoff(junk)).toBeNull();
  });

  it('an expired token is refused and swept', async () => {
    const token = await asCompany(company, () => mintHandoff(email));
    await asCompany(company, () => db.update(nativeHandoffs).set({ expiresAt: new Date(Date.now() - 1000) }));
    const swept = await asCompany(company, () => sweepExpiredHandoffs());
    expect(swept).toBeGreaterThanOrEqual(1);
    expect(await redeemHandoff(token)).toBeNull();
  });

  it('cannot be minted outside a company', async () => {
    await expect(mintHandoff(email)).rejects.toThrow();
  });

  it('builds the deep link on the app scheme', () => {
    expect(handoffUrl('t k')).toBe(`${NATIVE_SCHEME}://auth?t=t%20k`);
  });
});
