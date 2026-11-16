/**
 * leads are looked up by external_id in many places; migration 0007 gives that
 * a company-first index, matching shared/schema.ts.
 */
import { describe, it, expect } from 'vitest';
import { Client } from 'pg';

const url = process.env.DATABASE_URL || '';
const local = /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url);

describe.skipIf(!local || !process.env.ARCHIE_TEST_OWNER_URL)('leads external id index', async () => {
  const { pool } = await import('../../db');
  const { runAsCompany } = await import('../context');
  const { createCompany } = await import('../companies');

  it('exists, company first', async () => {
    const { rows } = await pool.query(
      "select indexdef from pg_indexes where schemaname = 'public' and tablename = 'leads' and indexname = 'leads_company_external_id_idx'",
    );
    expect(rows[0]?.indexdef).toMatch(/\(company_id, external_id\)/);
  });

  // No company condition in the query: row level security supplies it
  // (migrations/0008), and it is indexable, so the lookup goes straight to
  // this company's entry instead of scanning every company's leads.
  it('serves a lookup by external id alone, keyed on the company', async () => {
    const co = await createCompany({ slug: `leads-ext-idx-${process.pid}-${Date.now()}`, name: 'Index Co', status: 'cancelled' });
    // Enough rows, with statistics, that an equality on external_id is
    // selective; no sequential scan, so the planner shows which index it uses.
    await runAsCompany(co.id, () => pool.query("insert into leads (source, external_id) select 'test', 'ext-' || g from generate_series(1, 300) g"), { loadProfile: false });
    const owner = new Client({ connectionString: process.env.ARCHIE_TEST_OWNER_URL });
    await owner.connect();
    try { await owner.query('analyze leads'); } finally { await owner.end(); }
    const plan = await runAsCompany(co.id, async () => {
      const client = await pool.connect();
      try {
        await client.query('begin');
        await client.query('set local enable_seqscan = off');
        const { rows } = await client.query("explain select id from leads where external_id = 'ext-150'");
        await client.query('rollback');
        return rows.map((r: any) => r['QUERY PLAN']).join('\n');
      } finally {
        client.release();
      }
    }, { loadProfile: false });
    expect(plan).toMatch(/leads_company_external_id_idx/);
    expect(plan).toMatch(/Index Cond: \(\(company_id = .+\) AND \(external_id = 'ext-150'::text\)\)/);
  });
});
