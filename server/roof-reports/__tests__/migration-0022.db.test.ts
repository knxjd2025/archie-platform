/**
 * Migration 0022: roof_reports.started_at, idempotency_key and request_hash,
 * against the real local test database (scripts/test-db.sh) as the app's own
 * role. Fictional company: Summit Ridge Roofing in Cedar Falls.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';

const url = process.env.DATABASE_URL || '';
const local = process.env.ARCHIE_REHEARSAL === '1' || /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url);
const sqlState = (p: Promise<unknown>): Promise<string | null> => p.then(() => null, (e) => e?.cause?.code ?? e?.code ?? 'no-code');
const UNIQUE_VIOLATION = '23505';

describe('migration 0022: the file itself', () => {
  const text = readFileSync(join(process.cwd(), 'migrations', '0022_roof_report_starts.sql'), 'utf8');
  const at = (needle: string) => { const i = text.indexOf(needle); expect(i, needle).toBeGreaterThan(-1); return i; };

  it('fills started_at from created_at BEFORE it is given a default and made required, so no row is ever seen without a value', () => {
    expect(at('SET LOCAL lock_timeout')).toBeLessThan(at('ADD COLUMN "started_at"'));
    expect(at('ADD COLUMN "started_at" timestamp with time zone;')).toBeLessThan(at('SET "started_at" = "created_at"'));
    expect(at('SET "started_at" = "created_at"')).toBeLessThan(at('SET DEFAULT now()'));
    expect(at('SET DEFAULT now()')).toBeLessThan(at('SET NOT NULL'));
  });

  it('does not touch the older migrations', () => {
    expect(text).not.toMatch(/DROP |TRUNCATE|DELETE FROM/i);
  });
});

describe.skipIf(!local)('migration 0022: roof report starts and request keys', async () => {
  const { db } = await import('../../db');
  const { runAsCompany } = await import('../../tenant/context');
  const { createCompany } = await import('../../tenant/companies');

  const tag = `rr22-${process.pid}-${Date.now()}`;
  let a = '';
  let b = '';
  beforeAll(async () => {
    a = (await createCompany({ slug: `${tag}-a`, name: 'Summit Ridge Roofing', status: 'active' })).id;
    b = (await createCompany({ slug: `${tag}-b`, name: 'Cedar Falls Roofing Two', status: 'active' })).id;
  });

  const insert = (company: string, member: number | null, key: string | null) => runAsCompany(company, () => db.execute(sql`
    insert into roof_reports (address, report_types, created_by_member_id, idempotency_key, request_hash)
    values ('12 Elm Street', ARRAY['storm']::text[], ${member}, ${key}, ${key ? 'h' : null}) returning id`));

  it('makes started_at required, with now() for a new row', async () => {
    const meta = (await db.execute(sql`select is_nullable, column_default from information_schema.columns where table_name = 'roof_reports' and column_name = 'started_at'`)).rows[0] as any;
    expect(meta.is_nullable).toBe('NO');
    expect(meta.column_default).toMatch(/now\(\)/);
    const { rows } = await insert(a, null, null);
    const [row] = await runAsCompany(a, async () => (await db.execute(sql`select started_at, created_at from roof_reports where id = ${(rows[0] as any).id}`)).rows as any[]);
    expect(Math.abs(new Date(row.started_at).getTime() - Date.now())).toBeLessThan(60_000);
  });

  it('allows one report per company, person and key, and any number with no key', async () => {
    expect(await sqlState(insert(a, 7, 'submit-aaaa-0001'))).toBeNull();
    expect(await sqlState(insert(a, 7, 'submit-aaaa-0001'))).toBe(UNIQUE_VIOLATION);
    expect(await sqlState(insert(a, 8, 'submit-aaaa-0001'))).toBeNull();
    expect(await sqlState(insert(b, 7, 'submit-aaaa-0001'))).toBeNull();
    expect(await sqlState(insert(a, 7, 'submit-aaaa-0002'))).toBeNull();
    expect(await sqlState(insert(a, 7, null))).toBeNull();
    expect(await sqlState(insert(a, 7, null))).toBeNull();
  });

  it('has an index to count a company\'s starts by', async () => {
    const rows = (await db.execute(sql`select indexdef from pg_indexes where tablename = 'roof_reports' and indexname = 'roof_reports_company_started'`)).rows as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0].indexdef).toMatch(/\(company_id, started_at\)/);
  });
});
