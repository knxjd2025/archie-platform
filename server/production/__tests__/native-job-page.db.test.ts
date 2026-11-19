/**
 * The job page for a job Archie keeps itself (a company Roof Lee made:
 * server/production/native-jobs.ts), through the real request path: session,
 * company, route, database.
 *
 * What must hold, with no JobTread, no KynexPro and no other outside system:
 *   - a note is kept in Archie (lead_notes), written to the company's log, and
 *     Roof Lee reads it like its own;
 *   - the phone and email are corrected on the lead itself, and logged;
 *   - the job page does not move the job: the Production board does (409);
 *   - an admin corrects the customer, job name, address, project manager and
 *     insurance-claim tick, and is told plainly that the claim details kept
 *     only in JobTread cannot be saved;
 *   - the client's messages are the job's notes, labelled by who wrote them;
 *   - the client page says which system keeps the job, whether the customer
 *     agreed to photos, and where the job sits on the Production board, and
 *     adds no money and nothing for a crew to see.
 * And every other company, the original JobTread company included, behaves
 * exactly as before.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';

/** Every outside system the job page could reach, watched. */
const calls = vi.hoisted(() => ({ jobtread: [] as string[], kynexPro: [] as string[] }));

vi.mock('../../integrations/jobtread', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../integrations/jobtread')>();
  class JobTreadClient {
    constructor() { calls.jobtread.push('new'); }
    async createLead() { calls.jobtread.push('createLead'); return { ok: true, jobId: `jt-${randomUUID().slice(0, 12)}` }; }
    async addJobComment() { calls.jobtread.push('addJobComment'); return { ok: true, id: 'c-1' }; }
    async updateJobContact() { calls.jobtread.push('updateJobContact'); return { ok: true }; }
    async setJobStage() { calls.jobtread.push('setJobStage'); return { ok: true }; }
    async updateJobAccount(_id: string, change: unknown) { calls.jobtread.push(`updateJobAccount:${JSON.stringify(change)}`); return { ok: true }; }
    async getJobCustomFieldDefs() { calls.jobtread.push('getJobCustomFieldDefs'); return [{ id: 'f1', name: 'Insurance Carrier', type: 'option', options: ['Acme Mutual'] }]; }
    async getJobInsurance() { calls.jobtread.push('getJobInsurance'); return { carrier: 'Acme Mutual' }; }
    async getJobComments() {
      calls.jobtread.push('getJobComments');
      return { comments: [{ id: 'c-9', message: 'Crew booked', createdAt: '2026-11-01T10:00:00Z', isFromEmail: false, author: 'Office', jobName: 'Reyes', accountName: 'Reyes' }] };
    }
  }
  return { ...real, JobTreadClient };
});
vi.mock('../../integrations/gohighlevel', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../integrations/gohighlevel')>();
  class GoHighLevelClient {
    constructor() { calls.kynexPro.push('new'); }
    async createContact() { calls.kynexPro.push('createContact'); return { contact: { id: 'ghl-1' } }; }
    async getContacts() { calls.kynexPro.push('getContacts'); return { contacts: [] }; }
  }
  return { ...real, GoHighLevelClient };
});
vi.mock('@vercel/functions', () => ({ waitUntil: () => {} }));

const url = process.env.DATABASE_URL || '';
const localDb = /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url);

