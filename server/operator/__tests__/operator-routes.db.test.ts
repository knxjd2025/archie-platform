/**
 * The operator console through the real request path: the Postgres session
 * store, the company middleware, the roster re-check, the operator guard, the
 * routes and the database as the app's own role (scripts/test-db.sh).
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import express from 'express';
import session from 'express-session';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

const url = process.env.DATABASE_URL || '';
const local = /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url);

describe.skipIf(!local)('operator console', async () => {
  const { db, pool } = await import('../../db');
  const schema = await import('../../../shared/schema');
  const { and, eq, sql } = await import('drizzle-orm');
  const { createSessionStore } = await import('../../session-store');
  const { registerAuthRoutes } = await import('../../auth/routes');
  const { registerPasswordRoutes } = await import('../../auth/password-routes');
  const { registerTeamRoutes } = await import('../../auth/team-routes');
  const { registerOperatorRoutes } = await import('../routes');
  const { tenantFromSession } = await import('../../tenant/middleware');
  const { clearSessionRevalidationCache } = await import('../../auth/middleware');
  const { __resetRateLimits } = await import('../../lib/rate-limit');
  const { hashPassword } = await import('../../auth/password');
  const { runAsCompany, runAsSystem } = await import('../../tenant/context');
  const team = await import('../../storage/team');
  const { makeTestCompany } = await import('../../__tests__/helpers/tenant');
  const { COMPANY_PAUSED_MESSAGE } = await import('../../../shared/company');

  const tag = `op-${process.pid}-${Date.now()}`;
  const PW = 'a good long password 1';
  const operator = `${tag}-owner@example.test`;
  const adminA = `${tag}-admin-a@example.test`;
  const repA = `${tag}-rep-a@example.test`;
  let home = '';   // the company the operator signs in through
  let a = '';      // a customer company
  let server: Server;
  let base = '';
  let repAId = 0;
  const savedEnv = { ops: process.env.ARCHIE_OPERATOR_EMAILS, base: process.env.APP_BASE_URL };

  beforeAll(async () => {
    process.env.APP_BASE_URL = 'http://localhost:5000';
    process.env.ARCHIE_OPERATOR_EMAILS = ` someone-else@example.test , ${operator.toUpperCase()} `;
    home = await makeTestCompany('op-home');
    a = await makeTestCompany('op-a');
    const hash = await hashPassword(PW);
    await runAsCompany(home, async () => {
      await team.createTeamMember({ name: 'Owner', email: operator, role: 'admin', canLogin: true } as never, 'test');
      await team.setPasswordHash(operator, hash);
    });
    await runAsCompany(a, async () => {
      await team.createTeamMember({ name: 'Admin A', email: adminA, role: 'admin', canLogin: true } as never, 'test');
      await team.setPasswordHash(adminA, hash);
      repAId = (await team.createTeamMember({ name: 'Rep A', email: repA, role: 'sales', canLogin: true } as never, 'test')).id;
      await db.insert(schema.leads).values({ firstName: `${tag} lead`, source: 'test' });
      // A saved integration: its name may be shown, its credentials never.
      await db.insert(schema.companyIntegrations).values({ provider: 'companycam', credentials: `${tag}-SEALED-SECRET` });
    });

    const app = express();
    app.use(express.json());
    app.use(session({ store: createSessionStore(), secret: 'test-secret', resave: false, saveUninitialized: false }));
    app.use(tenantFromSession);
    registerAuthRoutes(app);
    registerPasswordRoutes(app);
    registerTeamRoutes(app);
    registerOperatorRoutes(app);
    server = app.listen(0);
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    process.env.ARCHIE_OPERATOR_EMAILS = savedEnv.ops;
    process.env.APP_BASE_URL = savedEnv.base;
    await new Promise<void>((r) => server.close(() => r()));
  });

  beforeEach(() => { __resetRateLimits(); clearSessionRevalidationCache(); });

  const cookieOf = (res: Response) => res.headers.getSetCookie().find((h) => h.startsWith('connect.sid='))!.split(';')[0];
  const post = (path: string, body: unknown, cookie = '') =>
    fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(body) });
  const get = (path: string, cookie = '') => { clearSessionRevalidationCache(); return fetch(base + path, { headers: { cookie } }); };
  const signIn = async (email: string, password = PW) => {
    const res = await post('/api/auth/login/password', { email, password });
    expect(res.status, `sign in ${email}`).toBe(200);
    return cookieOf(res);
  };
  const tokenOf = (link: string) => decodeURIComponent(link.split('#t=')[1]);
  const auditRows = (companyId: string) => runAsSystem('test: read audit', () =>
    db.select().from(schema.operatorAuditLog).where(eq(schema.operatorAuditLog.targetCompanyId, companyId)));
  /** Every operator route, as [method, path, body]. */
  const routes = (): Array<[string, string, unknown?]> => [
    ['GET', '/api/operator/companies'],
    ['GET', `/api/operator/companies/${a}`],
    ['POST', '/api/operator/companies', { companyName: 'Sneaky Roofing', adminName: 'X', adminEmail: `${tag}-sneaky@example.test` }],
    ['POST', `/api/operator/companies/${a}/status`, { status: 'paused' }],
    ['POST', `/api/operator/companies/${a}/members/${repAId}/reset-link`, {}],
  ];
  const call = ([method, path, body]: [string, string, unknown?], cookie: string) =>
    method === 'GET' ? get(path, cookie) : post(path, body, cookie);

  it('refuses everyone who is not an operator, company admins included', async () => {
    const admin = await signIn(adminA);
    for (const r of routes()) {
      expect((await call(r, admin)).status, `${r[0]} ${r[1]} as company admin`).toBe(403);
      expect((await call(r, '')).status, `${r[0]} ${r[1]} signed out`).toBe(401);
    }
    // Nothing happened: A is still active, no company was made, nothing was audited.
    const [row] = await runAsSystem('test', () => db.select().from(schema.companies).where(eq(schema.companies.id, a)));
    expect(row.status).toBe('active');
    expect(await team.findSignInMember(`${tag}-sneaky@example.test`)).toBeUndefined();
    expect(await auditRows(a)).toEqual([]);
    // The app is told this person is not an operator.
    const me = await (await get('/api/auth/me', admin)).json();
    expect(me.isOperator).toBe(false);
  });

  it('lets an operator in, and reads the allowlist again on every request', async () => {
    const op = await signIn(operator);
    expect((await (await get('/api/auth/me', op)).json()).isOperator).toBe(true);
    expect((await get('/api/operator/companies', op)).status).toBe(200);
    const saved = process.env.ARCHIE_OPERATOR_EMAILS;
    try {
      process.env.ARCHIE_OPERATOR_EMAILS = 'someone-else@example.test';
      expect((await get('/api/operator/companies', op)).status).toBe(403);
      expect((await (await get('/api/auth/me', op)).json()).isOperator).toBe(false);
      process.env.ARCHIE_OPERATOR_EMAILS = '';
      expect((await get('/api/operator/companies', op)).status).toBe(403);
    } finally {
      process.env.ARCHIE_OPERATOR_EMAILS = saved;
    }
    expect((await get('/api/operator/companies', op)).status).toBe(200);
  });

  it('lists companies with their numbers, and finds one by name or slug', async () => {
    const op = await signIn(operator);
    const [row] = await runAsSystem('test', () => db.select().from(schema.companies).where(eq(schema.companies.id, a)));
    const res = await get(`/api/operator/companies?q=${encodeURIComponent(row.slug)}`, op);
    const body = await res.json();
    expect(body.total).toBe(1);
    expect(body.companies[0]).toMatchObject({
      id: a, slug: row.slug, status: 'active', members: 2, canSignIn: 2, leads30d: 1, messages30d: 0, kynexProConnected: false,
    });
    const capped = await (await get('/api/operator/companies?limit=1000', op)).json();
    expect(capped.companies.length).toBeLessThanOrEqual(100);
  });

  it('shows one company with its team and integration names, and no secrets or hashes', async () => {
    const op = await signIn(operator);
    const res = await get(`/api/operator/companies/${a}`, op);
    expect(res.status).toBe(200);
    const text = await res.text();
    const body = JSON.parse(text);
    expect(body.team.map((m: any) => m.email).sort()).toEqual([adminA, repA].sort());
    expect(body.integrations).toEqual(['CompanyCam']);
    const [stored] = await runAsCompany(a, () => db.select({ h: schema.teamMembers.passwordHash }).from(schema.teamMembers).where(eq(schema.teamMembers.email, adminA)));
    expect(stored.h).toBeTruthy();
    for (const secret of [stored.h!, `${tag}-SEALED-SECRET`, 'passwordHash', 'password_hash', 'failedLogins', 'lockedUntil', 'credentials']) {
      expect(text).not.toContain(secret);
    }
    expect((await get('/api/operator/companies/00000000-0000-4000-8000-000000000000', op)).status).toBe(404);
    expect((await get('/api/operator/companies/not-a-uuid', op)).status).toBe(404);
  });

  it('creates a company with its admin, seed data, a trial end and a welcome link that works once', async () => {
    const op = await signIn(operator);
    const newAdmin = `${tag}-new-admin@example.test`;
    const res = await post('/api/operator/companies', { companyName: `Brand New Roofing ${tag}`, adminName: 'Nina New', adminEmail: newAdmin.toUpperCase() }, op);
    expect(res.status).toBe(201);
    const text = await res.text();
    const body = JSON.parse(text);
    expect(body.company.status).toBe('trial');
    expect(body.seeded).toBe(true);
    expect(body.welcomeLink).toMatch(/^http:\/\/localhost:5000\/set-password#t=/);
    const days = (new Date(body.company.trialEndsAt).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(13.9);
    expect(days).toBeLessThan(14.1);
    const hoursLeft = (new Date(body.linkExpiresAt).getTime() - Date.now()) / 3_600_000;
    expect(Math.round(hoursLeft)).toBe(72);

    const id = body.company.id;
    const counts = await runAsCompany(id, async () => ({
      admins: await db.select().from(schema.teamMembers).where(eq(schema.teamMembers.role, 'admin')),
      agents: (await db.select({ n: sql<number>`count(*)::int` }).from(schema.agents))[0].n,
      knowledge: (await db.select({ n: sql<number>`count(*)::int` }).from(schema.knowledgeDocuments))[0].n,
    }));
    expect(counts.admins.map((m) => [m.email, m.canLogin, m.passwordHash])).toEqual([[newAdmin, true, null]]);
    expect(counts.agents).toBeGreaterThan(0);
    expect(counts.knowledge).toBeGreaterThan(0);
    const [created] = await runAsSystem('test', () => db.select().from(schema.companies).where(eq(schema.companies.id, id)));
    expect(created.trialEndsAt).toBeInstanceOf(Date);

    // The link sets the admin's password and signs them in, once.
    const set = await post('/api/auth/password/set', { token: tokenOf(body.welcomeLink), password: PW });
    expect(set.status).toBe(200);
    expect((await (await get('/api/auth/me', cookieOf(set))).json()).company.id).toBe(id);
    expect((await post('/api/auth/password/set', { token: tokenOf(body.welcomeLink), password: PW })).status).toBe(400);

    const [entry] = await auditRows(id);
    expect(entry).toMatchObject({ operatorEmail: operator, action: 'company.create' });
    expect(entry.details).toMatchObject({ adminEmail: newAdmin, adminAdded: true, seeded: true });
    expect(JSON.stringify(entry)).not.toContain(tokenOf(body.welcomeLink));

    // An email already on a team is refused, and no second company is made.
    const again = await post('/api/operator/companies', { companyName: 'Dup Roofing', adminName: 'D', adminEmail: newAdmin }, op);
    expect(again.status).toBe(409);
    expect((await post('/api/operator/companies', { companyName: '', adminName: 'D', adminEmail: 'd@example.test' }, op)).status).toBe(400);
    expect((await post('/api/operator/companies', { companyName: 'X', adminName: 'D', adminEmail: 'nope' }, op)).status).toBe(400);
  }, 60_000);

  it('pausing signs the company out and blocks sign-in with a plain message; resuming restores it', async () => {
    const op = await signIn(operator);
    const admin = await signIn(adminA);
    expect((await get('/api/team', admin)).status).toBe(200);

    const paused = await post(`/api/operator/companies/${a}/status`, { status: 'paused' }, op);
    expect(paused.status).toBe(200);
    const result = await paused.json();
    expect(result).toMatchObject({ from: 'active', to: 'paused' });
    expect(result.sessionsEnded).toBeGreaterThanOrEqual(1);
    const left = await pool.query(`select count(*)::int as n from "session" where sess->'user'->>'companyId' = $1`, [a]);
    expect(left.rows[0].n).toBe(0);

    // The old session is gone; signing in again says why, and only with the right password.
    expect((await get('/api/team', admin)).status).toBe(401);
    const refused = await post('/api/auth/login/password', { email: adminA, password: PW });
    expect(refused.status).toBe(403);
    expect((await refused.json()).error).toBe(COMPANY_PAUSED_MESSAGE);
    const wrong = await post('/api/auth/login/password', { email: adminA, password: 'not the password 1' });
    expect(wrong.status).toBe(401);
    expect((await wrong.json()).error).toBe('Email or password is wrong.');
    // No reset links for a paused company: nobody could use them.
    expect((await post(`/api/operator/companies/${a}/members/${repAId}/reset-link`, {}, op)).status).toBe(400);
    // The operator's own session is untouched.
    expect((await get('/api/operator/companies', op)).status).toBe(200);

    const resumed = await post(`/api/operator/companies/${a}/status`, { status: 'active' }, op);
    expect(await resumed.json()).toMatchObject({ from: 'paused', to: 'active', sessionsEnded: 0 });
    const back = await signIn(adminA);
    expect((await get('/api/team', back)).status).toBe(200);

    const actions = (await auditRows(a)).filter((r) => r.action === 'company.status').map((r) => r.details);
    expect(actions).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: 'active', to: 'paused' }),
      expect.objectContaining({ from: 'paused', to: 'active', sessionsEnded: 0 }),
    ]));
    expect((await post(`/api/operator/companies/${a}/status`, { status: 'deleted' }, op)).status).toBe(400);
  });

  it('tells a session that outlived its company being paused why it ended', async () => {
    const admin = await signIn(adminA);
    // Paused behind the console's back, so the session row is still there.
    await runAsSystem('test: pause', () => db.update(schema.companies).set({ status: 'paused' }).where(eq(schema.companies.id, a)));
    try {
      const res = await get('/api/team', admin);
      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({ message: COMPANY_PAUSED_MESSAGE, code: 'company_inactive' });
    } finally {
      await runAsSystem('test: resume', () => db.update(schema.companies).set({ status: 'active' }).where(eq(schema.companies.id, a)));
    }
  });

  it('will not let an operator pause the company they sign in through', async () => {
    const op = await signIn(operator);
    const res = await post(`/api/operator/companies/${home}/status`, { status: 'paused' }, op);
    expect(res.status).toBe(400);
    const [row] = await runAsSystem('test', () => db.select().from(schema.companies).where(eq(schema.companies.id, home)));
    expect(row.status).toBe('active');
  });

  it('makes a 1-hour reset link for a member that works once, and audits it', async () => {
    const op = await signIn(operator);
    const res = await post(`/api/operator/companies/${a}/members/${repAId}/reset-link`, {}, op);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.email).toBe(repA);
    expect(Math.round((new Date(body.expiresAt).getTime() - Date.now()) / 60_000)).toBe(60);
    const set = await post('/api/auth/password/set', { token: tokenOf(body.link), password: PW });
    expect(set.status).toBe(200);
    expect((await post('/api/auth/password/set', { token: tokenOf(body.link), password: PW })).status).toBe(400);
    const [entry] = (await auditRows(a)).filter((r) => r.action === 'member.reset_link');
    expect(entry).toMatchObject({ operatorEmail: operator, details: { memberId: repAId, email: repA } });
    expect(JSON.stringify(entry)).not.toContain(tokenOf(body.link));

    // A member of another company, reached through this company's URL, is not found.
    const [ownerRow] = await runAsCompany(home, () => db.select().from(schema.teamMembers).where(eq(schema.teamMembers.email, operator)));
    expect((await post(`/api/operator/companies/${a}/members/${ownerRow.id}/reset-link`, {}, op)).status).toBe(404);
  });

  it('keeps the audit log away from the app role: only system work may read it or add to it', async () => {
    const state = (p: Promise<unknown>) => p.then(() => null, (e: any) => e?.cause?.code ?? e?.code);
    expect(await state(pool.query('select * from operator_audit_log'))).toBe('42501');
    expect(await state(runAsCompany(a, () => db.select().from(schema.operatorAuditLog), { loadProfile: false }))).toBe('42501');
    expect(await state(runAsCompany(a, () => db.insert(schema.operatorAuditLog).values({ operatorEmail: 'x@example.test', action: 'forged', targetCompanyId: a }), { loadProfile: false }))).toBe('42501');
    // Append-only even for system work.
    expect(await state(runAsSystem('test', () => db.update(schema.operatorAuditLog).set({ action: 'changed' }).where(eq(schema.operatorAuditLog.targetCompanyId, a))))).toBe('42501');
    expect(await state(runAsSystem('test', () => db.delete(schema.operatorAuditLog).where(and(eq(schema.operatorAuditLog.targetCompanyId, a)))))).toBe('42501');
    expect((await auditRows(a)).length).toBeGreaterThan(0);
  });
});
