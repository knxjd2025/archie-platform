/**
 * PERMANENT. Crews never see money (Stage D, docs/archie/02-roof-lee-link.md,
 * "Crews and install dates"; the plan's correction 8).
 *
 * Builds the real app, lists EVERY read route it registers (nested routers
 * included), and calls each one as a crew member of a company Roof Lee made,
 * whose crew is booked on a job that carries a price. Each answer must be a
 * refusal, or carry no money field with anything in it and nowhere hold the
 * job's price. A route added later is walked without anyone touching this
 * file, so a new route that hands a crew a price fails here.
 *
 * Do not delete, skip or weaken it. A route that must show money to a crew
 * does not exist: crews never see prices.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Readable } from 'node:stream';
import express from 'express';
import { localDb, startCrewApp, type Co } from './harness';
import { makeJpeg } from '../../photos/__tests__/jpeg-fixtures';

vi.mock('../../integrations/jobtread', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../integrations/jobtread')>();
  const { throwingClient } = await import('./harness');
  return { ...real, JobTreadClient: throwingClient('jobtread') };
});
vi.mock('../../integrations/gohighlevel', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../integrations/gohighlevel')>();
  const { throwingClient } = await import('./harness');
  return { ...real, GoHighLevelClient: throwingClient('kynexPro') };
});
vi.mock('@vercel/functions', () => ({ waitUntil: () => {} }));
vi.mock('../../seed', () => ({ seedCompany: async () => {}, seedAll: async () => {}, SEED_JOB: 'seed-company', seedVersion: () => 'test' }));

/** The job's price. Unusual on purpose, so finding it anywhere means it leaked. */
const PRICE = '987654.32';
const PRICE_MARKS = ['987654', '987,654'];

/**
 * A key that names money. Exact names, and anything ending in a money word
 * ("approvedPrice", "contractTotal", "jobValue"), so a renamed field is still caught.
 */
const MONEY_KEY = /^(price|prices|amount|amounts|total|totals|subtotal|value|cost|costs|balance|revenue|commission|commissions|estimate|estimates|invoice|invoices|payout|payouts|deposit|paid|owed|overdueAR|ar)$|(Price|Prices|Amount|Total|Totals|Value|Cost|Costs|Balance|Revenue|Commission|Commissions|Estimate|Estimates|Invoice|Invoices|Payout|Payouts|Owed)$/;

/** Money keys in an answer that hold anything at all. */
export function moneyFound(body: unknown, path = '$'): string[] {
  if (Array.isArray(body)) return body.flatMap((v, i) => moneyFound(v, `${path}[${i}]`));
  if (!body || typeof body !== 'object') return [];
  const out: string[] = [];
  for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
    // A zero is the placeholder a refused figure is given (e.g. revenue: 0); it hands nothing over.
    const empty = v === null || v === undefined || v === 0 || (Array.isArray(v) && v.length === 0);
    if (MONEY_KEY.test(k) && !empty) out.push(`${path}.${k}`);
    out.push(...moneyFound(v, `${path}.${k}`));
  }
  return out;
}

