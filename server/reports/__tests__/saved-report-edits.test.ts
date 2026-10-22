/**
 * Edits to a saved report, against a real database: the re-render that feeds
 * the live /r/:token copy, the refine that used to throw away a save made while
 * the AI was thinking, and the poll that answered for any job.
 *
 * Needs DATABASE_URL (the local bra_e2e database); skipped without one.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest';
import express from 'express';
import { inCompany, makeTestCompany, TEST_COMPANY_ID } from '../../__tests__/helpers/tenant';

// Every test here runs as a real test company (row level security is on).
let __co = TEST_COMPANY_ID;
const as = inCompany(() => __co);
beforeAll(async () => { if (process.env.DATABASE_URL) __co = await makeTestCompany('reports'); });

const mocks = vi.hoisted(() => ({
  renderEstimate: vi.fn(),
  refine: vi.fn(),
  owns: vi.fn(),
}));
vi.mock('../../lib/reports/render-estimate-html.js', () => ({
  renderEstimateHtml: mocks.renderEstimate,
  estimateSections: () => [],
}));
vi.mock('../../inspections/lookup', () => ({
  getLatestInspectionContext: async () => ({ jobType: 'insurance', recommendation: 'Replace', damageSummary: 'Hail across the south slope' }),
}));
vi.mock('../../ai/assist-service', async (importOriginal) => ({ ...await importOriginal<object>(), refineReport: mocks.refine }));
vi.mock('../../access/rep-scope', async (importOriginal) => ({ ...await importOriginal<object>(), ownsLead: mocks.owns }));

const hasDb = !!process.env.DATABASE_URL;
const JOB = `test-rpt-${process.pid}-${Date.now()}`;
let seq = 0;

type Routes = typeof import('../routes');
let routes: Routes;
let dbm: typeof import('../../db');
let schema: typeof import('../../../shared/schema');
let orm: typeof import('drizzle-orm');
let unchanged: typeof import('../unchanged-since');

async function makeReport() {
  const reportId = `${JOB}-${++seq}`;
  const [row] = await dbm.db.insert(schema.clientReports).values({
    jobExternalId: JOB, reportId, reportType: 'estimate', status: 'succeeded', html: '<html>old</html>',
    data: { title: 'Roof estimate', customerName: 'Karen Whitfield', repairEstimate: { lineItems: [], total: 0 } },
  }).returning();
  return row;
}

const reread = async (id: number) =>
  (await dbm.db.select().from(schema.clientReports).where(orm.eq(schema.clientReports.id, id)))[0];

function routeHandler(method: 'get' | 'put' | 'post', path: string) {
  const app = express();
  const spy = vi.spyOn(app, method);
  routes.registerRoofReportRoutes(app);
  const args = spy.mock.calls.find((c) => c[0] === path) as unknown[] | undefined;
  if (!args) throw new Error(`no ${method} ${path}`);
  const handler = args[args.length - 1] as (req: unknown, res: unknown) => Promise<unknown>;
  return async (req: Record<string, unknown>) => {
    let status = 200; let body: unknown = null;
    const res: Record<string, unknown> = {};
    Object.assign(res, {
      status: (s: number) => { status = s; return res; },
      json: (b: unknown) => { body = b; return res; },
      send: (b: unknown) => { body = b; return res; },
      set: () => res,
    });
    await handler({ headers: {}, query: {}, body: {}, session: { user: { email: 'rep@acme.test', name: 'Rep', role: 'sales' } }, ...req }, res);
    return { status, body };
  };
}

beforeAll(as(async () => {
  if (!hasDb) return;
  routes = await import('../routes');
  dbm = await import('../../db');
  schema = await import('../../../shared/schema');
  orm = await import('drizzle-orm');
  unchanged = await import('../unchanged-since');
  // Importing the reports routes pulls in most of the server; under the full
  // suite's load that took longer than the default 10s hook limit.
}), 60_000);

afterAll(as(async () => {
  // Skip cleanup if setup never finished, rather than crash on undefined.
  if (!hasDb || !dbm) return;
  await dbm.db.delete(schema.clientReports).where(orm.eq(schema.clientReports.jobExternalId, JOB));
  await dbm.db.delete(schema.writeLog).where(orm.eq(schema.writeLog.targetId, JOB));
}));

beforeEach(as(() => {
  vi.clearAllMocks();
  mocks.renderEstimate.mockReturnValue('<html>new</html>');
  mocks.owns.mockResolvedValue(true);
}));

describe.skipIf(!hasDb)('the unchanged-since guard', () => {
  it('matches a row stamped by the database itself, to the microsecond', as(async () => {
    const row = await makeReport();   // updated_at from defaultNow(): microseconds
    const [hit] = await dbm.db.update(schema.clientReports).set({ title: 'x', updatedAt: new Date() })
      .where(orm.and(orm.eq(schema.clientReports.id, row.id), unchanged.unchangedSince(row.updatedAt))).returning();
    expect(hit).toBeTruthy();
  }));

  it('refuses once somebody else has saved', as(async () => {
    const row = await makeReport();
    await dbm.db.update(schema.clientReports).set({ updatedAt: new Date(Date.now() + 5) }).where(orm.eq(schema.clientReports.id, row.id));
    const [hit] = await dbm.db.update(schema.clientReports).set({ title: 'x' })
      .where(orm.and(orm.eq(schema.clientReports.id, row.id), unchanged.unchangedSince(row.updatedAt))).returning();
    expect(hit).toBeUndefined();
  }));
});

describe.skipIf(!hasDb)('re-rendering a saved report', () => {
  it('an estimate edit renders with the job\'s inspection, like the editor\'s save', as(async () => {
    const row = await makeReport();
    const put = routeHandler('put', '/api/clients/:externalId/reports/:reportId/estimate');
    const res = await put({ params: { externalId: JOB, reportId: row.reportId }, body: { lines: [] } });
    expect(res.status).toBe(200);
    const opts = mocks.renderEstimate.mock.calls[0][1];
    expect(opts).toMatchObject({ customer: 'Karen Whitfield', jobType: 'insurance', damageSummary: 'Hail across the south slope' });
    expect(opts.inspection).toBeTruthy();
    expect((await reread(row.id)).html).toBe('<html>new</html>');
  }));

  it('a refine renders the same way', as(async () => {
    const row = await makeReport();
    mocks.refine.mockResolvedValue({ text: JSON.stringify({ reply: 'Done.', patch: { title: 'Storm damage estimate' } }) });
    const post = routeHandler('post', '/api/clients/:externalId/reports/:reportId/refine');
    const res = await post({ params: { externalId: JOB, reportId: row.reportId }, body: { instruction: 'Retitle it' } });
    expect(res.status).toBe(200);
    expect(mocks.renderEstimate.mock.calls[0][1]).toMatchObject({ jobType: 'insurance', damageSummary: 'Hail across the south slope' });
  }));

  it('a refine does not write over a save made while the AI was working', as(async () => {
    const row = await makeReport();
    mocks.refine.mockImplementation(async () => {
      // The rep's editor saves while the model is still answering.
      await dbm.db.update(schema.clientReports).set({ title: 'Saved by the editor', updatedAt: new Date(Date.now() + 5) })
        .where(orm.eq(schema.clientReports.id, row.id));
      return { text: JSON.stringify({ reply: 'Done.', patch: { title: 'From the AI' } }) };
    });
    const post = routeHandler('post', '/api/clients/:externalId/reports/:reportId/refine');
    const res = await post({ params: { externalId: JOB, reportId: row.reportId }, body: { instruction: 'Retitle it' } });
    expect(res.status).toBe(409);
    expect((await reread(row.id)).title).toBe('Saved by the editor');
  }));
});

describe.skipIf(!hasDb)('polling one report', () => {
  it('answers only for a job the rep can see', as(async () => {
    const row = await makeReport();
    const get = routeHandler('get', '/api/reports/:id');
    mocks.owns.mockResolvedValue(false);
    expect((await get({ params: { id: row.reportId } })).status).toBe(404);
    expect(mocks.owns).toHaveBeenCalledWith(expect.anything(), JOB);
    mocks.owns.mockResolvedValue(true);
    expect((await get({ params: { id: row.reportId } })).status).toBe(200);
  }));
});
