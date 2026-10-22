/**
 * Company isolation through the real request path: session, company
 * middleware, roster re-check, route, database. Two companies' admins ask the
 * same API for the team list and each gets only their own people; an admin
 * cannot add someone to another company; a session for a paused company is
 * ended.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

const url = process.env.DATABASE_URL || '';
const local = /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url);

describe.skipIf(!local)('company isolation through the API', async () => {
  const { db } = await import('../../db');
  const schema = await import('../../../shared/schema');
  const { eq } = await import('drizzle-orm');
  const { runAsCompany, runAsSystem } = await import('../context');
  const { createCompany } = await import('../companies');
  const { tenantFromSession } = await import('../middleware');
  const { registerTeamRoutes } = await import('../../auth/team-routes');
  const { registerAuthRoutes } = await import('../../auth/routes');
  const { clearSessionRevalidationCache } = await import('../../auth/middleware');

  const tag = `api-iso-${process.pid}-${Date.now()}`;
  const emailA = `${tag}-admin-a@example.test`;
  const emailB = `${tag}-admin-b@example.test`;
  let a = '';
  let b = '';
  let server: Server;
  let base = '';
  // Which session the next request carries.
  let sessionUser: Record<string, unknown> | undefined;

  beforeAll(async () => {
    a = (await createCompany({ slug: `${tag}-a`, name: 'Alpha Roofing', status: 'active' })).id;
    b = (await createCompany({ slug: `${tag}-b`, name: 'Bravo HVAC', status: 'active', trade: 'hvac' })).id;
    await runAsCompany(a, () => db.insert(schema.teamMembers).values([
      { name: 'Admin A', email: emailA, role: 'admin', canLogin: true },
      { name: 'Rep A', email: `${tag}-rep-a@example.test`, role: 'sales', canLogin: true },
    ]));
    await runAsCompany(b, () => db.insert(schema.teamMembers).values([
      { name: 'Admin B', email: emailB, role: 'admin', canLogin: true },
    ]));

    const app = express();
    app.use(express.json());
    app.use((req: any, _res, next) => {
      req.session = { user: sessionUser, destroy: (cb: () => void) => { req.session.user = undefined; cb(); } };
      next();
    });
    app.use(tenantFromSession);
    registerAuthRoutes(app);
    registerTeamRoutes(app);
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    server?.close();
    await runAsSystem('test cleanup', async () => {
      for (const id of [a, b]) await db.delete(schema.teamMembers).where(eq(schema.teamMembers.companyId, id));
    });
  });

  const as = (email: string, companyId: string) => {
    clearSessionRevalidationCache();
    sessionUser = { email, name: 'x', role: 'admin', companyId };
  };

  it('gives each company only its own team', async () => {
    as(emailA, a);
    const teamA = await (await fetch(`${base}/api/team`)).json();
    as(emailB, b);
    const teamB = await (await fetch(`${base}/api/team`)).json();
    const emails = (t: any) => (Array.isArray(t) ? t : t.members ?? t.team ?? []).map((m: any) => m.email).sort();
    expect(emails(teamA)).toEqual([emailA, `${tag}-rep-a@example.test`].sort());
    expect(emails(teamB)).toEqual([emailB]);
  });

  it('tells the app which company the person is in', async () => {
    as(emailB, b);
    const me = await (await fetch(`${base}/api/auth/me`)).json();
    expect(me.company).toMatchObject({ id: b, name: 'Bravo HVAC', trade: 'hvac' });
  });

  it('refuses a session that claims another company', async () => {
    // Admin A's email with company B: B's roster has no such person.
    as(emailA, b);
    const r = await fetch(`${base}/api/team`);
    expect(r.status).toBe(401);
  });

  it('adds new people to the admin\'s own company only', async () => {
    as(emailA, a);
    const r = await fetch(`${base}/api/team`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'New Hire', email: `${tag}-new@example.test`, role: 'sales' }),
    });
    expect(r.status).toBeLessThan(300);
    const [row] = await runAsSystem('test check', () => db.select().from(schema.teamMembers).where(eq(schema.teamMembers.email, `${tag}-new@example.test`)));
    expect(row.companyId).toBe(a);
  });

  it('ends sessions for a paused company', async () => {
    await runAsSystem('test: pause company', () => db.update(schema.companies).set({ status: 'paused' }).where(eq(schema.companies.id, b)));
    as(emailB, b);
    const r = await fetch(`${base}/api/team`);
    expect(r.status).toBe(401);
    await runAsSystem('test: unpause company', () => db.update(schema.companies).set({ status: 'active' }).where(eq(schema.companies.id, b)));
  });
});
