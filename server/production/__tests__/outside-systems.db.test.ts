/**
 * Outside systems are never reached for a company Roof Lee made (it keeps its
 * own jobs: server/production/native-jobs.ts), through the real request path:
 * session, company, route, database.
 *
 * Every JobTread and KynexPro client is replaced by one whose every method
 * throws, and every request leaving Archie is refused and recorded. Then a
 * job Archie keeps is made, noted, corrected, checked before construction,
 * walked through, inspected, given a follow-up and given a rep, and its
 * photos, commission statement, report and insurance letter are touched:
 * not one client is made and not one request leaves. A company Roof Lee made
 * cannot connect other job software or KynexPro, takes in no KynexPro
 * contact, and holds no connection to either.
 *
 * Every other company, the original JobTread company included, behaves
 * exactly as before: the same steps still reach JobTread.
 *
 * The list of every place that makes one of these clients, with what it does
 * for such a job, is outside-systems.test.ts.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomBytes, randomUUID } from 'node:crypto';

/**
 * Every JobTread and KynexPro client, watched. In 'throw' mode every method
 * throws (nothing may be called at all); in 'ok' mode each answers like the
 * real one would on success, for the companies that still use them.
 */
const calls = vi.hoisted(() => {
  const state = { jobtread: [] as string[], kynexPro: [] as string[], mode: 'throw' as 'throw' | 'ok' };
  const answers: Record<string, (...args: any[]) => unknown> = {
    addJobComment: () => ({ ok: true, id: 'c-1' }),
    setJobSalesRep: () => ({ ok: true }),
    setJobStage: () => ({ ok: true }),
    getJobFiles: () => ({ files: [], total: 0 }),
    uploadJobFile: () => ({ ok: true, fileId: 'jt-file-1' }),
    getJobInsurance: () => ({}),
    createLead: () => ({ ok: true, jobId: `jt-${Math.random().toString(16).slice(2, 14)}` }),
    createContact: () => ({ contact: { id: 'ghl-1' } }),
  };
  const watched = (kind: 'jobtread' | 'kynexPro') => class {
    constructor() {
      state[kind].push('new');
      return new Proxy(this, {
        get: (_target, prop) => {
          if (typeof prop !== 'string' || prop === 'then') return undefined;
          return (...args: unknown[]) => {
            state[kind].push(prop);
            if (state.mode === 'throw') throw new Error(`${kind}.${prop} must not be called for a job Archie keeps`);
            const answer = answers[prop];
            return Promise.resolve(answer ? answer(...args) : { ok: true, success: true });
          };
        },
      });
    }
  };
  return { state, watched };
});

vi.mock('../../integrations/jobtread', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../integrations/jobtread')>();
  return { ...real, JobTreadClient: calls.watched('jobtread') };
});
vi.mock('../../integrations/gohighlevel', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../integrations/gohighlevel')>();
  return { ...real, GoHighLevelClient: calls.watched('kynexPro') };
});
vi.mock('@vercel/functions', () => ({ waitUntil: () => {} }));
vi.mock('../../seed', () => ({ seedCompany: async () => {}, seedAll: async () => {}, SEED_JOB: 'seed-company', seedVersion: () => 'test' }));

const url = process.env.DATABASE_URL || '';
const localDb = /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url);

