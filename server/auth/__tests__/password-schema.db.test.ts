/**
 * Password sign-in schema against the real database (scripts/test-db.sh):
 * password_links is company-isolated like every other company table, and
 * team_members carries the password and lockout columns with safe defaults.
 */
import { describe, it, expect, beforeAll } from 'vitest';

const url = process.env.DATABASE_URL || '';
const local = /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url);

describe.skipIf(!local)('password sign-in schema', async () => {
  const { makeTestCompany, asCompany } = await import('../../__tests__/helpers/tenant');
  const { db } = await import('../../db');
  const { passwordLinks, teamMembers } = await import('../../../shared/schema');
  let a = '';
  let b = '';

  beforeAll(async () => {
    a = await makeTestCompany('pw-a');
    b = await makeTestCompany('pw-b');
  });

  it('password_links is company-isolated', async () => {
    await asCompany(a, () => db.insert(passwordLinks).values({
      tokenHash: `hash-${Date.now()}-${Math.random()}`,
      email: 'someone@example.test',
      purpose: 'welcome',
      expiresAt: new Date(Date.now() + 60_000),
    }));
    expect(await asCompany(b, () => db.select().from(passwordLinks))).toHaveLength(0);
    expect(await asCompany(a, () => db.select().from(passwordLinks))).toHaveLength(1);
  });

  it('password_links only accepts the welcome and reset purposes', async () => {
    const err: any = await asCompany(a, () => db.insert(passwordLinks).values({
      tokenHash: `bad-${Date.now()}-${Math.random()}`,
      email: 'someone@example.test',
      purpose: 'other',
      expiresAt: new Date(Date.now() + 60_000),
    })).then(() => null, (e) => e);
    // Drizzle wraps the driver error; the constraint name is on the cause.
    expect(err?.cause?.constraint).toBe('password_links_purpose_check');
  });

  it('team_members has password columns', async () => {
    const [row] = await asCompany(a, () => db.insert(teamMembers).values({
      name: 'Pat Password',
      email: `pw-${Date.now()}@example.test`,
      role: 'sales',
    }).returning());
    expect(row.failedLogins).toBe(0);
    expect(row.passwordHash).toBeNull();
    expect(row.lockedUntil).toBeNull();
  });
});
