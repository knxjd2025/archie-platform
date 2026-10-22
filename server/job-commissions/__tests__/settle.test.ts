import { afterAll, describe, it, expect } from 'vitest';

/**
 * Paying reps, against a real database — the double payment this guards
 * against is a race between two transactions, and nothing short of Postgres
 * can show whether the lock holds.
 *
 * Runs only against a local database (the e2e one), never whatever
 * DATABASE_URL happens to be set in a shell: these tests insert and delete
 * commission records.
 */
const url = process.env.DATABASE_URL || '';
const local = /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url);

describe.skipIf(!local)('settling a job', async () => {
  const { db } = await import('../../db');
  const { and, eq, like, sql } = await import('drizzle-orm');
  const { jobCommissions, jobCommissionSplits, jobCommissionPayouts } = await import('../../../shared/schema');
  const { settleApprovedSplits, recomputeSplits, reshare } = await import('../splits');

  const PREFIX = 'vitest-settle-';
  let seq = 0;

  // 24,500 revenue, self-generated retail: 10% overhead, 10,000 of costs,
  // 12,050 profit — a pool of 6,025 for the reps to share.
  const POOL = 6025;

  /** An approved job with these reps on it, figures already worked out. */
  async function approvedJob(shares: Array<{ rep: string; pct: number; manual?: number; status?: 'open' | 'approved' }>, over: Partial<typeof jobCommissions.$inferInsert> = {}) {
    const [job] = await db.insert(jobCommissions).values({
      jobExternalId: `${PREFIX}${Date.now()}-${seq++}`, jobName: 'Vitest job', leadSource: 'self', jobType: 'retail',
      revenue: '24500.00', material: '6000.00', labor: '4000.00', other: '0.00', createdBy: 'vitest', ...over,
    }).returning();
    const approvedAt = new Date('2026-10-01T15:00:00Z');
    const splits = await db.insert(jobCommissionSplits).values(shares.map((s) => ({
      jobCommissionId: job.id, repName: s.rep, sharePct: s.pct.toFixed(2),
      manualAmount: s.manual == null ? null : s.manual.toFixed(2),
      status: s.status ?? 'approved' as const,
      approvedBy: (s.status ?? 'approved') === 'approved' ? 'boss@brn.com' : null,
      approvedAt: (s.status ?? 'approved') === 'approved' ? approvedAt : null,
      createdBy: 'vitest',
    }))).returning();
    await recomputeSplits(job.id);
    return { job, splits };
  }

  const payoutsOf = async (jobId: number) => db.select({ splitId: jobCommissionPayouts.splitId, amount: jobCommissionPayouts.amount })
    .from(jobCommissionPayouts)
    .innerJoin(jobCommissionSplits, eq(jobCommissionPayouts.splitId, jobCommissionSplits.id))
    .where(eq(jobCommissionSplits.jobCommissionId, jobId));
  const jobRow = async (id: number) => (await db.select().from(jobCommissions).where(eq(jobCommissions.id, id)))[0];

  afterAll(async () => {
    await db.delete(jobCommissions).where(like(jobCommissions.jobExternalId, `${PREFIX}%`));
  });

  it('pays once when two settle-ups land at the same moment', async () => {
    const { job } = await approvedJob([{ rep: 'Ann', pct: 50 }, { rep: 'Bo', pct: 50 }]);
    // Open the connections first, so the runs below really do overlap rather
    // than queueing behind a connection that is still being set up.
    await Promise.all(Array.from({ length: 5 }, () => db.execute(sql`SELECT 1`)));
    // Two admins and a double click: every run starts before any has written.
    const runs = await Promise.all(Array.from({ length: 5 }, () => settleApprovedSplits(job.id, 'boss@brn.com', 'ck 1')));
    const rows = await payoutsOf(job.id);
    expect(rows).toHaveLength(2);
    expect(rows.reduce((t, r) => t + Number(r.amount), 0)).toBe(POOL);
    // One run paid everybody; the rest found the job already paid.
    expect(runs.map((r) => r.payouts.length).sort()).toEqual([0, 0, 0, 0, 2]);
    expect(runs.filter((r) => r.refused?.message === 'already paid')).toHaveLength(4);
    expect((await jobRow(job.id)).status).toBe('paid');
  });

  it('pays only the rep it was asked to, and says what actually went out', async () => {
    const { job, splits } = await approvedJob([{ rep: 'Ann', pct: 60 }, { rep: 'Bo', pct: 40 }]);
    const r = await settleApprovedSplits(job.id, 'boss@brn.com', '', [splits[1].id]);
    expect(r.refused).toBeNull();
    expect(r.payouts.map((p) => p.splitId)).toEqual([splits[1].id]);
    // The money that left, read from the rows written — never the $0 a
    // settled balance reads afterwards.
    expect(r.amount).toBe(2410);
    const after = await db.select().from(jobCommissionSplits).where(eq(jobCommissionSplits.jobCommissionId, job.id));
    expect(after.find((s) => s.id === splits[0].id)?.status).toBe('approved');
    expect(after.find((s) => s.id === splits[1].id)?.status).toBe('paid');
    // Ann is still owed, so the job is still on the board as approved.
    expect((await jobRow(job.id)).status).toBe('approved');
  });

  it('refuses to pay when the shares no longer come to the whole pool', async () => {
    const { job, splits } = await approvedJob([{ rep: 'Ann', pct: 50 }, { rep: 'Bo', pct: 50 }]);
    // Edited after approval, the way the old split PATCH allowed.
    await db.update(jobCommissionSplits).set({ sharePct: '70.00' }).where(eq(jobCommissionSplits.id, splits[0].id));
    const r = await settleApprovedSplits(job.id, 'boss@brn.com', '');
    expect(r.refused?.reason).toBe('shares');
    expect(r.refused?.message).toMatch(/120%/);
    expect(await payoutsOf(job.id)).toHaveLength(0);
  });

  it('will not pay a job somebody reopened since the screen was drawn', async () => {
    const { job } = await approvedJob([{ rep: 'Ann', pct: 100, status: 'open' }]);
    const r = await settleApprovedSplits(job.id, 'boss@brn.com', '');
    expect(r.refused).toEqual({ reason: 'status', message: 'already open' });
    expect(await payoutsOf(job.id)).toHaveLength(0);
  });

  it('settles an approved commission of nothing without waiting for a payment', async () => {
    const { job } = await approvedJob([{ rep: 'Ann', pct: 100 }], { manualCommission: '0.00' });
    const row = await jobRow(job.id);
    expect(row.status).toBe('paid');
    // Paid by whoever approved it, when they approved it — there was no payment.
    expect(row.paidBy).toBe('boss@brn.com');
    expect(row.paidAt).not.toBeNull();
  });

  it('stamps the job approved and paid from its reps, and clears the stamps on reopen', async () => {
    const { job } = await approvedJob([{ rep: 'Ann', pct: 100 }]);
    let row = await jobRow(job.id);
    expect(row.approvedBy).toBe('boss@brn.com');
    expect(row.approvedAt?.toISOString()).toBe('2026-10-01T15:00:00.000Z');
    expect(row.paidAt).toBeNull();

    await settleApprovedSplits(job.id, 'payroll@brn.com', 'ck 9');
    row = await jobRow(job.id);
    expect(row.status).toBe('paid');
    expect(row.paidBy).toBe('payroll@brn.com');
    expect(row.paidAt).not.toBeNull();

    // What the reopen route does to the splits; the roll-up must follow.
    await db.update(jobCommissionSplits).set({ status: 'open', approvedBy: null, approvedAt: null })
      .where(eq(jobCommissionSplits.jobCommissionId, job.id));
    await recomputeSplits(job.id);
    row = await jobRow(job.id);
    expect(row.status).toBe('open');
    expect([row.approvedAt, row.approvedBy, row.paidAt, row.paidBy]).toEqual([null, null, null, null]);
  });

  it('leaves a paid rep on their share when another is added, and evens out only the rest', async () => {
    const { job, splits } = await approvedJob([{ rep: 'Ann', pct: 50 }, { rep: 'Bo', pct: 50 }]);
    await settleApprovedSplits(job.id, 'boss@brn.com', '', [splits[0].id]); // Ann paid in full
    await db.insert(jobCommissionSplits).values({ jobCommissionId: job.id, repName: 'Cy', sharePct: '0.00', createdBy: 'vitest' });
    await reshare(job.id);
    await recomputeSplits(job.id);

    const after = await db.select().from(jobCommissionSplits)
      .where(and(eq(jobCommissionSplits.jobCommissionId, job.id))).orderBy(jobCommissionSplits.id);
    expect(after.map((s) => [s.repName, s.sharePct, s.status])).toEqual([
      ['Ann', '50.00', 'paid'],
      // Bo's share moved after he was approved, so he needs approving again.
      ['Bo', '25.00', 'open'],
      ['Cy', '25.00', 'open'],
    ]);
  });
});