describe.skipIf(!localDb)('outside systems for a company Roof Lee made', async () => {
  const { db } = await import('../../db');
  const schema = await import('../../../shared/schema');
  const { and, eq } = await import('drizzle-orm');
  const { runAsCompany, runAsSystem } = await import('../../tenant/context');
  const { createCompany } = await import('../../tenant/companies');
  const { tenantFromSession } = await import('../../tenant/middleware');
  const { clearProfileCache } = await import('../../tenant/profile');
  const { clearSessionRevalidationCache } = await import('../../auth/middleware');
  const { registerRoutes } = await import('../../routes');
  const { isNativeJobId, OTHER_JOB_SOFTWARE_SOON, NATIVE_PHOTOS_SOON, NATIVE_SEND_ELSEWHERE_SOON, KYNEXPRO_IS_ROOF_LEES, COMPANYCAM_NOT_FOR_YOU, NATIVE_STATEMENT_NOT_FILED } = await import('../native-jobs');
  const { handleGhlNewContact } = await import('../../integrations/ghl/new-contact');
  const { resolveJobTreadCredentials } = await import('../../integrations/jobtread-connection');
  const { companyCamConnectionStatus } = await import('../../integrations/companycam-connection');
  const { ghlConnection, clearGhlConnectionCache } = await import('../../integrations/ghl/connection');
  const { clearCompanyCredentialsCache } = await import('../../tenant/company-credentials');
  const { PRECON_CHECKLIST_FIELDS } = await import('../../../shared/preconstruction-checklist');
  const { WALKTHROUGH_FIELDS } = await import('../../../shared/final-walkthrough');
  const { INSPECTION_FORM_FIELDS } = await import('../../../shared/inspection-form');

  const tag = `outside-${process.pid}-${Date.now()}`;
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
    if (roofLee) {
      await runAsSystem('test: a company Roof Lee made', () => db.update(schema.companies).set({ roofliCompanyId: randomUUID() }).where(eq(schema.companies.id, c.id)));
      clearProfileCache(c.id);
    }
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
    // The Roof Lee company's rep carries a JobTread rep name on purpose: even
    // then, nothing about its own jobs is sent to JobTread.
    native = await company('Summit Ridge Roofing', true, [
      ['owner', 'admin', null], ['office', 'customer_service', null], ['rep', 'sales', 'Rep Summit'], ['crew', 'production', null],
    ]);
    original = await company('Cedar Falls Exteriors', false, [
      ['owner', 'admin', 'Owner Cedar'], ['rep', 'sales', 'Rep Cedar'],
    ]);

    const app = express();
    app.use(express.json({ limit: '10mb' }));
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
    calls.state.jobtread.length = 0; calls.state.kynexPro.length = 0; calls.state.mode = 'throw';
    const real = globalThis.fetch;
    outside = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation((input: any, init?: any) => {
      const u = String(typeof input === 'string' || input instanceof URL ? input : input.url);
      if (!u.startsWith(base)) { outside.push(u); return Promise.reject(new Error('no outside calls in tests')); }
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
  const put = (path: string, body: unknown) => send('PUT', path, body);

  const nothingLeftArchie = () => {
    expect(calls.state.jobtread).toEqual([]);
    expect(calls.state.kynexPro).toEqual([]);
    expect(outside).toEqual([]);
  };
  const leadByKey = async (c: Co, key: string) =>
    (await runAsCompany(c.id, () => db.select().from(schema.leads).where(eq(schema.leads.externalId, key))))[0];

  /** Every required answer filled, the way a person finishing the form would. */
  type Field = { name: string; type: string; options: string[] | null; isRequired: boolean; isReviewerField?: boolean };
  const filled = (fields: Field[], over: Record<string, unknown> = {}) => {
    const answers: Record<string, unknown> = {};
    for (const f of fields) {
      if (!f.isRequired || f.isReviewerField) continue;
      answers[f.name] = f.type === 'checkbox' ? true
        : f.type === 'photo' ? [{ fileId: 'photo-1', name: 'site.jpg' }]
          : f.type === 'verify' ? { state: 'ok' }
            : f.type === 'option' ? f.options![0]
              : f.type === 'date' ? '2026-11-19'
                : f.type === 'number' ? '24'
                  : f.type === 'signature' ? 'data:image/png;base64,iVBORw0KGgo='
                    : 'Summit Ridge test';
    }
    return { ...answers, ...over };
  };
  const firstVerify = (WALKTHROUGH_FIELDS as Field[]).find((f) => f.type === 'verify')!.name;
  /** A walkthrough with the homeowner there, so they sign it too. */
  const walked = (over: Record<string, unknown> = {}) => filled(WALKTHROUGH_FIELDS as Field[], {
    'Homeowner present': 'Yes', 'Homeowner signature': 'data:image/png;base64,iVBORw0KGgo=', ...over,
  });

  /** A fresh lead of the Roof Lee company, made on the lead form by its rep (so the rep owns it). */
  const nativeLead = async () => {
    as(native, 'rep');
    const r = await post('/api/leads/create', {
      firstName: 'Pat', lastName: 'Hollis', phone: '(319) 555-0142', email: 'pat@example.test',
      address: '12 Main St', city: 'Cedar Falls', state: 'IA',
    });
    expect(r.status).toBe(200);
    expect(isNativeJobId(r.body.jobId)).toBe(true);
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

  // ---------------------------------------------------------------- a job Archie keeps

  describe('a job Archie keeps', () => {
    it('is made, noted and corrected with no client made and nothing sent', async () => {
      const { key } = await nativeLead();
      expect((await post(`/api/jobs/${key}/note`, { message: 'Gate code 4411.' })).status).toBe(200);
      expect((await patch(`/api/leads/${key}/contact`, { phone: '319-555-0199' })).status).toBe(200);
      nothingLeftArchie();
    });

    it('finishes its pre-construction checklist without telling JobTread (A1-l)', async () => {
      const { key } = await nativeLead();
      const draft = await post('/api/preconstruction', { jobExternalId: key, answers: filled(PRECON_CHECKLIST_FIELDS as Field[]) });
      expect(draft.status).toBe(200);
      const done = await post(`/api/preconstruction/${draft.body.checklist.id}/submit`, {});
      expect(done.status).toBe(200);
      expect(done.body.checklist).toMatchObject({ status: 'submitted', jobtreadSyncedAt: null });
      nothingLeftArchie();
    });

    it('is walked through, and its issue becomes a follow-up kept in Archie (A1-l)', async () => {
      const { key } = await nativeLead();
      const draft = await post('/api/final-walkthrough', {
        jobExternalId: key, answers: walked({ [firstVerify]: { state: 'issue', note: 'Nails by the driveway.' } }),
      });
      expect(draft.status).toBe(200);
      const done = await post(`/api/final-walkthrough/${draft.body.walkthrough.id}/submit`, {});
      expect(done.status).toBe(200);
      expect(done.body).toMatchObject({ ok: true, followUps: 1 });
      expect(done.body.walkthrough).toMatchObject({ status: 'submitted', jobtreadSyncedAt: null });
      nothingLeftArchie();
    });

    it('is inspected without telling JobTread (A1-l)', async () => {
      const { key } = await nativeLead();
      const draft = await post('/api/inspections', { jobExternalId: key, answers: filled(INSPECTION_FORM_FIELDS as Field[]) });
      expect(draft.status).toBe(200);
      const done = await post(`/api/inspections/${draft.body.submission.id}/submit`, {});
      expect(done.status).toBe(200);
      expect(done.body.submission).toMatchObject({ status: 'submitted', jobtreadSyncedAt: null });
      nothingLeftArchie();
    });

    it('keeps a follow-up in Archie only (A1-l)', async () => {
      const { key } = await nativeLead();
      const r = await post('/api/follow-ups', { jobExternalId: key, clientName: 'Pat Hollis', note: 'Call back about the color.', dueDate: '2026-11-21' });
      expect(r.status).toBe(200);
      expect(r.body.followUp).toMatchObject({ jobExternalId: key, note: 'Call back about the color.' });
      nothingLeftArchie();
    });

    it('is given a rep without telling JobTread, even when the rep has a JobTread name (A1-l)', async () => {
      const { key } = await nativeLead();
      as(native, 'owner');
      const r = await post('/api/assignments', { jobExternalId: key, primaryTeamMemberId: native.people.rep.id });
      expect(r.status).toBe(200);
      const rows = await runAsCompany(native.id, () => db.select().from(schema.repAssignments).where(eq(schema.repAssignments.jobExternalId, key)));
      expect(rows).toEqual([expect.objectContaining({ teamMemberId: native.people.rep.id, role: 'primary' })]);
      nothingLeftArchie();
    });

    it('has no photos to list yet, and adding one is refused in plain words', async () => {
      const { key } = await nativeLead();
      expect(await get(`/api/clients/${key}/photos`)).toEqual({ status: 200, body: { photos: [], totalFiles: 0 } });
      expect(await get(`/api/clients/${key}/files`)).toEqual({ status: 200, body: { files: [], totalFiles: 0 } });
      const add = await post(`/api/clients/${key}/photos`, { base64: Buffer.from('not really a photo').toString('base64'), contentType: 'image/jpeg' });
      expect(add).toEqual({ status: 409, body: { error: NATIVE_PHOTOS_SOON } });
      nothingLeftArchie();
    });

    it('does not send a commission statement or a proposal to other job software', async () => {
      const { key } = await nativeLead();
      const [commission] = await runAsCompany(native.id, () => db.insert(schema.jobCommissions).values({ jobExternalId: key, jobName: 'Pat Hollis', createdBy: 'test' } as any).returning());
      as(native, 'owner');
      // Said for what was asked (saving the statement on the job), and pointing at Preview, which still opens it.
      expect(await post(`/api/job-commissions/${commission.id}/pdf`, {})).toEqual({ status: 409, body: { error: NATIVE_STATEMENT_NOT_FILED } });
      expect(NATIVE_STATEMENT_NOT_FILED).toMatch(/Preview/);
      expect(NATIVE_STATEMENT_NOT_FILED).not.toMatch(/job software|[—–]/);
      expect((await get(`/api/job-commissions/${commission.id}/pdf`)).status).toBe(200);
      as(native, 'rep');
      expect(await post(`/api/clients/${key}/reports/${randomUUID()}/to-jobtread`, {})).toEqual({ status: 409, body: { error: NATIVE_SEND_ELSEWHERE_SOON } });
      nothingLeftArchie();
    });

    it('reads its report context and insurance letter details from Archie alone', async () => {
      const { key } = await nativeLead();
      await runAsCompany(native.id, () => db.update(schema.leads).set({ insuranceClaim: true }).where(eq(schema.leads.externalId, key)));
      const ctx = await get(`/api/clients/${key}/report-context`);
      expect(ctx.status).toBe(200);
      expect(ctx.body.counts).toEqual({ photos: 0, files: 0, messages: 0, documents: 0, dailyLogs: 0 });
      const letter = await get(`/api/clients/${key}/insurance-letters/context`);
      expect(letter.status).toBe(200);
      expect(letter.body).toMatchObject({ insuranceJob: true, claimFound: false });
      nothingLeftArchie();
    });
  });

  // ---------------------------------------------------------------- the company itself

  describe('a company Roof Lee made', () => {
    it('takes in no KynexPro contact at all (A1-g)', async () => {
      const before = await runAsCompany(native.id, () => db.select().from(schema.leads));
      const contact = { id: `ghl-${randomUUID().slice(0, 8)}`, firstName: 'Jo', lastName: 'Marsh', phone: '(319) 555-0177', email: 'jo@example.test', tags: ['replacement'] };
      expect(await runAsCompany(native.id, () => handleGhlNewContact(contact))).toBe('roofli_company');
      // Even one Roof Lee tagged: the company is asked first.
      expect(await runAsCompany(native.id, () => handleGhlNewContact({ ...contact, tags: ['roofli'] }))).toBe('roofli_company');
      expect(await runAsCompany(native.id, () => db.select().from(schema.leads))).toHaveLength(before.length);
      nothingLeftArchie();
    });

    it('cannot connect other job software, CompanyCam or KynexPro, and is told so plainly, each in its own words (A1-m)', async () => {
      as(native, 'owner');
      expect(await put('/api/integrations/crm/connection', { provider: 'jobtread', grantKey: 'not-a-real-key' })).toEqual({ status: 409, body: { error: OTHER_JOB_SOFTWARE_SOON } });
      // CompanyCam is a photo tool and KynexPro is Roof Lee's: neither is job software, and neither is promised.
      expect(await put('/api/integrations/companycam/connection', { token: 'not-a-real-token' })).toEqual({ status: 409, body: { error: COMPANYCAM_NOT_FOR_YOU } });
      expect(await put('/api/integrations/ghl/connection', { locationId: 'abcdefghij12', token: 'not-a-real-token' })).toEqual({ status: 409, body: { error: KYNEXPRO_IS_ROOF_LEES } });
      for (const said of [KYNEXPRO_IS_ROOF_LEES, COMPANYCAM_NOT_FOR_YOU]) expect(said).not.toMatch(/soon|job software|[—–]/);
      expect(await runAsCompany(native.id, () => db.select().from(schema.companyIntegrations))).toEqual([]);
      nothingLeftArchie();
    });

    it('tells the screens that Roof Lee looks after its KynexPro, so nobody is asked to connect it', async () => {
      as(native, 'owner');
      const r = await get('/api/integrations/ghl/connection');
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({ connected: false, heldByRoofLee: true, webhook: null });
      // No webhook secret is made for a KynexPro Archie does not connect to.
      expect(await post('/api/integrations/ghl/webhook-secret/rotate', {})).toEqual({ status: 409, body: { error: KYNEXPRO_IS_ROOF_LEES } });
      const saved = process.env.ARCHIE_SECRETS_KEY;
      process.env.ARCHIE_SECRETS_KEY = randomBytes(32).toString('base64');
      try {
        as(original, 'owner');
        const before = await get('/api/integrations/ghl/connection');
        expect(before.status).toBe(200);
        expect(before.body).toMatchObject({ connected: false, heldByRoofLee: false, webhook: { header: 'x-webhook-secret' } });
        expect(before.body.webhook.secret).toEqual(expect.any(String));
      } finally {
        if (saved === undefined) delete process.env.ARCHIE_SECRETS_KEY; else process.env.ARCHIE_SECRETS_KEY = saved;
      }
      nothingLeftArchie();
    });

    it('holds no JobTread, CompanyCam or KynexPro connection, even pointed at the deployment\'s own keys', async () => {
      const saved = { owner: process.env.ARCHIE_ENV_CREDENTIALS_COMPANY_ID, jt: process.env.JOBTREAD_API_KEY, cc: process.env.COMPANYCAM_API_TOKEN };
      try {
        process.env.ARCHIE_ENV_CREDENTIALS_COMPANY_ID = native.id;
        process.env.JOBTREAD_API_KEY = 'not-a-key-for-tests';
        process.env.COMPANYCAM_API_TOKEN = 'not-a-token-for-tests';
        await runAsSystem('test: Roof Lee keeps the KynexPro location', () =>
          db.update(schema.companies).set({ ghlLocationId: `loc${randomUUID().replace(/-/g, '').slice(0, 20)}` }).where(eq(schema.companies.id, native.id)));
        clearCompanyCredentialsCache(native.id); clearGhlConnectionCache(native.id); clearProfileCache(native.id);
        await expect(runAsCompany(native.id, () => resolveJobTreadCredentials())).rejects.toMatchObject({ name: 'EnvCredentialsUnavailableError' });
        expect(await runAsCompany(native.id, () => companyCamConnectionStatus())).toEqual({ connected: false, source: null });
        await expect(runAsCompany(native.id, () => ghlConnection())).rejects.toMatchObject({ name: 'GhlNotConnectedError' });
      } finally {
        for (const [k, v] of [['ARCHIE_ENV_CREDENTIALS_COMPANY_ID', saved.owner], ['JOBTREAD_API_KEY', saved.jt], ['COMPANYCAM_API_TOKEN', saved.cc]] as const) {
          if (v === undefined) delete process.env[k]; else process.env[k] = v;
        }
        await runAsSystem('test: put the location back', () => db.update(schema.companies).set({ ghlLocationId: null }).where(eq(schema.companies.id, native.id)));
      }
      nothingLeftArchie();
    });
  });

  // ---------------------------------------------------------------- every other company

  describe('the original JobTread company, unchanged', () => {
    beforeEach(() => { calls.state.mode = 'ok'; });

    it('still copies the checklist, the walkthrough and the inspection to JobTread', async () => {
      const { key } = await jobTreadLead();
      as(original, 'rep');
      const precon = await post('/api/preconstruction', { jobExternalId: key, answers: filled(PRECON_CHECKLIST_FIELDS as Field[]) });
      expect((await post(`/api/preconstruction/${precon.body.checklist.id}/submit`, {})).status).toBe(200);
      const walk = await post('/api/final-walkthrough', { jobExternalId: key, answers: walked() });
      expect((await post(`/api/final-walkthrough/${walk.body.walkthrough.id}/submit`, {})).status).toBe(200);
      const insp = await post('/api/inspections', { jobExternalId: key, answers: filled(INSPECTION_FORM_FIELDS as Field[]) });
      expect((await post(`/api/inspections/${insp.body.submission.id}/submit`, {})).status).toBe(200);
      expect(calls.state.jobtread.filter((c) => c === 'addJobComment')).toHaveLength(3);
    });

    it('still mirrors a follow-up to JobTread and sends the primary rep\'s name there', async () => {
      const { key } = await jobTreadLead();
      as(original, 'rep');
      expect((await post('/api/follow-ups', { jobExternalId: key, note: 'Call back.' })).status).toBe(200);
      expect(calls.state.jobtread).toEqual(['new', 'addJobComment']);
      as(original, 'owner');
      expect((await post('/api/assignments', { jobExternalId: key, primaryTeamMemberId: original.people.rep.id })).status).toBe(200);
      expect(calls.state.jobtread).toEqual(['new', 'addJobComment', 'new', 'setJobSalesRep']);
    });

    it('still lists and adds photos, saves statements and sends proposals through JobTread', async () => {
      const { key } = await jobTreadLead();
      as(original, 'rep');
      expect(await get(`/api/clients/${key}/photos`)).toEqual({ status: 200, body: { photos: [], totalFiles: 0 } });
      const add = await post(`/api/clients/${key}/photos`, { base64: Buffer.from('a photo').toString('base64'), contentType: 'image/jpeg' });
      expect(add.status).toBe(200);
      expect(calls.state.jobtread).toEqual(['new', 'getJobFiles', 'new', 'uploadJobFile']);
      // The push is not refused: it goes on to look for the report.
      expect((await post(`/api/clients/${key}/reports/${randomUUID()}/to-jobtread`, {})).status).toBe(404);
      const [commission] = await runAsCompany(original.id, () => db.insert(schema.jobCommissions).values({ jobExternalId: key, jobName: 'Reyes Roof', createdBy: 'test' } as any).returning());
      as(original, 'owner');
      expect((await post(`/api/job-commissions/${commission.id}/pdf`, {})).status).toBe(200);
      expect(calls.state.jobtread.slice(-2)).toEqual(['new', 'uploadJobFile']);
    });

    it('can still connect its own job software, CompanyCam and KynexPro (the check goes to the provider)', async () => {
      as(original, 'owner');
      const crm = await put('/api/integrations/crm/connection', { provider: 'jobtread', grantKey: 'not-a-real-key' });
      expect(crm).toEqual({ status: 400, body: { error: 'Could not reach JobTread. Try again in a minute.' } });
      const cam = await put('/api/integrations/companycam/connection', { token: 'not-a-real-token' });
      expect(cam.status).toBe(400);
      expect(cam.body.error).not.toBe(OTHER_JOB_SOFTWARE_SOON);
      const kp = await put('/api/integrations/ghl/connection', { locationId: 'abcdefghij12', token: 'not-a-real-token' });
      expect(kp).toEqual({ status: 400, body: { error: 'Could not reach KynexPro. Try again in a minute.' } });
      expect(outside).toHaveLength(3);
    });

    it('still takes in a KynexPro contact as before', async () => {
      const contact = { id: `ghl-${randomUUID().slice(0, 8)}`, firstName: 'Jo', lastName: 'Marsh', email: 'jo.marsh@example.test', tags: ['replacement'] };
      // No marketing advisor in this company: the contact is looked at, and not a lead.
      expect(await runAsCompany(original.id, () => handleGhlNewContact(contact))).toBe('no_advisor');
      expect(await runAsCompany(original.id, () => handleGhlNewContact({ ...contact, tags: ['roofli'] }))).toBe('roofli');
    });
  });
});
