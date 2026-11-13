/**
 * Set-password links against the real database (scripts/test-db.sh).
 * Redeeming is one DELETE ... RETURNING, so racing redeemers get it once;
 * the grant names the company and purpose that minted it.
 */
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';

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

  describe('one link per person, and a brake on reset mail', async () => {
    const { mintResetLinkUnlessRecent, deletePasswordLinksFor, RESET_LINK_GAP_MS } = await import('../password-links');
    const { eq } = await import('drizzle-orm');
    const rowsFor = (who: string, co = company) => asCompany(co, () => db.select().from(passwordLinks).where(eq(passwordLinks.email, who)));
    const { and } = await import('drizzle-orm');
    // Pretend the links for `who` were minted `ago` ms ago (each by its own purpose's lifetime).
    const age = async (who: string, ago: number) => {
      for (const purpose of ['welcome', 'reset'] as const) {
        await asCompany(company, () => db.update(passwordLinks)
          .set({ expiresAt: new Date(Date.now() + PASSWORD_LINK_TTL_MS[purpose] - ago) })
          .where(and(eq(passwordLinks.email, who), eq(passwordLinks.purpose, purpose))));
      }
    };

    it('a later link leaves an earlier unexpired one working', async () => {
      // Otherwise a stranger asking for resets could keep cancelling a member's link.
      const who = `keep-${Date.now()}@example.test`;
      const welcome = await asCompany(company, () => mintPasswordLink(who, 'welcome'));
      await age(who, RESET_LINK_GAP_MS + 5_000);
      const reset = await asCompany(company, () => mintResetLinkUnlessRecent(who));
      expect(reset).toBeTruthy();
      expect(await rowsFor(who)).toHaveLength(2);
      expect(await redeemPasswordLink(welcome)).toMatchObject({ email: who, purpose: 'welcome' });
      expect(await redeemPasswordLink(reset!)).toMatchObject({ email: who, purpose: 'reset' });
    });

    it('minting sweeps this company\'s expired links, and only this company\'s', async () => {
      const other = await makeTestCompany('pwlink-other');
      const stale = `stale-${Date.now()}@example.test`;
      await asCompany(company, () => mintPasswordLink(stale, 'reset'));
      await asCompany(other, () => mintPasswordLink(stale, 'reset'));
      for (const co of [company, other]) {
        await asCompany(co, () => db.update(passwordLinks).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(passwordLinks.email, stale)));
      }
      await asCompany(company, () => mintPasswordLink(`fresh-${Date.now()}@example.test`, 'reset'));
      expect(await rowsFor(stale)).toHaveLength(0);
      expect(await rowsFor(stale, other)).toHaveLength(1);
    });

    it('a reset is skipped within 2 minutes of the last link, and allowed after', async () => {
      expect(RESET_LINK_GAP_MS).toBe(120_000);
      const who = `brake-${Date.now()}@example.test`;
      expect(await asCompany(company, () => mintResetLinkUnlessRecent(who))).toBeTruthy();
      expect(await asCompany(company, () => mintResetLinkUnlessRecent(who))).toBeNull();
      await age(who, RESET_LINK_GAP_MS - 5_000);
      expect(await asCompany(company, () => mintResetLinkUnlessRecent(who))).toBeNull();
      await age(who, RESET_LINK_GAP_MS + 5_000);
      const again = await asCompany(company, () => mintResetLinkUnlessRecent(who));
      expect(again).toBeTruthy();
      expect(await rowsFor(who)).toHaveLength(2);
    });

    it('a welcome link minted a few minutes ago does not hold back a reset; one minted just now does', async () => {
      // With one shared lifetime, a 72-hour welcome link looked minted in the
      // future and would have blocked reset mail for days.
      const who = `welcome-brake-${Date.now()}@example.test`;
      await asCompany(company, () => mintPasswordLink(who, 'welcome'));
      expect(await asCompany(company, () => mintResetLinkUnlessRecent(who))).toBeNull();
      await age(who, RESET_LINK_GAP_MS + 5_000);
      expect(await asCompany(company, () => mintResetLinkUnlessRecent(who))).toBeTruthy();
    });

    it('simultaneous resets for one email mint one link', async () => {
      const who = `race-${Date.now()}@example.test`;
      const tokens = await Promise.all(Array.from({ length: 8 }, () => asCompany(company, () => mintResetLinkUnlessRecent(who))));
      expect(tokens.filter(Boolean)).toHaveLength(1);
      expect(await rowsFor(who)).toHaveLength(1);
    });

    it('deletePasswordLinksFor cancels every outstanding link for that email', async () => {
      const who = `cancel-${Date.now()}@example.test`;
      const token = await asCompany(company, () => mintPasswordLink(who, 'welcome'));
      await asCompany(company, () => deletePasswordLinksFor(who.toUpperCase()));
      expect(await redeemPasswordLink(token)).toBeNull();
    });
  });

  describe('lifetimes', () => {
    afterEach(() => { vi.useRealTimers(); });
    const HOUR = 3_600_000;
    const later = (ms: number) => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(Date.now() + ms); };

    it('a welcome link still works after 2 hours', async () => {
      const token = await asCompany(company, () => mintPasswordLink(`life-w2-${Date.now()}@example.test`, 'welcome'));
      later(2 * HOUR);
      expect(await redeemPasswordLink(token)).toMatchObject({ purpose: 'welcome' });
    });

    it('a welcome link does not work after 73 hours', async () => {
      const token = await asCompany(company, () => mintPasswordLink(`life-w73-${Date.now()}@example.test`, 'welcome'));
      later(73 * HOUR);
      expect(await redeemPasswordLink(token)).toBeNull();
    });

    it('a reset link does not work after 61 minutes', async () => {
      const token = await asCompany(company, () => mintPasswordLink(`life-r61-${Date.now()}@example.test`, 'reset'));
      later(61 * 60_000);
      expect(await redeemPasswordLink(token)).toBeNull();
    });
  });

  it('puts the token in the fragment, never the query; welcome links last 72 hours, resets 1 hour', () => {
    expect(PASSWORD_LINK_TTL_MS).toEqual({ welcome: 72 * 3_600_000, reset: 3_600_000 });
    const prev = process.env.APP_BASE_URL;
    process.env.APP_BASE_URL = 'https://app.example.test/';
    try {
      expect(passwordLinkUrl('a b')).toBe('https://app.example.test/set-password#t=a%20b');
    } finally {
      if (prev === undefined) delete process.env.APP_BASE_URL; else process.env.APP_BASE_URL = prev;
    }
  });
});
