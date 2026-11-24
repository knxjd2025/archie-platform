/**
 * Migration 0024: roof_report_uses (the record every email sent and every
 * rewrite asked for leaves, so a daily cap can be held and a double click sends
 * once), against the real local test database (scripts/test-db.sh) as the app's
 * own role. Fictional companies: Summit Ridge Roofing and Cedar Falls Roofing Two.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';

const url = process.env.DATABASE_URL || '';
const local = process.env.ARCHIE_REHEARSAL === '1' || /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url);
const sqlState = (p: Promise<unknown>): Promise<string | null> => p.then(() => null, (e) => e?.cause?.code ?? e?.code ?? 'no-code');

describe('migration 0024: the file itself', () => {
  const text = readFileSync(join(process.cwd(), 'migrations', '0024_roof_report_uses.sql'), 'utf8');

  it('makes one new table, with a short lock wait, and touches nothing that exists', () => {
    expect(text).toContain("SET LOCAL lock_timeout = '5s'");
    expect(text.match(/CREATE TABLE/g)).toHaveLength(1);
    expect(text).not.toMatch(/DROP |TRUNCATE|DELETE FROM|ALTER TABLE "(?!roof_report_uses)/i);
  });

  it('protects the table the way every company table is, and holds no address column', () => {
    expect(text).toContain("SELECT archie_protect_company_table('roof_report_uses');");
    const body = text.split('CREATE TABLE')[1];
    expect(body).not.toMatch(/"(email|recipient|to_address)"/);
  });
});

describe.skipIf(!local)('migration 0024: roof report uses', async () => {
  const { db } = await import('../../db');
  const { runAsCompany } = await import('../../tenant/context');
  const { createCompany } = await import('../../tenant/companies');
  const tag = `rr24-${process.pid}-${Date.now()}`;
  let a = ''; let b = '';
  beforeAll(async () => {
    a = (await createCompany({ slug: `${tag}-a`, name: 'Summit Ridge Roofing', status: 'active' })).id;
    b = (await createCompany({ slug: `${tag}-b`, name: 'Cedar Falls Roofing Two', status: 'active' })).id;
  });
  const report = '00000000-0000-4000-8000-0000000000aa';
  const insert = (co: string, kind: string, status: string, key: string | null) => runAsCompany(co, () => db.execute(sql`
    insert into roof_report_uses (report_id, kind, status, idempotency_key, request_hash) values (${report}, ${kind}, ${status}, ${key}, ${key ? 'h' : null}) returning id`));

  it('takes the company from the connection and shows a company only its own rows', async () => {
    await insert(a, 'send', 'done', 'k-own-1');
    const mine = (await runAsCompany(a, () => db.execute(sql`select company_id from roof_report_uses`))).rows as any[];
    expect(mine.length).toBeGreaterThan(0);
    expect(new Set(mine.map((r) => r.company_id))).toEqual(new Set([a]));
    expect((await runAsCompany(b, () => db.execute(sql`select 1 from roof_report_uses`))).rows).toHaveLength(0);
  });

  it('refuses a kind or a status nobody decided', async () => {
    expect(await sqlState(insert(a, 'post', 'done', null))).toBe('23514');
    expect(await sqlState(insert(a, 'send', 'maybe', null))).toBe('23514');
  });

  it('lets one live use hold a request key, and frees the key when that use failed', async () => {
    await insert(a, 'send', 'reserved', 'k-dup');
    expect(await sqlState(insert(a, 'send', 'reserved', 'k-dup'))).toBe('23505');
    await runAsCompany(a, () => db.execute(sql`update roof_report_uses set status = 'failed' where idempotency_key = 'k-dup'`));
    expect(await sqlState(insert(a, 'send', 'reserved', 'k-dup'))).toBeNull();
    // Another company may use the same key for its own.
    expect(await sqlState(insert(b, 'send', 'reserved', 'k-dup'))).toBeNull();
  });
});
