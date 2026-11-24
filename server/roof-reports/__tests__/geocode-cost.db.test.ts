/**
 * The storm step's Google geocoding is a paid call, and it is recorded in
 * model_costs for the company that caused it, through the same cost path as
 * the model calls. Its price is not confirmed, so the row is unpriced: 0 cents
 * and `priced = false`, never a guess. Nothing reaches the network.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';

const url = process.env.DATABASE_URL || '';
const local = process.env.ARCHIE_REHEARSAL === '1' || /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url);

describe.skipIf(!local)('the geocoding cost row (database)', async () => {
  const { db } = await import('../../db');
  const { runAsCompany } = await import('../../tenant/context');
  const { createCompany } = await import('../../tenant/companies');
  const { liveDeps } = await import('../generate');
  const { MODEL_PRICES_CENTS_PER_MTOK } = await import('../../lib/roof-reports/models.js');

  const tag = `rrgeo-${process.pid}-${Date.now()}`;
  let a = ''; let b = '';
  beforeAll(async () => {
    a = (await createCompany({ slug: `${tag}-a`, name: 'Summit Ridge Roofing', status: 'active' })).id;
    b = (await createCompany({ slug: `${tag}-b`, name: 'Cedar Falls Roofing Two', status: 'active' })).id;
  });
  const saved = process.env.GOOGLE_MAPS_API_KEY;
  afterEach(() => {
    vi.unstubAllGlobals();
    if (saved === undefined) delete process.env.GOOGLE_MAPS_API_KEY; else process.env.GOOGLE_MAPS_API_KEY = saved;
  });

  const GOOGLE_OK = { results: [{ geometry: { location: { lat: 42.5349, lng: -92.4453 } }, formatted_address: '12 Elm Street, Cedar Falls, IA 50613', address_components: [] }] };
  const noNetworkButGoogle = (googleOk: boolean) => vi.stubGlobal('fetch', vi.fn(async (u: unknown) => {
    const host = new URL(String(typeof u === 'string' || u instanceof URL ? u : (u as Request).url)).host;
    if (host === 'maps.googleapis.com') return { ok: googleOk, json: async () => (googleOk ? GOOGLE_OK : {}) } as Response;
    throw new Error('no network in tests');
  }));
  const rowsFor = (company: string, ref: string) =>
    runAsCompany(company, async () => (await db.execute(sql`select * from model_costs where ref = ${ref} order by created_at`)).rows as any[]);
  const storm = (reportId: string) => liveDeps(reportId, { keys: {} }).storm('12 Elm Street', 'Cedar Falls', 'IA', '50613', { yearsBack: 1, signal: AbortSignal.timeout(1_500) });

  it('writes one unpriced row for the company, tagged with the report, when Google places the address', async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'test-key-not-real';
    noNetworkButGoogle(true);
    const ref = randomUUID();
    await runAsCompany(a, () => storm(ref));
    const rows = await rowsFor(a, ref);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ company_id: a, operation: 'geocode', provider: 'google', priced: false, input_tokens: null, output_tokens: null });
    expect(Number(rows[0].cents)).toBe(0);
    // Another company never sees it.
    expect(await rowsFor(b, ref)).toHaveLength(0);
  });

  it('still records the attempt when Google could not place the address', async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'test-key-not-real';
    noNetworkButGoogle(false);
    const ref = randomUUID();
    await runAsCompany(a, () => storm(ref)).catch(() => {});
    const rows = await rowsFor(a, ref);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ operation: 'geocode', provider: 'google', priced: false });
  });

  it('writes nothing when there is no Google key', async () => {
    delete process.env.GOOGLE_MAPS_API_KEY; delete process.env.GOOGLEMAPS_API_KEY; delete process.env.GOOGLE_MAPS_KEY; delete process.env.MAPS_API_KEY;
    noNetworkButGoogle(true);
    const ref = randomUUID();
    await runAsCompany(a, () => storm(ref)).catch(() => {});
    expect(await rowsFor(a, ref)).toHaveLength(0);
  });

  it('has no price for it, so it can only ever be recorded as unpriced', () => {
    expect(Object.keys(MODEL_PRICES_CENTS_PER_MTOK).filter((k) => /geocod|maps/i.test(k))).toEqual([]);
  });
});
