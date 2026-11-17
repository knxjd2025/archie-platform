/**
 * The chat-summary cron with several companies: each company gets a bounded
 * batch per run, a company with more waiting is continued by the next run,
 * and a company whose backlog is clear is skipped for the rest of its day.
 */
import { describe, it, expect, vi } from 'vitest';

const url = process.env.DATABASE_URL || '';
const local = /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url);

// No summarizer configured: the stored summary is the plain fallback (no network).
vi.mock('../../ai/assist-service', async (orig) => ({ ...(await orig<any>()), assistConfigured: () => false }));

describe.skipIf(!local)('chat summary cron', async () => {
  const { db } = await import('../../db');
  const schema = await import('../../../shared/schema');
  const { isNull, sql } = await import('drizzle-orm');
  const { runAsCompany } = await import('../../tenant/context');
  const { createCompany } = await import('../../tenant/companies');
  const { runCompanyJob } = await import('../../tenant/fan-out');
  const { chatSummaryJob } = await import('../archie-routes');

  const tag = `sum-${process.pid}-${Date.now()}`;

  it('continues a busy company on the next run, and does each company once a day', async () => {
    const busy = (await createCompany({ slug: `${tag}-busy`, name: 'Busy Roofing', status: 'active' })).id;
    const quiet = (await createCompany({ slug: `${tag}-quiet`, name: 'Quiet Roofing', status: 'active' })).id;
    const days = (n: number) => Array.from({ length: n }, (_, i) => `2026-11-0${i + 1}`);
    await runAsCompany(busy, () => db.insert(schema.agentChats).values(days(3).map((day) => ({ userEmail: `${tag}-busy@x.test`, agentKey: 'advisor', day }))));
    await runAsCompany(quiet, () => db.insert(schema.agentChats).values(days(1).map((day) => ({ userEmail: `${tag}-quiet@x.test`, agentKey: 'advisor', day }))));
    const pending = (id: string) => runAsCompany(id, async () =>
      (await db.select({ n: sql<number>`count(*)::int` }).from(schema.agentChats).where(isNull(schema.agentChats.summarizedAt)))[0].n);

    const job = chatSummaryJob({ batch: 2 });
    const opts = { now: new Date('2026-11-16T12:00:00Z'), onlyCompanyIds: [busy, quiet] };
    const statusOf = (r: any, id: string) => r.companies.find((c: any) => c.companyId === id)?.status;

    const r1 = await runCompanyJob(job, opts);
    expect(statusOf(r1, busy)).toBe('partial');
    expect(statusOf(r1, quiet)).toBe('done');
    expect(await pending(busy)).toBe(1);
    expect(await pending(quiet)).toBe(0);

    const r2 = await runCompanyJob(job, opts);
    expect(statusOf(r2, busy)).toBe('done');
    expect(statusOf(r2, quiet)).toBe('already_done');
    expect(await pending(busy)).toBe(0);

    const r3 = await runCompanyJob(job, opts);
    expect(r3.companies.every((c) => c.status === 'already_done')).toBe(true);
  }, 30_000);
});
