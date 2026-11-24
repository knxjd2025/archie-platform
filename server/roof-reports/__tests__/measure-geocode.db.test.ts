/**
 * The real geocoding step of "Find it from the satellite", with the network replaced: the address is placed by
 * the same Google lookup the storm step uses, each paid lookup writes an (unpriced) cost row for the company, and
 * the key goes only to the Google host. Fictional company: Summit Ridge Roofing, 12 Elm Street in Cedar Falls.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModelCaller } from '../../lib/roof-reports/model-call';
import { GEOCODE_FAILED } from '../../../shared/roof-reports';
import { localDb, startRoofApp, type Co } from './harness';

vi.mock('@vercel/functions', () => ({ waitUntil: () => {} }));
const KEY = 'AIzaSy-ZZ-MAP-KEY-DO-NOT-LEAK-123456';
const rect = (x: number, y: number, w: number, h: number) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];

describe.skipIf(!localDb)('the real geocoding step (database, network replaced)', async () => {
  const tag = `rrmeasuregeo-${process.pid}-${Date.now()}`;
  const { registerRoofReportsRoutes } = await import('../routes');
  const { __resetRateLimits } = await import('../../lib/rate-limit');
  const model: ModelCaller = async () => ({ text: JSON.stringify({ outline: rect(440, 490, 400, 300), roofType: 'gable', confidence: 'high' }), usage: { inputTokens: 5, outputTokens: 5 } });
  const h = await startRoofApp(tag, (app) => registerRoofReportsRoutes(app, {
    measure: { mapKey: () => KEY, model: () => model, fetchImage: async () => ({ bytes: Buffer.from('x'), contentType: 'image/jpeg' }) },
  }));
  const { db, schema, runAsCompany } = h;
  const savedSwitch = process.env.ARCHIE_ROOF_REPORTS;
  let a: Co;
  const outside: string[] = [];
  let google: 'found' | 'nothing' = 'found';

  beforeAll(async () => {
    process.env.ARCHIE_ROOF_REPORTS = 'on';
    a = await h.company('Summit Ridge Roofing', [['admin', 'admin']]);
  });
  beforeEach(() => {
    __resetRateLimits(); outside.length = 0; google = 'found'; h.as(a, 'admin');
    const real = globalThis.fetch;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: any, init?: any) => {
      const u = String(typeof input === 'string' || input instanceof URL ? input : input.url);
      if (u.startsWith(h.base)) return real(input, init);
      outside.push(u);
      if (u.startsWith('https://maps.googleapis.com/maps/api/geocode/json')) {
        const body = google === 'found'
          ? { status: 'OK', results: [{ geometry: { location: { lat: 42.5349, lng: -92.4453 } }, formatted_address: '12 Elm Street, Cedar Falls, IA 50613, USA', address_components: [] }] }
          : { status: 'ZERO_RESULTS', results: [] };
        return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      throw new Error('no outside calls in tests');
    });
  });
  afterEach(() => { vi.restoreAllMocks(); });
  afterAll(async () => {
    if (savedSwitch === undefined) delete process.env.ARCHIE_ROOF_REPORTS; else process.env.ARCHIE_ROOF_REPORTS = savedSwitch;
    await h.close();
  });
  const detect = () => h.post('/api/roof-reports/measurements/detect', { address: '12 Elm Street', city: 'Cedar Falls', state: 'IA', zip: '50613' });
  const geocodeRows = async () => (await runAsCompany(a.id, () => db.select().from(schema.modelCosts))).filter((c) => c.operation === 'geocode' && c.ref === null);

  it('places the address with the Google lookup, records that paid lookup unpriced, and sends the key only to Google', async () => {
    const before = (await geocodeRows()).length;
    const res = await detect();
    expect(res.status, res.text).toBe(200);
    const google = outside.filter((u) => u.startsWith('https://maps.googleapis.com/maps/api/geocode/json'));
    expect(google).toHaveLength(1);
    expect(google[0]).toContain(`key=${KEY}`);
    expect(outside.filter((u) => !u.startsWith('https://maps.googleapis.com/'))).toEqual([]);
    const rows = (await geocodeRows()).slice(before);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ provider: 'google', model: 'google-geocoding', priced: false, cents: '0.0000', companyId: a.id });
    expect(res.text).not.toContain(KEY);
  });

  it('says the address could not be found, plainly, when no lookup places it, and still records the paid lookup', async () => {
    google = 'nothing';
    const before = (await geocodeRows()).length;
    const res = await detect();
    expect(res.status).toBe(422);
    expect(res.body).toEqual({ error: GEOCODE_FAILED });
    expect((await geocodeRows()).length).toBe(before + 1);
    expect(res.text).not.toContain(KEY);
  });
});