describe.skipIf(!localDb)('the job page for a job Archie keeps itself', async () => {
  const { db } = await import('../../db');
  const schema = await import('../../../shared/schema');
  const { and, eq } = await import('drizzle-orm');
  const { runAsCompany, runAsSystem } = await import('../../tenant/context');
  const { createCompany } = await import('../../tenant/companies');
  const { tenantFromSession } = await import('../../tenant/middleware');
  const { clearSessionRevalidationCache } = await import('../../auth/middleware');
  const { registerRoutes } = await import('../../routes');
  const { getJob } = await import('../../sister/leads');
  const { isNativeJobId } = await import('../native-jobs');

  const tag = `native-page-${process.pid}-${Date.now()}`;
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
      ['rep2', 'sales', null], ['crew', 'production', null],
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
    registerRoutes(app);
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => { server?.close(); });

  beforeEach(() => {
    calls.jobtread.length = 0; calls.kynexPro.length = 0;
    const real = globalThis.fetch;
    outside = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation((input: any, init?: any) => {
      const u = String(typeof input === 'string' || input instanceof URL ? input : input.url);
      if (!u.startsWith(base)) outside.push(u);
      return real(input, init);
    });
  });
  afterEach(() => { vi.restoreAllMocks(); });

  const as = (c: Co, who: string) => {
    clearSessionRevalidationCache();
    const p = c.people[who];
    sessionUser = { email: p.email, name: p.name, role: p.role, companyId: c.id };
    return p;
  };
  const send = async (method: string, path: string, body?: unknown) => {
    const r = await fetch(`${base}${path}`, {
      method, headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: r.status, body: await r.json().catch(() => null) as any };
  };
  const get = (path: string) => send('GET', path);
  const post = (path: string, body: unknown) => send('POST', path, body);
  const patch = (path: string, body: unknown) => send('PATCH', path, body);

  const leadByKey = async (c: Co, key: string) =>
    (await runAsCompany(c.id, () => db.select().from(schema.leads).where(eq(schema.leads.externalId, key))))[0];
  const notesOf = (c: Co, leadId: number) =>
    runAsCompany(c.id, () => db.select().from(schema.leadNotes).where(eq(schema.leadNotes.leadId, leadId)));
  const logFor = (c: Co, targetId: string) =>
    runAsCompany(c.id, () => db.select().from(schema.writeLog).where(eq(schema.writeLog.targetId, targetId)));
  const nothingLeftArchie = () => {
    expect(calls.jobtread).toEqual([]);
    expect(calls.kynexPro).toEqual([]);
    expect(outside).toEqual([]);
  };

  /** A fresh lead of the Roof Lee company, made on the lead form by its rep (so the rep owns it). */
  const nativeLead = async (over: Record<string, unknown> = {}) => {
    as(native, 'rep');
    const r = await post('/api/leads/create', {
      firstName: 'Pat', lastName: 'Hollis', phone: '(319) 555-0142', email: 'pat@example.test',
      address: '12 Main St', city: 'Cedar Falls', state: 'IA', ...over,
    });
    expect(r.status).toBe(200);
    expect(isNativeJobId(r.body.jobId)).toBe(true);
    calls.jobtread.length = 0; calls.kynexPro.length = 0;
    return { key: r.body.jobId as string, id: r.body.id as number };
  };
  /** A lead of the original company, kept in JobTread, sold by its rep. */
  const jobTreadLead = async () => {
    const key = `jt-${randomUUID().slice(0, 12)}`;
    const [row] = await runAsCompany(original.id, () => db.insert(schema.leads).values({
      source: 'jobtread', externalId: key, firstName: 'Sam Reyes', jobName: 'Reyes Roof', phone: '319-555-0150',
      email: 'sam@example.test', stage: 'New Lead', status: 'new', jtSalesRep: 'Rep Cedar',
    } as any).returning());
    return { key, id: row.id };
  };

  describe('a note (A1-d)', () => {
    it('is kept in Archie with who wrote it, logged, and read by Roof Lee, with nothing sent anywhere', async () => {
      const { key, id } = await nativeLead();
      const rep = as(native, 'rep');
      const r = await post(`/api/jobs/${key}/note`, { message: 'Homeowner wants a call after 5.' });
      expect(r.status).toBe(200);
      expect(r.body).toEqual({ ok: true });
      expect(await notesOf(native, id)).toEqual([expect.objectContaining({
        text: 'Homeowner wants a call after 5.', author: rep.email, authorName: rep.name, system: 'archie',
      })]);
      expect(await logFor(native, key)).toEqual(expect.arrayContaining([
        expect.objectContaining({ actor: rep.email, system: 'archie', action: 'add_note', ok: true, summary: 'Homeowner wants a call after 5.' }),
      ]));
      nothingLeftArchie();
      // Roof Lee reads the job's notes from the same place.
      const seen = await runAsCompany(native.id, () => getJob(id, undefined));
      expect(seen?.notes.map((n) => n.text)).toEqual(['Homeowner wants a call after 5.']);
    });

    it('refuses an empty or overlong note, and anyone who may not open the job', async () => {
      const { key, id } = await nativeLead();
      as(native, 'rep');
      expect((await post(`/api/jobs/${key}/note`, { message: '   ' })).status).toBe(400);
      const long = await post(`/api/jobs/${key}/note`, { message: 'x'.repeat(2001) });
      expect(long.status).toBe(400);
      expect(long.body.error).toBe('A note can be at most 2000 characters.');
      as(native, 'rep2');
      expect((await post(`/api/jobs/${key}/note`, { message: 'Not mine.' })).status).toBe(404);
      as(native, 'crew');
      expect((await post(`/api/jobs/${key}/note`, { message: 'Crew note.' })).status).toBe(404);
      expect(await notesOf(native, id)).toEqual([]);
      nothingLeftArchie();
    });

    it('is unchanged for the original JobTread company: the note goes to JobTread', async () => {
      const { key, id } = await jobTreadLead();
      const rep = as(original, 'rep');
      const r = await post(`/api/jobs/${key}/note`, { message: 'Called, left a message.' });
      expect(r.status).toBe(200);
      expect(calls.jobtread).toEqual(['new', 'addJobComment']);
      expect(await notesOf(original, id)).toEqual([]);
      expect(await logFor(original, key)).toEqual([expect.objectContaining({ actor: rep.email, system: 'jobtread', action: 'add_note', ok: true })]);
    });
  });

  describe('the phone and email (A1-e)', () => {
    it('are corrected on the lead itself and logged, with nothing sent anywhere', async () => {
      const { key } = await nativeLead();
      const office = as(native, 'office');
      const r = await patch(`/api/leads/${key}/contact`, { phone: '319-555-0199', email: 'pat.hollis@example.test' });
      expect(r.status).toBe(200);
      expect(r.body).toEqual({ ok: true });
      expect(await leadByKey(native, key)).toMatchObject({ phone: '319-555-0199', email: 'pat.hollis@example.test' });
      expect(await logFor(native, key)).toEqual(expect.arrayContaining([
        expect.objectContaining({ actor: office.email, system: 'archie', action: 'update_contact', ok: true }),
      ]));
      nothingLeftArchie();
    });

    it('clears an email sent blank, and refuses one that does not look right, in plain words', async () => {
      const { key } = await nativeLead();
      as(native, 'rep');
      const badPhone = await patch(`/api/leads/${key}/contact`, { phone: 'call me' });
      expect(badPhone.status).toBe(400);
      expect(badPhone.body.error).toBe('That phone number doesn\'t look right.');
      const badEmail = await patch(`/api/leads/${key}/contact`, { email: 'pat at home' });
      expect(badEmail.status).toBe(400);
      expect(badEmail.body.error).toBe('That email address doesn\'t look right.');
      expect(await leadByKey(native, key)).toMatchObject({ phone: '(319) 555-0142', email: 'pat@example.test' });
      expect((await patch(`/api/leads/${key}/contact`, { email: '' })).status).toBe(200);
      expect(await leadByKey(native, key)).toMatchObject({ phone: '(319) 555-0142', email: null });
      nothingLeftArchie();
    });

    it('is refused to anyone who may not open the job', async () => {
      const { key } = await nativeLead();
      as(native, 'rep2');
      expect((await patch(`/api/leads/${key}/contact`, { phone: '319-555-0100' })).status).toBe(404);
      as(native, 'crew');
      expect((await patch(`/api/leads/${key}/contact`, { phone: '319-555-0100' })).status).toBe(404);
      expect(await leadByKey(native, key)).toMatchObject({ phone: '(319) 555-0142' });
      nothingLeftArchie();
    });

    it('is unchanged for the original JobTread company: JobTread first, then the lead', async () => {
      const { key } = await jobTreadLead();
      as(original, 'rep');
      const r = await patch(`/api/leads/${key}/contact`, { phone: '319-555-0151' });
      expect(r.status).toBe(200);
      expect(calls.jobtread).toEqual(['new', 'updateJobContact']);
      expect(await leadByKey(original, key)).toMatchObject({ phone: '319-555-0151' });
      expect(await logFor(original, key)).toEqual([expect.objectContaining({ system: 'jobtread', action: 'update_contact' })]);
    });
  });

  describe('the stage control on the job page (A1-f)', () => {
    it('does not move a job Archie keeps: that is the Production board\'s job', async () => {
      const { key } = await nativeLead();
      as(native, 'owner');
      const r = await post(`/api/production/${key}/stage`, { stage: 'Appt Set' });
      expect(r.status).toBe(409);
      expect(r.body).toEqual({ error: 'Move this job on the Production board.' });
      expect(await leadByKey(native, key)).toMatchObject({ stage: 'New Lead' });
      expect(await logFor(native, key)).toEqual([expect.objectContaining({ action: 'create_lead' })]);
      // Someone who may not open the job is still told there is no such job.
      as(native, 'rep2');
      expect((await post(`/api/production/${key}/stage`, { stage: 'Appt Set' })).status).toBe(404);
      nothingLeftArchie();
    });

    it('is unchanged for the original JobTread company: the stage is written to JobTread', async () => {
      const { key } = await jobTreadLead();
      as(original, 'owner');
      const r = await post(`/api/production/${key}/stage`, { stage: 'Appt Set' });
      expect(r.status).toBe(200);
      expect(r.body).toEqual({ ok: true, stage: 'Appt Set' });
      expect(calls.jobtread).toEqual(['new', 'setJobStage']);
      expect(await leadByKey(original, key)).toMatchObject({ stage: 'Appt Set' });
      expect(await logFor(original, key)).toEqual([expect.objectContaining({ system: 'jobtread', action: 'set_stage', ok: true })]);
    });
  });

  describe('an admin\'s corrections to the account (A1-i)', () => {
    it('saves the customer, job name, address, project manager and claim tick on the lead, logged, with nothing sent anywhere', async () => {
      const { key } = await nativeLead();
      const owner = as(native, 'owner');
      const r = await patch(`/api/clients/${key}/account`, {
        customer: 'Patricia  Ann Hollis', jobName: 'Hollis Roof', address: '14 Main St, Cedar Falls, IA 50613',
        fields: { projectManager: 'Office Summit', isClaim: true },
      });
      expect(r.status).toBe(200);
      expect(r.body).toEqual({ ok: true });
      expect(await leadByKey(native, key)).toMatchObject({
        firstName: 'Patricia', lastName: 'Ann Hollis', jobName: 'Hollis Roof',
        address: '14 Main St, Cedar Falls, IA 50613', city: 'Cedar Falls', state: 'IA', zip: '50613',
        projectManager: 'Office Summit', insuranceClaim: true,
      });
      expect(await logFor(native, key)).toEqual(expect.arrayContaining([
        expect.objectContaining({ actor: owner.email, system: 'archie', action: 'update_account', ok: true }),
      ]));
      // The page shows the whole name back.
      expect((await get(`/api/clients/${key}`)).body.lead.customer).toBe('Patricia Ann Hollis');
      nothingLeftArchie();
    });

    it('refuses the claim details only JobTread keeps, in plain words, and changes nothing', async () => {
      const { key } = await nativeLead();
      as(native, 'owner');
      const r = await patch(`/api/clients/${key}/account`, { jobName: 'New Name', fields: { carrier: 'Acme Mutual' } });
      expect(r.status).toBe(400);
      expect(r.body.error).toBe('Insurance details like the carrier, claim number and adjuster can\'t be saved for this job yet.');
      expect(await leadByKey(native, key)).toMatchObject({ jobName: 'Pat' });
      // Still checked like every other edit.
      expect((await patch(`/api/clients/${key}/account`, { color: 'red' })).status).toBe(400);
      nothingLeftArchie();
    });

    it('is still for admins only', async () => {
      const { key } = await nativeLead();
      as(native, 'office');
      expect((await patch(`/api/clients/${key}/account`, { jobName: 'Office Rename' })).status).toBe(403);
      as(native, 'crew');
      expect((await patch(`/api/clients/${key}/account`, { jobName: 'Crew Rename' })).status).toBe(403);
      expect(await leadByKey(native, key)).toMatchObject({ jobName: 'Pat' });
    });

    it('offers only the fields Archie can keep, and asks JobTread nothing', async () => {
      as(native, 'owner');
      const r = await get('/api/jobtread/account-fields');
      expect(r.status).toBe(200);
      expect(r.body.fields.map((f: any) => f.key)).toEqual(['projectManager', 'isClaim']);
      expect(r.body.fields.every((f: any) => Array.isArray(f.options) && f.options.length === 0)).toBe(true);
      nothingLeftArchie();
    });

    it('is unchanged for the original JobTread company: every field, written to JobTread first', async () => {
      const { key } = await jobTreadLead();
      as(original, 'owner');
      const fields = await get('/api/jobtread/account-fields');
      expect(fields.body.fields).toHaveLength(11);
      expect(calls.jobtread).toEqual(['new', 'getJobCustomFieldDefs']);
      calls.jobtread.length = 0;
      const r = await patch(`/api/clients/${key}/account`, { customer: 'Samuel Reyes', fields: { carrier: 'Acme Mutual' } });
      expect(r.status).toBe(200);
      expect(calls.jobtread).toEqual(['new', `updateJobAccount:${JSON.stringify({ customer: 'Samuel Reyes', customFields: { 'Insurance Carrier': 'Acme Mutual' } })}`]);
      expect(await leadByKey(original, key)).toMatchObject({ firstName: 'Samuel Reyes' });
      expect(await logFor(original, key)).toEqual([expect.objectContaining({ system: 'jobtread', action: 'update_account' })]);
    });
  });

  describe('the client\'s messages (A1-j)', () => {
    it('are the job\'s notes, newest first, labelled by who wrote them, with nothing asked of anyone outside', async () => {
      const { key, id } = await nativeLead();
      const rep = as(native, 'rep');
      await runAsCompany(native.id, () => db.insert(schema.leadNotes).values({
        leadId: id, text: 'Asked for a quote on gutters too.', author: native.people.office.email,
        authorName: native.people.office.name, system: 'roofli', createdAt: new Date(Date.now() - 60_000),
      }));
      expect((await post(`/api/jobs/${key}/note`, { message: 'Measured the back slope.' })).status).toBe(200);
      calls.jobtread.length = 0; calls.kynexPro.length = 0;

      const r = await get(`/api/clients/${key}/messages`);
      expect(r.status).toBe(200);
      expect(r.body.contactId).toBeNull();
      expect(r.body.ghlContactUrl).toBeNull();
      expect(r.body.messages).toEqual([
        expect.objectContaining({ source: 'archie', channel: 'note', label: 'Note', author: rep.name, body: `${rep.name}: Measured the back slope.` }),
        expect.objectContaining({ source: 'roofli', channel: 'note', label: 'From Roof Lee', author: native.people.office.name, body: `${native.people.office.name}: Asked for a quote on gutters too.` }),
      ]);
      expect(r.body.messages[0].date).toBeGreaterThan(r.body.messages[1].date);
      nothingLeftArchie();
    });

    it('are not shown to anyone who may not open the job', async () => {
      const { key } = await nativeLead();
      as(native, 'rep2');
      expect((await get(`/api/clients/${key}/messages`)).status).toBe(404);
      as(native, 'crew');
      expect((await get(`/api/clients/${key}/messages`)).status).toBe(404);
      nothingLeftArchie();
    });

    it('are unchanged for the original JobTread company: KynexPro and JobTread are asked, and Archie\'s notes are not mixed in', async () => {
      const { key, id } = await jobTreadLead();
      await runAsCompany(original.id, () => db.insert(schema.leadNotes).values({ leadId: id, text: 'Never shown here.', author: original.people.owner.email, system: 'archie' }));
      as(original, 'rep');
      const r = await get(`/api/clients/${key}/messages`);
      expect(r.status).toBe(200);
      expect(calls.jobtread).toEqual(['new', 'getJobComments']);
      expect(calls.kynexPro).toEqual(['new', 'getContacts']);
      expect(r.body.messages).toEqual([{ source: 'jobtread', channel: 'note', direction: 'outbound', body: 'Office: Crew booked', date: Date.parse('2026-11-01T10:00:00Z') }]);
    });
  });

  describe('the client page (A1-k)', () => {
    const OLD_LEAD_KEYS = [
      'externalId', 'customer', 'jobName', 'email', 'phone', 'address', 'addressLine', 'source', 'status', 'stage',
      'repName', 'sharedWith', 'projectManager', 'projectedValue', 'insuranceClaim', 'scheduleStart', 'scheduleEnd', 'createdAt',
    ];

    it('says Archie keeps the job, whether the customer agreed to photos and where it is on the board, and adds nothing else', async () => {
      const { key } = await nativeLead();
      const rep = as(native, 'rep');
      const r = await get(`/api/clients/${key}`);
      expect(r.status).toBe(200);
      expect(r.body.lead).toMatchObject({ externalId: key, customer: 'Pat Hollis', backend: 'archie', photoConsent: false, boardStage: null, repName: rep.name });
      expect(r.body.insurance).toEqual({});
      // The three new things and no more: no money is added.
      expect(Object.keys(r.body.lead).sort()).toEqual([...OLD_LEAD_KEYS, 'backend', 'photoConsent', 'boardStage'].sort());
      expect(Object.keys(r.body).sort()).toEqual(['documents', 'insurance', 'lead']);
      nothingLeftArchie();

      // Consent recorded and the job on the Production board: both show.
      expect((await post(`/api/production/${key}/photo-consent`, { agreed: true })).status).toBe(200);
      await runAsCompany(native.id, () => db.insert(schema.productionPipeline).values({ jobExternalId: key, stage: 'schedule' }));
      const after = await get(`/api/clients/${key}`);
      expect(after.body.lead).toMatchObject({ photoConsent: true, boardStage: { key: 'schedule', label: 'Schedule Job' } });
      nothingLeftArchie();
    });

    it('is still closed to a crew and to another rep', async () => {
      const { key } = await nativeLead();
      as(native, 'crew');
      expect((await get(`/api/clients/${key}`)).status).toBe(404);
      as(native, 'rep2');
      expect((await get(`/api/clients/${key}`)).status).toBe(404);
      nothingLeftArchie();
    });

    it('is unchanged for the original JobTread company, apart from saying JobTread keeps the job', async () => {
      const { key } = await jobTreadLead();
      await runAsCompany(original.id, () => db.insert(schema.productionPipeline).values({ jobExternalId: key, stage: 'install' }));
      as(original, 'rep');
      const r = await get(`/api/clients/${key}`);
      expect(r.status).toBe(200);
      expect(calls.jobtread).toEqual(['new', 'getJobInsurance']);
      expect(r.body.insurance).toEqual({ carrier: 'Acme Mutual' });
      expect(r.body.lead).toMatchObject({ externalId: key, customer: 'Sam Reyes', source: 'jobtread', backend: 'jobtread', repName: 'Rep Cedar' });
      expect(Object.keys(r.body.lead).sort()).toEqual([...OLD_LEAD_KEYS, 'backend'].sort());
    });
  });

  describe('"Start production" on the job page (A.3)', () => {
    const start = (key: string) => post(`/api/production/${key}/pipeline/stage`, { stage: 'approved' });
    const pipelineOf = async (c: Co, key: string) =>
      (await runAsCompany(c.id, () => db.select().from(schema.productionPipeline).where(eq(schema.productionPipeline.jobExternalId, key))))[0];

    it('puts a job Archie keeps on the Production board at Approved, and its status says so, with nothing sent anywhere', async () => {
      const { key } = await nativeLead();
      as(native, 'office');
      const r = await start(key);
      expect(r.status).toBe(200);
      expect(r.body.pipeline.stage).toBe('approved');
      expect((await pipelineOf(native, key))?.stage).toBe('approved');
      // The status the rest of Archie reads moves with it, as when Roof Lee puts the job on the board.
      expect((await leadByKey(native, key)).stage).toBe('Buyer Approved');

      const page = await get(`/api/clients/${key}`);
      expect(page.body.lead).toMatchObject({ stage: 'Buyer Approved', boardStage: { key: 'approved', label: 'Approved' } });
      const board = await get('/api/production');
      expect(board.body.jobs.map((j: any) => j.externalId)).toContain(key);
      nothingLeftArchie();
    });

    it('is harmless pressed twice', async () => {
      const { key } = await nativeLead();
      as(native, 'office');
      expect((await start(key)).status).toBe(200);
      const again = await start(key);
      expect(again.status).toBe(200);
      expect(again.body.pipeline.stage).toBe('approved');
      expect((await pipelineOf(native, key))?.history).toHaveLength(1);
      expect((await leadByKey(native, key)).stage).toBe('Buyer Approved');
      nothingLeftArchie();
    });

    it('is open to the rep who owns the job, and closed to a crew and to another rep', async () => {
      const { key } = await nativeLead();
      as(native, 'crew');
      expect((await start(key)).status).toBe(404);
      as(native, 'rep2');
      expect((await start(key)).status).toBe(404);
      expect(await pipelineOf(native, key)).toBeUndefined();
      expect((await leadByKey(native, key)).stage).toBe('New Lead');
      as(native, 'rep');
      expect((await start(key)).status).toBe(200);
      expect((await leadByKey(native, key)).stage).toBe('Buyer Approved');
      nothingLeftArchie();
    });

    it('is unchanged for the original JobTread company: the status is JobTread\'s, and a real move still writes to it', async () => {
      const { key } = await jobTreadLead();
      as(original, 'owner');
      const r = await start(key);
      expect(r.status).toBe(200);
      expect((await pipelineOf(original, key))?.stage).toBe('approved');
      // Put on the board where it stood: nothing is written, here or to JobTread, exactly as before.
      expect((await leadByKey(original, key)).stage).toBe('New Lead');
      expect(calls.jobtread).toEqual([]);

      const moved = await post(`/api/production/${key}/pipeline/stage`, { stage: 'waiting_dp' });
      expect(moved.status).toBe(200);
      expect(calls.jobtread).toEqual(['new', 'setJobStage']);
      expect((await leadByKey(original, key)).stage).toBe('Buyer Approved');
    });
  });

  describe('what the screens are told about the company (A.3)', () => {
    it('says a company Roof Lee made is one, for every person in it, so the lead form leaves booking out', async () => {
      for (const who of ['owner', 'office', 'rep', 'crew']) {
        as(native, who);
        const me = await get('/api/auth/me');
        expect(me.status).toBe(200);
        expect(me.body.profile).toMatchObject({ id: native.id, madeByRoofli: true });
      }
      nothingLeftArchie();
    });

    it('says the original JobTread company is not, so its screens are unchanged', async () => {
      for (const who of ['owner', 'rep']) {
        as(original, who);
        const me = await get('/api/auth/me');
        expect(me.status).toBe(200);
        expect(me.body.profile).toMatchObject({ id: original.id, madeByRoofli: false });
      }
    });
  });

  it('never gives the original company a lead of Archie\'s own', async () => {
    const own = await runAsCompany(original.id, () => db.select().from(schema.leads).where(and(eq(schema.leads.companyId, original.id), eq(schema.leads.source, 'archie'))));
    expect(own).toEqual([]);
  });
});
