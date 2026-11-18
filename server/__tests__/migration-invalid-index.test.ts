/**
 * A CREATE INDEX CONCURRENTLY that fails leaves an INVALID index under its
 * name. Migrations 0007 and 0009 must replace such a leftover, not accept it
 * because of IF NOT EXISTS. Runs the real migration files as the owner
 * against the local test database.
 */
import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';

const ownerUrl = process.env.ARCHIE_TEST_OWNER_URL || '';
const isLocal = /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(ownerUrl);

describe.skipIf(!isLocal)('migrations replace invalid leftover indexes', () => {
  const owner = new Client({ connectionString: ownerUrl });
  const tag = `invalid-idx-${process.pid}-${Date.now()}`;
  const company = '00000000-0000-4000-8000-00000000abcd';
  const sqlOf = (file: string) => fs.readFileSync(path.join(process.cwd(), 'migrations', file), 'utf8');
  const state = async (name: string) => (await owner.query(
    `select i.indisvalid as valid, pg_get_indexdef(i.indexrelid) as def
       from pg_index i join pg_class c on c.oid = i.indexrelid where c.relname = $1`, [name])).rows[0];

  afterAll(async () => {
    await owner.query('set session_replication_role = replica');
    await owner.query('delete from leads where source = $1', [tag]);
    await owner.end();
  });

  for (const [file, name, columns] of [
    ['0009_company_leading_indexes.sql', 'leads_company_created_at_idx', '(company_id, created_at)'],
    ['0007_leads_external_id_index.sql', 'leads_company_external_id_idx', '(company_id, external_id)'],
  ] as const) {
    it(`${file} rebuilds ${name} when a failed concurrent build left it invalid`, async () => {
      if (!(owner as any)._connected) await owner.connect();
      // Two rows that break a unique build, so CONCURRENTLY fails part-way.
      await owner.query('set session_replication_role = replica');
      await owner.query(`insert into leads (company_id, source, external_id) values ($1, $2, 'dup'), ($1, $2, 'dup')`, [company, tag]);
      await owner.query('set session_replication_role = default');
      await owner.query(`drop index if exists ${name}`);
      const failed = await owner.query(`create unique index concurrently ${name} on leads (source, external_id)`).then(() => null, (e) => e);
      expect(failed?.code).toBe('23505');
      expect(await state(name)).toMatchObject({ valid: false });

      await owner.query('begin');
      await owner.query(sqlOf(file));
      await owner.query('commit');

      const after = await state(name);
      expect(after.valid).toBe(true);
      expect(after.def).toContain(columns);
      expect(after.def).not.toMatch(/UNIQUE/);
      await owner.query('delete from leads where source = $1', [tag]);
    });
  }
});
