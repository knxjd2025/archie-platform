/**
 * Finding the roof from a satellite picture (the old program's roof outline finder), through a real request
 * path on the local test database with a FAKE map host, a FAKE geocoder and a FAKE model: nothing is ever called.
 *
 * What holds: behind the switch and the sign-in, with the right to make a report (crew refused); the picture
 * is fetched only from the one map host, only through the seam the safe download sits behind, and the map key
 * never reaches the person, a log, a cost row or an error record; both paid calls are recorded for the company
 * that caused them (unpriced, since no price is confirmed); the model is the `measurement` role of models.ts,
 * a United States provider; the answer is checked strictly and anything else is one plain sentence with nothing
 * stored; one deadline; a daily limit and a request key held in one locked step, so presses that arrive
 * together cannot overrun either. Fictional companies: Summit Ridge Roofing and Cedar Falls Roofing Two.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModelCaller, ModelCallRequest } from '../../lib/roof-reports/model-call';
import { ROOF_REPORT_MODELS, US_MODEL_PROVIDERS } from '../../lib/roof-reports/models';
import {
  BAD_REQUEST_KEY, GEOCODE_FAILED, MAX_SATELLITE_PER_COMPANY_PER_DAY, NEEDS_ADDRESS, NEEDS_CITY_STATE, SATELLITE_CAPPED, SATELLITE_ESTIMATE_NOTE, SATELLITE_KEY_REUSED,
  SATELLITE_NOT_AVAILABLE, SATELLITE_NOT_FOUND, SATELLITE_NO_PICTURE, SATELLITE_REPEAT, SATELLITE_TOO_FAST, TEXT_TOO_LONG,
} from '../../../shared/roof-reports';
import { localDb, startRoofApp, type Co } from './harness';

vi.mock('@vercel/functions', () => ({ waitUntil: () => {} }));

const KEY = 'AIzaSy-ZZ-MAP-KEY-DO-NOT-LEAK-123456';
const rect = (x: number, y: number, w: number, h: number) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
const ANSWER = {
  outline: rect(440, 490, 400, 300),
  facets: [{ vertices: rect(440, 490, 400, 150), estimatedPitch: '6:12', direction: 'north' }, { vertices: rect(440, 640, 400, 150), estimatedPitch: '6:12', direction: 'south' }],
  roofType: 'gable', confidence: 'high',
};
const WHERE = { address: '12 Elm Street', city: 'Cedar Falls', state: 'IA', zip: '50613' };

describe.skipIf(!localDb)('finding the roof from a satellite picture (database, fake map and model)', async () => {
  const tag = `rrmeasure-${process.pid}-${Date.now()}`;
  const { registerRoofReportsRoutes } = await import('../routes');
  const { __resetRateLimits } = await import('../../lib/rate-limit');

  // ---- the fakes
  const models: ModelCallRequest[] = [];
  const pictures: Array<{ url: string; timeoutMs: number }> = [];
  const lookups: Array<{ address: string }> = [];
  let geocodeAnswer: 'ok' | 'free' | 'free-none' | 'none' | 'nan' | 'far' | 'zero' | 'throw' | 'slow' = 'ok';
  let pictureAnswer: 'ok' | 'throw' | 'text' | 'empty' | 'png' | 'slow' | 'odd' = 'ok';
  let modelAnswer: 'ok' | 'text' | 'throw' | 'hang' | 'deaf' | 'empty' | 'null' = 'ok';
  let modelText = JSON.stringify(ANSWER);
  let configured = true;
  let keyPresent = true;
  let gate: Promise<void> = Promise.resolve();
  const model: ModelCaller = async (request) => {
    models.push(request);
    if (modelAnswer === 'hang') await new Promise<void>((_r, reject) => request.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
    // A model that never answers and never looks at the deadline: only the request's own deadline can end it.
    if (modelAnswer === 'deaf') await new Promise<void>(() => {});
    if (modelAnswer === 'throw') throw Object.assign(new Error(`The provider said: key ${KEY} is not valid for dana@example.com`), { status: 401 });
    if (modelAnswer === 'null') return { text: null as never };
    if (modelAnswer === 'empty') return { text: '   ', usage: { inputTokens: 10, outputTokens: 1 } };
    return { text: modelAnswer === 'text' ? modelText : JSON.stringify(ANSWER), usage: { inputTokens: 1800, outputTokens: 220 } };
  };
  let caps = { perCompany: MAX_SATELLITE_PER_COMPANY_PER_DAY };
  const h = await startRoofApp(tag, (app) => registerRoofReportsRoutes(app, {
    measure: {
      mapKey: () => (keyPresent ? KEY : undefined),
      geocode: async (where, ctx) => {
        lookups.push({ address: where.address });
        await gate;
        if (geocodeAnswer === 'throw') throw new Error(`geocode failed for ${KEY}`);
        if (geocodeAnswer === 'slow') await new Promise<void>((_r, reject) => ctx.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
        // 'free' is a lookup that cost nothing (no Google call was made): nothing is recorded and nothing is counted for it.
        if (geocodeAnswer === 'free-none') return null;
        if (geocodeAnswer !== 'free') await ctx.paid();
        if (geocodeAnswer === 'none') return null;
        if (geocodeAnswer === 'nan') return { latitude: NaN, longitude: -92.4453 };
        if (geocodeAnswer === 'far') return { latitude: 342.5, longitude: -92.4453 };
        if (geocodeAnswer === 'zero') return { latitude: 0, longitude: 0 };
        return { latitude: 42.5349, longitude: -92.4453 };
      },
      fetchImage: async (url, ctx) => {
        pictures.push({ url, timeoutMs: ctx.timeoutMs });
        if (pictureAnswer === 'throw') throw new Error(`Media download failed for ${url}`);
        if (pictureAnswer === 'slow') await new Promise<void>((_r, reject) => ctx.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
        // An answer whose own content type cannot be read, and whose failure carries the key: an unexpected failure.
        if (pictureAnswer === 'odd') return { bytes: Buffer.from('x'), get contentType(): string { throw new Error(`unexpected: ${KEY}`); } };
        if (pictureAnswer === 'text') return { bytes: Buffer.from('<html>no</html>'), contentType: 'text/html' };
        if (pictureAnswer === 'empty') return { bytes: Buffer.alloc(0), contentType: 'image/jpeg' };
        return { bytes: Buffer.from('ZZ-FAKE-SATELLITE-PICTURE'), contentType: pictureAnswer === 'png' ? 'image/png' : 'image/jpeg' };
      },
      model: () => (configured ? model : null),
      caps: () => caps,
      deadlineMs: 600,
    },
  }));
  const { db, schema, runAsCompany } = h;
  const savedSwitch = process.env.ARCHIE_ROOF_REPORTS;
  let a: Co; let b: Co;
  let n = 0;
  const key = () => `sat-${tag}-${++n}`;
  const detect = (body: unknown = WHERE, k: string | null = key()) => h.send('POST', '/api/roof-reports/measurements/detect', body, { headers: k ? { 'Idempotency-Key': k } : {} });

  const allCosts = (co: Co) => runAsCompany(co.id, async () => (await db.select().from(schema.modelCosts)).filter((c) => ['satellite_image', 'measurement_detect', 'geocode'].includes(c.operation) && c.ref === null));
  const uses = (co: Co) => runAsCompany(co.id, async () => (await db.select().from(schema.roofReportUses)).filter((u) => u.kind === 'satellite'));
  const reportCount = (co: Co) => runAsCompany(co.id, async () => (await db.select().from(schema.roofReports)).length);

  let logs: string[] = [];
  const spies: Array<ReturnType<typeof vi.spyOn>> = [];
  beforeAll(async () => {
    process.env.ARCHIE_ROOF_REPORTS = 'on';
    a = await h.company('Summit Ridge Roofing', [['admin', 'admin'], ['csr', 'customer_service'], ['manager', 'manager'], ['repa', 'sales'], ['crew', 'production']]);
    b = await h.company('Cedar Falls Roofing Two', [['admin', 'admin']]);
  });
  beforeEach(() => {
    __resetRateLimits(); models.length = 0; pictures.length = 0; lookups.length = 0; logs = [];
    geocodeAnswer = 'ok'; pictureAnswer = 'ok'; modelAnswer = 'ok'; modelText = JSON.stringify(ANSWER); configured = true; keyPresent = true; gate = Promise.resolve();
    caps = { perCompany: MAX_SATELLITE_PER_COMPANY_PER_DAY };
    for (const m of ['log', 'info', 'warn', 'error', 'debug'] as const) spies.push(vi.spyOn(console, m).mockImplementation((...args: unknown[]) => { logs.push(args.map((x) => (x instanceof Error ? `${x.name}: ${x.message}` : String(x))).join(' ')); }));
    h.as(a, 'admin');
  });
  afterEach(() => { for (const s of spies.splice(0)) s.mockRestore(); });
  afterAll(async () => {
    if (savedSwitch === undefined) delete process.env.ARCHIE_ROOF_REPORTS; else process.env.ARCHIE_ROOF_REPORTS = savedSwitch;
    await h.close();
  });

  // ------------------------------------------------------------------ the good path
  it('finds the roof: an outline, facets, a type, a confidence, an estimate, and the note that it is only an estimate', async () => {
    const res = await detect();
    expect(res.status, res.text).toBe(200);
    expect(res.body.outline).toEqual(rect(440, 490, 400, 300));
    expect(res.body.facets).toHaveLength(2);
    expect(res.body.facets[0]).toEqual({ vertices: rect(440, 490, 400, 150), pitch: '6/12', direction: 'north' });
    expect(res.body).toMatchObject({ roofType: 'gable', confidence: 'high', note: SATELLITE_ESTIMATE_NOTE, imageSize: { width: 1280, height: 1280 } });
    expect(res.body.estimate.pitch).toBe('6/12');
    expect(res.body.estimate.squares).toBeCloseTo(43.7, 1);
    expect(Object.keys(res.body).sort()).toEqual(['confidence', 'estimate', 'facets', 'imageSize', 'note', 'outline', 'roofType']);
  });

  it('stores nothing about the roof: no report, no photo, only the one use that counts the day', async () => {
    const before = await reportCount(a);
    const res = await detect();
    expect(res.status).toBe(200);
    expect(await reportCount(a)).toBe(before);
    const used = await uses(a);
    expect(used.at(-1)).toMatchObject({ kind: 'satellite', status: 'done', reportId: '00000000-0000-0000-0000-000000000000' });
  });

  it('asks the geocoder for the address from the draft, the map for a picture of those coordinates, and the model for the measurement role', async () => {
    await detect({ address: '12 Elm Street', city: 'Cedar Falls', state: 'IA', zip: '50613' });
    expect(lookups).toEqual([{ address: '12 Elm Street' }]);
    expect(pictures).toHaveLength(1);
    const url = new URL(pictures[0].url);
    expect(url.hostname).toBe('maps.googleapis.com');
    expect(url.pathname).toBe('/maps/api/staticmap');
    expect(url.searchParams.get('center')).toBe('42.5349,-92.4453');
    expect(url.searchParams.get('key')).toBe(KEY);
    expect(models).toHaveLength(1);
    expect(models[0].role).toBe('measurement');
    expect(models[0].json).toBe(true);
    expect(models[0].image).toEqual({ base64: Buffer.from('ZZ-FAKE-SATELLITE-PICTURE').toString('base64'), mediaType: 'image/jpeg' });
    // The model is told about the picture, never about the person or the address.
    expect(models[0].prompt).not.toMatch(/Elm|Cedar|Dana|50613|IA\b/);
    expect(models[0].signal).toBeInstanceOf(AbortSignal);
  });

  it('uses the model of the measurement role, from models.ts, and that is a United States provider', () => {
    expect((US_MODEL_PROVIDERS as readonly string[]).includes(ROOF_REPORT_MODELS.measurement.provider)).toBe(true);
    expect(ROOF_REPORT_MODELS.measurement.provider).toBe('groq');
  });

  // ------------------------------------------------------------------ the money
  it('records every paid call for the company that caused it, unpriced: the look-up, the picture and the model', async () => {
    const seen = new Set((await allCosts(a)).map((r) => r.id));
    const res = await detect();
    expect(res.status).toBe(200);
    const rows = (await allCosts(a)).filter((r) => !seen.has(r.id));
    const by = (op: string) => rows.filter((r) => r.operation === op);
    expect(by('geocode')).toHaveLength(1);
    expect(by('satellite_image')).toHaveLength(1);
    expect(by('measurement_detect')).toHaveLength(1);
    expect(by('geocode')[0]).toMatchObject({ provider: 'google', model: 'google-geocoding', priced: false, cents: '0.0000', companyId: a.id });
    expect(by('satellite_image')[0]).toMatchObject({ provider: 'google', model: 'google-static-maps', priced: false, cents: '0.0000', companyId: a.id });
    // The Groq id has no confirmed price: its tokens are kept and it is never given an invented price.
    expect(by('measurement_detect')[0]).toMatchObject({ provider: 'groq', model: ROOF_REPORT_MODELS.measurement.id, priced: false, cents: '0.0000', inputTokens: 1800, outputTokens: 220, companyId: a.id });
    expect((await allCosts(b)).length).toBe(0);
  });

  it('still records the paid calls when the answer is no use', async () => {
    modelAnswer = 'text'; modelText = 'I cannot see a roof.';
    const seen = new Set((await allCosts(a)).map((r) => r.id));
    await detect();
    const ops = (await allCosts(a)).filter((r) => !seen.has(r.id)).map((r) => r.operation);
    expect(ops.filter((o) => o === 'satellite_image')).toHaveLength(1);
    expect(ops.filter((o) => o === 'measurement_detect')).toHaveLength(1);
  });

  // ------------------------------------------------------------------ the key
  it('never lets the map key reach the person, a log, a cost row, a use row or an error record, even when a failure carries it', async () => {
    const leaks = async () => {
      const dump = JSON.stringify({ logs, costs: await allCosts(a), uses: await uses(a), writes: await runAsCompany(a.id, () => db.select().from(schema.writeLog)) });
      expect(dump).not.toContain(KEY);
      expect(dump).not.toContain('key=');
    };
    const seen: string[] = [];
    for (const [setup, status] of [
      [() => {}, 200],
      [() => { pictureAnswer = 'throw'; }, 422],
      [() => { pictureAnswer = 'ok'; modelAnswer = 'throw'; }, 422],
      [() => { modelAnswer = 'ok'; geocodeAnswer = 'throw'; }, 422],
      [() => { geocodeAnswer = 'ok'; pictureAnswer = 'odd'; }, 422],
    ] as Array<[() => void, number]>) {
      geocodeAnswer = 'ok'; pictureAnswer = 'ok'; modelAnswer = 'ok'; setup();
      const res = await detect();
      expect(res.status).toBe(status);
      seen.push(res.text);
      for (const mark of [KEY, 'key=', 'maps.googleapis.com', 'staticmap', 'dana@example.com', 'provider said', 'Media download']) expect(res.text, mark).not.toContain(mark);
      await leaks();
    }
    expect(seen.length).toBe(5);
  });

  // ------------------------------------------------------------------ a bad answer
  it('turns every kind of bad answer into the one plain sentence, stores nothing and does not retry', async () => {
    const bad: Array<[string, () => void]> = [
      ['not json', () => { modelAnswer = 'text'; modelText = 'Sorry, I cannot help with that.'; }],
      ['too few points', () => { modelAnswer = 'text'; modelText = JSON.stringify({ ...ANSWER, outline: ANSWER.outline.slice(0, 2) }); }],
      ['outside the picture', () => { modelAnswer = 'text'; modelText = JSON.stringify({ ...ANSWER, outline: rect(1200, 1200, 300, 300) }); }],
      ['unknown roof type', () => { modelAnswer = 'text'; modelText = JSON.stringify({ ...ANSWER, roofType: 'castle' }); }],
      ['confidence out of range', () => { modelAnswer = 'text'; modelText = JSON.stringify({ ...ANSWER, confidence: 7 }); }],
      ['too many facets', () => { modelAnswer = 'text'; modelText = JSON.stringify({ ...ANSWER, facets: Array.from({ length: 30 }, () => ANSWER.facets[0]) }); }],
      ['empty text', () => { modelAnswer = 'empty'; }],
      ['no text at all', () => { modelAnswer = 'null'; }],
      ['the model failed', () => { modelAnswer = 'throw'; }],
    ];
    for (const [name, setup] of bad) {
      modelAnswer = 'ok'; setup();
      const before = await reportCount(a);
      const res = await detect();
      expect(res.status, name).toBe(422);
      expect(res.body, name).toEqual({ error: SATELLITE_NOT_FOUND });
      expect(await reportCount(a), name).toBe(before);
    }
    expect(SATELLITE_NOT_FOUND).toBe('We could not find the roof in the satellite picture. Enter the measurements by hand.');
    // A bad answer used a use up (a paid call was made), it did not make a result.
    expect((await uses(a)).filter((u) => u.status === 'failed').length).toBeGreaterThanOrEqual(bad.length);
  });

  it('says what went wrong with the address or the picture in a plain sentence of its own', async () => {
    for (const g of ['none', 'nan', 'far', 'zero'] as const) {
      geocodeAnswer = g;
      const res = await detect();
      expect(res.status, g).toBe(422);
      expect(res.body, g).toEqual({ error: GEOCODE_FAILED });
    }
    expect(pictures).toHaveLength(0);
    geocodeAnswer = 'ok';
    for (const p of ['throw', 'text', 'empty'] as const) {
      pictureAnswer = p;
      const res = await detect();
      expect(res.status, p).toBe(422);
      expect(res.body, p).toEqual({ error: SATELLITE_NO_PICTURE });
    }
    expect(models).toHaveLength(0);
  });

  it('counts a press only once something paid for has been called: a lookup that cost nothing and found nothing uses nothing up', async () => {
    const last = async () => (await uses(a)).at(-1)!.status;
    geocodeAnswer = 'free-none';
    expect((await detect()).status).toBe(422);
    expect(await last()).toBe('unused');
    // The picture was asked for (a paid call), so the press counts even though nothing came of it.
    geocodeAnswer = 'free'; pictureAnswer = 'throw';
    expect((await detect()).status).toBe(422);
    expect(await last()).toBe('failed');
    pictureAnswer = 'ok'; modelAnswer = 'throw';
    expect((await detect()).status).toBe(422);
    expect(await last()).toBe('failed');
    // A lookup that was paid for and found nothing counts too.
    modelAnswer = 'ok'; geocodeAnswer = 'none';
    expect((await detect()).status).toBe(422);
    expect(await last()).toBe('failed');
  });

  it('takes a png picture too, and nothing else but a jpeg or a png', async () => {
    pictureAnswer = 'png';
    expect((await detect()).status).toBe(200);
    expect(models.at(-1)!.image!.mediaType).toBe('image/png');
  });

  it('is one deadline: a model that never answers, or a picture that never comes, ends in the plain sentence in time', async () => {
    modelAnswer = 'hang';
    const t0 = Date.now();
    const res = await detect();
    expect(res.status).toBe(422);
    expect(res.body).toEqual({ error: SATELLITE_NOT_FOUND });
    expect(Date.now() - t0).toBeLessThan(5000);
    modelAnswer = 'deaf';
    const t1 = Date.now();
    const deaf = await detect();
    expect(deaf.status).toBe(422);
    expect(deaf.body).toEqual({ error: SATELLITE_NOT_FOUND });
    expect(Date.now() - t1).toBeLessThan(5000);
    modelAnswer = 'ok'; pictureAnswer = 'slow';
    const res2 = await detect();
    expect(res2.status).toBe(422);
    expect(res2.body).toEqual({ error: SATELLITE_NO_PICTURE });
    pictureAnswer = 'ok'; geocodeAnswer = 'slow';
    expect((await detect()).status).toBe(422);
    // Every call after the first is given only what is left of the one deadline.
    pictureAnswer = 'ok'; geocodeAnswer = 'ok';
    await detect();
    expect(pictures.at(-1)!.timeoutMs).toBeLessThanOrEqual(600);
    expect(pictures.at(-1)!.timeoutMs).toBeGreaterThan(0);
  });

  // ------------------------------------------------------------------ not set up
  it('says it is not available, and calls and counts nothing, when there is no map key or no model', async () => {
    keyPresent = false;
    const before = (await uses(a)).length;
    let res = await detect();
    expect(res.status).toBe(422);
    expect(res.body).toEqual({ error: SATELLITE_NOT_AVAILABLE });
    keyPresent = true; configured = false;
    res = await detect();
    expect(res.body).toEqual({ error: SATELLITE_NOT_AVAILABLE });
    expect(lookups.length + pictures.length + models.length).toBe(0);
    expect((await uses(a)).length).toBe(before);
  });

  // ------------------------------------------------------------------ the body
  it('reads only an address, a city, a state and a ZIP, and says plainly what is missing', async () => {
    const cases: Array<[unknown, number, string]> = [
      [{ ...WHERE, address: '' }, 400, NEEDS_ADDRESS], [{ ...WHERE, address: undefined }, 400, NEEDS_ADDRESS], [{ ...WHERE, city: '' }, 400, NEEDS_CITY_STATE],
      [{ ...WHERE, state: '' }, 400, NEEDS_CITY_STATE], [{ ...WHERE, address: 'x'.repeat(201) }, 400, TEXT_TOO_LONG], [{ ...WHERE, latitude: 1, longitude: 2 }, 400, NEEDS_ADDRESS],
      [{ ...WHERE, companyId: a.id }, 400, NEEDS_ADDRESS], [[], 400, NEEDS_ADDRESS],
    ];
    for (const [body, status, sentence] of cases) {
      const res = await detect(body);
      expect(res.status, JSON.stringify(body)).toBe(status);
      expect(res.body, JSON.stringify(body)).toEqual({ error: sentence });
    }
    expect(lookups.length + pictures.length + models.length).toBe(0);
  });

  it('refuses a request key that is not usable', async () => {
    for (const k of ['short', 'has space in it', 'x'.repeat(201), 'bad/char/in/key']) {
      const res = await detect(WHERE, k);
      expect(res.status, k).toBe(400);
      expect(res.body, k).toEqual({ error: BAD_REQUEST_KEY });
    }
    expect(lookups).toHaveLength(0);
  });

  // ------------------------------------------------------------------ one press, once
  it('does the work once for one request key: the same press again is told it was already asked for, and nothing is paid twice', async () => {
    const k = key();
    expect((await detect(WHERE, k)).status).toBe(200);
    const again = await detect(WHERE, k);
    expect(again.status).toBe(409);
    expect(again.body).toEqual({ error: SATELLITE_REPEAT });
    expect(lookups).toHaveLength(1);
    expect(pictures).toHaveLength(1);
    expect(models).toHaveLength(1);
    const other = await detect({ ...WHERE, address: '40 Birch Lane' }, k);
    expect(other.status).toBe(409);
    expect(other.body).toEqual({ error: SATELLITE_KEY_REUSED });
  });

  it('lets a press try again with the same key after the first did not work', async () => {
    const k = key();
    modelAnswer = 'throw';
    expect((await detect(WHERE, k)).status).toBe(422);
    modelAnswer = 'ok';
    expect((await detect(WHERE, k)).status).toBe(200);
  });

  it('holds two presses that arrive together with one key to one paid run', async () => {
    const k = key();
    let release!: () => void; gate = new Promise<void>((r) => { release = r; });
    const both = Promise.all([detect(WHERE, k), detect(WHERE, k)]);
    await new Promise((r) => setTimeout(r, 150));
    release();
    const [x, y] = await both;
    expect([x.status, y.status].sort()).toEqual([200, 409]);
    expect(lookups).toHaveLength(1);
    expect(pictures).toHaveLength(1);
    expect(models).toHaveLength(1);
  });

  // ------------------------------------------------------------------ the day's limit
  it('stops at the company\'s daily limit before anything is paid for, and another company is not held by it', async () => {
    caps = { perCompany: 3 };
    const already = (await uses(a)).filter((u) => u.status !== 'unused' && Date.now() - u.createdAt.getTime() < 86_400_000).length;
    // Use up what is left of today's, whatever earlier tests spent.
    for (let i = already; i < 3; i++) expect((await detect()).status).toBe(200);
    const calls = [lookups.length, pictures.length, models.length];
    const res = await detect();
    expect(res.status).toBe(429);
    expect(res.body).toEqual({ error: SATELLITE_CAPPED });
    expect([lookups.length, pictures.length, models.length]).toEqual(calls);
    h.as(b, 'admin');
    expect((await detect()).status).toBe(200);
  });

  it('holds the limit when many presses arrive together: no more than the limit are paid for', async () => {
    h.as(b, 'admin');
    caps = { perCompany: 3 };
    const startedWith = (await uses(b)).filter((u) => u.status !== 'unused').length;
    const room = Math.max(0, 3 - startedWith);
    let release!: () => void; gate = new Promise<void>((r) => { release = r; });
    const all = Promise.all(Array.from({ length: 8 }, () => detect()));
    await new Promise((r) => setTimeout(r, 200));
    release();
    const results = await all;
    expect(results.filter((r) => r.status === 200).length).toBe(room);
    expect(results.filter((r) => r.status === 429).length).toBe(8 - room);
    expect(lookups.length).toBe(room);
  });

  it('slows a person who presses it a great deal in a few minutes', async () => {
    let last = 0;
    for (let i = 0; i < 40; i++) { const res = await detect(WHERE, null); last = res.status; if (res.status === 429) { expect(res.body).toEqual({ error: SATELLITE_TOO_FAST }); break; } }
    expect(last).toBe(429);
  });

  // ------------------------------------------------------------------ who may
  it('lets the people who may make a report use it, and answers crew "not found" without calling or counting anything', async () => {
    for (const who of ['admin', 'csr', 'manager', 'repa']) { h.as(a, who); expect((await detect()).status, who).toBe(200); }
    const calls = [lookups.length, pictures.length, models.length];
    const useCount = (await uses(a)).length;
    h.as(a, 'crew');
    const res = await detect();
    expect(res.status).toBe(404);
    expect([lookups.length, pictures.length, models.length]).toEqual(calls);
    expect((await uses(a)).length).toBe(useCount);
    h.signedOut();
    expect((await detect()).status).toBe(401);
  });

  it('is a bare 404 while the switch is off', async () => {
    process.env.ARCHIE_ROOF_REPORTS = 'off';
    try {
      const res = await detect();
      expect(res.status).toBe(404);
      expect(res.text).toBe('');
      expect(lookups).toHaveLength(0);
    } finally { process.env.ARCHIE_ROOF_REPORTS = 'on'; }
  });
});
