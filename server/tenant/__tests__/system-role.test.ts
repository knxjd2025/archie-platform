/**
 * Row level security with a separate system role (migrations/0008), against
 * the real test database (scripts/test-db.sh), through the app's own
 * connection path (server/db.ts) as archie_app.
 *
 * Every company table gets one row for company A and one for company B,
 * written by the owner. Then, for every table:
 * - with no company and no system access, nothing is visible and nothing can
 *   be written (fails closed);
 * - company A sees only its row and cannot write into, move to, change or
 *   delete company B's;
 * - deliberate system work (runAsSystem) sees both.
 * And the system role never outlives its work on a pooled connection, and
 * neither app role can widen its own access.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool as PgPool, Client, type PoolClient } from 'pg';
import { sql } from 'drizzle-orm';

const url = process.env.DATABASE_URL || '';
const ownerUrl = process.env.ARCHIE_TEST_OWNER_URL || '';
// A rehearsal database (scripts/rehearse-supabase.sh) opts in explicitly.
const rehearsal = process.env.ARCHIE_REHEARSAL === '1';
const isLocal = (u: string) => rehearsal || /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(u);

const GLOBAL = new Set(['session', '_migrations', 'companies']);

interface TableInfo { name: string; deps: string[]; insert: (companyId: string) => { text: string; values: unknown[] } }

/** SQLSTATE of a failed query (drizzle wraps pg errors in .cause). */
async function sqlState(p: Promise<unknown>): Promise<string | null> {
  return p.then(() => null, (e) => e?.cause?.code ?? e?.code ?? 'no-code');
}