/** Every route an Express 4 app registers, with its full path, nested routers included. */
export function allRoutes(app: express.Express): Array<{ method: string; path: string }> {
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

/**
 * Fields whose NAME looks like money but whose content is not, each read and
 * decided by a person, with the reason. Array positions are written as [].
 * Add a line here only after reading what the route really returns to a crew.
 */
const NOT_MONEY: Record<string, string> = {
  '/api/leads $.total': 'how many leads the list holds (none, for a crew)',
  '/api/leads/pipeline/summary $.total': 'how many leads there are, a count',
  '/api/kpis/summary $.totals': 'counts of calls, doors and the like, for the person\'s own row',
  '/api/knowledge/categories $[].value': 'a category\'s key, beside its label',
  '/api/goals/me $.inputs.avgCommission': 'the person\'s own goal planner, filled with the planner\'s defaults until they change it; nothing a job or the company holds',
};
const decided = (route: string, field: string) => `${route} ${field.replace(/\[\d+\]/g, '[]')}` in NOT_MONEY;

describe('moneyFound', () => {
  it('finds a money field by name, at any depth, and ignores empty ones and look-alikes', () => {
    expect(moneyFound({ jobs: [{ projectedValue: 12, name: 'x' }] })).toEqual(['$.jobs[0].projectedValue']);
    expect(moneyFound({ contractTotal: '9', estimates: [{ id: 1 }], approvedPrice: null, invoices: [] })).toEqual(['$.contractTotal', '$.estimates']);
    expect(moneyFound({ totalFiles: 3, depositReceivedAt: null, statusLabel: 'Done', startTime: '07:00', revenue: 0 })).toEqual([]);
  });
});

describe.skipIf(!localDb)('a crew member, on every read route Archie has (PERMANENT)', async () => {
  const tag = `crewmoney-${process.pid}-${Date.now()}`;
  const h = await startCrewApp(tag);
  const { db, schema, runAsCompany, as, get, post, put } = h;
  const { eq } = await import('drizzle-orm');
  const { setPhotoStoreForTests } = await import('../../photos/store');
  const { registerRoutes } = await import('../../routes');

  const stored = new Map<string, Buffer>();
  const fakeStore = {
    put: async (key: string, body: Buffer) => { stored.set(key, Buffer.from(body)); },
    get: async (key: string) => { const b = stored.get(key); return b ? { body: Readable.from(b), length: b.length } : null; },
  };

  let a: Co;
  let jobKey = '';
  let photoId = '';
  let roofliId = '';

  beforeAll(async () => {
    setPhotoStoreForTests(fakeStore);
    h.blockOutside();
    a = await h.company('Summit Ridge Roofing', true, [['owner', 'admin'], ['office', 'customer_service'], ['rep', 'sales'], ['crew', 'production']]);
    as(a, 'rep');
    const lead = await post('/api/leads/create', { firstName: 'Pat', lastName: 'Hollis', address: '12 Main St', city: 'Cedar Falls', state: 'IA' });
    jobKey = lead.body.jobId;
    await runAsCompany(a.id, () => db.update(schema.leads).set({ projectedValue: PRICE }).where(eq(schema.leads.externalId, jobKey)));
    as(a, 'office');
    expect((await post(`/api/production/${jobKey}/pipeline/stage`, { stage: 'approved' })).status).toBe(200);
    const crew = await post('/api/crews', { name: `Walk ${tag}` });
    await put(`/api/crews/${crew.body.crew.id}/members`, { memberIds: [a.people.crew.id] });
    expect((await put(`/api/jobs/${jobKey}/install`, { crewId: crew.body.crew.id, installDate: '2026-11-24' })).status).toBe(200);
    as(a, 'crew');
    const photo = await post(`/api/crew/jobs/${jobKey}/photos`, { base64: makeJpeg().toString('base64'), phase: 'during' });
    photoId = photo.body.fileId;
    const [co] = await h.runAsSystem('test: read the company', () => db.select().from(schema.companies).where(eq(schema.companies.id, a.id)));
    roofliId = co.roofliCompanyId!;
    vi.restoreAllMocks();
  });
  afterAll(() => { setPhotoStoreForTests(null); h.server.close(); });
  beforeEach(() => { h.blockOutside(); });
  afterEach(() => { vi.restoreAllMocks(); });

  /** A value for each route parameter: the crew's own job, its photo, the company. */
  const fill = (path: string) => path.replace(/:(\w+)\??/g, (_m, name: string) => {
    if (/^(externalId|key|jobId|jobExternalId)$/.test(name)) return jobKey;
    if (name === 'variant') return 'thumb';
    if (name === 'roofliCompanyId') return roofliId;
    if (name === 'id' || name === 'photoId') return photoId;
    return '1';
  });

  /** Read routes that start work or answer only to a signed caller, never to a session. */
  const SKIP = (path: string) => /(^|\/)cron(\/|$)|\/cron,|^\/api\/sister\/|\/callback$|^\/r\//.test(path);

  function readRoutes(): string[] {
    const app = express();
    registerRoutes(app);
    const seen = new Set<string>();
    for (const r of allRoutes(app)) {
      if (r.method !== 'GET' || r.path.includes(',') || SKIP(r.path)) continue;
      seen.add(r.path);
    }
    return [...seen].sort();
  }

  it('walks the routes that hold money, so the walk cannot quietly miss them', () => {
    const routes = readRoutes();
    expect(routes.length).toBeGreaterThan(100);
    expect(routes).toEqual(expect.arrayContaining([
      '/api/production', '/api/clients/:externalId', '/api/clients/:externalId/estimates', '/api/clients/:externalId/daily-logs',
      '/api/commissions', '/api/job-commissions', '/api/kpis/summary', '/api/dashboard/summary', '/api/sales', '/api/claims',
      '/api/financial/quickbooks/profit-loss', '/api/crew/jobs', '/api/crew/jobs/:key', '/api/crews/week',
    ]));
  });

  it('finds the price when the owner reads the board, so finding nothing below means something', async () => {
    as(a, 'owner');
    const board = await get('/api/production');
    expect(board.status).toBe(200);
    expect(PRICE_MARKS.some((m) => board.text.includes(m))).toBe(true);
    expect(moneyFound(board.body).length).toBeGreaterThan(0);
  });

  it('hands a crew member no money on any of them', async () => {
    const leaks: string[] = [];
    for (const route of readRoutes()) {
      as(a, 'crew');
      const path = fill(route);
      const r = await get(path).catch((e) => ({ status: 0, body: null, text: String(e) }));
      if (r.status < 200 || r.status >= 300) continue; // refused: nothing handed over
      if (PRICE_MARKS.some((m) => r.text.includes(m))) leaks.push(`${route}: holds the job's price`);
      for (const k of moneyFound(r.body)) if (!decided(route, k)) leaks.push(`${route}: ${k}`);
    }
    expect(leaks).toEqual([]);
  }, 120_000);

  it('answers 404 to a crew member on the job routes that check only ownsLead', async () => {
    as(a, 'crew');
    for (const path of [`/api/clients/${jobKey}`, `/api/clients/${jobKey}/estimates`, `/api/clients/${jobKey}/daily-logs`]) {
      expect((await get(path)).status, path).toBe(404);
    }
  });

  it('hands a crew member no money from the crew\'s own writes either', async () => {
    as(a, 'crew');
    for (const [path, body] of [
      [`/api/crew/jobs/${jobKey}/status`, { status: 'in_progress' }],
      [`/api/crew/jobs/${jobKey}/trade-done`, { trade: 'roofing' }],
      [`/api/crew/jobs/${jobKey}/status`, { status: 'done' }],
    ] as const) {
      const r = await post(path, body);
      expect(r.status, path).toBe(200);
      expect(PRICE_MARKS.some((m) => r.text.includes(m)), path).toBe(false);
      expect(moneyFound(r.body), path).toEqual([]);
    }
  });
});
