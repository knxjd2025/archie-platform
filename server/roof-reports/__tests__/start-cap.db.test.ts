/**
 * The daily cap and the idempotency key on generate, against the real local
 * test database as the app's own role (migration 0022).
 *
 * Holds: the per-company daily cap is counted and written in one locked step,
 * so parallel requests cannot overrun it; every START of a generation counts
 * (a new report and a retry), not only the first; a repeated submit with the
 * same key from the same person starts nothing and returns the first report;
 * the same key asking for something else is refused with a plain sentence.
 * Fictional company: Summit Ridge Roofing in Cedar Falls.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { setPhotoStoreForTests } from '../../photos/store';
import { GENERATE_FAILED, MAX_REPORTS_PER_DAY, TOO_MANY_TODAY } from '../../../shared/roof-reports';
import { analysis, fakeStorm } from './fakes';
import { fakeStore, localDb, startRoofApp, type Co } from './harness';

vi.mock('@vercel/functions', () => ({ waitUntil: () => {} }));

describe.skipIf(!localDb)('the daily cap and the request key (database)', async () => {
  const tag = `rrcap-${process.pid}-${Date.now()}`;
  const { registerRoofReportsRoutes } = await import('../routes');
  const { liveDeps } = await import('../generate');
  const { __resetRateLimits } = await import('../../lib/rate-limit');
  const { sql, eq } = await import('drizzle-orm');

  let stormCalls = 0;
  const fakeDeps = (reportId: string) => ({
    ...liveDeps(reportId, { keys: {} }),
    storm: async () => { stormCalls++; return fakeStorm(); },
    enhancedStorm: (() => ({ noaaEventPageUrls: [], nexradRadarImageUrls: [], countyStormDatabaseUrl: '', narratives: [], propertyProfile: null, hailSizeDistribution: {} })) as any,
    analyze: async () => analysis(),
    narrate: async () => ({ findings: [], executiveSummary: 'A short summary.' }),
    label: async () => null,
    sleep: async () => {},
  });

  const h = await startRoofApp(tag, (app) => registerRoofReportsRoutes(app, { deps: fakeDeps }));
  const { db, schema, runAsCompany } = h;
  const savedSwitch = process.env.ARCHIE_ROOF_REPORTS;
  const GOOD = { reportTypes: ['storm'], template: 'full', address: '12 Elm Street', city: 'Cedar Falls', state: 'IA', zip: '50613' };
  const fresh = (name: string, people: Array<[string, any]> = [['admin', 'admin']]) => h.company(`${name} ${Math.random().toString(36).slice(2, 7)}`, people);
  const rowsOf = (co: Co) => runAsCompany(co.id, async () => db.select().from(schema.roofReports));
  const startedToday = (co: Co) => runAsCompany(co.id, async () => (await db.execute(sql`select count(*)::int as n from roof_reports where started_at >= now() - interval '1 day'`)).rows[0] as any).then((r) => r.n as number);
  const seedMany = (co: Co, n: number, over: Record<string, unknown> = {}) => runAsCompany(co.id, async () => {
    await db.insert(schema.roofReports).values(Array.from({ length: n }, () => ({ address: '1 Oak Road', reportTypes: ['storm'], status: 'ready', ...over })) as any);
  });

  /** Sends with an Idempotency-Key header, which the harness's own send() has no way to carry. */
  async function postWithKey(body: unknown, key?: string) {
    const r = await fetch(`${h.base}/api/roof-reports/generate`, {
      method: 'POST', headers: { 'content-type': 'application/json', ...(key === undefined ? {} : { 'idempotency-key': key }) }, body: JSON.stringify(body),
    });
    const text = await r.text();
    let parsed: any = null; try { parsed = text ? JSON.parse(text) : null; } catch { parsed = null; }
    return { status: r.status, body: parsed };
  }

  beforeAll(() => {
    process.env.ARCHIE_ROOF_REPORTS = 'on';
    setPhotoStoreForTests(fakeStore());
  });
  beforeEach(() => { __resetRateLimits(); stormCalls = 0; });
  afterEach(() => { process.env.ARCHIE_ROOF_REPORTS = 'on'; });
  afterAll(async () => {
    setPhotoStoreForTests(null);
    if (savedSwitch === undefined) delete process.env.ARCHIE_ROOF_REPORTS; else process.env.ARCHIE_ROOF_REPORTS = savedSwitch;
    await h.close();
  });

  describe('the daily cap', () => {
    it('lets exactly ten of thirty parallel requests through at 190 already started today', async () => {
      const co = await fresh('Parallel Cap Roofing');
      await seedMany(co, MAX_REPORTS_PER_DAY - 10);
      h.as(co, 'admin');
      const answers = await Promise.all(Array.from({ length: 30 }, () => h.post('/api/roof-reports/generate', GOOD)));
      const through = answers.filter((r) => r.status === 200);
      const refused = answers.filter((r) => r.status === 429);
      expect(through).toHaveLength(10);
      expect(refused).toHaveLength(20);
      for (const r of refused) expect(r.body).toEqual({ error: TOO_MANY_TODAY });
      expect(await startedToday(co)).toBe(MAX_REPORTS_PER_DAY);
      expect((await rowsOf(co)).length).toBe(MAX_REPORTS_PER_DAY);
    });

    it('counts a retry as a start, even of a report first made on an earlier day', async () => {
      const co = await fresh('Retry Cap Roofing');
      // 198 started today, plus one old failed report whose first start was long ago.
      await seedMany(co, MAX_REPORTS_PER_DAY - 2);
      const old = await runAsCompany(co.id, async () => {
        const [r] = await db.insert(schema.roofReports).values({
          address: '9 Pine Court', city: 'Cedar Falls', state: 'IA', reportTypes: ['storm'], status: 'failed', problem: GENERATE_FAILED,
          createdAt: new Date(Date.now() - 3 * 24 * 3600_000), startedAt: new Date(Date.now() - 3 * 24 * 3600_000),
        } as any).returning();
        return r;
      });
      expect(await startedToday(co)).toBe(MAX_REPORTS_PER_DAY - 2);
      h.as(co, 'admin');
      const retried = await h.post(`/api/roof-reports/${old.id}/retry`);
      expect(retried.status).toBe(200);
      expect(await startedToday(co)).toBe(MAX_REPORTS_PER_DAY - 1);
      // One more start fits, and then the day is full.
      expect((await h.post('/api/roof-reports/generate', GOOD)).status).toBe(200);
      expect(await startedToday(co)).toBe(MAX_REPORTS_PER_DAY);
      const full = await h.post('/api/roof-reports/generate', GOOD);
      expect(full.status).toBe(429);
      expect(full.body).toEqual({ error: TOO_MANY_TODAY });
    });

    it('refuses a retry once the day is full, and leaves that report as it was', async () => {
      const co = await fresh('Full Day Roofing');
      await seedMany(co, MAX_REPORTS_PER_DAY);
      const longAgo = new Date(Date.now() - 3 * 24 * 3600_000);
      const old = await runAsCompany(co.id, async () => {
        const [r] = await db.insert(schema.roofReports).values({
          address: '9 Pine Court', city: 'Cedar Falls', state: 'IA', reportTypes: ['storm'], status: 'failed', problem: GENERATE_FAILED,
          createdAt: longAgo, startedAt: longAgo,
        } as any).returning();
        return r;
      });
      h.as(co, 'admin');
      const refused = await h.post(`/api/roof-reports/${old.id}/retry`);
      expect(refused.status).toBe(429);
      expect(refused.body).toEqual({ error: TOO_MANY_TODAY });
      const [still] = await runAsCompany(co.id, () => db.select().from(schema.roofReports).where(eq(schema.roofReports.id, old.id)));
      expect(still.status).toBe('failed');
      expect(still.startedAt.getTime()).toBe(longAgo.getTime());
    });

    it('does not count another company\'s starts', async () => {
      const full = await fresh('Busy Roofing');
      const quiet = await fresh('Quiet Roofing');
      await seedMany(full, MAX_REPORTS_PER_DAY);
      h.as(full, 'admin');
      expect((await h.post('/api/roof-reports/generate', GOOD)).status).toBe(429);
      h.as(quiet, 'admin');
      expect((await h.post('/api/roof-reports/generate', GOOD)).status).toBe(200);
    });
  });

  describe('the request key', () => {
    it('returns the first report for the same key from the same person, and starts nothing', async () => {
      const co = await fresh('Key Roofing');
      h.as(co, 'admin');
      const first = await postWithKey(GOOD, 'submit-0001-abcdef');
      expect(first.status).toBe(200);
      expect(stormCalls).toBe(1);
      const again = await postWithKey(GOOD, 'submit-0001-abcdef');
      expect(again.status).toBe(200);
      expect(again.body.id).toBe(first.body.id);
      expect(again.body.status).toBe('ready');
      expect(stormCalls).toBe(1);
      expect(await rowsOf(co)).toHaveLength(1);
    });

    it('starts one report when the same key arrives five times at once', async () => {
      const co = await fresh('Double Click Roofing');
      h.as(co, 'admin');
      const answers = await Promise.all(Array.from({ length: 5 }, () => postWithKey(GOOD, 'submit-0002-abcdef')));
      expect(answers.every((r) => r.status === 200)).toBe(true);
      expect(new Set(answers.map((r) => r.body.id)).size).toBe(1);
      expect(stormCalls).toBe(1);
      expect(await rowsOf(co)).toHaveLength(1);
    });

    it('refuses the same key asking for something different, in a plain sentence, and starts nothing', async () => {
      const co = await fresh('Mixed Key Roofing');
      h.as(co, 'admin');
      expect((await postWithKey(GOOD, 'submit-0003-abcdef')).status).toBe(200);
      const other = await postWithKey({ ...GOOD, address: '99 Maple Lane' }, 'submit-0003-abcdef');
      expect(other.status).toBe(409);
      expect(typeof other.body.error).toBe('string');
      expect(other.body.error).not.toMatch(/key|hash|idempot|[{}\\]/i);
      expect(other.body.id).toBeUndefined();
      expect(await rowsOf(co)).toHaveLength(1);
      expect(stormCalls).toBe(1);
    });

    it('keeps a key to the person who sent it, and to their company', async () => {
      const co = await fresh('Two People Roofing', [['one', 'admin'], ['two', 'admin']]);
      const other = await fresh('Other Key Roofing');
      h.as(co, 'one');
      const a = await postWithKey(GOOD, 'submit-0004-abcdef');
      h.as(co, 'two');
      const b = await postWithKey(GOOD, 'submit-0004-abcdef');
      h.as(other, 'admin');
      const c = await postWithKey(GOOD, 'submit-0004-abcdef');
      expect(new Set([a.body.id, b.body.id, c.body.id]).size).toBe(3);
    });

    it('starts a new report each time when no key is sent', async () => {
      const co = await fresh('No Key Roofing');
      h.as(co, 'admin');
      expect((await postWithKey(GOOD)).status).toBe(200);
      expect((await postWithKey(GOOD)).status).toBe(200);
      expect(await rowsOf(co)).toHaveLength(2);
    });

    it('refuses a key that is not usable, in a plain sentence', async () => {
      const co = await fresh('Bad Key Roofing');
      h.as(co, 'admin');
      for (const key of ['', 'short', 'x'.repeat(201), 'has spaces in it here', 'semi;colon;key;here']) {
        const r = await postWithKey(GOOD, key);
        expect(r.status, key).toBe(400);
        expect(typeof r.body.error).toBe('string');
      }
      expect(await rowsOf(co)).toHaveLength(0);
    });

    it('does not use up the daily cap on a repeat', async () => {
      const co = await fresh('Repeat Cap Roofing');
      await seedMany(co, MAX_REPORTS_PER_DAY - 1);
      h.as(co, 'admin');
      expect((await postWithKey(GOOD, 'submit-0005-abcdef')).status).toBe(200);
      // The day is now full, but the same submit again is a repeat, not a new start.
      const again = await postWithKey(GOOD, 'submit-0005-abcdef');
      expect(again.status).toBe(200);
      expect(await startedToday(co)).toBe(MAX_REPORTS_PER_DAY);
    });
  });
});
