/**
 * Company isolation, against the real test database (scripts/test-db.sh), as
 * the app's own database role. These are the guarantees in
 * docs/archie/01-multi-company.md: one company never sees another's rows, work
 * with no company sees nothing and writes nothing, and a pooled connection never
 * carries one request's company into the next.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { sql, eq, like } from 'drizzle-orm';

const url = process.env.DATABASE_URL || '';
const local = /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url);

describe.skipIf(!local)('company isolation', async () => {
  const { db, pool } = await import('../../db');
  const schema = await import('../../../shared/schema');
  const { runAsCompany, runAsSystem } = await import('../context');
  const { createCompany } = await import('../companies');
  const { companyForToken } = await import('../public-links');
  const { getTableConfig } = await import('drizzle-orm/pg-core');
  const { is } = await import('drizzle-orm');
  const { PgTable } = await import('drizzle-orm/pg-core');

  const tag = `iso-${process.pid}-${Date.now()}`;

  /** The database refused it on row level security (SQLSTATE 42501). */
  async function expectRefused(p: Promise<unknown>) {
    const err = await p.then(() => null, (e) => e);
    expect(err, 'expected the database to refuse').not.toBeNull();
    const code = err.cause?.code ?? err.code;
    expect(code).toBe('42501');
  }
  let a = '';
  let b = '';

  beforeAll(async () => {
    a = (await createCompany({ slug: `${tag}-a`, name: 'Company A', status: 'active' })).id;
    b = (await createCompany({ slug: `${tag}-b`, name: 'Company B', status: 'active' })).id;
  });

  it('runs the tests as a role the policies apply to', async () => {
    const { rows } = await pool.query('select rolsuper, rolbypassrls from pg_roles where rolname = current_user');
    // A superuser or BYPASSRLS role would make every test below pass for the wrong reason.
    expect(rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
  });

  it('puts every company table behind row level security', async () => {
    const tables = (Object.values(schema) as unknown[]).filter((t) => is(t, PgTable)).map((t) => getTableConfig(t as any));
    const missingColumn = tables.filter((t) => t.name !== 'companies' && !t.columns.some((c) => c.name === 'company_id')).map((t) => t.name);
    expect(missingColumn).toEqual([]);
    const names = tables.map((t) => t.name);
    const { rows } = await pool.query(
      `select c.relname, c.relrowsecurity, c.relforcerowsecurity,
              (select count(*) from pg_policies p where p.tablename = c.relname)::int as policies
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname = any($1)`, [names]);
    const unprotected = rows.filter((r: any) => !r.relrowsecurity || !r.relforcerowsecurity || r.policies < 1).map((r: any) => r.relname);
    expect(unprotected).toEqual([]);
    expect(rows.length).toBe(names.length);
  });

  it('protects every table in the database, not just the ones in the schema file', async () => {
    // A table a later migration adds gets the app's grants automatically, so it
    // must also get the policy. Walk the database itself, and check the policy
    // says exactly what it should.
    const { rows } = await pool.query(
      `select c.relname, c.relrowsecurity as rls, c.relforcerowsecurity as forced,
              exists (select 1 from information_schema.columns k
                       where k.table_schema = 'public' and k.table_name = c.relname and k.column_name = 'company_id') as has_company,
              (select array_agg(p.policyname || '|' || p.cmd || '|' || coalesce(p.qual, '') || '|' || coalesce(p.with_check, '') order by p.policyname)
                 from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname) as policies
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind in ('r', 'p')`);
    const GLOBAL = new Set(['session', '_migrations', 'companies']);
    const expected = '((company_id = archie_current_company()) OR archie_is_system())';
    const bad = rows
      .filter((r: any) => !GLOBAL.has(r.relname))
      .filter((r: any) => !r.has_company || !r.rls || !r.forced
        || (r.policies ?? []).length !== 1
        || r.policies[0] !== `company_isolation|ALL|${expected}|${expected}`)
      .map((r: any) => `${r.relname}: ${JSON.stringify(r.policies)}`);
    expect(bad).toEqual([]);
  });

  it('lets a company read its own companies row but never change it', async () => {
    await runAsCompany(a, () => db.update(schema.companies).set({ status: 'paused' }).where(eq(schema.companies.id, a)));
    await runAsCompany(b, () => db.update(schema.companies).set({ ghlLocationId: `${tag}-SQUAT` }).where(eq(schema.companies.id, b)));
    const rows = await runAsSystem('test', () => db.select().from(schema.companies).where(sql`${schema.companies.id} in (${a}, ${b})`));
    expect(rows.find((r) => r.id === a)?.status).toBe('active');
    expect(rows.find((r) => r.id === b)?.ghlLocationId).toBeNull();
    await expectRefused(runAsCompany(a, () => db.insert(schema.companies).values({ slug: `${tag}-sneaky`, name: 'Sneaky' })));
  });

  it('keeps the migration log away from the app', async () => {
    const err = await pool.query('select count(*) from _migrations').then(() => null, (e) => e);
    expect(err?.code).toBe('42501');
  });

  it('shows a company only its own rows', async () => {
    await runAsCompany(a, () => db.insert(schema.settings).values({ key: `${tag}:shared-key`, value: { who: 'a' } }));
    await runAsCompany(b, () => db.insert(schema.settings).values({ key: `${tag}:shared-key`, value: { who: 'b' } }));
    const seenByA = await runAsCompany(a, () => db.select().from(schema.settings).where(like(schema.settings.key, `${tag}:%`)));
    const seenByB = await runAsCompany(b, () => db.select().from(schema.settings).where(like(schema.settings.key, `${tag}:%`)));
    expect(seenByA.map((r) => r.value)).toEqual([{ who: 'a' }]);
    expect(seenByB.map((r) => r.value)).toEqual([{ who: 'b' }]);
    // The same key in two companies is two rows, not a conflict.
    expect(seenByA[0].companyId).toBe(a);
    expect(seenByB[0].companyId).toBe(b);
  });

  it('cannot change or delete another company\'s rows, even by id', async () => {
    const [mine] = await runAsCompany(a, () => db.insert(schema.leads).values({ firstName: `${tag} lead`, source: 'test' }).returning());
    const updated = await runAsCompany(b, () => db.update(schema.leads).set({ firstName: 'taken over' }).where(eq(schema.leads.id, mine.id)).returning());
    const deleted = await runAsCompany(b, () => db.delete(schema.leads).where(eq(schema.leads.id, mine.id)).returning());
    expect(updated).toEqual([]);
    expect(deleted).toEqual([]);
    const [still] = await runAsCompany(a, () => db.select().from(schema.leads).where(eq(schema.leads.id, mine.id)));
    expect(still.firstName).toBe(`${tag} lead`);
  });

  it('refuses a row written into another company', async () => {
    await expectRefused(runAsCompany(b, () => db.insert(schema.settings).values({ companyId: a, key: `${tag}:planted`, value: {} })));
  });

  it('refuses moving a row to another company', async () => {
    await runAsCompany(a, () => db.insert(schema.settings).values({ key: `${tag}:move-me`, value: {} }));
    await expectRefused(runAsCompany(a, () => db.update(schema.settings).set({ companyId: b }).where(eq(schema.settings.key, `${tag}:move-me`))));
  });

  it('sees nothing and writes nothing with no company at all', async () => {
    const seen = await db.select().from(schema.settings).where(like(schema.settings.key, `${tag}:%`));
    expect(seen).toEqual([]);
    await expect(db.insert(schema.settings).values({ key: `${tag}:orphan`, value: {} })).rejects.toThrow();
    const companies = await db.select().from(schema.companies);
    expect(companies).toEqual([]);
  });

  it('lets a company see only its own companies row', async () => {
    const rows = await runAsCompany(a, () => db.select().from(schema.companies));
    expect(rows.map((r) => r.id)).toEqual([a]);
  });

  it('lets deliberate system work see every company', async () => {
    const rows = await runAsSystem('test', () => db.select().from(schema.settings).where(like(schema.settings.key, `${tag}:shared-key`)));
    expect(new Set(rows.map((r) => r.companyId))).toEqual(new Set([a, b]));
  });

  it('never carries one request\'s company into the next on a pooled connection', async () => {
    // Many interleaved requests for two companies over the same small pool.
    const reads = await Promise.all(Array.from({ length: 40 }, (_, i) => {
      const co = i % 2 ? a : b;
      return runAsCompany(co, async () => {
        const rows = await db.select({ companyId: schema.settings.companyId }).from(schema.settings).where(like(schema.settings.key, `${tag}:shared-key`));
        return { co, seen: rows.map((r) => r.companyId) };
      });
    }));
    for (const r of reads) expect(r.seen).toEqual([r.co]);
    // And a request with no company after all of that still sees nothing.
    const after = await db.select().from(schema.settings).where(like(schema.settings.key, `${tag}:%`));
    expect(after).toEqual([]);
  });

  it('keeps a transaction on its company too', async () => {
    const seen = await runAsCompany(a, () => db.transaction(async (tx) => {
      const r = await tx.execute(sql`select archie_current_company() as id`);
      return (r.rows[0] as { id: string }).id;
    }));
    expect(seen).toBe(a);
  });

  it('finds the company for a public link token, and nothing for an unknown one', async () => {
    const token = `${tag}-share-token-abcdef`;
    await runAsCompany(b, () => db.insert(schema.clientReports).values({
      reportId: `${tag}-r1`, jobExternalId: `${tag}-job`, shareToken: token, createdBy: 'test',
    } as any));
    expect(await companyForToken(schema.clientReports as any, schema.clientReports.shareToken, token)).toBe(b);
    expect(await companyForToken(schema.clientReports as any, schema.clientReports.shareToken, `${tag}-no-such-token`)).toBeNull();
  });
});
