/**
 * Leads made in Archie for a company Roof Lee made (it keeps its own jobs:
 * server/production/native-jobs.ts), through the real request path: session,
 * company, route, database.
 *
 * What must hold:
 *   - the lead is kept in Archie only: nothing is asked of JobTread, KynexPro,
 *     the Google calendar or any other outside system;
 *   - it gets its job key at once and sits in New Lead, so it can be opened
 *     and shows on the Sales board;
 *   - someone who could not otherwise see it (a rep, a sales leader) owns it,
 *     a crew member never does, and a lead nobody owns waits on the
 *     Assignments page for a manager to give to a salesperson;
 *   - Roof Lee is still told (lead.created);
 *   - every other company, the original JobTread company included, behaves
 *     exactly as before.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';

/** Every outside system a lead could reach, watched. */
const calls = vi.hoisted(() => ({ jobtread: [] as string[], kynexPro: [] as string[], calendar: [] as string[] }));

vi.mock('../../integrations/jobtread', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../integrations/jobtread')>();
  class JobTreadClient {
    constructor() { calls.jobtread.push('new'); }
    async createLead() { calls.jobtread.push('createLead'); return { ok: true, jobId: `jt-${randomUUID().slice(0, 12)}` }; }
    async setJobSalesRep() { calls.jobtread.push('setJobSalesRep'); return { ok: true }; }
    async setJobStage() { calls.jobtread.push('setJobStage'); return { ok: true }; }
    async paveQuery() { calls.jobtread.push('paveQuery'); return {}; }
  }
  return { ...real, JobTreadClient };
});
vi.mock('../../integrations/gohighlevel', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../integrations/gohighlevel')>();
  class GoHighLevelClient {
    constructor() { calls.kynexPro.push('new'); }
    async createContact() { calls.kynexPro.push('createContact'); return { contact: { id: 'ghl-1' } }; }
  }
  return { ...real, GoHighLevelClient };
});
vi.mock('../../integrations/google-workspace', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../integrations/google-workspace')>();
  return {
    ...real,
    getDelegatedCalendar: (mailbox: string) => {
      calls.calendar.push(mailbox);
      return { events: { insert: async () => ({ data: { id: 'evt-1' } }) } };
    },
  };
});
vi.mock('../../sync/calendar-sync', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../sync/calendar-sync')>();
  return { ...real, syncCalendar: async () => { calls.calendar.push('sync'); return {}; } };
});
// The send that follows the answer is not run: the outbox row is what is checked.
vi.mock('@vercel/functions', () => ({ waitUntil: () => {} }));

const url = process.env.DATABASE_URL || '';
const localDb = /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url);

