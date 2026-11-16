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
  const { currentCompanyId } = await import('../context');
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

  it('caps one company and carries on with the others; the next run retries it', async () => {
    const [slow, b, c] = await threeCompanies();
    let hang = true;
    const ran: string[] = [];
    const job = {
      name: jobName(), perCompanyMs: 300, concurrency: 3,
      period: () => 'today',
      run: async ({ company }: any) => {
        if (company.id === slow && hang) await sleep(2_000);
        ran.push(company.id);
      },
    };
    const r1 = await runCompanyJob(job, { onlyCompanyIds: [slow, b, c] });
    expect(r1.companies.find((o) => o.companyId === slow)?.status).toBe('timed_out');
    expect(r1.companies.filter((o) => o.status === 'done').map((o) => o.companyId).sort()).toEqual([b, c].sort());
    hang = false;
    const r2 = await runCompanyJob(job, { onlyCompanyIds: [slow, b, c] });
    expect(r2.companies.find((o) => o.companyId === slow)?.status).toBe('done');
    expect(r2.remaining).toBe(0);
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
