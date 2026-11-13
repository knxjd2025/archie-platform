/**
 * The Team routes never send a password hash or the lockout counters to the
 * browser. Real storage against the real database (scripts/test-db.sh), so it
 * is the rows the app actually reads that are checked, not a fake.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

const url = process.env.DATABASE_URL || '';
const local = /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url);

const ADMIN = 'admin@example.test';
vi.mock('../middleware', () => ({
  requireRole: () => (req: any, _res: any, next: any) => { req.session = { user: { email: ADMIN, role: 'admin' } }; next(); },
  clearSessionRevalidationCache: vi.fn(),
}));
vi.mock('../../calendar/access', () => ({ calendarSeeAllEmails: async () => [], setCalendarSeeAll: vi.fn() }));
vi.mock('../../sync/jobtread-reps', () => ({ syncSalesRepsFromJobTread: vi.fn() }));
vi.mock('../../sync/jobtread-roles', () => ({ pushRoleToJobTread: vi.fn(async () => ({ ok: true })) }));
vi.mock('../password-mail', () => ({ passwordMailConfigured: () => false, sendPasswordLinkEmail: vi.fn() }));

const SECRET = ['passwordHash', 'failedLogins', 'lockedUntil', 'password_hash', 'failed_logins', 'locked_until'];

describe.skipIf(!local)('Team routes and password fields', async () => {
  const { registerTeamRoutes } = await import('../team-routes');
  const team = await import('../../storage/team');
  const { makeTestCompany, asCompany } = await import('../../__tests__/helpers/tenant');
  const { runAsCompany } = await import('../../tenant/context');
  const stamp = Date.now();
  const withHash = `haspw-${stamp}@example.test`;
  let company = '';
  let server: Server;
  let base = '';

  beforeAll(async () => {
    company = await makeTestCompany('team-public');
    await asCompany(company, async () => {
      await team.createTeamMember({ name: 'Has Password', email: withHash, role: 'sales', canLogin: true } as never, 'test');
      await team.setPasswordHash(withHash, 'scrypt$secret-hash');
      await team.recordFailedLogin(withHash);
    });
    const app = express();
    app.use(express.json());
    app.use((_req, _res, next) => { runAsCompany(company, next); });
    registerTeamRoutes(app);
    server = app.listen(0);
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  const noSecrets = (text: string) => {
    for (const key of SECRET) expect(text).not.toContain(`"${key}"`);
    expect(text).not.toContain('secret-hash');
  };

  it('GET /api/team leaves the fields out and says who has a password', async () => {
    const res = await fetch(`${base}/api/team`);
    expect(res.status).toBe(200);
    const text = await res.text();
    noSecrets(text);
    const row = JSON.parse(text).find((m: any) => m.email === withHash);
    expect(row.hasPassword).toBe(true);
  });

  it('POST /api/team leaves the fields out', async () => {
    const res = await fetch(`${base}/api/team`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'New Person', email: `new-${stamp}@example.test`, role: 'sales', canLogin: false }),
    });
    expect(res.status).toBe(201);
    const text = await res.text();
    noSecrets(text);
    expect(JSON.parse(text).hasPassword).toBe(false);
  });

  it('PATCH /api/team/:id leaves the fields out', async () => {
    const id = (await asCompany(company, () => team.listTeamMembers())).find((m) => m.email === withHash)!.id;
    const res = await fetch(`${base}/api/team/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Has Password Too' }),
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    noSecrets(text);
    expect(JSON.parse(text).hasPassword).toBe(true);
  });

  it('the storage reads used by routes carry no password fields', async () => {
    const rows = await asCompany(company, async () => [
      ...(await team.listTeamMembers()),
      await team.getTeamMemberByEmail(withHash),
    ]);
    for (const r of rows) noSecrets(JSON.stringify(r));
  });
});