describe.skipIf(!isLocal(url) || !isLocal(ownerUrl))('system role and company isolation on every table', async () => {
  const { db, pool, SYSTEM_ROLE } = await import('../../db');
  const { runAsCompany, runAsSystem } = await import('../context');

  const tag = `sysrole-${process.pid}-${Date.now()}`;
  const owner = new Client({ connectionString: ownerUrl });
  let a = '';
  let b = '';
  let tables: TableInfo[] = [];

  /** A row for each company table, built from the catalog: required columns get a value of their type. */
  async function describeTables(): Promise<TableInfo[]> {
    const { rows } = await owner.query(`
      select c.relname as table,
             coalesce(json_agg(json_build_object('name', a.attname, 'type', format_type(a.atttypid, a.atttypmod),
                        'enum', t.typtype = 'e', 'udt', t.typname,
                        'check', (select string_agg(pg_get_constraintdef(k.oid), ' ') from pg_constraint k
                                   where k.conrelid = c.oid and k.contype = 'c' and a.attnum = any(k.conkey)),
                        'fk', (select json_build_object('table', f.confrelid::regclass::text, 'col', fa.attname)
                                 from pg_constraint f join pg_attribute fa on fa.attrelid = f.confrelid and fa.attnum = f.confkey[array_position(f.conkey, a.attnum)]
                                -- A one-column key, or a key paired with company_id (0017's crews): either way the
                                -- parent row is the same company's, which is what the insert below picks.
                                where f.conrelid = c.oid and f.contype = 'f' and a.attnum = any(f.conkey)
                                limit 1)))
                      filter (where a.attnotnull and not a.atthasdef and a.attname <> 'company_id' and a.attidentity = '' and a.attgenerated = ''), '[]') as cols
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
        join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
        join pg_type t on t.oid = a.atttypid
       where c.relkind = 'r'
         and exists (select 1 from pg_attribute z where z.attrelid = c.oid and z.attname = 'company_id' and not z.attisdropped)
       group by c.relname order by c.relname`);
    type Col = { name: string; type: string; enum: boolean; udt: string; check: string | null; fk: { table: string; col: string } | null };
    const unordered: TableInfo[] = rows.filter((r: any) => !GLOBAL.has(r.table)).map((r: any) => ({
      name: r.table,
      // Required foreign keys point at the same company's row in the parent,
      // so parents are written first (no need to switch foreign keys off).
      deps: (r.cols as Col[]).map((c) => c.fk?.table.replace(/^"|"$/g, '')).filter((t): t is string => !!t && t !== 'companies' && t !== r.table),
      insert: (companyId: string) => {
        const cols = ['company_id'];
        const exprs = ['$1::uuid'];
        const values: unknown[] = [companyId];
        for (const col of r.cols as Col[]) {
          cols.push(`"${col.name}"`);
          const literal = col.check?.match(/'([^']+)'::text/)?.[1];
          if (col.fk?.table === 'companies') exprs.push('$1::uuid');
          else if (col.fk) exprs.push(`(select "${col.fk.col}" from ${col.fk.table} where company_id = $1::uuid limit 1)`);
          else if (col.enum) exprs.push(`(enum_range(null::${col.udt}))[1]`);
          else if (literal) exprs.push(`'${literal}'`);
          // Kept under 60 characters, so a capped name (0017's crews) still fits.
          else if (/^(text|character varying)/.test(col.type)) exprs.push(`left('${tag}-' || replace(gen_random_uuid()::text, '-', ''), 56)`);
          else if (/^(integer|bigint|smallint)/.test(col.type)) exprs.push('(random() * 1e8)::int');
          else if (/^numeric/.test(col.type)) exprs.push('1');
          else if (col.type === 'boolean') exprs.push('false');
          else if (col.type === 'bytea') exprs.push(`'\\x00'::bytea`);
          else if (col.type === 'date') exprs.push('current_date');
          else if (/^timestamp/.test(col.type)) exprs.push('now()');
          else if (/^jsonb?$/.test(col.type)) exprs.push(`'{}'::${col.type}`);
          else if (col.type === 'uuid') exprs.push('gen_random_uuid()');
          else if (/\[\]$/.test(col.type)) exprs.push(`'{}'::${col.type}`);
          else throw new Error(`no test value for ${r.table}.${col.name} (${col.type})`);
        }
        return { text: `insert into "${r.table}" (${cols.join(', ')}) values (${exprs.join(', ')})`, values };
      },
    }));
    // Parents before children.
    const ordered: TableInfo[] = [];
    const placed = new Set<string>();
    let rest = unordered;
    while (rest.length) {
      const ready = rest.filter((t) => t.deps.every((d) => placed.has(d) || !unordered.some((u) => u.name === d)));
      if (!ready.length) throw new Error(`foreign key cycle among: ${rest.map((t) => t.name).join(', ')}`);
      for (const t of ready) { ordered.push(t); placed.add(t.name); }
      rest = rest.filter((t) => !placed.has(t.name));
    }
    return ordered;
  }

  /** Wait until every client is back in the pool (system releases reset asynchronously). */
  async function settle() {
    for (let i = 0; i < 100 && (pool.idleCount !== pool.totalCount || pool.waitingCount > 0); i++) {
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(pool.idleCount).toBe(pool.totalCount);
  }

  /** What every idle pooled connection is set to, read without the pool's checkout logic. */
  async function idleConnections() {
    await settle();
    const raw: PoolClient[] = [];
    try {
      const n = pool.idleCount;
      for (let i = 0; i < n; i++) raw.push(await (PgPool.prototype.connect as () => Promise<PoolClient>).call(pool));
      return await Promise.all(raw.map(async (c) => (await c.query(
        "select pg_backend_pid() as pid, current_user as role, coalesce(current_setting('app.system', true), '') as system",
      )).rows[0] as { pid: number; role: string; system: string }));
    } finally {
      for (const c of raw) c.release();
    }
  }

  beforeAll(async () => {
    await owner.connect();
    // Companies through the app's own system path; each company's rows by the
    // owner, in that company's context, so this works for a non-superuser
    // owner too (Supabase's postgres: row level security is forced on it),
    // with every constraint, foreign keys included, in force.
    const { createCompany } = await import('../companies');
    a = (await createCompany({ slug: `${tag}-a`, name: 'Sysrole A', status: 'cancelled' })).id;
    b = (await createCompany({ slug: `${tag}-b`, name: 'Sysrole B', status: 'cancelled' })).id;
    tables = await describeTables();
    const failed: string[] = [];
    for (const t of tables) {
      for (const id of [a, b]) {
        const q = t.insert(id);
        await owner.query("select set_config('app.company_id', $1, false)", [id]);
        await owner.query(q.text, q.values).catch((e) => failed.push(`${t.name}: ${e.message}`));
      }
    }
    await owner.query("select set_config('app.company_id', '', false)");
    expect(failed).toEqual([]);
  }, 120_000);

  afterAll(async () => {
    for (const id of [a, b]) {
      if (!id) continue;
      await owner.query("select set_config('app.company_id', $1, false)", [id]);
      // Children before parents.
      for (const t of [...tables].reverse()) await owner.query(`delete from "${t.name}" where company_id = $1`, [id]).catch(() => {});
    }
    await runAsSystem('test cleanup', () => pool.query('delete from companies where id in ($1, $2)', [a, b])).catch(() => {});
    await owner.end();
  }, 120_000);

  it('covers every company table, including the ones added after 0002', () => {
    const names = tables.map((t) => t.name);
    expect(names.length).toBeGreaterThan(60);
    expect(names).toEqual(expect.arrayContaining(['leads', 'team_members', 'password_links', 'company_assets', 'company_job_runs', 'bug_reports']));
  });

  it('fails closed with no company and no system access: sees nothing, writes nothing', async () => {
    const problems: string[] = [];
    for (const t of tables) {
      const { rows } = await pool.query(`select count(*)::int as n from "${t.name}"`);
      if (rows[0].n !== 0) problems.push(`${t.name}: sees ${rows[0].n} rows`);
      const q = t.insert(a);
      const code = await sqlState(pool.query(q.text, q.values));
      if (code !== '42501') problems.push(`${t.name}: insert gave ${code}`);
      const upd = await pool.query(`update "${t.name}" set company_id = company_id`);
      const del = await pool.query(`delete from "${t.name}" where company_id = $1`, [a]);
      if (upd.rowCount || del.rowCount) problems.push(`${t.name}: changed rows`);
    }
    expect(problems).toEqual([]);
  });

  it('shows company A only its own row in every table and refuses every write into company B', async () => {
    const problems = await runAsCompany(a, async () => {
      const out: string[] = [];
      for (const t of tables) {
        const { rows } = await pool.query(
          `select count(*) filter (where company_id = $1)::int as mine, count(*) filter (where company_id is distinct from $1)::int as others from "${t.name}"`, [a]);
        if (rows[0].mine !== 1 || rows[0].others !== 0) out.push(`${t.name}: sees ${JSON.stringify(rows[0])}`);
        const q = t.insert(b);
        const planted = await sqlState(pool.query(q.text, q.values));
        if (planted !== '42501') out.push(`${t.name}: insert into B gave ${planted}`);
        const moved = await sqlState(pool.query(`update "${t.name}" set company_id = $1 where company_id = $2`, [b, a]));
        if (moved !== '42501') out.push(`${t.name}: moving a row to B gave ${moved}`);
        const upd = await pool.query(`update "${t.name}" set company_id = company_id where company_id = $1`, [b]);
        const del = await pool.query(`delete from "${t.name}" where company_id = $1`, [b]);
        if (upd.rowCount || del.rowCount) out.push(`${t.name}: changed B's rows`);
      }
      return out;
    }, { loadProfile: false });
    expect(problems).toEqual([]);
    // B's rows are all still there.
    const { rows } = await runAsSystem('test check', () => pool.query('select count(*)::int as n from leads where company_id = $1', [b]));
    expect(rows[0].n).toBe(1);
  });

  it('lets deliberate system work see both companies in every table', async () => {
    const problems = await runAsSystem('test: every table', async () => {
      const out: string[] = [];
      for (const t of tables) {
        const { rows } = await pool.query(`select count(*)::int as n from "${t.name}" where company_id in ($1, $2)`, [a, b]);
        if (rows[0].n !== 2) out.push(`${t.name}: sees ${rows[0].n}`);
      }
      return out;
    });
    expect(problems).toEqual([]);
  });

  it('runs system work as the system role and everything else as the app role', async () => {
    const who = (q = 'select current_user as role, archie_is_system() as sys') => pool.query(q).then((r) => r.rows[0]);
    expect(await runAsSystem('test', () => who())).toEqual({ role: SYSTEM_ROLE, sys: true });
    expect(await runAsCompany(a, () => who(), { loadProfile: false })).toEqual({ role: 'archie_app', sys: false });
    expect(await who()).toEqual({ role: 'archie_app', sys: false });
  });

  it('keeps system access inside a transaction, and only there', async () => {
    const n = await runAsSystem('test', () => db.transaction(async (tx) => {
      const r = await tx.execute(sql`select count(*)::int as n from leads where company_id in (${a}, ${b})`);
      return (r.rows[0] as { n: number }).n;
    }));
    expect(n).toBe(2);
    const after = await runAsCompany(a, () => db.transaction(async (tx) => {
      const r = await tx.execute(sql`select current_user as role, count(*)::int as n from leads where company_id in (${a}, ${b})`);
      return r.rows[0];
    }), { loadProfile: false });
    expect(after).toEqual({ role: 'archie_app', n: 1 });
  });

  it('never leaves system access on an idle pooled connection', async () => {
    // Fill the pool with system work, then look at every idle connection
    // without going through the pool's own checkout (which would reset it).
    await runAsSystem('test', () => Promise.all(Array.from({ length: 8 }, () => pool.query('select pg_sleep(0.01)'))));
    const idle = await idleConnections();
    expect(idle.length).toBeGreaterThan(0);
    for (const c of idle) expect(c).toMatchObject({ role: 'archie_app', system: '' });
  });

  it('gives the next user of a connection no system access, after success, an error or a timeout in system work', async () => {
    const cases: [string, () => Promise<unknown>][] = [
      ['success', () => pool.query('select 1')],
      ['error', () => pool.query('select 1/0')],
      ['error in a transaction', () => db.transaction(async (tx) => { await tx.execute(sql`select 1`); throw new Error('boom'); })],
      ['statement timeout in a transaction', () => db.transaction(async (tx) => {
        await tx.execute(sql`set local statement_timeout = '50ms'`);
        await tx.execute(sql`select pg_sleep(2)`);
      })],
    ];
    for (const [label, work] of cases) {
      const pid = await runAsSystem('test', async () => {
        const r = await pool.query('select pg_backend_pid() as pid');
        await work().catch(() => {});
        return r.rows[0].pid as number;
      });
      // The very next checkout, with no context, then as a company.
      const none = await pool.query("select current_user as role, (select count(*)::int from leads) as n");
      expect(none.rows[0], label).toEqual({ role: 'archie_app', n: 0 });
      const asA = await runAsCompany(a, () => pool.query('select current_user as role, count(*)::int as n from leads where company_id in ($1, $2)', [a, b]), { loadProfile: false });
      expect(asA.rows[0], label).toEqual({ role: 'archie_app', n: 1 });
      for (const c of await idleConnections()) expect(c, `${label} (pid ${pid})`).toMatchObject({ role: 'archie_app', system: '' });
    }
  }, 20_000);

  it('throws away a connection released in the middle of a transaction', async () => {
    for (const ctx of ['system', 'company'] as const) {
      const run = <T,>(fn: () => Promise<T>) => (ctx === 'system' ? runAsSystem('test', fn) : runAsCompany(a, fn, { loadProfile: false }));
      const pid = await run(async () => {
        const client = await pool.connect();
        await client.query('begin');
        const r = await client.query('select pg_backend_pid() as pid');
        client.release();
        return r.rows[0].pid as number;
      });
      await settle();
      for (const c of await idleConnections()) expect(c.pid, ctx).not.toBe(pid);
    }
  });

  it('refuses system work done the old way (app.system without the role) loudly, never silently', async () => {
    // What code from before 0008 does: the setting, no role switch. It must
    // not see anything, and must say why rather than return nothing.
    const client = await pool.connect();
    try {
      await client.query("select set_config('app.system', 'on', false)");
      const err = await client.query('select count(*)::int as n from companies').then(() => null, (e) => e);
      expect(err?.code).toBe('42501');
      expect(err?.message).toMatch(/system work without the archie_system role/);
      expect(err?.hint).toMatch(/revert-0008-rls-system-role\.sql/);
      // Writes too.
      const w = await client.query(`insert into settings (key, value) values ('${tag}-old', '{}')`).then(() => null, (e) => e);
      expect(w?.code).toBe('42501');
    } finally {
      client.release(true); // do not hand this session on
    }
    // Company work is untouched by the check.
    const ok = await runAsCompany(a, () => pool.query('select count(*)::int as n from leads'), { loadProfile: false });
    expect(ok.rows[0].n).toBe(1);
  });

  it('keeps both roles unable to bypass row level security or widen their own access', async () => {
    const { rows } = await pool.query(
      `select rolname, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb, rolcanlogin, rolinherit
         from pg_roles where rolname in ('archie_app', 'archie_system') order by rolname`);
    expect(rows).toEqual([
      expect.objectContaining({ rolname: 'archie_app', rolsuper: false, rolbypassrls: false, rolcreaterole: false, rolcreatedb: false }),
      { rolname: 'archie_system', rolsuper: false, rolbypassrls: false, rolcreaterole: false, rolcreatedb: false, rolcanlogin: false, rolinherit: false },
    ]);
    // archie_app may switch to archie_system but does not inherit it.
    const m = await pool.query(
      `select pg_has_role('archie_app', 'archie_system', 'USAGE') as inherits,
              (select bool_or(admin_option) from pg_auth_members where member = 'archie_app'::regrole) as admin,
              (select count(*)::int from pg_auth_members where member = 'archie_system'::regrole) as system_member_of`);
    expect(m.rows[0]).toEqual({ inherits: false, admin: false, system_member_of: 0 });

    const attempts = [
      'grant archie_system to archie_app with inherit true',
      'grant archie_system to archie_app with admin option',
      'alter role archie_app bypassrls',
      'alter role archie_system bypassrls',
      'alter role archie_system login',
      'alter table leads disable row level security',
      'alter table leads no force row level security',
      'drop policy company_isolation on leads',
      'create policy sneak on leads using (true)',
      "alter policy company_system on leads to public",
      `set role ${(await owner.query('select current_user as u')).rows[0].u}`,
      'set session authorization archie_system',
      'create role sneaky',
      "select * from _migrations",
    ];
    for (const ctx of ['app', 'system'] as const) {
      for (const stmt of attempts) {
        const client = await pool.connect();
        try {
          if (ctx === 'system') await client.query(`set role ${SYSTEM_ROLE}`);
          const code = await sqlState(client.query(stmt));
          expect(code, `${ctx}: ${stmt}`).toBe('42501');
        } finally {
          client.release(true);
        }
      }
    }
  });

  it('keeps session global, and the migration log away from the system role too', async () => {
    const sid = `${tag}-sid`;
    await pool.query(`insert into session (sid, sess, expire) values ($1, '{}', now() + interval '1 hour')`, [sid]);
    expect((await runAsCompany(a, () => pool.query('select sid from session where sid = $1', [sid]), { loadProfile: false })).rows).toHaveLength(1);
    expect((await runAsSystem('test', () => pool.query('select sid from session where sid = $1', [sid]))).rows).toHaveLength(1);
    await pool.query('delete from session where sid = $1', [sid]);
    expect(await runAsSystem('test', () => sqlState(pool.query('select count(*) from _migrations')))).toBe('42501');
  });
});
