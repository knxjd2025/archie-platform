/**
 * The list filter by status uses the status the list SHOWS: a run still
 * `generating` after eight minutes is shown as failed, so `?status=failed`
 * includes it and `?status=generating` leaves it out, and the totals agree.
 * Fictional company: Summit Ridge Roofing in Cedar Falls.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeStore, localDb, startRoofApp, type Co } from './harness';
import { setPhotoStoreForTests } from '../../photos/store';

vi.mock('@vercel/functions', () => ({ waitUntil: () => {} }));

describe.skipIf(!localDb)('listing by status (database)', async () => {
  const tag = `rrlist-${process.pid}-${Date.now()}`;
  const { registerRoofReportsRoutes } = await import('../routes');
  const { __resetRateLimits } = await import('../../lib/rate-limit');
  const h = await startRoofApp(tag, (app) => registerRoofReportsRoutes(app));
  const { db, schema, runAsCompany } = h;
  const savedSwitch = process.env.ARCHIE_ROOF_REPORTS;
  let co: Co;
  const ids: Record<string, string> = {};
  const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);

  beforeAll(async () => {
    process.env.ARCHIE_ROOF_REPORTS = 'on';
    setPhotoStoreForTests(fakeStore());
    co = await h.company('Summit Ridge Roofing', [['admin', 'admin']]);
    const make = async (name: string, status: string, updatedAt: Date) => {
      const [r] = await runAsCompany(co.id, () => db.insert(schema.roofReports).values({
        address: `${name} Elm Street`, city: 'Cedar Falls', state: 'IA', reportTypes: ['storm'], status, updatedAt, createdAt: updatedAt,
      } as any).returning());
      ids[name] = r.id;
    };
    await make('ready', 'ready', minutesAgo(1));
    await make('failed', 'failed', minutesAgo(1));
    await make('running', 'generating', minutesAgo(2));
    await make('dead', 'generating', minutesAgo(9));
    await make('dead-old', 'generating', minutesAgo(600));
    await make('archived', 'archived', minutesAgo(1));
  });
  beforeEach(() => { __resetRateLimits(); h.as(co, 'admin'); });
  afterAll(async () => {
    setPhotoStoreForTests(null);
    if (savedSwitch === undefined) delete process.env.ARCHIE_ROOF_REPORTS; else process.env.ARCHIE_ROOF_REPORTS = savedSwitch;
    await h.close();
  });

  const list = async (query = '') => (await h.get(`/api/roof-reports${query}`)).body;
  const named = (body: any) => body.reports.map((r: any) => r.address.split(' ')[0]).sort();

  it('shows a run left generating for more than eight minutes as failed', async () => {
    const body = await list();
    const byName = Object.fromEntries(body.reports.map((r: any) => [r.address.split(' ')[0], r.status]));
    expect(byName).toMatchObject({ ready: 'ready', failed: 'failed', running: 'generating', dead: 'failed', 'dead-old': 'failed' });
  });

  it('?status=failed includes the dead runs as well as the failed one', async () => {
    const body = await list('?status=failed');
    expect(named(body)).toEqual(['dead', 'dead-old', 'failed']);
    expect(body.total).toBe(3);
    for (const r of body.reports) expect(r.status).toBe('failed');
  });

  it('?status=generating leaves the dead runs out', async () => {
    const body = await list('?status=generating');
    expect(named(body)).toEqual(['running']);
    expect(body.total).toBe(1);
    for (const r of body.reports) expect(r.status).toBe('generating');
  });

  it('?status=ready and ?status=archived are as they were', async () => {
    expect(named(await list('?status=ready'))).toEqual(['ready']);
    expect(named(await list('?status=archived'))).toEqual(['archived']);
  });

  it('every filtered row shows the status it was filtered by, and no report is in two buckets', async () => {
    const buckets = await Promise.all(['ready', 'failed', 'generating'].map(async (s) => ({ s, body: await list(`?status=${s}`) })));
    const seen = new Set<string>();
    for (const { s, body } of buckets) {
      for (const r of body.reports) { expect(r.status).toBe(s); expect(seen.has(r.id)).toBe(false); seen.add(r.id); }
    }
    expect(seen.size).toBe(5);
    expect(named(await list())).toEqual(['dead', 'dead-old', 'failed', 'ready', 'running']);
  });

  it('applies the same rule to a job\'s reports', async () => {
    await runAsCompany(co.id, async () => {
      await db.insert(schema.leads).values({ externalId: `${tag}-job`, source: 'jobtread', firstName: 'Dana' } as any);
      const { eq } = await import('drizzle-orm');
      await db.update(schema.roofReports).set({ jobExternalId: `${tag}-job` }).where(eq(schema.roofReports.id, ids.dead));
      await db.update(schema.roofReports).set({ jobExternalId: `${tag}-job` }).where(eq(schema.roofReports.id, ids.running));
    });
    const failed = (await h.get(`/api/clients/${tag}-job/roof-reports?status=failed`)).body;
    expect(failed.reports.map((r: any) => r.id)).toEqual([ids.dead]);
    const generating = (await h.get(`/api/clients/${tag}-job/roof-reports?status=generating`)).body;
    expect(generating.reports.map((r: any) => r.id)).toEqual([ids.running]);
  });
});
