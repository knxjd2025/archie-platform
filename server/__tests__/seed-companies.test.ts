/**
 * Seeding happens when a company is created, and through an explicit,
 * idempotent backfill. One company's seed failure never affects another.
 */
import { describe, it, expect } from 'vitest';

const url = process.env.DATABASE_URL || '';
const local = /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url);

describe.skipIf(!local)('seeding companies', async () => {
  const { db } = await import('../db');
  const { agents, knowledgeDocuments } = await import('../../shared/schema');
  const { sql } = await import('drizzle-orm');
  const { runAsCompany } = await import('../tenant/context');
  const { createCompany } = await import('../tenant/companies');
  const { provisionCompany, seedAll, seedCompany, seedCompaniesJob } = await import('../seed');
  const { runCompanyJob } = await import('../tenant/fan-out');

  const tag = `seed-${process.pid}-${Date.now()}`;
  const counts = (companyId: string) => runAsCompany(companyId, async () => {
    const [a] = await db.select({ n: sql<number>`count(*)::int` }).from(agents);
    const [k] = await db.select({ n: sql<number>`count(*)::int` }).from(knowledgeDocuments);
    return { agents: a.n, knowledge: k.n };
  });

  it('seeds a company as it is created', async () => {
    const { company, seeded } = await provisionCompany({ slug: `${tag}-new`, name: 'New Roofing', status: 'active' });
    expect(seeded).toBe(true);
    const c = await counts(company.id);
    expect(c.agents).toBeGreaterThan(0);
    expect(c.knowledge).toBeGreaterThan(0);
    // Idempotent: seeding again adds nothing.
    await runAsCompany(company.id, () => seedCompany());
    expect(await counts(company.id)).toEqual(c);
  }, 60_000);

  it('keeps the company when its seed fails, and reports the failure', async () => {
    const r = await provisionCompany({ slug: `${tag}-fail`, name: 'Fail Roofing', status: 'active' }, async () => { throw new Error('boom'); });
    expect(r.seeded).toBe(false);
    expect(r.error).toBe('boom');
    expect(r.company.id).toBeTruthy();
  });

  it('backfill: one company failing does not stop or fail the others', async () => {
    const bad = await createCompany({ slug: `${tag}-bad`, name: 'Bad Roofing', status: 'active' });
    const good = await createCompany({ slug: `${tag}-good`, name: 'Good Roofing', status: 'active' });
    const results = await seedAll(async (company) => {
      if (company.id === bad.id) throw new Error('broken company');
      if (company.id === good.id) await seedCompany();
      return 'ok';
    });
    expect(results.find((r) => r.companyId === bad.id)).toMatchObject({ ok: false, error: 'broken company' });
    expect(results.find((r) => r.companyId === good.id)).toMatchObject({ ok: true });
    expect((await counts(good.id)).knowledge).toBeGreaterThan(0);
  }, 60_000);

  it('two companies seeding at the same time both get their knowledge base', async () => {
    const x = await createCompany({ slug: `${tag}-x`, name: 'X Roofing', status: 'active' });
    const y = await createCompany({ slug: `${tag}-y`, name: 'Y Roofing', status: 'active' });
    await Promise.all([runAsCompany(x.id, () => seedCompany()), runAsCompany(y.id, () => seedCompany())]);
    expect((await counts(x.id)).knowledge).toBeGreaterThan(0);
    expect((await counts(y.id)).knowledge).toBeGreaterThan(0);
  }, 60_000);

  it('the backfill cron seeds companies not yet seeded, and skips ones seeded at creation', async () => {
    const { company: fresh } = await provisionCompany({ slug: `${tag}-cron-fresh`, name: 'Fresh Roofing', status: 'active' });
    const old = await createCompany({ slug: `${tag}-cron-old`, name: 'Old Roofing', status: 'active' });
    const r1 = await runCompanyJob(seedCompaniesJob(), { onlyCompanyIds: [fresh.id, old.id] });
    expect(r1.companies.find((c) => c.companyId === fresh.id)?.status).toBe('already_done');
    expect(r1.companies.find((c) => c.companyId === old.id)?.status).toBe('done');
    expect((await counts(old.id)).knowledge).toBeGreaterThan(0);
    const r2 = await runCompanyJob(seedCompaniesJob(), { onlyCompanyIds: [fresh.id, old.id] });
    expect(r2.companies.every((c) => c.status === 'already_done')).toBe(true);
  }, 60_000);
});
