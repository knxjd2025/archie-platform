/**
 * Finishing signed documents on a starved connection pool, against a real
 * database.
 *
 * finishSigned used to open a transaction for the whole of finishing — the
 * PDF, the JobTread upload, every email — while every query inside it went
 * through the global pool for a second connection. Opening a job resumed every
 * signed request of the last week at once, so a handful of them held every
 * connection in the pool, each waiting for another, until all of them timed
 * out. Here the pool has two connections and a slow mailbox, and every run
 * has to finish anyway, each step exactly once.
 *
 * Needs DATABASE_URL (the local bra_e2e database); skipped without one.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest';
import crypto from 'node:crypto';
import { inCompany, makeTestCompany, TEST_COMPANY_ID } from '../../__tests__/helpers/tenant';

// Every test here runs as a real test company (row level security is on).
let __co = TEST_COMPANY_ID;
const as = inCompany(() => __co);
beforeAll(async () => { if (process.env.DATABASE_URL) __co = await makeTestCompany('sigpool'); });

// Before the pool is built: two connections, and a short wait for one, so a
// pool deadlock fails the test in seconds instead of hanging it.
process.env.DB_POOL_MAX = '2';
process.env.DB_CONNECT_TIMEOUT_MS = '3000';

const mocks = vi.hoisted(() => ({
  upload: vi.fn(),
  sendWith: vi.fn(),
  pending: [] as Array<Promise<unknown>>,
}));
vi.mock('@vercel/functions', () => ({ waitUntil: (p: Promise<unknown>) => { mocks.pending.push(p); } }));
vi.mock('../../integrations/company-mail', () => ({ sendAsMailbox: vi.fn(), sendAsMailboxWithAttachments: mocks.sendWith }));
vi.mock('../../integrations/jobtread', () => ({ JobTreadClient: class { uploadJobFile = mocks.upload; } }));
vi.mock('../../integrations/gohighlevel', () => ({ GoHighLevelClient: class { sendSms = vi.fn(); } }));
vi.mock('../../access/team-scope', () => ({ memberByEmail: async () => null, visibleRepNamesFor: async () => null }));
vi.mock('../../access/rep-scope', async (orig) => ({ ...(await orig<object>()), ownsLead: async () => true }));

const hasDb = !!process.env.DATABASE_URL;
const JOB = `test-sig-pool-${process.pid}-${Date.now()}`;

type Mod = typeof import('../routes');
type Db = typeof import('../../db');
type Schema = typeof import('../../../shared/schema');
type Drizzle = typeof import('drizzle-orm');
let routes: Mod; let dbm: Db; let schema: Schema; let orm: Drizzle;

const slow = <T>(value: T, ms = 80) => new Promise<T>((r) => setTimeout(() => r(value), ms));

/** A request everybody has signed, marked as tracked step by step, nothing yet filed or sent. */
async function signedRequest(emails: string[]) {
  const { db } = dbm; const { signatureRequests, signatureSigners, writeLog } = schema;
  const [r] = await db.insert(signatureRequests).values({
    jobExternalId: JOB, sourceKind: 'report', title: 'Roof report', html: '<p>The report</p>',
    docHash: 'x', status: 'signed', completedAt: new Date(), createdBy: 'rep@acme.test', sentBy: 'rep@acme.test',
  }).returning();
  await db.insert(signatureSigners).values(emails.map((email, i) => ({
    requestId: r.id, ordinal: i, name: `Signer ${i}`, role: 'customer', email,
    token: crypto.randomBytes(16).toString('hex'),
    signedAt: new Date(), signedName: `Signer ${i}`, signatureKind: 'typed', ip: '10.0.0.1',
  })));
  await db.insert(writeLog).values({
    actor: 'system:signatures', system: 'app', action: 'signature_completed', targetId: JOB,
    summary: `request #${r.id}`, ok: true, error: null,
  });
  return r;
}

beforeAll(as(async () => {
  if (!hasDb) return;
  routes = await import('../routes');
  dbm = await import('../../db');
  schema = await import('../../../shared/schema');
  orm = await import('drizzle-orm');
}));

afterAll(as(async () => {
  if (!hasDb) return;
  const { db } = dbm; const { signatureRequests, writeLog } = schema;
  await db.delete(signatureRequests).where(orm.eq(signatureRequests.jobExternalId, JOB));
  await db.delete(writeLog).where(orm.eq(writeLog.targetId, JOB));
  await dbm.pool.end();
}));

