/**
 * leads are looked up by external_id in many places; migration 0007 gives that
 * a company-first index, matching shared/schema.ts.
 */
import { describe, it, expect } from 'vitest';

const url = process.env.DATABASE_URL || '';
const local = /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url);

describe.skipIf(!local)('leads external id index', async () => {
  const { pool } = await import('../../db');
  const { runAsCompany } = await import('../context');

  it('exists, company first', async () => {
    const { rows } = await pool.query(
      "select indexdef from pg_indexes where schemaname = 'public' and tablename = 'leads' and indexname = 'leads_company_external_id_idx'",
    );
    expect(rows[0]?.indexdef).toMatch(/\(company_id, external_id\)/);
  });

  // With an explicit company condition. A lookup on external_id alone, with
  // the company left to the current OR-shaped RLS policy, does not use it yet.
  it('can serve a lookup by company and external id', async () => {
    const plan = await runAsCompany('00000000-0000-4000-8000-000000000001', async () => {
      const client = await pool.connect();
      try {
        // Small test table: tell the planner not to prefer a sequential scan.
        await client.query('begin');
        await client.query('set local enable_seqscan = off');
        const { rows } = await client.query(
          "explain select id from leads where company_id = '00000000-0000-4000-8000-000000000001' and external_id = 'x'",
        );
        await client.query('rollback');
        return rows.map((r: any) => r['QUERY PLAN']).join('\n');
      } finally {
        client.release();
      }
    }, { loadProfile: false });
    expect(plan).toMatch(/leads_company_external_id_idx/);
  });
});
