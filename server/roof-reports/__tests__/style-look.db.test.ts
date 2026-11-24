/**
 * What the editor is told about the look (through a real request path on the
 * local test database): the look the report is really shown in, and, when it is
 * not the one asked for, one plain sentence saying why. The page route and this
 * answer choose through the same function, so they cannot disagree.
 * Fictional company: Summit Ridge Roofing in Cedar Falls.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { setPhotoStoreForTests } from '../../photos/store';
import { makeJpeg } from '../../photos/__tests__/jpeg-fixtures';
import { analysis, fakeStorm } from './fakes';
import { fakeStore, localDb, startRoofApp, type Co } from './harness';

vi.mock('@vercel/functions', () => ({ waitUntil: () => {} }));

describe.skipIf(!localDb)('the look the editor is told about (database)', async () => {
  const tag = `rrlook-${process.pid}-${Date.now()}`;
  const { registerRoofReportsRoutes } = await import('../routes');
  const { liveDeps } = await import('../generate');
  const { __resetRateLimits } = await import('../../lib/rate-limit');
  const fakeDeps = (reportId: string) => ({
    ...liveDeps(reportId, { keys: {} }),
    storm: async () => fakeStorm(),
    enhancedStorm: (() => ({ noaaEventPageUrls: [], nexradRadarImageUrls: [], countyStormDatabaseUrl: '', narratives: [], propertyProfile: null, hailSizeDistribution: {} })) as any,
    analyze: async () => analysis(),
    narrate: async () => ({ findings: [], executiveSummary: 'A short summary.' }),
    label: async () => null,
    sleep: async () => {},
  });
  const h = await startRoofApp(tag, (app) => registerRoofReportsRoutes(app, { deps: fakeDeps }));
  const savedSwitch = process.env.ARCHIE_ROOF_REPORTS;
  let co: Co; let few = ''; let many = '';
  const GOOD = { reportTypes: ['inspection', 'storm'], template: 'full', address: '12 Elm Street', city: 'Cedar Falls', state: 'IA', zip: '50613' };

  async function make(photoCount: number): Promise<string> {
    const photos: string[] = [];
    for (let i = 0; i < photoCount; i++) photos.push((await h.upload('/api/roof-reports/photos', makeJpeg())).body.id);
    return (await h.post('/api/roof-reports/generate', { ...GOOD, photoIds: photos })).body.id;
  }

  beforeAll(async () => {
    process.env.ARCHIE_ROOF_REPORTS = 'on';
    setPhotoStoreForTests(fakeStore());
    co = await h.company('Summit Ridge Roofing', [['rep', 'sales']]);
    h.as(co, 'rep');
    few = await make(2);
    many = await make(4);
  });
  afterAll(async () => {
    setPhotoStoreForTests(null);
    if (savedSwitch === undefined) delete process.env.ARCHIE_ROOF_REPORTS; else process.env.ARCHIE_ROOF_REPORTS = savedSwitch;
    await h.close();
  });

  it('says a flight is shown as a document, in one plain sentence with the counts, when the report has too few photos', async () => {
    __resetRateLimits();
    const put = await h.put(`/api/roof-reports/${few}`, { visualStyle: 'flight' });
    expect(put.status).toBe(200);
    expect(put.body.look).toEqual({ shown: 'formal', notice: 'This report has only 2 photos, so it is shown as a document. A flight needs 3 or more.' });
    const got = await h.get(`/api/roof-reports/${few}`);
    expect(got.body.look).toEqual(put.body.look);
    // And the page really is the document, so the sentence is true.
    const page = await h.get(`/api/roof-reports/${few}/html`);
    expect(page.text).not.toContain('ScrollCraft.mount');
  });

  it('says nothing when the look can be used, and says which look it is', async () => {
    for (const [style, shown] of [['flight', 'flight'], ['presentation', 'presentation'], ['formal', 'formal']] as const) {
      const put = await h.put(`/api/roof-reports/${many}`, { visualStyle: style });
      expect(put.body.look, style).toEqual({ shown, notice: null });
    }
  });

  it('tells which look it really is when none was chosen (the template\'s usual one), and its sentence has no code, id or long dash', async () => {
    const put = await h.put(`/api/roof-reports/${few}`, { visualStyle: null, template: 'full' });
    expect(['formal', 'presentation', 'flight']).toContain(put.body.look.shown);
    await h.put(`/api/roof-reports/${few}`, { visualStyle: 'presentation' });
    const got = await h.get(`/api/roof-reports/${few}`);
    expect(['formal', 'presentation']).toContain(got.body.look.shown);
    for (const n of [put.body.look.notice, got.body.look.notice].filter(Boolean)) {
      expect(n).toMatch(/^This report has (no|only \d+) /);
      expect(n).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}|_|\{|\}/);
      expect(n).not.toContain(String.fromCharCode(0x2014));
    }
  });

  it('has no look for a report that is not ready', async () => {
    const [row] = await h.runAsCompany(co.id, () => h.db.insert(h.schema.roofReports).values({ address: '1 Main Street', reportTypes: ['storm'], status: 'generating', createdByMemberId: co.people.rep.id } as any).returning());
    const got = await h.get(`/api/roof-reports/${row.id}`);
    expect(got.status).toBe(200);
    expect(got.body.look).toBeNull();
  });
});
