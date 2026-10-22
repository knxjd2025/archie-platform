import { afterAll, describe, it, expect, vi, beforeAll } from 'vitest';
import express from 'express';
import { inCompany, makeTestCompany, TEST_COMPANY_ID } from '../../__tests__/helpers/tenant';

// Every test here runs as a real test company (row level security is on).
let __co = TEST_COMPANY_ID;
const as = inCompany(() => __co);
beforeAll(async () => { if (process.env.DATABASE_URL) __co = await makeTestCompany('lock'); });

/**
 * The split routes against a real database: a draw checked before the job's
 * lock could be paid on top of a balance a settle-up had just paid out, the
 * routes that changed splits took their rows in the opposite order to the ones
 * that paid them, and a money edit on a reopened job moved an approved rep's
 * figure without anybody approving the new one. Each is a race or a sequence
 * between transactions, so only Postgres can show it.
 *
 * Runs only against a local database (the e2e one): these insert and delete
 * commission records.
 */
const url = process.env.DATABASE_URL || '';
const local = /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url);

vi.mock('../../integrations/jobtread', () => ({ JobTreadClient: class {} }));

const ADMIN = { email: 'boss@bestroofingnow.com', name: 'Boss', role: 'admin' };

type Answer = { status: number; body: any };

describe.skipIf(!local)('changing who is paid on a job', async () => {
  const { db } = await import('../../db');
  const { eq, like, sql } = await import('drizzle-orm');
  const { jobCommissions, jobCommissionSplits, jobCommissionPayouts } = await import('../../../shared/schema');
  const { recomputeSplits, settleApprovedSplits } = await import('../splits');
  const { registerJobCommissionRoutes } = await import('../routes');

  const PREFIX = 'vitest-split-lock-';
  let seq = 0;

  /** One registered route's handler, called the way Express would, resolved when it answers. */
  function route(method: 'get' | 'post' | 'patch' | 'delete', path: string) {
    const app = express();
    const spy = vi.spyOn(app, method);
    registerJobCommissionRoutes(app);
    const args = spy.mock.calls.find((c) => c[0] === path) as unknown[] | undefined;
    if (!args) throw new Error(`no ${method} ${path}`);
    const handler = args[args.length - 1] as (req: unknown, res: unknown) => Promise<unknown>;
    return (params: Record<string, unknown>, body: Record<string, unknown> = {}) => new Promise<Answer>((resolve) => {
      let status = 200;
      const res: Record<string, unknown> = {};
      Object.assign(res, {
        status: (s: number) => { status = s; return res; },
        json: (b: unknown) => { resolve({ status, body: b }); return res; },
        send: (b: unknown) => { resolve({ status, body: b }); return res; },
        setHeader: () => res,
      });
      handler({ session: { user: ADMIN }, params, body, query: {} }, res);
    });
  }
  const draw = route('post', '/api/job-commissions/:id/splits/:splitId/payouts');
  const patchJob = route('patch', '/api/job-commissions/:id');
  const patchSplit = route('patch', '/api/job-commissions/:id/splits/:splitId');
  const addRep = route('post', '/api/job-commissions/:id/splits');
  const approve = route('post', '/api/job-commissions/:id/approve');
  const deny = route('post', '/api/job-commissions/:id/deny');

  // 24,500 revenue, self-generated retail: a pool of 6,025 for the reps.
  const POOL = 6025;

  async function approvedJob(shares: Array<{ rep: string; pct: number }>) {
    const [job] = await db.insert(jobCommissions).values({
      jobExternalId: `${PREFIX}${Date.now()}-${seq++}`, jobName: 'Vitest job', leadSource: 'self', jobType: 'retail',
      revenue: '24500.00', material: '6000.00', labor: '4000.00', other: '0.00', createdBy: 'vitest',
    }).returning();
    const splits = await db.insert(jobCommissionSplits).values(shares.map((s) => ({
      jobCommissionId: job.id, repName: s.rep, sharePct: s.pct.toFixed(2), status: 'approved' as const,
      approvedBy: 'boss@brn.com', approvedAt: new Date(), createdBy: 'vitest',
    }))).returning();
    await recomputeSplits(job.id);
    return { job, splits };
  }
  const paidOut = async (jobId: number) => (await db.select({ amount: jobCommissionPayouts.amount })
    .from(jobCommissionPayouts)
    .innerJoin(jobCommissionSplits, eq(jobCommissionPayouts.splitId, jobCommissionSplits.id))
    .where(eq(jobCommissionSplits.jobCommissionId, jobId))).reduce((t, r) => t + Number(r.amount), 0);
  const splitsOf = async (jobId: number) => db.select().from(jobCommissionSplits)
    .where(eq(jobCommissionSplits.jobCommissionId, jobId)).orderBy(jobCommissionSplits.id);

  afterAll(as(async () => {
    await db.delete(jobCommissions).where(like(jobCommissions.jobExternalId, `${PREFIX}%`));
  }));

  it('will not record a draw on a rep a settle-up has just paid', as(async () => {
    const { job, splits } = await approvedJob([{ rep: 'Ann', pct: 100 }]);
    await settleApprovedSplits(job.id, 'boss@brn.com', 'ck 1');
    const r = await draw({ id: String(job.id), splitId: String(splits[0].id) }, { amount: 500 });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/already been paid/);
    expect(await paidOut(job.id)).toBe(POOL);
  }));

  it('a draw and a settle-up at the same moment never pay out more than the job earned', as(async () => {
    const { job, splits } = await approvedJob([{ rep: 'Ann', pct: 100 }]);
    const [d] = await Promise.all([
      draw({ id: String(job.id), splitId: String(splits[0].id) }, { amount: 1000 }),
      settleApprovedSplits(job.id, 'boss@brn.com', 'ck 2'),
    ]);
    // Either the draw went first and the settle-up paid the rest, or the
    // settle-up went first and the draw was refused — never both in full.
    expect([200, 400]).toContain(d.status);
    expect(await paidOut(job.id)).toBe(POOL);
  }));

  it('refuses a draw while the job is open again, even for a rep still approved', as(async () => {
    const { job, splits } = await approvedJob([{ rep: 'Ann', pct: 100 }]);
    await draw({ id: String(job.id), splitId: String(splits[0].id) }, { amount: 1000 });
    // Bo is added after sign-off: Ann has been paid a draw, so she keeps her
    // share and her approval, and the job is open until Bo is approved.
    expect((await addRep({ id: String(job.id) }, { repName: 'Bo' })).status).toBe(200);
    const r = await draw({ id: String(job.id), splitId: String(splits[0].id) }, { amount: 100 });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/Approve it again/);
  }));

  it('sends an approved rep back for approval when a money edit moves their figure', as(async () => {
    const { job, splits } = await approvedJob([{ rep: 'Ann', pct: 100 }]);
    await draw({ id: String(job.id), splitId: String(splits[0].id) }, { amount: 1000 });
    await addRep({ id: String(job.id) }, { repName: 'Bo' });
    let after = await splitsOf(job.id);
    expect(after.map((s) => [s.repName, s.status])).toEqual([['Ann', 'approved'], ['Bo', 'open']]);

    // The pool grows while the job is open. Ann's approved figure grows with
    // it — and approving the job again only signs off the open reps, so the
    // new figure would have been paid without anybody approving it.
    const edit = await patchJob({ id: String(job.id) }, { revenue: 30000 });
    expect(edit.status).toBe(200);
    after = await splitsOf(job.id);
    expect(after.map((s) => [s.repName, s.status])).toEqual([['Ann', 'open'], ['Bo', 'open']]);
    expect(after[0].approvedAt).toBeNull();
  }));

  it('leaves an approved rep approved when a money edit does not move their figure', as(async () => {
    const { job, splits } = await approvedJob([{ rep: 'Ann', pct: 100 }]);
    await draw({ id: String(job.id), splitId: String(splits[0].id) }, { amount: 1000 });
    await addRep({ id: String(job.id) }, { repName: 'Bo' });
    // A note is not money.
    expect((await patchJob({ id: String(job.id) }, { notes: 'checked' })).status).toBe(200);
    expect((await splitsOf(job.id)).map((s) => s.status)).toEqual(['approved', 'open']);
  }));

  it('split edits, approvals and settle-ups on one job at once all go through', as(async () => {
    const { job, splits } = await approvedJob([{ rep: 'Ann', pct: 50 }, { rep: 'Bo', pct: 50 }]);
    // Open the connections first, so the runs below really do overlap.
    await Promise.all(Array.from({ length: 6 }, () => db.execute(sql`SELECT 1`)));
    const results = await Promise.allSettled([
      patchSplit({ id: String(job.id), splitId: String(splits[0].id) }, { notes: 'one' }),
      settleApprovedSplits(job.id, 'boss@brn.com', 'ck 3', [splits[1].id]),
      patchSplit({ id: String(job.id), splitId: String(splits[1].id) }, { notes: 'two' }),
      approve({ id: String(job.id) }),
      draw({ id: String(job.id), splitId: String(splits[0].id) }, { amount: 100 }),
      deny({ id: String(job.id) }, { reason: '' }),
    ]);
    // No deadlock, no 500: every one answered with a decision.
    for (const r of results) expect(r.status).toBe('fulfilled');
    const answers = results.map((r) => (r as PromiseFulfilledResult<any>).value)
      .filter((v): v is Answer => v && typeof v.status === 'number');
    expect(answers.every((a) => a.status < 500)).toBe(true);
    expect(await paidOut(job.id)).toBeLessThanOrEqual(POOL);
  }));
});
