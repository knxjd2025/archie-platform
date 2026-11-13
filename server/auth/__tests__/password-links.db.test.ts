/**
 * Set-password links against the real database (scripts/test-db.sh).
 * Redeeming is one DELETE ... RETURNING, so racing redeemers get it once;
 * the grant names the company and purpose that minted it.
 */
import { describe, it, expect, beforeAll } from 'vitest';

const url = process.env.DATABASE_URL || '';
const local = /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url);

describe.skipIf(!local)('password links', async () => {
  const { mintPasswordLink, redeemPasswordLink, passwordLinkUrl, PASSWORD_LINK_TTL_MS } = await import('../password-links');
  const { makeTestCompany, asCompany } = await import('../../__tests__/helpers/tenant');
  const { db } = await import('../../db');
  const { passwordLinks } = await import('../../../shared/schema');
  const email = `pwlink-${Date.now()}@example.test`;
  let company = '';

  beforeAll(async () => { company = await makeTestCompany('pwlink'); });

  it('one of eight simultaneous redeemers wins', async () => {
    for (let round = 0; round < 5; round++) {
      const token = await asCompany(company, () => mintPasswordLink(email, 'welcome'));
      const results = await Promise.all(Array.from({ length: 8 }, () => redeemPasswordLink(token)));
      expect(results.filter((r) => r?.email === email)).toHaveLength(1);
      expect(results.filter((r) => r === null)).toHaveLength(7);
    }
  });

  it('a spent link stays spent', async () => {
    const token = await asCompany(company, () => mintPasswordLink(email, 'reset'));
    expect(await redeemPasswordLink(token)).not.toBeNull();
    expect(await redeemPasswordLink(token)).toBeNull();
  });

  it('an expired link returns null', async () => {
    const token = await asCompany(company, () => mintPasswordLink(email, 'reset'));
    await asCompany(company, () => db.update(passwordLinks).set({ expiresAt: new Date(Date.now() - 1000) }));
    expect(await redeemPasswordLink(token)).toBeNull();
  });

  it('the grant names the minting company and purpose, with the email lowercased', async () => {
    const token = await asCompany(company, () => mintPasswordLink(email.toUpperCase(), 'welcome'));
    expect(await redeemPasswordLink(token)).toEqual({ email, companyId: company, purpose: 'welcome' });
  });

  it('junk tokens return null', async () => {
    for (const junk of ['', 'x', 'a'.repeat(500)]) expect(await redeemPasswordLink(junk)).toBeNull();
  });

  it('cannot be minted outside a company', async () => {
    await expect(mintPasswordLink(email, 'reset')).rejects.toThrow();
  });

  it('puts the token in the fragment, never the query, and expires in an hour', () => {
    expect(PASSWORD_LINK_TTL_MS).toBe(3_600_000);
    const prev = process.env.APP_BASE_URL;
    process.env.APP_BASE_URL = 'https://app.example.test/';
    try {
      expect(passwordLinkUrl('a b')).toBe('https://app.example.test/set-password#t=a%20b');
    } finally {
      if (prev === undefined) delete process.env.APP_BASE_URL; else process.env.APP_BASE_URL = prev;
    }
  });
});
