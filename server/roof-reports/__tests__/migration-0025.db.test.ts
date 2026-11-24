/**
 * Migration 0025: roof_report_uses accepts one more kind, 'satellite' (finding the roof from a
 * satellite picture), against the real local test database (scripts/test-db.sh) as the app's own role.
 * Fictional company: Summit Ridge Roofing.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';

const url = process.env.DATABASE_URL || '';
const local = process.env.ARCHIE_REHEARSAL === '1' || /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url);
const sqlState = (p: Promise<unknown>): Promise<string | null> => p.then(() => null, (e) => e?.cause?.code ?? e?.code ?? 'no-code');

describe('migration 0025: the file itself', () => {
  const text = readFileSync(join(process.cwd(), 'migrations', '0025_roof_report_satellite_use.sql'), 'utf8');

  it('only widens one check on one table, with a short lock wait, and makes nothing', () => {
    expect(text).toContain("SET LOCAL lock_timeout = '5s'");
    expect(text).not.toMatch(/CREATE TABLE|CREATE INDEX|DROP TABLE|TRUNCATE|DELETE FROM|UPDATE |INSERT /i);
    expect(text.match(/ALTER TABLE "([a-z_]+)"/g)).toEqual(['ALTER TABLE "roof_report_uses"', 'ALTER TABLE "roof_report_uses"']);
    expect(text).toContain("IN ('send','rewrite','satellite')");
  });

  it('is in the journal as the next migration, with a snapshot', () => {
    const journal = JSON.parse(readFileSync(join(process.cwd(), 'migrations', 'meta', '_journal.json'), 'utf8')) as { entries: Array<{ idx: number; tag: string }> };
    const last = journal.entries[journal.entries.length - 1];
    expect(last).toMatchObject({ idx: 25, tag: '0025_roof_report_satellite_use' });
    const snapshot = JSON.parse(readFileSync(join(process.cwd(), 'migrations', 'meta', '0025_snapshot.json'), 'utf8'));
    expect(snapshot.tables['public.roof_report_uses'].checkConstraints.roof_report_uses_kind_check.value).toContain("'satellite'");
  });
});

describe.skipIf(!local)('migration 0025: the satellite kind', async () => {
  const { db } = await import('../../db');
  const { runAsCompany } = await import('../../tenant/context');
  const { createCompany } = await import('../../tenant/companies');
  const tag = `rr25-${process.pid}-${Date.now()}`;
  let a = '';
  beforeAll(async () => { a = (await createCompany({ slug: `${tag}-a`, name: 'Summit Ridge Roofing', status: 'active' })).id; });
  const NIL = '00000000-0000-0000-0000-000000000000';
  const insert = (kind: string, key: string | null = null) => runAsCompany(a, () => db.execute(sql`
    insert into roof_report_uses (report_id, kind, status, idempotency_key, request_hash) values (${NIL}, ${kind}, 'reserved', ${key}, ${key ? 'h' : null}) returning id`));

  it('takes a satellite use, and still takes a send and a rewrite', async () => {
    for (const kind of ['satellite', 'send', 'rewrite']) expect(await sqlState(insert(kind)), kind).toBeNull();
  });

  it('still refuses a kind nobody decided', async () => {
    for (const kind of ['post', 'Satellite', 'satellite ', '']) expect(await sqlState(insert(kind)), JSON.stringify(kind)).toBe('23514');
  });

  it('lets one live satellite use hold a request key, like a send does', async () => {
    expect(await sqlState(insert('satellite', 'k-sat-1'))).toBeNull();
    expect(await sqlState(insert('satellite', 'k-sat-1'))).toBe('23505');
  });
});
