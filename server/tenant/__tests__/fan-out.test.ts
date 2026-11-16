/**
 * Scheduled per-company jobs with many companies: ordered so none starves,
 * bounded per company and per invocation, resumable after a cut-off run, and
 * idempotent within a period.
 */
import { describe, it, expect } from 'vitest';

const url = process.env.DATABASE_URL || '';
const local = /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe.skipIf(!local)('runCompanyJob', async () => {
  const { createCompany } = await import('../companies');
  const { currentCompanyId, runAsCompany } = await import('../context');
  const { db } = await import('../../db');
  const schema = await import('../../../shared/schema');
  const { eq } = await import('drizzle-orm');
  const donePeriod = async (companyId: string, job: string) => {
    const [row] = await runAsCompany(companyId, () => db.select().from(schema.companyJobRuns).where(eq(schema.companyJobRuns.job, job)), { loadProfile: false });
    return row?.donePeriod ?? null;
  };
  const { runCompanyJob, localParts, companyTimeZone } = await import('../fan-out');

  const tag = `fan-${process.pid}-${Date.now()}`;
  let n = 0;
  /** Three fresh live companies, sorted by id (the order they are first tried in). */
  const threeCompanies = async () => {
    const made = [];
    for (let i = 0; i < 3; i++) made.push(await createCompany({ slug: `${tag}-${n++}`, name: `Fan ${n}`, status: 'active' }));
    return made.map((c) => c.id).sort();
  };
  const jobName = () => `test-job-${tag}-${n++}`;

  it('runs each company as itself, once per period', async () => {
    const ids = await threeCompanies();
    const ran: string[] = [];
    const job = {
      name: jobName(), perCompanyMs: 5_000,
      period: () => 'P1',
      run: async ({ company }: any) => { expect(currentCompanyId()).toBe(company.id); ran.push(company.id); return 1; },
    };
    const first = await runCompanyJob(job, { onlyCompanyIds: ids });
    expect(first.ok).toBe(true);
    expect(first.remaining).toBe(0);
    expect(ran).toEqual(ids);
    const again = await runCompanyJob(job, { onlyCompanyIds: ids });
    expect(again.companies.map((c) => c.status)).toEqual(['already_done', 'already_done', 'already_done']);
    expect(ran).toHaveLength(3);
    // A new period runs everyone again.
    await runCompanyJob({ ...job, period: () => 'P2' }, { onlyCompanyIds: ids });
    expect(ran).toHaveLength(6);
  });

  it('resumes where a cut-off invocation stopped, never repeating a company', async () => {
    const ids = await threeCompanies();
    const ran: string[] = [];
    // The budget fits one company per invocation: the stand-in for the 300s limit.
    const job = {
      name: jobName(), perCompanyMs: 1_000,
      period: () => '2026-11-16',
      run: async ({ company }: any) => { await sleep(600); ran.push(company.id); },
    };
    const opts = { onlyCompanyIds: ids, budgetMs: 1_500 };
    const r1 = await runCompanyJob(job, opts);
    expect(r1.companies.map((c) => c.status)).toEqual(['done', 'not_reached', 'not_reached']);
    expect(r1.remaining).toBe(2);
    const r2 = await runCompanyJob(job, opts);
    const r3 = await runCompanyJob(job, opts);
    expect(r3.remaining).toBe(0);
    expect(ran).toEqual(ids);
    expect([r2, r3].every((r) => r.companies.filter((c) => c.status === 'done').length === 1)).toBe(true);
    const r4 = await runCompanyJob(job, opts);
    expect(r4.companies.every((c) => c.status === 'already_done')).toBe(true);
    expect(ran).toHaveLength(3);
  });

  it('puts companies tried least recently first, so a failing one cannot starve the rest', async () => {
    const [x, y, z] = await threeCompanies();
    const order: string[] = [];
    const job = {
      name: jobName(), perCompanyMs: 1_000,
      period: () => 'today',
      run: async ({ company }: any) => {
        order.push(company.id);
        await sleep(300);
        if (company.id === x) throw new Error('x is broken');
      },
    };
    const opts = { onlyCompanyIds: [x, y, z], budgetMs: 1_200 };
    const r1 = await runCompanyJob(job, opts);
    expect(r1.ok).toBe(false);
    expect(r1.companies.find((c) => c.companyId === x)).toMatchObject({ status: 'failed', error: 'x is broken' });
    await runCompanyJob(job, opts);
    await runCompanyJob(job, opts);
    // x failed first, then y and z (never tried) went ahead of it.
    expect(order).toEqual([x, y, z]);
    await runCompanyJob(job, opts);
    expect(order).toEqual([x, y, z, x]);
  });

  it('caps one company and carries on with the others; a later run retries it once its lease expires', async () => {
    const [slow, b, c] = await threeCompanies();
    let hang = true;
    const ran: string[] = [];
    let zombieSignal: AbortSignal | null = null;
    const job = {
      name: jobName(), perCompanyMs: 300, concurrency: 3,
      period: () => 'today',
      run: async ({ company, signal }: any) => {
        if (company.id === slow && hang) { zombieSignal = signal; await sleep(1_000); }
        ran.push(company.id);
      },
    };
    const r1 = await runCompanyJob(job, { onlyCompanyIds: [slow, b, c] });
    expect(r1.companies.find((o) => o.companyId === slow)?.status).toBe('timed_out');
    expect(r1.companies.filter((o) => o.status === 'done').map((o) => o.companyId).sort()).toEqual([b, c].sort());
    expect(zombieSignal!.aborted).toBe(true);
    // Its work is still running: nobody else may start the company yet.
    const r2 = await runCompanyJob(job, { onlyCompanyIds: [slow, b, c] });
    expect(r2.companies.find((o) => o.companyId === slow)?.status).toBe('in_progress');
    await sleep(800); // the timed-out work ends, and its lease (300 + 300 ms) has expired
    expect(await donePeriod(slow, job.name)).toBeNull(); // it could not record success
    hang = false;
    const r3 = await runCompanyJob(job, { onlyCompanyIds: [slow, b, c] });
    expect(r3.companies.find((o) => o.companyId === slow)?.status).toBe('done');
    expect(r3.remaining).toBe(0);
  });

  it('runs each company exactly once when two invocations overlap', async () => {
    const ids = await threeCompanies();
    const runs = new Map<string, number>();
    const job = {
      name: jobName(), perCompanyMs: 5_000, concurrency: 3,
      period: () => 'today',
      run: async ({ company }: any) => { runs.set(company.id, (runs.get(company.id) ?? 0) + 1); await sleep(300); },
    };
    const [r1, r2] = await Promise.all([runCompanyJob(job, { onlyCompanyIds: ids }), runCompanyJob(job, { onlyCompanyIds: ids })]);
    expect(ids.map((id) => runs.get(id))).toEqual([1, 1, 1]);
    for (const id of ids) {
      const statuses = [r1, r2].map((r) => r.companies.find((o) => o.companyId === id)?.status).sort();
      expect(statuses[0]).toBe('done');
      expect(['already_done', 'in_progress']).toContain(statuses[1]);
    }
    // Even a forced run cannot start a company another run holds.
    const forced = Promise.all([runCompanyJob(job, { onlyCompanyIds: ids, ignoreDone: true }), runCompanyJob(job, { onlyCompanyIds: ids, ignoreDone: true })]);
    await forced;
    expect(ids.map((id) => runs.get(id))).toEqual([2, 2, 2]);
  });

  it('retries a company whose run crashed holding the lease, after the lease expires', async () => {
    const [id] = await threeCompanies();
    const name = jobName();
    // A crashed invocation: a lease nobody will release.
    await runAsCompany(id, () => db.insert(schema.companyJobRuns)
      .values({ job: name, leaseToken: '11111111-1111-4111-8111-111111111111', leaseUntil: new Date(Date.now() + 400) }), { loadProfile: false });
    let ran = 0;
    const job = { name, perCompanyMs: 1_000, period: () => 'today', run: async () => { ran++; } };
    expect((await runCompanyJob(job, { onlyCompanyIds: [id] })).companies[0].status).toBe('in_progress');
    await sleep(500);
    expect((await runCompanyJob(job, { onlyCompanyIds: [id] })).companies[0].status).toBe('done');
    expect(ran).toBe(1);
  });

  it('does not record success for a run that lost its lease', async () => {
    const [id] = await threeCompanies();
    const name = jobName();
    const job = {
      name, perCompanyMs: 1_000, period: () => 'today',
      // Another run takes over mid-work (as if this one's lease had expired).
      run: async () => {
        await db.update(schema.companyJobRuns).set({ leaseToken: '22222222-2222-4222-8222-222222222222' }).where(eq(schema.companyJobRuns.job, name));
      },
    };
    const r = await runCompanyJob(job, { onlyCompanyIds: [id] });
    expect(r.companies[0]).toMatchObject({ status: 'failed', error: expect.stringMatching(/lost its claim/) });
    expect(await donePeriod(id, name)).toBeNull();
  });

  it('keeps unfinished work for the next run', async () => {
    const ids = await threeCompanies();
    let left = 2;
    const job = {
      name: jobName(), perCompanyMs: 1_000,
      period: () => 'today',
      run: async ({ company }: any) => (company.id === ids[0] ? --left : 0),
      isComplete: (v: number) => v === 0,
    };
    const r1 = await runCompanyJob(job, { onlyCompanyIds: ids });
    expect(r1.companies[0].status).toBe('partial');
    expect(r1.remaining).toBe(1);
    const r2 = await runCompanyJob(job, { onlyCompanyIds: ids });
    expect(r2.companies.map((o) => o.status)).toEqual(['done', 'already_done', 'already_done']);
  });

  it('runs companies in parallel up to the limit', async () => {
    const ids = await threeCompanies();
    let inFlight = 0; let peak = 0;
    const job = {
      name: jobName(), perCompanyMs: 2_000, concurrency: 2,
      period: () => 'today',
      run: async () => { inFlight++; peak = Math.max(peak, inFlight); await sleep(200); inFlight--; },
    };
    await runCompanyJob(job, { onlyCompanyIds: ids });
    expect(peak).toBe(2);
  });

  it('skips companies with nothing due, without running them', async () => {
    const ids = await threeCompanies();
    const ran: string[] = [];
    const job = {
      name: jobName(), perCompanyMs: 1_000,
      period: (company: any) => (company.id === ids[1] ? 'today' : null),
      run: async ({ company }: any) => { ran.push(company.id); },
    };
    const r = await runCompanyJob(job, { onlyCompanyIds: ids });
    expect(ran).toEqual([ids[1]]);
    expect(r.companies.map((o) => o.status)).toEqual(['not_due', 'done', 'not_due']);
  });

  it('reads the period in the company\'s own time zone', async () => {
    const la = await createCompany({ slug: `${tag}-la`, name: 'LA Roofing', status: 'active', settings: { timeZone: 'America/Los_Angeles' } as any });
    const ny = await createCompany({ slug: `${tag}-ny`, name: 'NY Roofing', status: 'active' });
    const now = new Date('2026-11-17T06:30:00Z'); // 1:30 AM in New York, 10:30 PM the day before in LA
    expect(companyTimeZone(la)).toBe('America/Los_Angeles');
    expect(localParts(now, companyTimeZone(la)).date).toBe('2026-11-16');
    expect(localParts(now, companyTimeZone(ny)).date).toBe('2026-11-17');
  });
});
