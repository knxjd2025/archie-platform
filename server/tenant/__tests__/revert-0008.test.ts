/**
 * scripts/sql/revert-0008-rls-system-role.sql, in a database of its own built
 * from the migrations (so its table locks never meet the other test files).
 *
 * After the revert: old code (app.system without the role) and current code
 * (the role) can both do system work, company isolation still holds, and
 * missing context still sees nothing. Running 0008 again restores the
 * role-based policies, after which old code gets a loud error. Both files are
 * idempotent.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';

const ownerUrl = process.env.ARCHIE_TEST_OWNER_URL || '';
const isLocal = /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(ownerUrl);

describe.skipIf(!isLocal)('reverting 0008', () => {
  const dbName = `archie_revert_${process.pid}`;
  const serverUrl = ownerUrl.replace(/\/[^/]+$/, '');
  const admin = new Client({ connectionString: `${serverUrl}/postgres` });
  const owner = new Client({ connectionString: `${serverUrl}/${dbName}` });
  const file = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');
  const A = '0a000000-0000-4000-8000-000000000001';
  const B = '0b000000-0000-4000-8000-000000000002';

  beforeAll(async () => {
    await admin.connect();
    await admin.query(`drop database if exists ${dbName}`);
    await admin.query(`create database ${dbName}`);
    execFileSync('npx', ['tsx', 'scripts/migrate.ts'], { env: { ...process.env, DATABASE_URL: `${serverUrl}/${dbName}` }, stdio: 'ignore' });
    await owner.connect();
    await owner.query(`insert into companies (id, slug, name, status) values ($1, 'rev-a', 'A', 'active'), ($2, 'rev-b', 'B', 'active')`, [A, B]);
    await owner.query(`insert into leads (company_id, source) values ($1, 'test'), ($2, 'test')`, [A, B]);
  }, 60_000);

  afterAll(async () => {
    await owner.end().catch(() => {});
    await admin.query(`drop database if exists ${dbName}`);
    await admin.end();
  });

  /** One query as the app role, in a fresh transaction, with the given context. */
  async function asApp(ctx: { company?: string; system?: boolean; role?: 'archie_app' | 'archie_system' }, q: string) {
    await owner.query('begin');
    try {
      await owner.query(`set local role ${ctx.role ?? 'archie_app'}`);
      await owner.query("select set_config('app.company_id', $1, true), set_config('app.system', $2, true)", [ctx.company ?? '', ctx.system ? 'on' : '']);
      return (await owner.query(q)).rows;
    } finally {
      await owner.query('rollback');
    }
  }
  const leadCompanies = (ctx: Parameters<typeof asApp>[0]) =>
    asApp(ctx, 'select company_id from leads order by company_id').then((rows) => rows.map((r: any) => r.company_id));
  const err = (p: Promise<unknown>) => p.then(() => null, (e) => e);

  it('lets old and current code do system work after the revert, with isolation intact', async () => {
    await owner.query(file('scripts/sql/revert-0008-rls-system-role.sql'));
    await owner.query(file('scripts/sql/revert-0008-rls-system-role.sql')); // idempotent
    const { rows } = await owner.query(
      "select tablename, policyname, qual from pg_policies where schemaname = 'public' and tablename in ('leads', 'companies') order by 1, 2");
    expect(rows.map((r: any) => `${r.tablename}.${r.policyname}`)).toEqual([
      'companies.company_self_read', 'companies.company_system_delete', 'companies.company_system_insert', 'companies.company_system_update',
      'leads.company_isolation',
    ]);
    expect(rows.find((r: any) => r.tablename === 'leads').qual).toBe('((company_id = archie_current_company()) OR archie_is_system())');

    expect(await leadCompanies({ system: true })).toEqual([A, B]); // old code
    expect(await leadCompanies({ system: true, role: 'archie_system' })).toEqual([A, B]); // current code
    expect(await leadCompanies({ company: A })).toEqual([A]);
    expect(await leadCompanies({})).toEqual([]);
    expect((await err(asApp({ company: A }, `insert into leads (company_id, source) values ('${B}', 'x')`)))?.code).toBe('42501');
  });

  it('goes forward again by rerunning 0008, after which old code fails loudly', async () => {
    await owner.query(file('migrations/0008_rls_system_role.sql'));
    expect(await leadCompanies({ system: true, role: 'archie_system' })).toEqual([A, B]);
    expect(await leadCompanies({ company: A })).toEqual([A]);
    expect(await leadCompanies({})).toEqual([]);
    const e = await err(leadCompanies({ system: true }));
    expect(e?.code).toBe('42501');
    expect(e?.message).toMatch(/running code is older/);
  });
});