describe.skipIf(!hasDb)('finishing signed documents on a small pool', () => {
  beforeEach(as(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    mocks.pending.length = 0;
    mocks.upload.mockImplementation(() => slow({ ok: true, fileId: `file-${crypto.randomUUID()}` }));
    mocks.sendWith.mockImplementation(() => slow('msg'));
  }));

  it('finishes many at once with two connections, each step exactly once', as(async () => {
    const requests = [];
    for (let i = 0; i < 6; i++) requests.push(await signedRequest([`a${i}@example.com`, `b${i}@example.com`]));

    // Every request at once, and each one twice — two job views landing together.
    const runs = requests.flatMap((r) => [routes.finishSigned(r.id, false), routes.finishSigned(r.id, false)]);
    const results = await Promise.allSettled(runs);
    expect(results.filter((r) => r.status === 'rejected')).toEqual([]);

    expect(mocks.upload).toHaveBeenCalledTimes(requests.length);
    const sent = mocks.sendWith.mock.calls.map((c) => c[1] as string).sort();
    expect(sent).toEqual(requests.flatMap((_, i) => [`a${i}@example.com`, `b${i}@example.com`]).sort());

    // And once it is all done, running again does nothing at all.
    vi.clearAllMocks();
    await Promise.all(requests.map((r) => routes.finishSigned(r.id, false)));
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.sendWith).not.toHaveBeenCalled();
  }), 30_000);

  it('opening a job resumes its signed requests one at a time, without starving the pool', as(async () => {
    for (let i = 0; i < 5; i++) await signedRequest([`list${i}@example.com`]);
    const { default: express } = await import('express');
    const app = express();
    const spy = vi.spyOn(app, 'get');
    routes.registerSignatureRoutes(app);
    const args = spy.mock.calls.find((c) => c[0] === '/api/clients/:externalId/signature-requests') as unknown[];
    const handler = args[args.length - 1] as (req: unknown, res: unknown, next: (e?: unknown) => void) => void;

    const view = () => new Promise<number>((resolve, reject) => {
      let status = 200;
      const res: Record<string, unknown> = {};
      Object.assign(res, { status: (s: number) => { status = s; return res; }, json: () => { resolve(status); return res; } });
      handler({ session: { user: { email: 'admin@acme.test', role: 'admin' } }, params: { externalId: JOB } }, res, (e?: unknown) => (e ? reject(e) : resolve(status)));
    });
    // Three views of the job in a row, each answering while the last one's
    // resumes are still running in the background.
    expect(await Promise.all([view(), view(), view()])).toEqual([200, 200, 200]);
    await Promise.all(mocks.pending.splice(0));
    expect(mocks.sendWith.mock.calls.map((c) => c[1]).filter((to) => String(to).startsWith('list')).sort())
      .toEqual(['list0@example.com', 'list1@example.com', 'list2@example.com', 'list3@example.com', 'list4@example.com']);
  }), 30_000);

  it('sends nothing when the step cannot be recorded first', as(async () => {
    const r = await signedRequest(['closed@example.com']);
    // The write log refusing the claim — a missing table, a dropped connection.
    vi.spyOn(dbm.db, 'transaction').mockRejectedValueOnce(new Error('relation "write_log" does not exist'));
    await expect(routes.finishSigned(r.id, false)).rejects.toThrow(/write_log/);
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.sendWith).not.toHaveBeenCalled();

    // Once the log takes writes again, it finishes — once.
    await routes.finishSigned(r.id, false);
    await routes.finishSigned(r.id, false);
    expect(mocks.upload).toHaveBeenCalledTimes(1);
    expect(mocks.sendWith).toHaveBeenCalledTimes(1);
  }), 30_000);

  it('a step another run is in the middle of is left to it', as(async () => {
    const r = await signedRequest(['busy@example.com']);
    const { db } = dbm; const { writeLog } = schema;
    // Another instance claimed the copy a moment ago and has not finished.
    await db.insert(writeLog).values({
      actor: 'system:signatures', system: 'google', action: 'signature_copy_sent', targetId: JOB,
      summary: `request #${r.id}: signed copy to busy@example.com`, ok: false, error: 'in progress',
    });
    await routes.finishSigned(r.id, false);
    expect(mocks.upload).toHaveBeenCalledTimes(1);
    expect(mocks.sendWith).not.toHaveBeenCalled();
  }), 30_000);
});
