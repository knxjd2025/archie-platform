/**
 * The roof report routes (Task B7), through a real request path (session,
 * company, switch, sign-in check) against the local test database as the app's
 * own role. The storm sources, the models and the photo store are fakes; every
 * request leaving the app is refused.
 *
 * Holds: every route is a bare 404 while the switch is off; the company comes
 * from the session alone; a report that is not yours, another company's,
 * archived or not there is the same "not found"; crew see nothing; an update
 * takes only the named fields; a failed run is a failed report with a plain
 * sentence and never the provider's words; archive keeps everything; the page
 * is built only by the escaped renderers and served in a sandbox.
 * Fictional company: Summit Ridge Roofing in Cedar Falls. Customer: Dana
 * Whitfield, dana@example.com, 12 Elm Street.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { setPhotoStoreForTests } from '../../photos/store';
import {
  CANT_CHANGE, GENERATE_FAILED, GEOCODE_FAILED, MAX_REPORTS_PER_DAY, NEEDS_ADDRESS, NOT_FOUND, NOTHING_TO_CHANGE, ONLY_FAILED_RETRY,
  PAGE_NOT_READY, PAGE_NOT_SAFE, STILL_BEING_MADE, STILL_BEING_MADE_EDIT, TOO_MANY_PHOTOS, TOO_MANY_RECENT, TOO_MANY_TODAY,
} from '../../../shared/roof-reports';
import { makeJpeg } from '../../photos/__tests__/jpeg-fixtures';
import { analysis, fakeStorm } from './fakes';
import { fakeStore, localDb, startRoofApp, type Co } from './harness';

vi.mock('@vercel/functions', () => ({ waitUntil: () => {} }));

const SECRET = 'sk-ant-api03-SECRET-provider-text-0123456789';

describe.skipIf(!localDb)('the roof report routes (database)', async () => {
  const tag = `rrroutes-${process.pid}-${Date.now()}`;
  const { registerRoofReportsRoutes } = await import('../routes');
  const { liveDeps } = await import('../generate');
  const { __resetRateLimits } = await import('../../lib/rate-limit');
  const { eq, sql } = await import('drizzle-orm');

  let behave: { storm?: () => Promise<any>; narrate?: () => Promise<any>; now?: () => Date } = {};
  const fakeDeps = (reportId: string) => ({
    ...liveDeps(reportId, { keys: {} }),
    storm: async () => (behave.storm ? behave.storm() : fakeStorm()),
    enhancedStorm: (() => ({ noaaEventPageUrls: [], nexradRadarImageUrls: [], countyStormDatabaseUrl: '', narratives: [], propertyProfile: null, hailSizeDistribution: {} })) as any,
    analyze: async () => analysis(),
    narrate: async () => (behave.narrate ? behave.narrate() : { findings: [{ id: 'finding-0', title: 'Missing shingles', severity: 'high', narrative: 'Shingles are missing.', relatedPhotoIds: [], repairAction: 'Replace', insuranceRelevant: true }], executiveSummary: 'A short summary.' }),
    label: async () => null,
    sleep: async () => {},
    now: () => (behave.now ? behave.now() : new Date()),
  });

  const h = await startRoofApp(tag, (app) => registerRoofReportsRoutes(app, { deps: fakeDeps }));
  const { db, schema, runAsCompany } = h;
  const store = fakeStore();
  const savedSwitch = process.env.ARCHIE_ROOF_REPORTS;
  let a: Co; let b: Co;
  const outside: string[] = [];

  const GOOD = { reportTypes: ['inspection', 'storm'], template: 'full', address: '12 Elm Street', city: 'Cedar Falls', state: 'IA', zip: '50613', customer: { name: 'Dana Whitfield', email: 'dana@example.com' }, roofDetails: { squares: 28, pitch: '6/12' } };
  const rowOf = (co: Co, id: string) => runAsCompany(co.id, async () => (await db.select().from(schema.roofReports).where(eq(schema.roofReports.id, id)))[0]);
  const countRows = (co: Co) => runAsCompany(co.id, async () => (await db.select({ n: sql<number>`count(*)::int` }).from(schema.roofReports))[0].n);

  async function make(co: Co, who: string, body: object = GOOD) {
    h.as(co, who);
    return h.post('/api/roof-reports/generate', body);
  }
  /** A report straight into the database: for the cases where how it got there is not the question. */
  async function seed(co: Co, over: Record<string, unknown> = {}) {
    const [r] = await runAsCompany(co.id, () => db.insert(schema.roofReports).values({
      address: '12 Elm Street', city: 'Cedar Falls', state: 'IA', reportTypes: ['inspection'], status: 'ready', ...over,
    } as any).returning());
    return r.id as string;
  }

  beforeAll(async () => {
    process.env.ARCHIE_ROOF_REPORTS = 'on';
    setPhotoStoreForTests(store);
    const real = globalThis.fetch;
    vi.spyOn(globalThis, 'fetch').mockImplementation((input: any, init?: any) => {
      const u = String(typeof input === 'string' || input instanceof URL ? input : input.url);
      if (!u.startsWith(h.base)) { outside.push(u); return Promise.reject(new Error('no outside calls in tests')); }
      return real(input, init);
    });
    a = await h.company('Summit Ridge Roofing', [['admin', 'admin'], ['csr', 'customer_service'], ['manager', 'manager'], ['repA', 'sales'], ['repB', 'sales'], ['crew', 'production'], ['limited', 'admin']]);
    b = await h.company('Cedar Falls Roofing Two', [['admin', 'admin'], ['repA', 'sales']]);
    await runAsCompany(a.id, async () => {
      await db.insert(schema.leads).values([
        { externalId: `${tag}-jobA`, source: 'jobtread', firstName: 'Dana', jtSalesRep: 'Rep repA' },
        { externalId: `${tag}-jobB`, source: 'jobtread', firstName: 'Lee', jtSalesRep: 'Rep repB' },
      ] as any);
    });
  });
  beforeEach(() => { __resetRateLimits(); });
  afterEach(() => { behave = {}; process.env.ARCHIE_ROOF_REPORTS = 'on'; setPhotoStoreForTests(store); });
  afterAll(async () => {
    vi.restoreAllMocks();
    setPhotoStoreForTests(null);
    if (savedSwitch === undefined) delete process.env.ARCHIE_ROOF_REPORTS; else process.env.ARCHIE_ROOF_REPORTS = savedSwitch;
    await h.close();
  });

  describe('the switch', () => {
    it('answers a bare 404 on every route while it is off, whoever asks and whatever they send', async () => {
      const id = await seed(a);
      process.env.ARCHIE_ROOF_REPORTS = 'off';
      h.as(a, 'admin');
      const photo = crypto.randomUUID();
      const calls: Array<[string, string, unknown?]> = [
        ['GET', '/api/roof-reports/status'], ['POST', '/api/roof-reports/photos'], ['GET', `/api/roof-reports/${id}/photos/${photo}/thumb`],
        ['GET', '/api/roof-reports/linked-photo/abc'], ['POST', '/api/roof-reports/generate', GOOD], ['GET', '/api/roof-reports'],
        ['GET', `/api/roof-reports/${id}`], ['PUT', `/api/roof-reports/${id}`, { title: 'x' }], ['POST', `/api/roof-reports/${id}/archive`],
        ['POST', `/api/roof-reports/${id}/retry`], ['GET', `/api/roof-reports/${id}/html`], ['GET', `/api/clients/${tag}-jobA/roof-reports`],
      ];
      for (const [method, path, body] of calls) {
        const r = await h.send(method, path, body);
        expect(r.status, `${method} ${path}`).toBe(404);
        expect(r.text, `${method} ${path}`).toBe('');
      }
      h.signedOut();
      expect((await h.get('/api/roof-reports')).status).toBe(404);
      expect(await rowOf(a, id)).toMatchObject({ status: 'ready' });
    });
  });

  describe('status', () => {
    it('says it is on, whether photos and analysis are available, and never which keys', async () => {
      h.as(a, 'repA');
      const r = await h.get('/api/roof-reports/status');
      expect(r.status).toBe(200);
      expect(r.body).toEqual({ on: true, photoStore: true, analysis: expect.any(Boolean) });
      expect(r.text).not.toMatch(/key|secret|GROQ|ANTHROPIC/i);
    });
  });

  describe('making a report', () => {
    it('makes one for the signed-in person\'s own company, from the session alone', async () => {
      const r = await make(a, 'repA', { ...GOOD, companyId: b.id, company_id: b.id, createdByMemberId: 1, status: 'archived', role: 'admin' });
      expect(r.status).toBe(200);
      expect(r.body).toEqual({ id: expect.any(String), status: 'ready', problem: null });
      const row = await rowOf(a, r.body.id);
      expect(row.companyId).toBe(a.id);
      expect(row.createdByMemberId).toBe(a.people.repA.id);
      expect(row.shareToken).toMatch(/^[0-9a-f]{64}$/);
      expect(row.status).toBe('ready');
      expect((row.reportJson as any).id).toBe(r.body.id);
      expect(Number(row.totalEstimate)).toBeGreaterThanOrEqual(0);
      expect(await rowOf(b, r.body.id)).toBeUndefined();
      expect(r.text).not.toContain(row.shareToken!);
    });

    it('puts the uploaded photos in the report, once, and shows them only by the app\'s own route', async () => {
      h.as(a, 'repA');
      const up = [await h.upload('/api/roof-reports/photos', makeJpeg({ exif: true })), await h.upload('/api/roof-reports/photos', makeJpeg())];
      const ids = up.map((u) => u.body.id as string);
      const r = await h.post('/api/roof-reports/generate', { ...GOOD, photoIds: [...ids, crypto.randomUUID()] });
      expect(r.status).toBe(200);
      const row = await rowOf(a, r.body.id);
      const photos = (row.reportJson as any).damageAnalysis.photos;
      expect(photos.map((p: any) => p.id)).toEqual(ids);
      expect(JSON.stringify(row.reportJson)).not.toMatch(/\/rr\/|c\/[0-9a-f-]{36}/);
      const attached = await runAsCompany(a.id, () => db.select().from(schema.roofReportPhotos).where(eq(schema.roofReportPhotos.reportId, r.body.id)));
      expect(attached.map((p) => p.id).sort()).toEqual([...ids].sort());
      // A second report cannot take the same photos.
      const again = await h.post('/api/roof-reports/generate', { ...GOOD, photoIds: ids });
      expect(again.status).toBe(200);
      expect((await rowOf(a, again.body.id) as any).reportJson.damageAnalysis.photos).toEqual([]);
    });

    it('says in plain words what is wrong with a request, and makes nothing', async () => {
      const before = await countRows(a);
      const cases: Array<[object, number, string]> = [
        [{ ...GOOD, address: '' }, 400, NEEDS_ADDRESS],
        [{ ...GOOD, photoIds: Array.from({ length: 41 }, () => crypto.randomUUID()) }, 400, TOO_MANY_PHOTOS],
      ];
      for (const [body, status, sentence] of cases) {
        const r = await make(a, 'repA', body);
        expect(r.status).toBe(status);
        expect(r.body).toEqual({ error: sentence });
      }
      expect(await countRows(a)).toBe(before);
    });

    it('answers a salesperson who names a job that is not theirs the same "not found", and makes nothing', async () => {
      const before = await countRows(a);
      for (const job of [`${tag}-jobB`, `${tag}-no-such-job`]) {
        const r = await make(a, 'repA', { ...GOOD, jobExternalId: job });
        expect(r.status).toBe(404);
        expect(r.body).toEqual({ error: NOT_FOUND });
      }
      expect(await countRows(a)).toBe(before);
      const own = await make(a, 'repA', { ...GOOD, jobExternalId: `${tag}-jobA` });
      expect(own.status).toBe(200);
      expect((await rowOf(a, own.body.id)).jobExternalId).toBe(`${tag}-jobA`);
      // The other company's job with the same key is nobody's here.
      const crossed = await make(b, 'admin', { ...GOOD, jobExternalId: `${tag}-jobA` });
      expect(crossed.status).toBe(404);
    });

    it('gives crew a 404 and makes nothing', async () => {
      const before = await countRows(a);
      const r = await make(a, 'crew');
      expect(r.status).toBe(404);
      expect(await countRows(a)).toBe(before);
    });

    it('answers a failed run with a plain sentence, leaves a failed report, and never says what the provider said', async () => {
      behave.storm = async () => { throw new Error(`upstream 500 ${SECRET} at /var/task/node_modules/x.js`); };
      const r = await make(a, 'repA');
      expect(r.status).toBe(422);
      expect(r.body.error).toBe(GEOCODE_FAILED);
      expect(r.text).not.toMatch(/sk-ant|upstream|node_modules|SECRET/);
      const failed = await runAsCompany(a.id, async () => (await db.select().from(schema.roofReports).where(eq(schema.roofReports.problem, GEOCODE_FAILED)))[0]);
      expect(failed.status).toBe('failed');
      expect(failed.reportJson && (failed.reportJson as any).property).toBeUndefined();
    });

    it('answers anything else that goes wrong with the one failure sentence, and leaves a failed report that is not ready', async () => {
      behave.now = () => { throw new Error(`password authentication failed for user archie_app ${SECRET}`); };
      const before = await countRows(a);
      const r = await make(a, 'repA');
      expect(r.status).toBe(500);
      expect(r.body).toEqual({ error: GENERATE_FAILED, id: expect.any(String) });
      expect(r.text).not.toMatch(/password|archie_app|sk-ant|SECRET/);
      expect(await countRows(a)).toBe(before + 1);
      const row = await runAsCompany(a.id, async () => (await db.select().from(schema.roofReports).orderBy(sql`created_at desc`).limit(1))[0]);
      expect(row.status).toBe('failed');
      expect(row.problem).toBe(GENERATE_FAILED);
      // A model that throws is not fatal at all: the report is made without its narrative.
      behave = { narrate: async () => { throw new Error(SECRET); } };
      const ok = await make(a, 'repA');
      expect(ok.status).toBe(200);
      expect(ok.text).not.toContain(SECRET);
    });

    it('limits one person to forty reports in ten minutes, and a company to a day\'s worth', async () => {
      __resetRateLimits();
      h.as(a, 'limited');
      let last: any;
      for (let i = 0; i < 41; i++) last = await h.post('/api/roof-reports/generate', { ...GOOD, address: '' });
      expect(last.status).toBe(429);
      expect(last.body).toEqual({ error: TOO_MANY_RECENT });
      __resetRateLimits();
      const c = await h.company('Daily Cap Roofing', [['admin', 'admin']]);
      await runAsCompany(c.id, async () => {
        await db.insert(schema.roofReports).values(Array.from({ length: MAX_REPORTS_PER_DAY }, () => ({ address: '1 Oak Road', reportTypes: ['storm'], status: 'ready' })) as any);
      });
      const capped = await make(c, 'admin');
      expect(capped.status).toBe(429);
      expect(capped.body).toEqual({ error: TOO_MANY_TODAY });
      // Another company is not affected.
      expect((await make(a, 'repA')).status).toBe(200);
      __resetRateLimits();
    });

    it('logs the report id and nothing about the customer or the address', async () => {
      const r = await make(a, 'repA');
      const rows = await runAsCompany(a.id, async () => (await db.execute(sql`select * from write_log where target_id = ${r.body.id}`)).rows as any[]);
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect(row.action).toMatch(/^roof_report/);
        expect(`${row.summary} ${row.error ?? ''}`).not.toMatch(/Elm|Dana|dana@|Cedar|50613/);
      }
    });
  });

  describe('the list', () => {
    let ids: Record<string, string>;
    beforeAll(async () => {
      const mine = (key: string) => a.people[key].id;
      ids = {
        jobA: await seed(a, { title: 'Elm job', jobExternalId: `${tag}-jobA`, createdByMemberId: mine('csr') }),
        jobB: await seed(a, { title: 'Bravo job', jobExternalId: `${tag}-jobB`, createdByMemberId: mine('csr'), reportTypes: ['storm'] }),
        addrA: await seed(a, { title: 'Alpha address', createdByMemberId: mine('repA') }),
        failed: await seed(a, { title: 'Broken one', status: 'failed', problem: GENERATE_FAILED, createdByMemberId: mine('repA') }),
        archived: await seed(a, { title: 'Old one', status: 'archived', createdByMemberId: mine('repA') }),
      };
    });
    const list = async (co: Co, who: string, qs = '') => { h.as(co, who); return h.get(`/api/roof-reports${qs}`); };
    const titles = (r: any) => r.body.reports.map((x: any) => x.title);

    it('shows a person what the role rules say they may see, newest first, and not the archived', async () => {
      const admin = await list(a, 'admin', '?search=job');
      expect(admin.status).toBe(200);
      expect(titles(admin).sort()).toEqual(['Bravo job', 'Elm job']);
      const all = titles(await list(a, 'admin'));
      for (const t of ['Elm job', 'Bravo job', 'Alpha address', 'Broken one']) expect(all).toContain(t);
      expect(all).not.toContain('Old one');
      expect(titles(await list(a, 'repA', '?search=job'))).toEqual(['Elm job']);
      expect(titles(await list(a, 'repB', '?search=job'))).toEqual(['Bravo job']);
      expect(titles(await list(a, 'manager', '?search=alpha'))).toEqual([]);
      const rep = await list(a, 'repA');
      expect(titles(rep)).toContain('Alpha address');
      expect(titles(rep)).not.toContain('Bravo job');
    });

    it('answers crew with a 404, and another company with only its own', async () => {
      expect((await list(a, 'crew')).status).toBe(404);
      const other = await list(b, 'admin');
      expect(other.status).toBe(200);
      expect(other.body.reports).toEqual([]);
    });

    it('lists archived reports only to a role that sees everything, and only when asked', async () => {
      expect(titles(await list(a, 'admin', '?status=archived'))).toContain('Old one');
      expect(titles(await list(a, 'csr', '?status=archived'))).toContain('Old one');
      expect(titles(await list(a, 'admin', '?status=archived'))).not.toContain('Elm job');
      expect((await list(a, 'repA', '?status=archived')).body.reports).toEqual([]);
      expect((await list(a, 'manager', '?status=archived')).body.reports).toEqual([]);
    });

    it('filters by kind, by state and by what was typed, and pages', async () => {
      expect(titles(await list(a, 'admin', '?kind=storm&search=bravo'))).toEqual(['Bravo job']);
      expect(titles(await list(a, 'admin', '?status=failed'))).toContain('Broken one');
      expect(titles(await list(a, 'admin', '?status=failed'))).not.toContain('Elm job');
      expect(titles(await list(a, 'admin', '?search=%25'))).toEqual([]);
      const c = await h.company('Paging Roofing', [['admin', 'admin']]);
      await runAsCompany(c.id, async () => { await db.insert(schema.roofReports).values(Array.from({ length: 30 }, (_, i) => ({ address: `${i + 1} Oak Road`, reportTypes: ['storm'], status: 'ready' })) as any); });
      const p1 = await list(c, 'admin');
      const p2 = await list(c, 'admin', '?page=2');
      expect(p1.body.reports).toHaveLength(25);
      expect(p1.body).toMatchObject({ page: 1, hasMore: true, total: 30 });
      expect(p2.body.reports).toHaveLength(5);
      expect(p2.body.hasMore).toBe(false);
    });

    it('answers each row with what a list needs and nothing that names the company, a token or a key', async () => {
      const r = await list(a, 'admin');
      const row = r.body.reports.find((x: any) => x.title === 'Elm job');
      expect(Object.keys(row).sort()).toEqual(['address', 'city', 'createdAt', 'customerName', 'id', 'jobExternalId', 'problem', 'reportTypes', 'status', 'template', 'title', 'totalEstimate']);
      expect(r.text).not.toMatch(/shareToken|share_token|company_id|companyId|reportJson/);
    });

    it('lists a job\'s reports after the same check that opens the job, and 404s the rest', async () => {
      h.as(a, 'repA');
      const own = await h.get(`/api/clients/${tag}-jobA/roof-reports`);
      expect(own.status).toBe(200);
      expect(titles(own)).toContain('Elm job');
      expect(titles(own)).not.toContain('Bravo job');
      expect((await h.get(`/api/clients/${tag}-jobB/roof-reports`)).status).toBe(404);
      h.as(a, 'crew');
      expect((await h.get(`/api/clients/${tag}-jobA/roof-reports`)).status).toBe(404);
      h.as(b, 'admin');
      expect((await h.get(`/api/clients/${tag}-jobA/roof-reports`)).status).toBe(404);
    });
  });

  describe('opening one report', () => {
    it('hands the report to the people who may see it, with its photos, and no token', async () => {
      h.as(a, 'repA');
      const up = await h.upload('/api/roof-reports/photos', makeJpeg());
      const made = await h.post('/api/roof-reports/generate', { ...GOOD, photoIds: [up.body.id] });
      for (const who of ['repA', 'admin', 'csr']) {
        h.as(a, who);
        const r = await h.get(`/api/roof-reports/${made.body.id}`);
        expect(r.status, who).toBe(200);
        expect(r.body).toMatchObject({ id: made.body.id, status: 'ready', address: '12 Elm Street', customerName: 'Dana Whitfield', template: 'full' });
        expect(r.body.report.id).toBe(made.body.id);
        expect(r.body.photos).toEqual([{ id: up.body.id, category: null, position: 0, url: `/api/roof-reports/${made.body.id}/photos/${up.body.id}/working`, thumbUrl: `/api/roof-reports/${made.body.id}/photos/${up.body.id}/thumb` }]);
        expect(r.text).not.toMatch(/shareToken|share_token|companyId|company_id|legacy/);
        expect(r.text).not.toMatch(/\/rr\//);
      }
    });

    it('answers "not found" to anyone else, in the same words, whatever the reason', async () => {
      const id = await seed(a, { jobExternalId: `${tag}-jobA` });
      const archived = await seed(a, { status: 'archived' });
      const unseen: Array<[Co, string, string]> = [
        [a, 'repB', id], [a, 'crew', id], [b, 'admin', id], [b, 'repA', id], [a, 'admin', archived], [a, 'admin', crypto.randomUUID()], [a, 'admin', 'not-an-id'], [a, 'admin', '../etc/passwd'],
      ];
      for (const [co, who, target] of unseen) {
        h.as(co, who);
        const r = await h.get(`/api/roof-reports/${target}`);
        expect(r.status, `${who} ${target}`).toBe(404);
        expect(r.text).not.toMatch(/Elm|Dana|shareToken/);
      }
    });

    it('shows a report that was left generating for over eight minutes as failed, and one still running as running', async () => {
      const running = await seed(a, { status: 'generating' });
      const stale = await seed(a, { status: 'generating' });
      await runAsCompany(a.id, () => db.execute(sql`update roof_reports set updated_at = now() - interval '9 minutes' where id = ${stale}`));
      h.as(a, 'admin');
      expect((await h.get(`/api/roof-reports/${running}`)).body).toMatchObject({ status: 'generating', problem: null, report: null });
      expect((await h.get(`/api/roof-reports/${stale}`)).body).toMatchObject({ status: 'failed', problem: GENERATE_FAILED, report: null });
    });
  });

  describe('changing a report', () => {
    let id = '';
    beforeAll(async () => { id = (await make(a, 'repA')).body.id; });
    const put = (co: Co, who: string, target: string, body: unknown) => { h.as(co, who); return h.put(`/api/roof-reports/${target}`, body); };

    it('changes the named fields and nothing else', async () => {
      const r = await put(a, 'repA', id, { title: 'Roof report for Dana', customerPhone: '555 0142', inspectorNotes: 'Wet ladder.', template: 'insurance', visualStyle: 'presentation', inspectionDate: '2026-11-20' });
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({ id, title: 'Roof report for Dana', customerPhone: '555 0142', template: 'insurance', visualStyle: 'presentation' });
      const row = await rowOf(a, id);
      expect(row).toMatchObject({ title: 'Roof report for Dana', inspectorNotes: 'Wet ladder.', template: 'insurance', visualStyle: 'presentation', status: 'ready', companyId: a.id });
      expect(row.inspectionDate?.toISOString().slice(0, 10)).toBe('2026-11-20');
    });

    it('refuses any field it was not told it may change, with a plain sentence, and changes nothing', async () => {
      const before = await rowOf(a, id);
      for (const body of [{ title: 'x', companyId: b.id }, { status: 'archived' }, { shareToken: 'abc' }, { createdByMemberId: 1 }, { address: '1 Oak Road' }, { reportTypes: ['storm'] }, { id: crypto.randomUUID() }]) {
        const r = await put(a, 'repA', id, body);
        expect(r.status, JSON.stringify(body)).toBe(400);
        expect(r.body).toEqual({ error: CANT_CHANGE });
      }
      expect((await put(a, 'repA', id, {})).body).toEqual({ error: NOTHING_TO_CHANGE });
      expect(await rowOf(a, id)).toEqual(before);
    });

    it('stores an edited report with every figure a number, the photos only its own, and the id its own', async () => {
      const up = await (async () => { h.as(a, 'repA'); return h.upload('/api/roof-reports/photos', makeJpeg()); })();
      const made = await h.post('/api/roof-reports/generate', { ...GOOD, photoIds: [up.body.id] });
      const target = made.body.id as string;
      const current = (await h.get(`/api/roof-reports/${target}`)).body.report;
      const edited = {
        ...current,
        id: 'something else',
        property: { ...current.property, address: '<script>alert(1)</script> 12 Elm Street' },
        stormHistory: { ...current.stormHistory, totalEvents: '<img src=x onerror=alert(1)>' },
        damageAnalysis: {
          ...current.damageAnalysis,
          photos: [...current.damageAnalysis.photos.map((p: any) => ({ ...p, url: 'https://tracker.example/p.gif' })), { id: crypto.randomUUID(), url: 'https://other.example/a.jpg', damages: [] }],
        },
        injected: { x: 1 },
      };
      const r = await put(a, 'repA', target, { reportJson: edited });
      expect(r.status).toBe(200);
      const saved = (await rowOf(a, target)).reportJson as any;
      expect(saved.id).toBe(target);
      expect(saved.stormHistory.totalEvents).toBe(0);
      expect(saved.injected).toBeUndefined();
      expect(saved.damageAnalysis.photos).toHaveLength(1);
      expect(saved.damageAnalysis.photos[0].url).toBe(`/api/roof-reports/${target}/photos/${up.body.id}/working`);
      expect(JSON.stringify(saved)).not.toMatch(/tracker\.example|other\.example/);
      // The report that is not shaped like one is refused.
      expect((await put(a, 'repA', target, { reportJson: { property: {} } })).status).toBe(400);
    });

    it('refuses a saved page that can run script, and keeps one that cannot', async () => {
      const bad = await put(a, 'repA', id, { editedHtml: '<p onclick="x()">hi</p><script>alert(1)</script>' });
      expect(bad.status).toBe(400);
      expect(bad.body).toEqual({ error: PAGE_NOT_SAFE });
      const fine = await put(a, 'repA', id, { editedHtml: '<!doctype html><html><body><h1>Roof report</h1></body></html>' });
      expect(fine.status).toBe(200);
      expect((await rowOf(a, id)).editedHtml).toContain('Roof report');
      expect(fine.text).not.toContain('<h1>Roof report</h1>');
    });

    it('lets a report move to a job only if the person may open that job, or off any job', async () => {
      expect((await put(a, 'repA', id, { jobExternalId: `${tag}-jobB` })).status).toBe(404);
      expect((await put(a, 'repA', id, { jobExternalId: `${tag}-nope` })).status).toBe(404);
      expect((await rowOf(a, id)).jobExternalId).toBeNull();
      expect((await put(a, 'repA', id, { jobExternalId: `${tag}-jobA` })).status).toBe(200);
      expect((await rowOf(a, id)).jobExternalId).toBe(`${tag}-jobA`);
      expect((await put(a, 'repA', id, { jobExternalId: null })).status).toBe(200);
      expect((await rowOf(a, id)).jobExternalId).toBeNull();
    });

    it('answers "not found" for another company, another rep, crew and an archived report, and waits for one still being made', async () => {
      const before = await rowOf(a, id);
      for (const [co, who] of [[b, 'admin'], [a, 'repB'], [a, 'crew']] as Array<[Co, string]>) {
        const r = await put(co, who, id, { title: 'taken over' });
        expect(r.status, who).toBe(404);
      }
      expect(await rowOf(a, id)).toEqual(before);
      const archived = await seed(a, { status: 'archived' });
      expect((await put(a, 'admin', archived, { title: 'x' })).status).toBe(404);
      const running = await seed(a, { status: 'generating' });
      const r = await put(a, 'admin', running, { title: 'x' });
      expect(r.status).toBe(409);
      expect(r.body).toEqual({ error: STILL_BEING_MADE_EDIT });
    });
  });

  describe('archiving', () => {
    it('puts a report away and keeps everything: the row, its photos and its token', async () => {
      h.as(a, 'repA');
      const up = await h.upload('/api/roof-reports/photos', makeJpeg());
      const made = await h.post('/api/roof-reports/generate', { ...GOOD, photoIds: [up.body.id] });
      const id = made.body.id as string;
      const before = await rowOf(a, id);
      const photosBefore = await runAsCompany(a.id, () => db.select().from(schema.roofReportPhotos).where(eq(schema.roofReportPhotos.reportId, id)));
      const rowsBefore = await countRows(a);
      const r = await h.post(`/api/roof-reports/${id}/archive`);
      expect(r.status).toBe(200);
      expect(r.body).toEqual({ id, status: 'archived' });
      const after = await rowOf(a, id);
      expect(after.status).toBe('archived');
      expect(after.shareToken).toBe(before.shareToken);
      expect(after.reportJson).toEqual(before.reportJson);
      expect(await countRows(a)).toBe(rowsBefore);
      expect(await runAsCompany(a.id, () => db.select().from(schema.roofReportPhotos).where(eq(schema.roofReportPhotos.reportId, id)))).toHaveLength(photosBefore.length);
      expect(store.objects.size).toBeGreaterThan(0);
      // It is gone from every list and cannot be opened, changed or archived again.
      expect((await h.get(`/api/roof-reports/${id}`)).status).toBe(404);
      expect((await h.post(`/api/roof-reports/${id}/archive`)).status).toBe(404);
      expect((await h.get('/api/roof-reports')).body.reports.map((x: any) => x.id)).not.toContain(id);
      h.as(a, 'admin');
      expect((await h.get('/api/roof-reports?status=archived')).body.reports.map((x: any) => x.id)).toContain(id);
    });

    it('waits for a report that is still being made, and answers 404 to anyone who may not archive it', async () => {
      const running = await seed(a, { status: 'generating' });
      h.as(a, 'admin');
      const r = await h.post(`/api/roof-reports/${running}/archive`);
      expect(r.status).toBe(409);
      expect(r.body).toEqual({ error: STILL_BEING_MADE });
      expect((await rowOf(a, running)).status).toBe('generating');
      const ready = await seed(a, { createdByMemberId: a.people.repA.id });
      for (const [co, who] of [[b, 'admin'], [a, 'repB'], [a, 'crew']] as Array<[Co, string]>) {
        h.as(co, who);
        expect((await h.post(`/api/roof-reports/${ready}/archive`)).status, who).toBe(404);
      }
      expect((await rowOf(a, ready)).status).toBe('ready');
    });

    it('archives a failed report, and one that was left generating long ago', async () => {
      const failed = await seed(a, { status: 'failed', problem: GENERATE_FAILED });
      const stale = await seed(a, { status: 'generating' });
      await runAsCompany(a.id, () => db.execute(sql`update roof_reports set updated_at = now() - interval '9 minutes' where id = ${stale}`));
      h.as(a, 'admin');
      expect((await h.post(`/api/roof-reports/${failed}/archive`)).status).toBe(200);
      expect((await h.post(`/api/roof-reports/${stale}/archive`)).status).toBe(200);
    });
  });

  describe('trying a failed report again', () => {
    it('runs it again from what was typed and the photos it already has, and not from anyone else\'s say-so', async () => {
      h.as(a, 'repA');
      const up = await h.upload('/api/roof-reports/photos', makeJpeg());
      behave.storm = async () => { throw new Error('down'); };
      const failed = await h.post('/api/roof-reports/generate', { ...GOOD, photoIds: [up.body.id], roofDetails: { squares: 31, pitch: '8/12' } });
      expect(failed.status).toBe(422);
      const id = (await runAsCompany(a.id, async () => (await db.select().from(schema.roofReports).where(eq(schema.roofReports.status, 'failed')).orderBy(sql`created_at desc`))[0])).id as string;
      behave = {};
      const r = await h.post(`/api/roof-reports/${id}/retry`, { companyId: b.id, address: 'elsewhere' });
      expect(r.status).toBe(200);
      expect(r.body).toEqual({ id, status: 'ready', problem: null });
      const row = await rowOf(a, id);
      expect(row.address).toBe('12 Elm Street');
      expect((row.reportJson as any).roofDetails).toMatchObject({ squares: 31, pitch: '8/12' });
      expect((row.reportJson as any).damageAnalysis.photos.map((p: any) => p.id)).toEqual([up.body.id]);
      expect((row.reportJson as any).retryInput).toBeUndefined();
    });

    it('does not run a report that is ready or still running, or that is not the person\'s to see', async () => {
      const ready = await seed(a, { createdByMemberId: a.people.repA.id });
      const running = await seed(a, { status: 'generating', createdByMemberId: a.people.repA.id });
      h.as(a, 'repA');
      for (const id of [ready, running]) {
        const r = await h.post(`/api/roof-reports/${id}/retry`);
        expect(r.status).toBe(409);
        expect(r.body).toEqual({ error: ONLY_FAILED_RETRY });
      }
      const failed = await seed(a, { status: 'failed', problem: GENERATE_FAILED, createdByMemberId: a.people.repA.id });
      for (const [co, who] of [[b, 'admin'], [a, 'repB'], [a, 'crew']] as Array<[Co, string]>) {
        h.as(co, who);
        expect((await h.post(`/api/roof-reports/${failed}/retry`)).status, who).toBe(404);
      }
      expect((await rowOf(a, failed)).status).toBe('failed');
    });
  });

  describe('the page', () => {
    let id = ''; let photoId = '';
    beforeAll(async () => {
      h.as(a, 'repA');
      photoId = (await h.upload('/api/roof-reports/photos', makeJpeg())).body.id;
      id = (await h.post('/api/roof-reports/generate', { ...GOOD, photoIds: [photoId], inspectorNotes: 'Dana <b>Whitfield</b> said the ladder was wet.' })).body.id;
      // The classic document: it carries the notes and the photos in the page itself.
      await h.put(`/api/roof-reports/${id}`, { visualStyle: 'formal' });
    });

    it('is built by the escaped renderers, with photos only from short signed links, and served in a sandbox', async () => {
      h.as(a, 'repA');
      const r = await h.get(`/api/roof-reports/${id}/html`);
      expect(r.status).toBe(200);
      expect(r.headers.get('content-type')).toMatch(/^text\/html/);
      const csp = r.headers.get('content-security-policy')!;
      expect(csp).toMatch(/sandbox/);
      expect(csp).toMatch(/default-src 'none'/);
      expect(r.headers.get('x-content-type-options')).toBe('nosniff');
      expect(r.headers.get('referrer-policy')).toBe('no-referrer');
      expect(r.headers.get('cache-control')).toMatch(/no-store/);
      expect(r.text).toContain('Dana &lt;b&gt;Whitfield&lt;/b&gt;');
      expect(r.text).not.toContain('Dana <b>Whitfield</b>');
      const links = [...r.text.matchAll(/https?:\/\/[^"' )]*\/api\/roof-reports\/linked-photo\/([A-Za-z0-9_.-]+)/g)].map((m) => m[1]);
      expect(links.length).toBeGreaterThan(0);
      expect(r.text).not.toMatch(/\/rr\/|c\/[0-9a-f-]{36}|\/photos\/[0-9a-f-]{36}\/(working|thumb)/);
      // A signed link works with no session, for one photo, and is not a way into anything else.
      h.signedOut();
      const img = await h.get(`/api/roof-reports/linked-photo/${links[0]}`);
      expect(img.status).toBe(200);
      expect(img.headers.get('content-type')).toBe('image/jpeg');
      expect((await h.get(`/api/roof-reports/${id}/html`)).status).toBe(401);
    });

    it('escapes a script put into the stored report instead of running it', async () => {
      await runAsCompany(a.id, async () => {
        const row = (await db.select().from(schema.roofReports).where(eq(schema.roofReports.id, id)))[0];
        const json: any = JSON.parse(JSON.stringify(row.reportJson));
        json.property.address = '<script>alert("xss")</script>';
        json.executiveSummary = '"><img src=x onerror=alert(1)>';
        json.stormHistory.totalEvents = '<svg onload=alert(1)>';
        await db.update(schema.roofReports).set({ reportJson: json }).where(eq(schema.roofReports.id, id));
      });
      h.as(a, 'repA');
      const r = await h.get(`/api/roof-reports/${id}/html`);
      expect(r.status).toBe(200);
      expect(r.text).not.toContain('<script>alert("xss")</script>');
      expect(r.text).not.toMatch(/<img src=x onerror/);
      expect(r.text).not.toMatch(/<svg onload/);
      expect(r.text).toContain('&lt;script&gt;alert');
    });

    it('serves a saved page as it was saved, in a sandbox that cannot run script', async () => {
      h.as(a, 'repA');
      await h.put(`/api/roof-reports/${id}`, { editedHtml: '<!doctype html><html><body><h1>My edit</h1></body></html>' });
      const r = await h.get(`/api/roof-reports/${id}/html`);
      expect(r.status).toBe(200);
      expect(r.text).toContain('<h1>My edit</h1>');
      const csp = r.headers.get('content-security-policy')!;
      expect(csp).toMatch(/sandbox(;|$)/);
      expect(csp).not.toMatch(/allow-scripts/);
      expect(csp).not.toMatch(/script-src/);
      await h.put(`/api/roof-reports/${id}`, { editedHtml: null });
    });

    it('is not shown for a report that is not ready, and is "not found" for anyone who may not see the report', async () => {
      const running = await seed(a, { status: 'generating', createdByMemberId: a.people.repA.id });
      h.as(a, 'repA');
      const r = await h.get(`/api/roof-reports/${running}/html`);
      expect(r.status).toBe(409);
      expect(r.body).toEqual({ error: PAGE_NOT_READY });
      for (const [co, who] of [[b, 'admin'], [a, 'repB'], [a, 'crew']] as Array<[Co, string]>) {
        h.as(co, who);
        const denied = await h.get(`/api/roof-reports/${id}/html`);
        expect(denied.status, who).toBe(404);
        expect(denied.text).not.toMatch(/Elm|Dana|linked-photo/);
      }
    });
  });

  it('never let a request leave the app', () => {
    expect(outside).toEqual([]);
  });
});
