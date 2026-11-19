/**
 * The two sales roles Roof Lee added on 2026-11-19, and the team list being
 * the whole truth only for the people Roof Lee sent (Stage B, Archie side).
 *
 * What must hold (docs/sisters/contract-v2.md in the Roof Lee repository,
 * "Roles each product is told" and "Archie"):
 *   - Roof Lee's `sales_manager` is Archie's sales leader (`manager`) and its
 *     `salesperson` is Archie's sales rep (`sales`), wherever a role is read:
 *     a team list, an `acting` block, `actingRole` in an address, a sign-in
 *     ticket. Neither is skipped, so neither loses access;
 *   - a salesperson sees and changes only their own leads and jobs, through
 *     Roof Lee and in Archie;
 *   - someone the company added in Archie itself keeps their access and their
 *     email sign-in whatever team list Roof Lee sends, while someone Roof Lee
 *     sent and then left out is switched off;
 *   - the original company, which Roof Lee did not make, is exactly as before.
 *
 * Against the real test database, through the real request path and a real
 * session. Fixtures are the fictional Summit Ridge Roofing in Cedar Falls.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import session from 'express-session';
import http, { type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { TEST_SECRET, companyBody, dropSecret, localDb, makeTicket, member, sisterSend, useSecret, type TestMember } from './helpers';
import { SISTER_PREFIX, sisterRawBody } from '../door';
import { ROLE_MAP, ROOFLI_ROLES, parseActing, parseActingQuery, parseMembers } from '../contract';
import { readTicket } from '../ticket';

vi.mock('../../seed', () => ({ seedCompany: async () => {}, seedAll: async () => {}, SEED_JOB: 'seed-company', seedVersion: () => 'test' }));
vi.mock('@vercel/functions', () => ({ waitUntil: () => {} }));

describe('the six Roof Lee roles, as Archie reads them', () => {
  const id = '7d1c1d0a-3f0e-4b53-8a44-0d6d7f1f2a10';

  it('maps a sales manager to a sales leader and a salesperson to a sales rep, and the first four as before', () => {
    expect([...ROOFLI_ROLES].sort()).toEqual(['admin', 'crew', 'office', 'owner', 'sales_manager', 'salesperson']);
    expect(ROLE_MAP).toEqual({
      owner: 'admin', admin: 'admin', office: 'customer_service', crew: 'production',
      sales_manager: 'manager', salesperson: 'sales',
    });
  });

  it('takes both into a team list, and still leaves out a role it does not know', () => {
    const parsed = parseMembers([
      { authUserId: id, email: 'morgan@example.test', fullName: 'Morgan Reyes', role: 'sales_manager' },
      { authUserId: randomUUID(), email: 'jo@example.test', fullName: 'Jo Ames', role: 'salesperson' },
      { authUserId: randomUUID(), email: 'kit@example.test', fullName: 'Kit Moss', role: 'superuser' },
    ]);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.members.map((m) => [m.email, m.role])).toEqual([['morgan@example.test', 'manager'], ['jo@example.test', 'sales']]);
    expect(parsed.value.skipped).toHaveLength(1);
  });

  it('reads both in an acting block and in the address of a read', () => {
    for (const role of ['sales_manager', 'salesperson']) {
      expect(parseActing({ authUserId: id, role })).toEqual({ ok: true, value: { authUserId: id, role } });
      expect(parseActingQuery({ actingUserId: id, actingRole: role })).toEqual({ ok: true, value: { authUserId: id, role } });
    }
    expect(parseActing({ authUserId: id, role: 'superuser' }).ok).toBe(false);
    expect(parseActingQuery({ actingUserId: id, actingRole: 'sales' }).ok).toBe(false);
  });

  it('reads both in a sign-in ticket, and nothing else new', () => {
    const now = new Date();
    for (const role of ['sales_manager', 'salesperson']) {
      const ticket = makeTicket({ roofliCompanyId: randomUUID(), authUserId: id, role });
      expect(readTicket(ticket, TEST_SECRET, now, 'archie')?.role).toBe(role);
    }
    expect(readTicket(makeTicket({ roofliCompanyId: randomUUID(), authUserId: id, role: 'manager' }), TEST_SECRET, now, 'archie')).toBeNull();
  });
});

describe.skipIf(!localDb)('sales roles and the team list, through the real request path', async () => {
  const { db } = await import('../../db');
  const schema = await import('../../../shared/schema');
  const { and, eq, inArray } = await import('drizzle-orm');
  const { runAsCompany, runAsSystem } = await import('../../tenant/context');
  const { createCompany } = await import('../../tenant/companies');
  const { tenantFromSession } = await import('../../tenant/middleware');
  const { requireAuth, clearSessionRevalidationCache } = await import('../../auth/middleware');
  const { registerSisterRoutes } = await import('../routes');
  const { registerPasswordRoutes } = await import('../../auth/password-routes');
  const { registerTeamRoutes } = await import('../../auth/team-routes');
  const { registerSalesRoutes } = await import('../../sales/routes');
  const { registerProductionRoutes } = await import('../../production/routes');
  const { hashPassword } = await import('../../auth/password');
  const { setPasswordHash, findSignInMember } = await import('../../storage/team');
  const { applyAssignment } = await import('../../access/assignment-service');
  const { ownsLead } = await import('../../access/rep-scope');

  const tag = `sis-roles-${process.pid}-${Date.now()}`;
  const companies = '/api/sister/v1/companies';
  const PASSWORD = 'cedar-falls-ridge-42';
  let server: Server;
  let base = '';
  const made: string[] = [];

  beforeAll(async () => {
    // Wired the way both entry files wire it: raw body for the signed door,
    // then the parsers, the session, the company, the routes.
    const app = express();
    app.use(SISTER_PREFIX, sisterRawBody());
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));
    app.use(session({ secret: 'test', resave: false, saveUninitialized: false }));
    app.use(tenantFromSession);
    app.get('/whoami', requireAuth, (req, res) => { res.json({ user: req.session.user }); });
    registerSisterRoutes(app);
    registerPasswordRoutes(app);
    registerTeamRoutes(app);
    registerSalesRoutes(app);
    registerProductionRoutes(app);
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    server?.close();
    await runAsSystem('test cleanup', async () => {
      if (made.length) {
        await db.delete(schema.repAssignments).where(inArray(schema.repAssignments.companyId, made));
      }
    });
  });
  beforeEach(() => { useSecret(); clearSessionRevalidationCache(); });
  afterEach(() => { dropSecret(); vi.restoreAllMocks(); });

  interface Made { id: string; roofliId: string; body: Record<string, unknown>; owner: TestMember; office: TestMember; leader: TestMember; rep: TestMember; rep2: TestMember; crew: TestMember }
  async function make(): Promise<Made> {
    const owner = member(tag, 'owner', 'Dana Whitfield');
    const office = member(tag, 'office', 'Riley Marsh');
    const leader = member(tag, 'sales_manager', 'Morgan Reyes');
    const rep = member(tag, 'salesperson', 'Jo Ames');
    const rep2 = member(tag, 'salesperson', 'Kim Lane');
    const crew = member(tag, 'crew', 'Sam Ortiz');
    const body = companyBody(tag, { members: [owner, office, leader, rep, rep2, crew] });
    const r = await sisterSend(base, { method: 'POST', path: companies, json: body, version: 1 });
    expect(r.status).toBe(201);
    // Nobody was left out: Archie knows every role Roof Lee sent.
    expect(r.body).toEqual({ companyId: r.body.companyId });
    made.push(r.body.companyId);
    return { id: r.body.companyId, roofliId: body.roofliCompanyId as string, body, owner, office, leader, rep, rep2, crew };
  }
  const putTeam = (c: Made, members: TestMember[]) =>
    sisterSend(base, { method: 'PUT', path: `${companies}/${c.roofliId}/members`, json: { roofliCompanyId: c.roofliId, members }, version: 1 });
  const team = (id: string) => runAsCompany(id, () => db.select().from(schema.teamMembers).orderBy(schema.teamMembers.id));
  const rowOf = async (c: Made, m: TestMember) => (await team(c.id)).find((r) => r.authUserId === m.authUserId)!;
  const as = (m: TestMember) => ({ authUserId: m.authUserId, role: m.role });
  const who = (m: TestMember) => `actingUserId=${m.authUserId}&actingRole=${m.role}`;
  const read = (c: Made, path: string, m: TestMember) => sisterSend(base, { path: `${companies}/${c.roofliId}${path}?${who(m)}`, version: 2 });
  const write = (c: Made, method: string, path: string, json: Record<string, unknown>) =>
    sisterSend(base, { method, path: `${companies}/${c.roofliId}${path}`, json, version: 2, headers: { 'idempotency-key': randomUUID() } });
  async function newLead(c: Made, by: TestMember, name: string): Promise<string> {
    const r = await write(c, 'POST', '/leads', { name, town: 'Cedar Falls', jobType: 'replacement', acting: as(by) });
    expect(r.status).toBe(201);
    return r.body.leadId as string;
  }
  const keyOf = async (c: Made, leadId: string) =>
    (await runAsCompany(c.id, () => db.select().from(schema.leads).where(eq(schema.leads.id, Number(leadId)))))[0].externalId!;
  /** A manager gives the job to someone, the way the Assignments page does. */
  async function give(c: Made, leadId: string, to: TestMember) {
    const key = await keyOf(c, leadId);
    const owner = await rowOf(c, to);
    await runAsCompany(c.id, () => applyAssignment({ jobExternalId: key, primaryTeamMemberId: owner.id, secondaryTeamMemberIds: [], source: 'manual', assignedBy: 'test' }));
    return key;
  }
  const ownersOf = async (c: Made, leadId: string) => {
    const key = await keyOf(c, leadId);
    return runAsCompany(c.id, () => db.select().from(schema.repAssignments).where(eq(schema.repAssignments.jobExternalId, key)));
  };
  const listed = async (c: Made, m: TestMember) => {
    const r = await read(c, '/jobs', m);
    expect(r.status).toBe(200);
    return (r.body.jobs as Array<{ id: string }>).map((j) => j.id).sort();
  };

  /** Posts a ticket the way the browser does: one form field, no signature headers. */
  async function present(ticket: string) {
    const res = await fetch(`${base}/api/sister/v1/sso`, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ ticket }).toString(),
    });
    const set = res.headers.get('set-cookie');
    return { status: res.status, cookie: set ? set.split(';')[0] : null };
  }
  async function signInByEmail(email: string, password = PASSWORD) {
    const res = await fetch(`${base}/api/auth/login/password`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }),
    });
    const set = res.headers.getSetCookie().find((h) => h.startsWith('connect.sid='));
    return { status: res.status, cookie: set ? set.split(';')[0] : null };
  }
  const get = async (path: string, cookie: string | null) => {
    const res = await fetch(`${base}${path}`, { headers: cookie ? { cookie } : {} });
    return { status: res.status, body: res.status === 200 ? await res.json() as any : null };
  };
  const send = async (method: string, path: string, json: unknown, cookie: string | null) => {
    const res = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(json) });
    return { status: res.status, body: await res.json().catch(() => null) as any };
  };

  it('takes a sales manager and a salesperson as a sales leader and a sales rep, with access, and keeps them on every later list', async () => {
    const c = await make();
    expect(await rowOf(c, c.leader)).toMatchObject({ role: 'manager', name: 'Morgan Reyes', active: true, canLogin: true, source: 'roofli' });
    expect(await rowOf(c, c.rep)).toMatchObject({ role: 'sales', name: 'Jo Ames', active: true, canLogin: true, source: 'roofli' });

    // The whole team again, with Jo moved up to sales manager: nobody is skipped or switched off.
    const r = await putTeam(c, [c.owner, c.office, c.leader, { ...c.rep, role: 'sales_manager' }, c.rep2, c.crew]);
    expect(r.status).toBe(200);
    expect(r.body?.skipped ?? []).toEqual([]);
    expect(await rowOf(c, c.rep)).toMatchObject({ role: 'manager', active: true, canLogin: true });
    expect(await rowOf(c, c.leader)).toMatchObject({ role: 'manager', active: true, canLogin: true });
    // And back down again.
    await putTeam(c, [c.owner, c.office, c.leader, c.rep, c.rep2, c.crew]);
    expect(await rowOf(c, c.rep)).toMatchObject({ role: 'sales', active: true, canLogin: true });
  });

  it('holds a salesperson to their own leads and jobs through Roof Lee, in reads and writes alike', async () => {
    const c = await make();
    const mine = await newLead(c, c.office, 'Pat Hollis');
    const theirs = await newLead(c, c.office, 'Jo Burst');
    const nobodys = await newLead(c, c.office, 'Lee Brandt');
    await give(c, mine, c.rep);
    await give(c, theirs, c.rep2);

    expect(await listed(c, c.rep)).toEqual([mine]);
    expect(await listed(c, c.rep2)).toEqual([theirs]);
    // Office staff and the owner still see every lead.
    expect(await listed(c, c.office)).toEqual([mine, theirs, nobodys].sort());

    expect((await read(c, `/jobs/${mine}`, c.rep)).status).toBe(200);
    for (const other of [theirs, nobodys]) {
      expect((await read(c, `/jobs/${other}`, c.rep)).status).toBe(404);
      expect((await write(c, 'PATCH', `/leads/${other}`, { status: 'lost', acting: as(c.rep) })).status).toBe(404);
      expect((await write(c, 'POST', `/leads/${other}/notes`, { text: 'Called.', acting: as(c.rep) })).status).toBe(404);
      expect((await write(c, 'POST', `/jobs/${other}/stage`, { stage: 'approved', acting: as(c.rep) })).status).toBe(404);
    }
    // Nothing changed on another rep's lead.
    const theirsRow = (await runAsCompany(c.id, () => db.select().from(schema.leads).where(eq(schema.leads.id, Number(theirs)))))[0];
    expect(theirsRow.status).toBe('new');
    expect(await runAsCompany(c.id, () => db.select().from(schema.leadNotes).where(eq(schema.leadNotes.leadId, Number(theirs))))).toEqual([]);

    // Their own they can work.
    expect((await write(c, 'PATCH', `/leads/${mine}`, { status: 'contacted', acting: as(c.rep) })).status).toBe(200);
    expect((await write(c, 'POST', `/leads/${mine}/notes`, { text: 'Booked the inspection.', acting: as(c.rep) })).status).toBe(201);
    expect((await write(c, 'POST', `/jobs/${mine}/stage`, { stage: 'approved', acting: as(c.rep) })).status).toBe(200);
  });

  it('gives a lead a salesperson or sales manager adds through Roof Lee to them, so they can see it, and nobody else\'s', async () => {
    const c = await make();
    const reps = await newLead(c, c.rep, 'Ray Okafor');
    expect(await ownersOf(c, reps)).toEqual([expect.objectContaining({ teamMemberId: (await rowOf(c, c.rep)).id, role: 'primary' })]);
    expect(await listed(c, c.rep)).toEqual([reps]);
    expect(await listed(c, c.rep2)).toEqual([]);

    const leaders = await newLead(c, c.leader, 'Ana Diaz');
    expect(await ownersOf(c, leaders)).toEqual([expect.objectContaining({ teamMemberId: (await rowOf(c, c.leader)).id, role: 'primary' })]);
    expect(await listed(c, c.leader)).toEqual([leaders]);

    // Office staff see every lead already: theirs waits for a manager to give it out, as before.
    const offices = await newLead(c, c.office, 'Bo Hart');
    expect(await ownersOf(c, offices)).toEqual([]);
  });

  it('lets a sales manager see their own reps\' jobs and nobody else\'s', async () => {
    const c = await make();
    const leaderRow = await rowOf(c, c.leader);
    // Jo reports to Morgan; Kim does not.
    const jo = await rowOf(c, c.rep);
    await runAsCompany(c.id, () => db.update(schema.teamMembers).set({ reportsTo: leaderRow.id }).where(eq(schema.teamMembers.id, jo.id)));
    const jos = await newLead(c, c.office, 'Pat Hollis');
    const kims = await newLead(c, c.office, 'Jo Burst');
    await give(c, jos, c.rep);
    await give(c, kims, c.rep2);
    expect(await listed(c, c.leader)).toEqual([jos]);
    expect((await read(c, `/jobs/${kims}`, c.leader)).status).toBe(404);
    // A later team list does not undo the reporting line.
    await putTeam(c, [c.owner, c.office, c.leader, c.rep, c.rep2, c.crew]);
    expect(await listed(c, c.leader)).toEqual([jos]);
  });

  it('goes by the lower role: an owner Roof Lee calls a salesperson sees nothing of their own here', async () => {
    const c = await make();
    await newLead(c, c.office, 'Pat Hollis');
    expect(await listed(c, { ...c.owner, role: 'salesperson' })).toEqual([]);
    // A salesperson Roof Lee calls an owner is still a salesperson.
    const theirs = await newLead(c, c.office, 'Jo Burst');
    await give(c, theirs, c.rep2);
    expect(await listed(c, { ...c.rep, role: 'owner' })).toEqual([]);
    // A sales role can never pause or close the company.
    const paused = await sisterSend(base, { method: 'DELETE', path: `${companies}/${c.roofliId}`, json: { roofliCompanyId: c.roofliId, mode: 'pause', acting: as(c.leader) }, version: 2, headers: { 'idempotency-key': randomUUID() } });
    expect(paused.status).toBe(403);
  });

  it('signs a salesperson in from Roof Lee as a sales rep, who sees only their own jobs in Archie', async () => {
    const c = await make();
    const mine = await newLead(c, c.office, 'Pat Hollis');
    const theirs = await newLead(c, c.office, 'Jo Burst');
    const myKey = await give(c, mine, c.rep);
    const theirKey = await give(c, theirs, c.rep2);

    const rep = await present(makeTicket({ roofliCompanyId: c.roofliId, authUserId: c.rep.authUserId, role: 'salesperson' }));
    expect(rep.status).toBe(303);
    const me = await get('/whoami', rep.cookie);
    expect(me.body.user).toEqual({ email: c.rep.email, name: 'Jo Ames', role: 'sales', companyId: c.id });
    const board = await get('/api/sales', rep.cookie);
    expect(board.status).toBe(200);
    expect(board.body.jobs.map((j: any) => j.externalId)).toEqual([myKey]);
    const repRow = await rowOf(c, c.rep);
    expect(await runAsCompany(c.id, () => ownsLead({ email: repRow.email, name: repRow.name, role: 'sales' }, theirKey))).toBe(false);
    expect(await runAsCompany(c.id, () => ownsLead({ email: repRow.email, name: repRow.name, role: 'sales' }, myKey))).toBe(true);
    // Both sold and on the production board: still only their own.
    for (const id of [mine, theirs]) expect((await write(c, 'POST', `/jobs/${id}/stage`, { stage: 'approved', acting: as(c.office) })).status).toBe(200);
    const production = await get('/api/production', rep.cookie);
    expect(production.status).toBe(200);
    const onBoard = JSON.stringify(production.body);
    expect(onBoard).toContain(myKey);
    expect(onBoard).not.toContain(theirKey);

    const leader = await present(makeTicket({ roofliCompanyId: c.roofliId, authUserId: c.leader.authUserId, role: 'sales_manager' }));
    expect(leader.status).toBe(303);
    expect((await get('/whoami', leader.cookie)).body.user).toMatchObject({ role: 'manager' });

    // The office sees both.
    const office = await present(makeTicket({ roofliCompanyId: c.roofliId, authUserId: c.office.authUserId, role: 'office' }));
    const all = JSON.stringify((await get('/api/production', office.cookie)).body);
    expect(all).toContain(myKey);
    expect(all).toContain(theirKey);
  });

  it('keeps someone the company added in Archie, with their email sign-in, whatever team list Roof Lee sends', async () => {
    const c = await make();
    // The owner opens Archie from Roof Lee and adds a crew member who has no Roof Lee sign-in.
    const owner = await present(makeTicket({ roofliCompanyId: c.roofliId, authUserId: c.owner.authUserId, role: 'owner' }));
    expect(owner.status).toBe(303);
    const kitEmail = `${tag}-kit-${randomUUID().slice(0, 8)}@example.test`;
    const added = await send('POST', '/api/team', { name: 'Kit Moss', email: kitEmail, role: 'production', canLogin: true }, owner.cookie);
    expect(added.status).toBe(201);
    const hash = await hashPassword(PASSWORD);
    await runAsCompany(c.id, () => setPasswordHash(kitEmail, hash));
    const kitIn = await signInByEmail(kitEmail);
    expect(kitIn.status).toBe(200);
    expect((await get('/whoami', kitIn.cookie)).body.user).toEqual({ email: kitEmail, name: 'Kit Moss', role: 'production', companyId: c.id });

    // Roof Lee's next list leaves Kit out (it never knew Kit) and leaves Sam out (it did).
    const samIn = await present(makeTicket({ roofliCompanyId: c.roofliId, authUserId: c.crew.authUserId, role: 'crew' }));
    expect((await get('/whoami', samIn.cookie)).status).toBe(200);
    const r = await putTeam(c, [c.owner, c.office, c.leader, c.rep, c.rep2]);
    expect(r.status).toBe(200);

    const kit = (await team(c.id)).find((m) => m.email === kitEmail)!;
    expect(kit).toMatchObject({ active: true, canLogin: true, source: null, role: 'production', authUserId: null });
    // Kit is still signed in, and can still sign in by email.
    clearSessionRevalidationCache();
    expect((await get('/whoami', kitIn.cookie)).status).toBe(200);
    expect((await findSignInMember(kitEmail))?.company.id).toBe(c.id);
    expect((await signInByEmail(kitEmail)).status).toBe(200);

    // Sam, whom Roof Lee sent and has now left out, is switched off and signed out.
    expect(await rowOf(c, c.crew)).toMatchObject({ active: false, canLogin: false, source: 'roofli' });
    expect((await get('/whoami', samIn.cookie)).status).toBe(401);
    expect((await present(makeTicket({ roofliCompanyId: c.roofliId, authUserId: c.crew.authUserId, role: 'crew' }))).status).toBe(401);

    // A list sent again later still leaves Kit alone.
    await putTeam(c, [c.owner]);
    expect((await team(c.id)).find((m) => m.email === kitEmail)).toMatchObject({ active: true, canLogin: true });
    expect((await signInByEmail(kitEmail)).status).toBe(200);
    // Kit is crew: no money, no leads, and Kit owns nothing.
    expect(await runAsCompany(c.id, () => db.select().from(schema.repAssignments).where(eq(schema.repAssignments.teamMemberId, kit.id)))).toEqual([]);
  });

  it('never lets someone added in Archie act for Roof Lee, or be taken over by a team list, even with a matching sign-in id', async () => {
    const c = await make();
    const authUserId = randomUUID();
    const email = `${tag}-byhand-${randomUUID().slice(0, 8)}@example.test`;
    // A row with a sign-in id that Roof Lee did not send (no source), as only a hand-made row could have.
    await runAsCompany(c.id, () => db.insert(schema.teamMembers).values({ name: 'By Hand', email, role: 'admin', active: true, canLogin: true, authUserId }));
    const byHand = { authUserId, email: `${tag}-other@example.test`, fullName: 'Someone Else', role: 'owner' } as TestMember;

    // Not taken over: a list naming that id is refused for that person, and the hand-made row is left exactly as it was.
    const r = await putTeam(c, [c.owner, byHand]);
    expect(r.status).toBe(200);
    expect(r.body.skipped.map((s: any) => s.authUserId)).toEqual([authUserId]);
    expect((await team(c.id)).find((m) => m.email === email)).toMatchObject({ name: 'By Hand', role: 'admin', source: null, active: true, canLogin: true });

    // And never acts for Roof Lee: not a lead, not a pause.
    expect((await write(c, 'POST', '/leads', { name: 'Pat Hollis', acting: { authUserId, role: 'owner' } })).status).toBe(403);
    const paused = await sisterSend(base, { method: 'DELETE', path: `${companies}/${c.roofliId}`, json: { roofliCompanyId: c.roofliId, mode: 'pause', acting: { authUserId, role: 'owner' } }, version: 2, headers: { 'idempotency-key': randomUUID() } });
    expect(paused.status).toBe(403);
    const [row] = await runAsSystem('test', () => db.select().from(schema.companies).where(eq(schema.companies.id, c.id)));
    expect(row.status).not.toBe('paused');
  });

  it('leaves the original company exactly as before: its team, its sign-in and its reps\' books by JobTread name', async () => {
    const original = await createCompany({ slug: `${tag}-cedar-exteriors`, name: 'Cedar Falls Exteriors', status: 'active' });
    made.push(original.id);
    const email = (who: string) => `${tag}-orig-${who}-${randomUUID().slice(0, 6)}@example.test`;
    const people = { owner: email('owner'), rep: email('rep'), rep2: email('rep2') };
    await runAsCompany(original.id, () => db.insert(schema.teamMembers).values([
      { name: 'Owner Cedar', email: people.owner, role: 'admin', canLogin: true, jobtreadSalesRep: 'Owner Cedar' },
      { name: 'Rep Cedar', email: people.rep, role: 'sales', canLogin: true, jobtreadSalesRep: 'Rep Cedar' },
      { name: 'Rep Two', email: people.rep2, role: 'sales', canLogin: true, jobtreadSalesRep: 'Rep Two' },
    ]));
    const hash = await hashPassword(PASSWORD);
    for (const e of Object.values(people)) await runAsCompany(original.id, () => setPasswordHash(e, hash));
    const jt = (n: string) => `jt-${tag}-${n}`;
    await runAsCompany(original.id, () => db.insert(schema.leads).values([
      { externalId: jt('a'), firstName: 'Pat', lastName: 'Hollis', stage: 'New Lead', jtSalesRep: 'Rep Cedar', source: 'jobtread' },
      { externalId: jt('b'), firstName: 'Jo', lastName: 'Burst', stage: 'New Lead', jtSalesRep: 'Rep Two', source: 'jobtread' },
    ]));
    const before = await team(original.id);

    // Roof Lee sends lists for a company it made, sales roles included. The original company is not touched.
    const c = await make();
    await putTeam(c, [c.owner]);
    await putTeam(c, [c.owner, c.leader, c.rep]);
    expect(await team(original.id)).toEqual(before);

    // Its people sign in by email as before, with the roles Archie holds for them.
    const repIn = await signInByEmail(people.rep);
    expect(repIn.status).toBe(200);
    expect((await get('/whoami', repIn.cookie)).body.user).toEqual({ email: people.rep, name: 'Rep Cedar', role: 'sales', companyId: original.id });
    // And a rep still sees only the jobs JobTread names them on.
    expect((await get('/api/sales', repIn.cookie)).body.jobs.map((j: any) => j.externalId)).toEqual([jt('a')]);
    const ownerIn = await signInByEmail(people.owner);
    expect((await get('/api/sales', ownerIn.cookie)).body.jobs.map((j: any) => j.externalId).sort()).toEqual([jt('a'), jt('b')]);

    await runAsSystem('test cleanup', async () => {
      await db.delete(schema.leads).where(and(eq(schema.leads.companyId, original.id), inArray(schema.leads.externalId, [jt('a'), jt('b')])));
    });
  });
});
