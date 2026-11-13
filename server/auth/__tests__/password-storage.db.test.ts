/**
 * The password storage helpers against the real database (scripts/test-db.sh):
 * the lockout counter is one SQL statement, so it is checked for real.
 */
import { describe, it, expect, beforeAll } from 'vitest';

const url = process.env.DATABASE_URL || '';
const local = /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url);

describe.skipIf(!local)('password storage helpers', async () => {
  const team = await import('../../storage/team');
  const { makeTestCompany, asCompany } = await import('../../__tests__/helpers/tenant');
  const email = `pwstore-${Date.now()}@example.test`;
  let company = '';
  const row = () => asCompany(company, () => team.getTeamMemberByEmail(email));

  beforeAll(async () => {
    company = await makeTestCompany('pwstore');
    await asCompany(company, () => team.createTeamMember({ name: 'P W', email, role: 'sales', canLogin: true } as never, 'test'));
  });

  it('the fifth failure locks for 15 minutes and restarts the count; setting a password clears both', async () => {
    for (let i = 1; i <= 4; i++) {
      await asCompany(company, () => team.recordFailedLogin(email.toUpperCase()));
      expect((await row())!.failedLogins).toBe(i);
      expect((await row())!.lockedUntil).toBeNull();
    }
    await asCompany(company, () => team.recordFailedLogin(email));
    const locked = (await row())!;
    expect(locked.failedLogins).toBe(0);
    const ms = locked.lockedUntil!.getTime() - Date.now();
    expect(ms).toBeGreaterThan(14 * 60_000);
    expect(ms).toBeLessThanOrEqual(15 * 60_000);

    await asCompany(company, () => team.recordFailedLogin(email));
    await asCompany(company, () => team.setPasswordHash(email, 'h'));
    const cleared = (await row())!;
    expect(cleared).toMatchObject({ passwordHash: 'h', failedLogins: 0, lockedUntil: null });
  });

  it('clearFailedLogins zeroes the count; an unknown email is a no-op', async () => {
    await asCompany(company, () => team.recordFailedLogin(email));
    await asCompany(company, () => team.clearFailedLogins(email));
    expect((await row())!.failedLogins).toBe(0);
    await asCompany(company, () => team.recordFailedLogin('nobody@example.test'));
  });

  it('touchLogin leaves googleSub alone unless given one', async () => {
    await asCompany(company, () => team.touchLogin(email, 'sub-1'));
    await asCompany(company, () => team.touchLogin(email));
    const r = (await row())!;
    expect(r.googleSub).toBe('sub-1');
    expect(r.lastLoginAt).not.toBeNull();
  });
});
