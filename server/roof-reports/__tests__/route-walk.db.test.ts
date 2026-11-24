/**
 * PERMANENT. Never delete, skip or weaken this file.
 *
 * Builds the real app, lists EVERY route it registers that is a roof report
 * route (read from the router itself, so a route added later is walked with no
 * change here), and calls each one:
 *
 *   - as another company's person, with this company's ids in the address, the
 *     query and the body: the answer must be "not found" and carry nothing of
 *     this company's;
 *   - as a person of this company who may not see the report (a salesperson
 *     who does not own it) and as crew: "not found" again, and the report is
 *     left exactly as it was;
 *   - as the people who may see it, on the routes that only read: no server
 *     error and nothing of the other company's;
 *   - with the switch off, as anyone or no one: a bare 404, and nothing changes.
 *
 * A short signed photo link is the one route that answers without a session,
 * because the signature IS its check. It is walked with this company's ids and
 * no valid signature, and must be "not found" for everyone.
 *
 * A new route is walked the moment it exists. One that must be open to a role
 * that is refused here has to be decided on purpose in the tables below.
 * Fictional companies: Summit Ridge Roofing and Cedar Falls Roofing Two.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import express from 'express';
import { Readable } from 'node:stream';
import { localDb, startCrewApp, type Co } from '../../crews/__tests__/harness';
import { makeJpeg } from '../../photos/__tests__/jpeg-fixtures';
import { makeReport } from '../../lib/roof-reports/__tests__/fixtures/report';

vi.mock('../../integrations/jobtread', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../integrations/jobtread')>();
  const { throwingClient } = await import('../../crews/__tests__/harness');
  return { ...real, JobTreadClient: throwingClient('jobtread') };
});
vi.mock('../../integrations/gohighlevel', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../integrations/gohighlevel')>();
  const { throwingClient } = await import('../../crews/__tests__/harness');
  return { ...real, GoHighLevelClient: throwingClient('kynexPro') };
});
vi.mock('@vercel/functions', () => ({ waitUntil: () => {} }));
vi.mock('../../seed', () => ({ seedCompany: async () => {}, seedAll: async () => {}, SEED_JOB: 'seed-company', seedVersion: () => 'test' }));

/** Every route an Express 4 app registers, with its full path, nested routers included. */
function allRoutes(app: express.Express): Array<{ method: string; path: string }> {
  const out: Array<{ method: string; path: string }> = [];
  const mountOf = (layer: any): string => {
    const src: string = layer.regexp?.source ?? '';
    if (layer.regexp?.fast_slash || src === '^\\/?(?=\\/|$)') return '';
    return src.replace(/^\^/, '').replace(/\\\/\?\(\?=\\\/\|\$\)$/i, '').replace(/\\\//g, '/');
  };
  const walk = (stack: any[], prefix: string) => {
    for (const l of stack) {
      if (l.route) {
        const paths = Array.isArray(l.route.path) ? l.route.path : [l.route.path];
        for (const p of paths) for (const m of Object.keys(l.route.methods)) out.push({ method: m.toUpperCase(), path: `${prefix}${p}` });
      } else if (l.handle?.stack) {
        walk(l.handle.stack, `${prefix}${mountOf(l)}`);
      }
    }
  };
  walk((app as any)._router.stack, '');
  return out;
}

const isRoofReportRoute = (path: string) => path === '/api/roof-reports' || path.startsWith('/api/roof-reports/') || /^\/api\/clients\/:\w+\/roof-reports/.test(path);

/** A route that names something by id: asked about another company's thing it must say "not found". */
const NAMES_SOMETHING = /:(id|photoId|token|externalId)\b/;

describe.skipIf(!localDb)('every roof report route, walked (PERMANENT)', async () => {
  const tag = `rrwalk-${process.pid}-${Date.now()}`;
  const h = await startCrewApp(tag);
  const { db, schema, runAsCompany, as, send } = h;
  const { eq } = await import('drizzle-orm');
  const { setPhotoStoreForTests } = await import('../../photos/store');
  const { registerRoutes } = await import('../../routes');
  const { signPhotoLink } = await import('../photo-links');

  const stored = new Map<string, Buffer>();
  const fakeStore = {
    put: async (key: string, body: Buffer) => { stored.set(key, Buffer.from(body)); },
    get: async (key: string) => { const b = stored.get(key); return b ? { body: Readable.from(b), length: b.length } : null; },
  };

  let a: Co; let b: Co;
  let reportA = ''; let photoA = ''; let jobA = ''; let reportB = ''; let tokenA = '';
  const A_MARKS = ['12 Elm Street', 'Dana Whitfield', 'dana@example.com'];
  const B_MARKS = ['9 Oak Road', 'Pat Brown'];
  const savedSwitch = process.env.ARCHIE_ROOF_REPORTS;

  const routes = (): Array<{ method: string; path: string }> => {
    const app = express();
    registerRoutes(app);
    const seen = new Set<string>();
    return allRoutes(app).map((r) => ({ ...r, path: r.path.length > 1 ? r.path.replace(/\/+$/, '') : r.path })).filter((r) => isRoofReportRoute(r.path) && !r.path.includes(',') && !seen.has(`${r.method} ${r.path}`) && seen.add(`${r.method} ${r.path}`));
  };

  /** A value for each parameter, always from company A: its report, its photo, its job. */
  const fill = (path: string) => path.replace(/:(\w+)\??/g, (_m, name: string) => {
    if (name === 'id') return reportA;
    if (name === 'photoId') return photoA;
    if (name === 'variant') return 'working';
    if (name === 'externalId') return jobA;
    if (name === 'token') return forged;
    return '1';
  });
  /** A signed link for company A's photo with no real signature: what someone who only knows the ids could make. */
  let forged = '';

  /** What to send to a route: a body that names company A's job, photo and report, and tries to name the company. */
  const bodyFor = (method: string): unknown => (method === 'POST' || method === 'PUT' ? {
    reportTypes: ['storm'], address: '1 Walk Road', city: 'Cedar Falls', state: 'IA', jobExternalId: jobA, photoIds: [photoA],
    companyId: a.id, company_id: a.id, title: 'walk', status: 'ready', reportId: reportA,
  } : undefined);
  const call = (r: { method: string; path: string }) => send(r.method, fill(r.path), bodyFor(r.method));

  const rowOfA = () => runAsCompany(a.id, async () => (await db.select().from(schema.roofReports).where(eq(schema.roofReports.id, reportA)))[0]);
  const countA = () => runAsCompany(a.id, async () => (await db.select().from(schema.roofReports)).length);
  const photosA = () => runAsCompany(a.id, async () => (await db.select().from(schema.roofReportPhotos)).length);

  beforeAll(async () => {
    setPhotoStoreForTests(fakeStore);
    process.env.ARCHIE_ROOF_REPORTS = 'on';
    h.blockOutside();
    a = await h.company('Summit Ridge Roofing', false, [['admin', 'admin'], ['csr', 'customer_service'], ['manager', 'manager'], ['repa', 'sales'], ['repb', 'sales'], ['crew', 'production']]);
    b = await h.company('Cedar Falls Roofing Two', false, [['admin', 'admin'], ['csr', 'customer_service'], ['repa', 'sales'], ['crew', 'production']]);
    jobA = `${tag}-jobA`;
    await runAsCompany(a.id, () => db.insert(schema.leads).values({ externalId: jobA, source: 'jobtread', firstName: 'Dana', jtSalesRep: 'Rep repa' } as any));
    await runAsCompany(b.id, () => db.insert(schema.leads).values({ externalId: `${tag}-jobB`, source: 'jobtread', firstName: 'Pat', jtSalesRep: 'Rep repa' } as any));
    // Company A's report, on repa's job, with a photo in it.
    as(a, 'repa');
    const up = await fetch(`${h.base}/api/roof-reports/photos`, { method: 'POST', headers: { 'content-type': 'image/jpeg' }, body: new Uint8Array(makeJpeg()) });
    const upBody = (await up.json()) as any;
    photoA = upBody.id;
    if (!photoA) throw new Error(`upload answered ${up.status} ${JSON.stringify(upBody)}`);
    expect(photoA).toMatch(/^[0-9a-f-]{36}$/);
    const [r1] = await runAsCompany(a.id, () => db.insert(schema.roofReports).values({
      address: '12 Elm Street', city: 'Cedar Falls', state: 'IA', reportTypes: ['inspection'], status: 'ready', jobExternalId: jobA,
      createdByMemberId: a.people.repa.id, customerName: 'Dana Whitfield', customerEmail: 'dana@example.com', title: 'Walk report A',
      reportJson: makeReport({ id: 'walk-report-a' }),
    } as any).returning());
    reportA = r1.id;
    await runAsCompany(a.id, () => db.update(schema.roofReportPhotos).set({ reportId: reportA }).where(eq(schema.roofReportPhotos.id, photoA)));
    const [r2] = await runAsCompany(b.id, () => db.insert(schema.roofReports).values({
      address: '9 Oak Road', city: 'Cedar Falls', state: 'IA', reportTypes: ['storm'], status: 'ready', customerName: 'Pat Brown', title: 'Walk report B',
    } as any).returning());
    reportB = r2.id;
    forged = `${Buffer.from(JSON.stringify({ c: a.id, r: reportA, p: photoA, v: 'working', e: Math.floor(Date.now() / 1000) + 600 })).toString('base64url')}.${'A'.repeat(43)}`;
    tokenA = signPhotoLink({ companyId: a.id, reportId: reportA, photoId: photoA, variant: 'working' });
  });
  afterAll(() => {
    setPhotoStoreForTests(null);
    vi.restoreAllMocks();
    if (savedSwitch === undefined) delete process.env.ARCHIE_ROOF_REPORTS; else process.env.ARCHIE_ROOF_REPORTS = savedSwitch;
    h.server.close();
  });

  it('finds the roof report routes, so the walk cannot quietly walk nothing', () => {
    const lines = routes().map((r) => `${r.method} ${r.path}`);
    expect(lines).toEqual(expect.arrayContaining([
      'GET /api/roof-reports/status', 'POST /api/roof-reports/photos', 'GET /api/roof-reports/:id/photos/:photoId/:variant',
      'GET /api/roof-reports/linked-photo/:token', 'POST /api/roof-reports/generate', 'GET /api/roof-reports', 'GET /api/roof-reports/:id',
      'PUT /api/roof-reports/:id', 'POST /api/roof-reports/:id/archive', 'POST /api/roof-reports/:id/retry', 'GET /api/roof-reports/:id/html',
      'GET /api/clients/:externalId/roof-reports',
    ]));
    // Written out by hand, so a route added or removed is seen and decided on purpose.
    expect(lines.sort()).toEqual([
      'DELETE /api/roof-reports/photos/:photoId', 'GET /api/clients/:externalId/roof-reports', 'GET /api/roof-reports', 'GET /api/roof-reports/:id', 'GET /api/roof-reports/:id/html',
      'GET /api/roof-reports/:id/photos/:photoId/:variant', 'GET /api/roof-reports/linked-photo/:token', 'GET /api/roof-reports/status',
      'POST /api/roof-reports/:id/archive', 'POST /api/roof-reports/:id/retry', 'POST /api/roof-reports/generate', 'POST /api/roof-reports/photos',
      'PUT /api/roof-reports/:id',
    ].sort());
  });

  it('refuses a person of another company on every route, with this company\'s ids, and hands over nothing', async () => {
    const before = { row: await rowOfA(), reports: await countA(), photos: await photosA() };
    for (const r of routes()) {
      for (const who of ['admin', 'csr', 'repa', 'crew']) {
        as(b, who);
        const res = await call(r);
        const label = `${who} of the other company: ${r.method} ${r.path}`;
        if (NAMES_SOMETHING.test(r.path)) expect(res.status, label).toBe(404);
        else if (r.path.endsWith('/generate')) expect(res.status, label).toBe(404);
        else if (who === 'crew') expect(res.status, label).toBe(404);
        else expect(res.status, label).toBeLessThan(500);
        for (const mark of [...A_MARKS, reportA, photoA, jobA]) expect(res.text, `${label} leaked ${mark}`).not.toContain(mark);
        expect(res.text, label).not.toMatch(/node_modules|\bat \w+ \(|postgres|password/i);
      }
    }
    expect(await rowOfA()).toEqual(before.row);
    expect(await countA()).toBe(before.reports);
    expect(await photosA()).toBe(before.photos);
  }, 120_000);

  it('refuses crew, and a salesperson who does not own the report, on every route that names it, and changes nothing', async () => {
    const before = { row: await rowOfA(), reports: await countA(), photos: await photosA() };
    for (const r of routes()) {
      for (const who of ['crew', 'repb']) {
        as(a, who);
        const res = await call(r);
        const label = `${who}: ${r.method} ${r.path}`;
        if (NAMES_SOMETHING.test(r.path) || who === 'crew' || r.path.endsWith('/generate')) expect(res.status, label).toBe(404);
        else expect(res.status, label).toBeLessThan(500);
        for (const mark of [...A_MARKS, reportA, photoA]) expect(res.text, `${label} leaked ${mark}`).not.toContain(mark);
      }
    }
    expect(await rowOfA()).toEqual(before.row);
    expect(await countA()).toBe(before.reports);
    expect(await photosA()).toBe(before.photos);
  }, 120_000);

  it('lets the people who may see the report read it, and never shows them the other company\'s', async () => {
    for (const who of ['admin', 'csr', 'manager', 'repa']) {
      for (const r of routes().filter((x) => x.method === 'GET' && x.path !== '/api/roof-reports/linked-photo/:token')) {
        as(a, who);
        const res = await call(r);
        const label = `${who}: ${r.method} ${r.path}`;
        expect(res.status, label).toBeLessThan(500);
        for (const mark of [...B_MARKS, reportB]) expect(res.text, `${label} leaked ${mark}`).not.toContain(mark);
      }
    }
    // The owner and the office see this one; the manager (leading nobody here) and the other rep do not.
    as(a, 'repa'); expect((await send('GET', `/api/roof-reports/${reportA}`)).status).toBe(200);
    as(a, 'admin'); expect((await send('GET', `/api/roof-reports/${reportA}`)).status).toBe(200);
    as(a, 'csr'); expect((await send('GET', `/api/roof-reports/${reportA}`)).status).toBe(200);
    as(a, 'manager'); expect((await send('GET', `/api/roof-reports/${reportA}`)).status).toBe(404);
  });

  it('answers a signed photo link made up from the ids alone with "not found", whoever holds it, and a real one only for its one photo', async () => {
    for (const [co, who] of [[a, 'admin'], [b, 'admin'], [a, 'crew']] as Array<[Co, string]>) {
      as(co, who);
      expect((await send('GET', `/api/roof-reports/linked-photo/${forged}`)).status, who).toBe(404);
    }
    // The decided exception: the link made after the access rules passed is itself the credential.
    expect((await send('GET', `/api/roof-reports/linked-photo/${tokenA}`)).status).toBe(200);
  });

  it('is a bare 404 on every route while the switch is off, for anyone, and changes nothing', async () => {
    const before = { row: await rowOfA(), reports: await countA(), photos: await photosA() };
    process.env.ARCHIE_ROOF_REPORTS = 'off';
    try {
      for (const r of routes()) {
        for (const [co, who] of [[a, 'admin'], [a, 'repa'], [b, 'admin']] as Array<[Co, string]>) {
          as(co, who);
          const res = await call(r);
          expect(res.status, `${who}: ${r.method} ${r.path}`).toBe(404);
          expect(res.text, `${who}: ${r.method} ${r.path}`).toBe('');
        }
      }
      delete process.env.ARCHIE_ROOF_REPORTS;
      for (const r of routes()) {
        as(a, 'admin');
        const res = await call(r);
        expect(res.status, `unset: ${r.method} ${r.path}`).toBe(404);
        expect(res.text).toBe('');
      }
    } finally {
      process.env.ARCHIE_ROOF_REPORTS = 'on';
    }
    expect(await rowOfA()).toEqual(before.row);
    expect(await countA()).toBe(before.reports);
    expect(await photosA()).toBe(before.photos);
  }, 120_000);
});