describe.skipIf(!localDb)('leads made in Archie for a company that keeps its own jobs', async () => {
  const { db } = await import('../../db');
  const schema = await import('../../../shared/schema');
  const { and, eq } = await import('drizzle-orm');
  const { runAsCompany, runAsSystem } = await import('../../tenant/context');
  const { createCompany } = await import('../../tenant/companies');
  const { tenantFromSession } = await import('../../tenant/middleware');
  const { clearSessionRevalidationCache } = await import('../../auth/middleware');
  const { registerWriteRoutes } = await import('../../writes/routes');
  const { registerSalesRoutes } = await import('../../sales/routes');
  const { registerAssignmentRoutes } = await import('../../access/assignment-routes');
  const { registerCanvassRoutes } = await import('../../canvass/routes');
  const { ownsLead } = await import('../../access/rep-scope');
  const { isNativeJobId } = await import('../native-jobs');
  const { SISTER_SECRET_ENV } = await import('../../sister/door');
  const { EVENTS_URL_ENV } = await import('../../sister/events');

  const tag = `native-lead-${process.pid}-${Date.now()}`;
  /** Roof Lee's address for news, here: nothing listens, and nothing needs to. */
  const ROOF_LEE = 'http://127.0.0.1:9';
  type Role = 'admin' | 'customer_service' | 'sales' | 'manager' | 'production';
  interface Person { id: number; email: string; name: string; role: Role }
  interface Co { id: string; people: Record<string, Person> }

  let server: Server;
  let base = '';
  let sessionUser: Record<string, unknown> | undefined;
  let outside: string[] = [];
  let native: Co;
  let original: Co;

  async function company(name: string, roofLee: boolean, people: Array<[string, Role, string | null]>): Promise<Co> {
    const c = await createCompany({ slug: `${tag}-${name.toLowerCase().replace(/\W+/g, '-')}`, name, status: 'active' });
    if (roofLee) await runAsSystem('test: a company Roof Lee made', () => db.update(schema.companies).set({ roofliCompanyId: randomUUID() }).where(eq(schema.companies.id, c.id)));
    const made: Record<string, Person> = {};
    for (const [key, role, repName] of people) {
      const email = `${tag}-${c.id.slice(0, 8)}-${key}@example.test`;
      const display = `${key[0].toUpperCase()}${key.slice(1)} ${name.split(' ')[0]}`;
      const [row] = await runAsCompany(c.id, () => db.insert(schema.teamMembers).values({ name: display, email, role, canLogin: true, active: true, jobtreadSalesRep: repName }).returning());
      made[key] = { id: row.id, email, name: display, role };
    }
    return { id: c.id, people: made };
  }

  beforeAll(async () => {
    native = await company('Summit Ridge Roofing', true, [
      ['owner', 'admin', null], ['office', 'customer_service', null], ['rep', 'sales', null],
      ['rep2', 'sales', null], ['leader', 'manager', null], ['crew', 'production', null],
    ]);
    original = await company('Cedar Falls Exteriors', false, [
      ['owner', 'admin', 'Owner Cedar'], ['rep', 'sales', 'Rep Cedar'],
    ]);

    const app = express();
    app.use(express.json());
    app.use((req: any, _res, next) => {
      req.session = { user: sessionUser, destroy: (cb: () => void) => { req.session.user = undefined; cb(); } };
      next();
    });
    app.use(tenantFromSession);
    registerWriteRoutes(app);
    registerSalesRoutes(app);
    registerAssignmentRoutes(app);
    registerCanvassRoutes(app);
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => { server?.close(); });

  beforeEach(() => {
    calls.jobtread.length = 0; calls.kynexPro.length = 0; calls.calendar.length = 0;
    // The link is on, so lead.created is written to the outbox (and never sent: waitUntil is a stand-in).
    process.env[SISTER_SECRET_ENV] = 'native-lead-test-secret';
    process.env[EVENTS_URL_ENV] = ROOF_LEE;
    const real = globalThis.fetch;
    outside = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation((input: any, init?: any) => {
      const u = String(typeof input === 'string' || input instanceof URL ? input : input.url);
      // News for Roof Lee is the one thing that may go out; it is checked in the outbox.
      if (!u.startsWith(base) && !u.startsWith(ROOF_LEE)) outside.push(u);
      return real(input, init);
    });
  });
  afterEach(() => {
    delete process.env[SISTER_SECRET_ENV];
    delete process.env[EVENTS_URL_ENV];
    vi.restoreAllMocks();
  });

  const as = (c: Co, who: string) => {
    clearSessionRevalidationCache();
    const p = c.people[who];
    sessionUser = { email: p.email, name: p.name, role: p.role, companyId: c.id };
    return p;
  };
  const post = async (path: string, body: unknown) => {
    const r = await fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: r.status, body: await r.json().catch(() => null) as any };
  };
  const get = async (path: string) => {
    const r = await fetch(`${base}${path}`);
    return { status: r.status, body: await r.json().catch(() => null) as any };
  };
  const leadByKey = async (c: Co, key: string) =>
    (await runAsCompany(c.id, () => db.select().from(schema.leads).where(eq(schema.leads.externalId, key))))[0];
  const ownersOf = (c: Co, key: string) =>
    runAsCompany(c.id, () => db.select().from(schema.repAssignments).where(eq(schema.repAssignments.jobExternalId, key)));
  const logFor = (c: Co, targetId: string) =>
    runAsCompany(c.id, () => db.select().from(schema.writeLog).where(eq(schema.writeLog.targetId, targetId)));
  const newsAbout = (c: Co, leadId: number) =>
    runAsCompany(c.id, () => db.select().from(schema.outboundEvents).where(eq(schema.outboundEvents.dedupeKey, `lead.created:${leadId}`)));
  const sees = (c: Co, who: string, key: string) => {
    const p = c.people[who];
    return runAsCompany(c.id, () => ownsLead({ email: p.email, name: p.name, role: p.role }, key));
  };
  const nothingLeftArchie = () => {
    expect(calls.jobtread).toEqual([]);
    expect(calls.kynexPro).toEqual([]);
    expect(calls.calendar).toEqual([]);
    expect(outside).toEqual([]);
  };

  describe('the lead form', () => {
    it('keeps a rep\'s new lead in Archie: its own key, New Lead, the rep\'s, logged, told to Roof Lee, nothing outside', async () => {
      const rep = as(native, 'rep');
      const r = await post('/api/leads/create', {
        firstName: 'Pat', lastName: 'Hollis', phone: '(319) 555-0142', email: 'pat@example.test',
        address: '12 Main St', city: 'Cedar Falls', state: 'IA', notes: 'Hail on the north slope.',
      });
      expect(r.status).toBe(200);
      expect(r.body.ok).toBe(true);
      expect(isNativeJobId(r.body.jobId)).toBe(true);
      const key = r.body.jobId as string;

      const lead = await leadByKey(native, key);
      expect(lead).toMatchObject({
        id: r.body.id, source: 'archie', externalId: key, stage: 'New Lead', status: 'new',
        firstName: 'Pat', lastName: 'Hollis', city: 'Cedar Falls', notes: 'Hail on the north slope.',
        enteredBy: rep.email, jtSalesRep: null,
        // The whole name, the same as the page's customer, so no stray first name shows under it.
        jobName: 'Pat Hollis',
      });

      const owners = await ownersOf(native, key);
      expect(owners).toEqual([expect.objectContaining({ teamMemberId: rep.id, role: 'primary' })]);

      const log = await logFor(native, key);
      expect(log).toEqual([expect.objectContaining({ actor: rep.email, system: 'archie', action: 'create_lead', ok: true })]);
      expect(await newsAbout(native, lead.id)).toEqual([expect.objectContaining({ type: 'lead.created' })]);
      nothingLeftArchie();

      // The rep opens it and sees it on the Sales board; another rep and the crew do not.
      expect(await sees(native, 'rep', key)).toBe(true);
      const board = await get('/api/sales');
      expect(board.status).toBe(200);
      expect(board.body.jobs.map((j: any) => j.externalId)).toContain(key);
      expect(board.body.jobs.find((j: any) => j.externalId === key)).toMatchObject({ jtStage: 'New Lead', source: 'archie' });
      expect(await sees(native, 'rep2', key)).toBe(false);
      expect(await sees(native, 'crew', key)).toBe(false);
      as(native, 'rep2');
      expect((await get('/api/sales')).body.jobs.map((j: any) => j.externalId)).not.toContain(key);
    });

    it('makes a sales leader\'s new lead theirs, so they can open it', async () => {
      const leader = as(native, 'leader');
      const r = await post('/api/leads/create', { firstName: 'Lee', lastName: 'Brandt', phone: '319-555-0199' });
      expect(r.status).toBe(200);
      expect(await ownersOf(native, r.body.jobId)).toEqual([expect.objectContaining({ teamMemberId: leader.id, role: 'primary' })]);
      expect(await sees(native, 'leader', r.body.jobId)).toBe(true);
      nothingLeftArchie();
    });

    it('gives the lead to the salesperson a leader picked on the form', async () => {
      as(native, 'owner');
      const r = await post('/api/leads/create', { firstName: 'Jo', lastName: 'Ames', phone: '319-555-0110', salesRep: native.people.rep2.name });
      expect(r.status).toBe(200);
      expect(await ownersOf(native, r.body.jobId)).toEqual([expect.objectContaining({ teamMemberId: native.people.rep2.id, role: 'primary' })]);
      expect(await sees(native, 'rep2', r.body.jobId)).toBe(true);
      nothingLeftArchie();
    });

    it('a rep cannot file a lead under another rep', async () => {
      const rep = as(native, 'rep');
      const r = await post('/api/leads/create', { firstName: 'Kit', phone: '319-555-0111', salesRep: native.people.rep2.name });
      expect(r.status).toBe(200);
      expect(await ownersOf(native, r.body.jobId)).toEqual([expect.objectContaining({ teamMemberId: rep.id, role: 'primary' })]);
    });

    it('leaves office staff\'s new lead with no owner, waiting on the Assignments page', async () => {
      as(native, 'office');
      const r = await post('/api/leads/create', { firstName: 'Ray', lastName: 'Okafor', email: 'ray@example.test' });
      expect(r.status).toBe(200);
      const key = r.body.jobId as string;
      expect(isNativeJobId(key)).toBe(true);
      expect(await ownersOf(native, key)).toEqual([]);
      expect(await sees(native, 'office', key)).toBe(true); // office sees every customer
      as(native, 'owner');
      const waiting = await get('/api/assignments/unassigned');
      expect(waiting.status).toBe(200);
      expect(waiting.body.jobs.map((j: any) => j.externalId)).toContain(key);
      nothingLeftArchie();
    });

    it('never makes a crew member the owner of a lead they add', async () => {
      as(native, 'crew');
      const r = await post('/api/leads/create', { firstName: 'Cam', phone: '319-555-0123' });
      expect(r.status).toBe(200);
      expect(await ownersOf(native, r.body.jobId)).toEqual([]);
      expect(await sees(native, 'crew', r.body.jobId)).toBe(false);
      nothingLeftArchie();
    });

    it('does not book yet: the lead is made, the calendar is not touched, and the answer says so plainly', async () => {
      as(native, 'rep');
      const r = await post('/api/leads/create', {
        firstName: 'Dee', phone: '319-555-0177',
        appointment: { date: '2026-12-01', time: '09:00', type: 'Inspection', forEmail: native.people.rep2.email },
      });
      expect(r.status).toBe(200);
      expect(isNativeJobId(r.body.jobId)).toBe(true);
      expect(r.body.appointment).toEqual({ ok: false, error: 'Booking is not available for your company yet.' });
      // Booking on rep2's calendar would have handed rep2 the lead; with no booking it stays the rep's.
      expect(await ownersOf(native, r.body.jobId)).toEqual([expect.objectContaining({ teamMemberId: native.people.rep.id, role: 'primary' })]);
      nothingLeftArchie();
    });

    it('does not book an existing job Archie keeps either: refused plainly, the calendar is not touched', async () => {
      as(native, 'rep');
      const key = (await post('/api/leads/create', { firstName: 'Ella', lastName: 'Booker', phone: '319-555-0178' })).body.jobId as string;
      const r = await post(`/api/clients/${key}/appointment`, { date: '2026-12-01', time: '10:00', type: 'Inspection', forEmail: native.people.rep.email });
      expect(r).toEqual({ status: 409, body: { error: 'Booking is not available for your company yet.' } });
      nothingLeftArchie();

      // The original JobTread company still books its jobs on the calendar, as before.
      const jt = `jt-${randomUUID().slice(0, 12)}`;
      await runAsCompany(original.id, () => db.insert(schema.leads).values({ source: 'jobtread', externalId: jt, firstName: 'Old Booker', jtSalesRep: 'Rep Cedar', stage: 'New Lead', status: 'new' } as any));
      as(original, 'rep');
      const booked = await post(`/api/clients/${jt}/appointment`, { date: '2026-12-01', time: '10:00', type: 'Inspection' });
      expect(booked.status).toBe(200);
      expect(booked.body).toMatchObject({ ok: true, eventId: 'evt-1' });
      expect(calls.calendar.length).toBeGreaterThan(0);
    });

    it('still checks what was typed', async () => {
      as(native, 'rep');
      expect((await post('/api/leads/create', { lastName: 'Only' })).status).toBe(400);
      expect((await post('/api/leads/create', { firstName: 'Pat', phone: 'call me' })).status).toBe(400);
      nothingLeftArchie();
    });

    it('is unchanged for the original JobTread company: JobTread and KynexPro are still asked, nothing is told to Roof Lee', async () => {
      const owner = as(original, 'owner');
      const r = await post('/api/leads/create', { firstName: 'Sam', lastName: 'Reyes', phone: '319-555-0150', email: 'sam@example.test' });
      expect(r.status).toBe(200);
      expect(calls.jobtread).toEqual(['new', 'createLead']);
      expect(calls.kynexPro).toEqual(['new', 'createContact']);
      expect(r.body).toMatchObject({ ok: true, jobtread: 'created', ghl: 'created' });
      expect(r.body.jobId).toMatch(/^jt-/);
      const lead = await leadByKey(original, r.body.jobId);
      expect(lead).toMatchObject({ source: 'jobtread', stage: 'New Lead', jtSalesRep: 'Owner Cedar', enteredBy: owner.email });
      expect(await ownersOf(original, r.body.jobId)).toEqual([]);
      expect(await logFor(original, r.body.jobId)).toEqual([expect.objectContaining({ system: 'jobtread', action: 'create_lead' })]);
      expect(await newsAbout(original, lead.id)).toEqual([]);
      // No lead of this company is ever given a key of Archie's own.
      const own = await runAsCompany(original.id, () => db.select().from(schema.leads).where(and(eq(schema.leads.companyId, original.id), eq(schema.leads.source, 'archie'))));
      expect(own).toEqual([]);
    });
  });

  describe('a canvassed door turned into a lead', () => {
    const door = (c: Co, createdBy: string, over: Record<string, unknown> = {}) =>
      runAsCompany(c.id, async () => (await db.insert(schema.canvassProperties).values({
        address: '48 Ridge Rd', city: 'Cedar Falls', state: 'IA', zip: '50613', ownerName: 'Morgan Lee Tate',
        phone: '319-555-0188', email: 'morgan@example.test', status: 'interested', createdBy, ...over,
      } as any).returning())[0]);
    const doorRow = async (c: Co, id: number) =>
      (await runAsCompany(c.id, () => db.select().from(schema.canvassProperties).where(eq(schema.canvassProperties.id, id))))[0];

    it('keeps the lead in Archie, owned by the rep whose door it is, and converts a door once', async () => {
      const rep = as(native, 'rep');
      const d = await door(native, rep.email);
      const r = await post(`/api/canvass/${d.id}/convert`, {});
      expect(r.status).toBe(200);
      expect(r.body.ok).toBe(true);
      expect(isNativeJobId(r.body.externalId)).toBe(true);
      const key = r.body.externalId as string;

      expect(await doorRow(native, d.id)).toMatchObject({ leadExternalId: key, status: 'appointment' });
      const lead = await leadByKey(native, key);
      expect(lead).toMatchObject({
        source: 'archie', stage: 'New Lead', status: 'new', firstName: 'Morgan', lastName: 'Lee Tate',
        address: '48 Ridge Rd', city: 'Cedar Falls', state: 'IA', zip: '50613', phone: '319-555-0188', email: 'morgan@example.test',
        enteredBy: rep.email,
      });
      expect(await ownersOf(native, key)).toEqual([expect.objectContaining({ teamMemberId: rep.id, role: 'primary', source: 'canvass' })]);
      expect(await logFor(native, key)).toEqual([expect.objectContaining({ actor: rep.email, system: 'archie', action: 'canvass_convert', ok: true })]);
      expect(await newsAbout(native, lead.id)).toEqual([expect.objectContaining({ type: 'lead.created' })]);
      expect(await sees(native, 'rep', key)).toBe(true);
      nothingLeftArchie();

      // Again: the same lead, no second one.
      const again = await post(`/api/canvass/${d.id}/convert`, {});
      expect(again.body).toEqual({ ok: true, alreadyConverted: true, externalId: key });
      const made = await runAsCompany(native.id, () => db.select().from(schema.leads).where(eq(schema.leads.address, '48 Ridge Rd')));
      expect(made.filter((l) => l.externalId === key)).toHaveLength(1);
    });

    it('a door nobody who sells owns becomes a lead nobody owns yet, for a manager to assign', async () => {
      const office = as(native, 'office');
      const d = await door(native, office.email, { address: '7 Elm Ct', ownerName: null });
      const r = await post(`/api/canvass/${d.id}/convert`, {});
      expect(r.status).toBe(200);
      const key = r.body.externalId as string;
      expect(await leadByKey(native, key)).toMatchObject({ source: 'archie', firstName: null, jobName: '7 Elm Ct', address: '7 Elm Ct' });
      expect(await ownersOf(native, key)).toEqual([]);
      as(native, 'owner');
      expect((await get('/api/assignments/unassigned')).body.jobs.map((j: any) => j.externalId)).toContain(key);
      nothingLeftArchie();
    });

    it('is unchanged for the original JobTread company: JobTread makes the lead, the sync brings it in', async () => {
      const rep = as(original, 'rep');
      const d = await door(original, rep.email, { address: '90 Oak Ave' });
      const r = await post(`/api/canvass/${d.id}/convert`, {});
      expect(r.status).toBe(200);
      expect(r.body.externalId).toMatch(/^jt-/);
      expect(calls.jobtread).toEqual(['new', 'createLead']);
      expect(await doorRow(original, d.id)).toMatchObject({ leadExternalId: r.body.externalId, status: 'appointment' });
      expect(await leadByKey(original, r.body.externalId)).toBeUndefined();
      expect(await logFor(original, r.body.externalId)).toEqual([expect.objectContaining({ system: 'jobtread', action: 'canvass_convert' })]);
    });
  });

  describe('giving a lead to a salesperson (the Assignments page)', () => {
    it('lists a lead nobody owns, offers everyone who can own jobs, and works out nothing from JobTread', async () => {
      as(native, 'office');
      const key = (await post('/api/leads/create', { firstName: 'Una', lastName: 'Signed', phone: '319-555-0161' })).body.jobId as string;
      as(native, 'owner');
      calls.jobtread.length = 0;

      const list = await get('/api/assignments/unassigned');
      expect(list.body.jobs.find((j: any) => j.externalId === key)).toMatchObject({ customerName: 'Una Signed', backend: 'archie' });

      const r = await get('/api/assignments/suggestions?limit=60');
      expect(r.status).toBe(200);
      const job = r.body.jobs.find((j: any) => j.externalId === key);
      expect(job).toMatchObject({ backend: 'archie', suggestion: { primary: null, confidence: 'low' } });
      // Nobody here has a JobTread rep name, and every salesperson can still be picked. Never office staff or a crew.
      const offered = r.body.reps.map((p: any) => p.teamMemberId).sort();
      const { owner, rep, rep2, leader } = native.people;
      expect(offered).toEqual([owner.id, rep.id, rep2.id, leader.id].sort());
      expect(r.body.reps.find((p: any) => p.teamMemberId === rep.id)).toMatchObject({ repName: rep.name, isFieldRep: true });
      nothingLeftArchie();
    });

    it('lists a lead Roof Lee added, so a manager can give it to a salesperson', async () => {
      const { createLead } = await import('../../sister/leads');
      const office = native.people.office;
      const made = await runAsCompany(native.id, () => createLead(
        { id: office.id, email: office.email, name: office.name, role: 'customer_service', heldRole: 'customer_service', authUserId: randomUUID() },
        { name: 'Yara From Roof Lee', town: 'Cedar Falls' } as any, undefined,
      ));
      const row = (await runAsCompany(native.id, () => db.select().from(schema.leads).where(eq(schema.leads.id, Number((made.body as any).leadId)))))[0];
      expect(isNativeJobId(row.externalId)).toBe(true);
      as(native, 'owner');
      expect((await get('/api/assignments/unassigned')).body.jobs.find((j: any) => j.externalId === row.externalId)).toMatchObject({ backend: 'archie', stage: 'New Lead' });
      expect((await post('/api/assignments', { jobExternalId: row.externalId, primaryTeamMemberId: native.people.rep.id })).status).toBe(200);
      expect(await sees(native, 'rep', row.externalId!)).toBe(true);
      nothingLeftArchie();
    });

    it('gives the lead to a salesperson, who then sees it, with nothing sent to JobTread', async () => {
      as(native, 'office');
      const key = (await post('/api/leads/create', { firstName: 'Vic', lastName: 'Handed', phone: '319-555-0162' })).body.jobId as string;
      expect(await sees(native, 'rep2', key)).toBe(false);
      const boss = as(native, 'owner');
      const r = await post('/api/assignments', { jobExternalId: key, primaryTeamMemberId: native.people.rep2.id, secondaryTeamMemberIds: [native.people.rep.id] });
      expect(r.status).toBe(200);
      expect(await ownersOf(native, key)).toEqual(expect.arrayContaining([
        expect.objectContaining({ teamMemberId: native.people.rep2.id, role: 'primary' }),
        expect.objectContaining({ teamMemberId: native.people.rep.id, role: 'secondary' }),
      ]));
      expect(await sees(native, 'rep2', key)).toBe(true);
      expect(await sees(native, 'rep', key)).toBe(true);
      expect(await sees(native, 'crew', key)).toBe(false);
      as(native, 'rep2');
      expect((await get('/api/sales')).body.jobs.map((j: any) => j.externalId)).toContain(key);
      const log = await logFor(native, key);
      expect(log).toEqual(expect.arrayContaining([expect.objectContaining({ actor: boss.email, system: 'app', action: 'assign_rep', ok: true })]));
      expect(log.filter((l) => l.system === 'jobtread')).toEqual([]);
      // No longer waiting on the Assignments page.
      as(native, 'owner');
      expect((await get('/api/assignments/unassigned')).body.jobs.map((j: any) => j.externalId)).not.toContain(key);
      nothingLeftArchie();
    });

    it('sends nothing to JobTread even when the new owner has a JobTread rep name filled in', async () => {
      const leader = native.people.leader;
      await runAsCompany(native.id, () => db.update(schema.teamMembers).set({ jobtreadSalesRep: 'Leader Summit' }).where(eq(schema.teamMembers.id, leader.id)));
      try {
        as(native, 'office');
        const key = (await post('/api/leads/create', { firstName: 'Xan', phone: '319-555-0163' })).body.jobId as string;
        as(native, 'owner');
        expect((await post('/api/assignments', { jobExternalId: key, primaryTeamMemberId: leader.id })).status).toBe(200);
        expect(await ownersOf(native, key)).toEqual([expect.objectContaining({ teamMemberId: leader.id, role: 'primary' })]);
        expect((await logFor(native, key)).filter((l) => l.system === 'jobtread')).toEqual([]);
        nothingLeftArchie();
      } finally {
        await runAsCompany(native.id, () => db.update(schema.teamMembers).set({ jobtreadSalesRep: null }).where(eq(schema.teamMembers.id, leader.id)));
      }
    });

    it('never makes a crew member (or anyone who cannot own jobs) an owner or sharer, because owning a job opens its money', async () => {
      as(native, 'office');
      const key = (await post('/api/leads/create', { firstName: 'Yul', lastName: 'Crewless', phone: '319-555-0164' })).body.jobId as string;
      as(native, 'owner');
      for (const body of [
        { jobExternalId: key, primaryTeamMemberId: native.people.crew.id },
        { jobExternalId: key, primaryTeamMemberId: native.people.rep.id, secondaryTeamMemberIds: [native.people.crew.id] },
        { jobExternalId: key, primaryTeamMemberId: native.people.office.id },
      ]) {
        const r = await post('/api/assignments', body);
        expect(r.status).toBe(400);
        expect(r.body.error).toBe('Only people who sell can own or share a job.');
      }
      expect(await ownersOf(native, key)).toEqual([]);
      expect(await sees(native, 'crew', key)).toBe(false);
      // A salesperson is still accepted.
      expect((await post('/api/assignments', { jobExternalId: key, primaryTeamMemberId: native.people.rep.id })).status).toBe(200);
      nothingLeftArchie();
    });

    it('is unchanged for the original JobTread company: evidence from JobTread, only people with a JobTread rep name, and the rep written back', async () => {
      const jt = `jt-${randomUUID().slice(0, 12)}`;
      await runAsCompany(original.id, () => db.insert(schema.leads).values({ source: 'jobtread', externalId: jt, firstName: 'Wes', lastName: 'Older', stage: 'New Lead', status: 'new' } as any));
      as(original, 'owner');
      const r = await get('/api/assignments/suggestions?limit=60');
      expect(r.status).toBe(200);
      expect(r.body.jobs.find((j: any) => j.externalId === jt)).toMatchObject({ backend: 'jobtread' });
      expect(calls.jobtread).toContain('paveQuery');
      expect(r.body.reps.map((p: any) => p.repName).sort()).toEqual(['Owner Cedar', 'Rep Cedar']);

      calls.jobtread.length = 0;
      const a = await post('/api/assignments', { jobExternalId: jt, primaryTeamMemberId: original.people.rep.id });
      expect(a.status).toBe(200);
      expect(calls.jobtread).toEqual(['new', 'setJobSalesRep']);
      expect(await logFor(original, jt)).toEqual(expect.arrayContaining([expect.objectContaining({ system: 'jobtread', action: 'set_sales_rep' })]));
    });
  });
});
