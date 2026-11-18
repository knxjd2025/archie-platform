/**
 * One sign-in: a ticket from Roof Lee, posted by the person's browser, signs
 * them in to Archie. Against the real test database, through the real
 * request path, with a real session.
 *
 * What must hold (docs/sisters/contract-v2.md in the Roof Lee repository,
 * "What the receiver must do"): a ticket works once; a ticket for another
 * product, or signed with another secret, or for someone no longer on the
 * team, signs nobody in; the person is found by their shared sign-in id inside
 * the company the ticket names; the session is brand new; and every refusal
 * looks the same.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import session from 'express-session';
import http, { type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { companyBody, dropSecret, localDb, makeTicket, member, sisterSend, useSecret } from './helpers';
import { SISTER_PREFIX, sisterRawBody } from '../door';

vi.mock('../../seed', () => ({ seedCompany: async () => {}, seedAll: async () => {}, createSeedOnce: () => async () => {} }));
vi.mock('@vercel/functions', () => ({ waitUntil: () => {} }));

describe.skipIf(!localDb)('one sign-in from Roof Lee', async () => {
  const { db } = await import('../../db');
  const schema = await import('../../../shared/schema');
  const { eq } = await import('drizzle-orm');
  const { runAsCompany } = await import('../../tenant/context');
  const { tenantFromSession } = await import('../../tenant/middleware');
  const { requireAuth, clearSessionRevalidationCache } = await import('../../auth/middleware');
  const { registerSisterRoutes } = await import('../routes');
  const { SSO_REFUSED_PAGE } = await import('../sso');

  const tag = `sis-sso-${process.pid}-${Date.now()}`;
  const SSO = '/api/sister/v1/sso';
  const companies = '/api/sister/v1/companies';
  let server: Server;
  let base = '';

  beforeAll(async () => {
    // Wired the way both entry files wire it: raw body for the signed door,
    // then the parsers, the session, the company, the routes.
    const app = express();
    app.use(SISTER_PREFIX, sisterRawBody());
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));
    app.use(session({ secret: 'test', resave: false, saveUninitialized: false }));
    app.use(tenantFromSession);
    // A page that leaves something in the session before anyone signs in.
    app.get('/visit', (req, res) => { (req.session as any).visited = true; res.json({ ok: true }); });
    app.get('/whoami', requireAuth, (req, res) => { res.json({ user: req.session.user, visited: (req.session as any).visited ?? false }); });
    registerSisterRoutes(app);
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => { server?.close(); });
  beforeEach(() => { useSecret(); clearSessionRevalidationCache(); });
  afterEach(() => { dropSecret(); delete process.env.LOGIN_BLOCKLIST; });

  async function make(over: Record<string, unknown> = {}) {
    const body = companyBody(tag, over);
    const r = await sisterSend(base, { method: 'POST', path: companies, json: body, version: 1 });
    expect(r.status).toBe(201);
    return { body, id: r.body.companyId as string, roofliId: body.roofliCompanyId as string };
  }

  /** Posts a ticket the way the browser does: one form field, no signature headers. */
  async function present(ticket: string, cookie?: string) {
    const res = await fetch(`${base}${SSO}`, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded', ...(cookie ? { cookie } : {}) },
      body: new URLSearchParams({ ticket }).toString(),
    });
    const set = res.headers.get('set-cookie');
    return { status: res.status, location: res.headers.get('location'), cookie: set ? set.split(';')[0] : null, text: await res.text() };
  }
  const whoami = async (cookie: string | null) => {
    const res = await fetch(`${base}/whoami`, { headers: cookie ? { cookie } : {} });
    return { status: res.status, body: res.status === 200 ? await res.json() : null };
  };
  /** Nobody was signed in, and nothing says why. */
  function expectRefused(r: Awaited<ReturnType<typeof present>>) {
    expect(r.status).toBe(401);
    expect(r.text).toBe(SSO_REFUSED_PAGE);
    expect(r.cookie).toBeNull();
    expect(r.location).toBeNull();
  }

  it('signs the person in with the role Archie holds for them, on the landing page', async () => {
    const office = member(tag, 'office', 'Riley Marsh');
    const { id, roofliId } = await make({ members: [member(tag, 'owner'), office] });
    // The ticket claims "owner". Archie goes by its own roster: office staff are customer service here.
    const r = await present(makeTicket({ roofliCompanyId: roofliId, authUserId: office.authUserId, email: 'someone-else@example.test', role: 'owner' }));
    expect(r.status).toBe(303);
    expect(r.location).toBe('/');
    expect(r.cookie).not.toBeNull();
    const me = await whoami(r.cookie);
    expect(me.status).toBe(200);
    expect(me.body.user).toEqual({ email: office.email, name: 'Riley Marsh', role: 'customer_service', companyId: id });
    const [row] = await runAsCompany(id, () => db.select().from(schema.teamMembers).where(eq(schema.teamMembers.email, office.email)));
    expect(row.lastLoginAt).not.toBeNull();
  });

  it('works once: a second use of the same ticket signs nobody in', async () => {
    const owner = member(tag, 'owner');
    const { roofliId } = await make({ members: [owner] });
    const ticket = makeTicket({ roofliCompanyId: roofliId, authUserId: owner.authUserId });
    expect((await present(ticket)).status).toBe(303);
    expectRefused(await present(ticket));
  });

  it('lets only one of two copies arriving together through', async () => {
    const owner = member(tag, 'owner');
    const { roofliId } = await make({ members: [owner] });
    const ticket = makeTicket({ roofliCompanyId: roofliId, authUserId: owner.authUserId });
    const both = await Promise.all([present(ticket), present(ticket), present(ticket)]);
    expect(both.map((r) => r.status).sort()).toEqual([303, 401, 401]);
  });

  it('refuses a ticket made for another product', async () => {
    const owner = member(tag, 'owner');
    const { roofliId } = await make({ members: [owner] });
    for (const product of ['roofn', 'kontentfire']) {
      expectRefused(await present(makeTicket({ roofliCompanyId: roofliId, authUserId: owner.authUserId, product })));
    }
  });

  it('refuses a ticket signed with another product\'s secret, or the old shared one', async () => {
    const owner = member(tag, 'owner');
    const { roofliId } = await make({ members: [owner] });
    process.env.SISTERS_SHARED_SECRET = 'the-old-shared-secret';
    process.env.SISTERS_ROOFN_SECRET = 'roofn-pair-secret';
    try {
      for (const secret of ['the-old-shared-secret', 'roofn-pair-secret']) {
        expectRefused(await present(makeTicket({ roofliCompanyId: roofliId, authUserId: owner.authUserId }, secret)));
      }
    } finally {
      delete process.env.SISTERS_SHARED_SECRET;
      delete process.env.SISTERS_ROOFN_SECRET;
    }
  });

  it('refuses a ticket for someone who has been taken off the team', async () => {
    const owner = member(tag, 'owner');
    const crew = member(tag, 'crew', 'Sam Ortiz');
    const { roofliId } = await make({ members: [owner, crew] });
    // The ticket was made while Sam was on the team; the team list then left Sam out.
    const ticket = makeTicket({ roofliCompanyId: roofliId, authUserId: crew.authUserId, role: 'crew' });
    const put = await sisterSend(base, { method: 'PUT', path: `${companies}/${roofliId}/members`, json: { roofliCompanyId: roofliId, members: [owner] }, version: 1 });
    expect(put.status).toBe(200);
    expectRefused(await present(ticket));
    // And a fresh ticket for Sam does no better.
    expectRefused(await present(makeTicket({ roofliCompanyId: roofliId, authUserId: crew.authUserId, role: 'crew' })));
  });

  it('ends a signed-in person\'s session when the team list leaves them out', async () => {
    const owner = member(tag, 'owner');
    const crew = member(tag, 'crew', 'Sam Ortiz');
    const { roofliId } = await make({ members: [owner, crew] });
    const r = await present(makeTicket({ roofliCompanyId: roofliId, authUserId: crew.authUserId }));
    expect((await whoami(r.cookie)).status).toBe(200);
    await sisterSend(base, { method: 'PUT', path: `${companies}/${roofliId}/members`, json: { roofliCompanyId: roofliId, members: [owner] }, version: 1 });
    expect((await whoami(r.cookie)).status).toBe(401);
  });

  it('finds the person inside the company the ticket names and nowhere else', async () => {
    const dana = member(tag, 'owner');
    const a = await make({ members: [dana] });
    const b = await make({ members: [member(tag, 'owner', 'Lee Park')] });
    // Dana belongs to A. A ticket naming B does not let Dana into B, or anyone into anything.
    expectRefused(await present(makeTicket({ roofliCompanyId: b.roofliId, authUserId: dana.authUserId })));
    // Nor does a company Roof Lee never made, or Archie's own id for one.
    expectRefused(await present(makeTicket({ roofliCompanyId: randomUUID(), authUserId: dana.authUserId })));
    expectRefused(await present(makeTicket({ roofliCompanyId: a.id, authUserId: dana.authUserId })));
    // The email in a ticket finds nobody: only the sign-in id does.
    expectRefused(await present(makeTicket({ roofliCompanyId: a.roofliId, authUserId: randomUUID(), email: dana.email })));
  });

  it('never signs in someone the company added by hand, even with a matching id in the ticket', async () => {
    const { id, roofliId } = await make();
    const email = `${tag}-byhand-${randomUUID().slice(0, 8)}@example.test`;
    const authUserId = randomUUID();
    // A row with a sign-in id that Roof Lee did not send (no source).
    await runAsCompany(id, () => db.insert(schema.teamMembers).values({ name: 'By Hand', email, role: 'admin', active: true, canLogin: true, authUserId }));
    expectRefused(await present(makeTicket({ roofliCompanyId: roofliId, authUserId })));
  });

  it('refuses everyone while the company is paused, and lets them back when it is paying again', async () => {
    const owner = member(tag, 'owner');
    const { body, roofliId } = await make({ members: [owner] });
    const paused = await sisterSend(base, { method: 'DELETE', path: `${companies}/${roofliId}`, json: { roofliCompanyId: roofliId, mode: 'pause' }, version: 2, headers: { 'idempotency-key': randomUUID() } });
    expect(paused.status).toBe(200);
    expectRefused(await present(makeTicket({ roofliCompanyId: roofliId, authUserId: owner.authUserId })));
    const back = await sisterSend(base, { method: 'POST', path: companies, json: { ...body, plan: { keys: ['base'], active: true, trial: false } }, version: 1 });
    expect(back.status).toBe(200);
    expect((await present(makeTicket({ roofliCompanyId: roofliId, authUserId: owner.authUserId }))).status).toBe(303);
  });

  it('applies the deployment\'s own block list', async () => {
    const owner = member(tag, 'owner');
    const { roofliId } = await make({ members: [owner] });
    process.env.LOGIN_BLOCKLIST = owner.email;
    expectRefused(await present(makeTicket({ roofliCompanyId: roofliId, authUserId: owner.authUserId })));
  });

  it('refuses a ticket that has run out, and one that claims a longer life', async () => {
    const owner = member(tag, 'owner');
    const { roofliId } = await make({ members: [owner] });
    const now = Math.floor(Date.now() / 1000);
    expectRefused(await present(makeTicket({ roofliCompanyId: roofliId, authUserId: owner.authUserId, iat: now - 61 })));
    expectRefused(await present(makeTicket({ roofliCompanyId: roofliId, authUserId: owner.authUserId, iat: now, exp: now + 86400 })));
  });

  it('starts a brand-new session, never the one the browser arrived with', async () => {
    const owner = member(tag, 'owner');
    const { roofliId } = await make({ members: [owner] });
    // The browser already holds a session from before sign-in (or one planted on it).
    const before = (await fetch(`${base}/visit`)).headers.get('set-cookie')!.split(';')[0];
    const r = await present(makeTicket({ roofliCompanyId: roofliId, authUserId: owner.authUserId }), before);
    expect(r.status).toBe(303);
    expect(r.cookie).not.toBeNull();
    expect(r.cookie).not.toBe(before);
    // The old id is signed in to nothing, and nothing was carried over from it.
    expect((await whoami(before)).status).toBe(401);
    const me = await whoami(r.cookie);
    expect(me.body.visited).toBe(false);
  });

  it('answers every refusal the same way, and reads a ticket from the form body only', async () => {
    const owner = member(tag, 'owner');
    const { roofliId } = await make({ members: [owner] });
    const good = () => makeTicket({ roofliCompanyId: roofliId, authUserId: owner.authUserId });
    expectRefused(await present(''));
    expectRefused(await present('not-a-ticket'));
    expectRefused(await present(`${good()}x`));
    // In the address: never read.
    const inAddress = await fetch(`${base}${SSO}?ticket=${encodeURIComponent(good())}`, { method: 'POST', redirect: 'manual' });
    expect(inAddress.status).toBe(401);
    expect(await inAddress.text()).toBe(SSO_REFUSED_PAGE);
    // As JSON: never read.
    const asJson = await fetch(`${base}${SSO}`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ticket: good() }) });
    expect(asJson.status).toBe(401);
    expect(asJson.headers.get('set-cookie')).toBeNull();
    // A body far too large to be a ticket.
    expectRefused(await present('a'.repeat(40_000)));
    // A GET is not this endpoint at all: the signed door answers it, bare.
    expect((await fetch(`${base}${SSO}?ticket=${encodeURIComponent(good())}`, { redirect: 'manual' })).status).toBe(401);
  });

  it('is shut while the pair secret is unset', async () => {
    const owner = member(tag, 'owner');
    const { roofliId } = await make({ members: [owner] });
    const ticket = makeTicket({ roofliCompanyId: roofliId, authUserId: owner.authUserId });
    dropSecret();
    expectRefused(await present(ticket));
    // Shut means the ticket was not even spent.
    useSecret();
    expect((await present(ticket)).status).toBe(303);
  });
});
