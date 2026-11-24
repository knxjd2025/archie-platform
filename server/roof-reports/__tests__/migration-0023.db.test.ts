/**
 * Migration 0023: presentation_chapter_packs, against the real local test
 * database (scripts/test-db.sh) as the app's own role. The file creates one new
 * table and touches no existing one; the table has exactly the two company
 * policies, one row a company, and nobody but the system role writes it.
 * Fictional company: Summit Ridge Roofing in Cedar Falls.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';

const url = process.env.DATABASE_URL || '';
const local = process.env.ARCHIE_REHEARSAL === '1' || /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url);

describe('migration 0023: the file itself', () => {
  const text = readFileSync(join(process.cwd(), 'migrations', '0023_presentation_chapter_packs.sql'), 'utf8');

  it('creates one new table and changes no existing one', () => {
    expect(text.match(/CREATE TABLE /g)).toHaveLength(1);
    const alters = [...text.matchAll(/ALTER TABLE "?(\w+)"?/g)].map((m) => m[1]);
    expect(alters.every((t) => t === 'presentation_chapter_packs')).toBe(true);
    expect(text).not.toMatch(/DROP |DELETE FROM|UPDATE "?\w+"? SET|INSERT INTO/i);
  });

  it('has a lock timeout before anything else, protects the table the standard way, and keeps the app from writing it', () => {
    const at = (needle: string) => { const i = text.indexOf(needle); expect(i, needle).toBeGreaterThan(-1); return i; };
    expect(at('SET LOCAL lock_timeout')).toBeLessThan(at('CREATE TABLE'));
    expect(at("archie_protect_company_table('presentation_chapter_packs')")).toBeGreaterThan(at('CREATE TABLE'));
    expect(text).toMatch(/current_user = 'archie_app'/);
    expect(text).toMatch(/BEFORE INSERT OR UPDATE OR DELETE/);
    expect(text).toMatch(/REVOKE DELETE ON "presentation_chapter_packs" FROM archie_system/);
  });

  it('says it is applied by hand before the code that reads it', () => {
    expect(text).toMatch(/Apply this by hand, as the owner, BEFORE any deploy/);
  });
});

describe.skipIf(!local)('migration 0023: the table', async () => {
  const { db } = await import('../../db');
  const rows = async (query: ReturnType<typeof sql>) => (await db.execute(query)).rows as any[];
  let ready = false;
  beforeAll(async () => { ready = (await rows(sql`select to_regclass('public.presentation_chapter_packs') as t`))[0].t !== null; });

  it('exists, with row level security forced and exactly the two company policies', async () => {
    expect(ready).toBe(true);
    const [c] = await rows(sql`select relrowsecurity as rls, relforcerowsecurity as forced from pg_class where relname = 'presentation_chapter_packs'`);
    expect(c).toEqual({ rls: true, forced: true });
    const policies = await rows(sql`select policyname from pg_policies where tablename = 'presentation_chapter_packs' order by policyname`);
    expect(policies.map((p) => p.policyname)).toEqual(['company_isolation', 'company_system']);
  });

  it('lets the system role select, insert and update but not delete, and holds one row a company', async () => {
    const privs = await rows(sql`select p.privilege_type as p from (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')) p(privilege_type)
      where has_table_privilege('archie_system', 'public.presentation_chapter_packs', p.privilege_type) order by 1`);
    expect(privs.map((r) => r.p)).toEqual(['INSERT', 'SELECT', 'UPDATE']);
    const idx = await rows(sql`select indexdef from pg_indexes where tablename = 'presentation_chapter_packs' and indexname = 'presentation_chapter_packs_company_uq'`);
    expect(idx[0].indexdef).toMatch(/UNIQUE INDEX .* \(company_id\)/);
  });

  it('refuses a pack that is not an object', async () => {
    const c = await rows(sql`select pg_get_constraintdef(oid) as d from pg_constraint where conname = 'presentation_chapter_packs_pack_is_object'`);
    expect(c[0].d).toMatch(/pack @> '\{\}'::jsonb/);
  });
});
