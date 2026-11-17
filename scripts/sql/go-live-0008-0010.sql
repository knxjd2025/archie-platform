-- Archie go-live: migrations 0008, 0009 and 0010 in one paste, for the Supabase SQL Editor.
-- Run ONLY after the code from PR #2 is live (it is). Runs as one transaction: all or nothing.
-- Safe to run twice: if 0008 is already recorded it stops at the duplicate _migrations row and changes nothing.

-- ===================== 0008_rls_system_role.sql
-- Archie: row level security that Postgres can plan with the company indexes.
-- See docs/archie/01-multi-company.md, "Row Level Security".
--
-- ORDER AND ROLLBACK (read before running on a live database):
-- 1. Deploy the current code FIRST, then run this migration. The current code
--    works before and after it; code older than it cannot do system work
--    after it (sign-in, GHL webhook routing, crons), and gets a loud error
--    ("system work without the archie_system role") rather than nothing.
-- 2. Never run code older than this migration against the database (a Vercel
--    rollback past the deployment that shipped it, a preview deployment, a
--    laptop) without first running scripts/sql/revert-0008-rls-system-role.sql.
-- 3. To go forward again after a revert, rerun this file as the owner (it is
--    idempotent; scripts/migrate.ts will not, it is recorded as applied).
--
-- Before: every company table had one policy,
--   company_id = archie_current_company() OR archie_is_system()
-- The OR with a non-indexable function kept Postgres from using any index on
-- company_id, so nearly every query (almost none filter by company
-- themselves) scanned every company's rows.
--
-- After: two policies per company table, neither with an OR:
--   company_isolation  (everyone)              company_id = (SELECT archie_current_company())
--   company_system     (TO archie_system only) true
-- The app connects as archie_app and sees only its company. Deliberate
-- cross-company work (runAsSystem) switches its connection to the archie_system
-- role (server/db.ts, set_config('role', ...)), which replaces the old
-- app.system = 'on' setting. For archie_system the two policies combine to
-- (company_id = ... OR true), which Postgres folds to true.
-- (SELECT archie_current_company()) is an initplan: computed once per query
-- and usable as an index condition (company_id = $0).
--
-- Safe on a live database with data: no table is rewritten, and no index is
-- built unless a company table has none starting with company_id (none does
-- after 0002-0007; check first with the query in the docs' rollout section). Replacing a policy takes an ACCESS EXCLUSIVE lock on its table,
-- held until the migration commits (well under a second for all tables; no
-- statement here depends on table size). lock_timeout makes the migration
-- fail instead of queueing behind a long query and blocking everyone else;
-- if it fails, run it again.
--
-- Needs only what Supabase's postgres role has: CREATEROLE (to create
-- archie_system and grant it to archie_app), table ownership (policies,
-- grants). No superuser, no BYPASSRLS anywhere.

SET LOCAL lock_timeout = '5s';

-- The system role. It cannot log in: the only way to it is SET ROLE from
-- archie_app. It is not a superuser and cannot bypass row level security;
-- what it may see comes from the company_system policies below, and what it
-- may touch from the same table grants archie_app has.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'archie_system') THEN
    CREATE ROLE archie_system NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT;
  END IF;
END $$;

-- archie_app may switch to archie_system (SET) but does not inherit its
-- privileges or policies: as itself it sees only company_isolation. Postgres
-- 16+ says so on the grant; Postgres 15 says so with NOINHERIT on archie_app
-- (archie_app holds its privileges directly, not through other roles).
-- No ADMIN option: archie_app cannot grant archie_system to anyone.
DO $$
BEGIN
  IF current_setting('server_version_num')::int >= 160000 THEN
    EXECUTE 'GRANT archie_system TO archie_app WITH INHERIT FALSE, SET TRUE';
  ELSE
    EXECUTE 'ALTER ROLE archie_app NOINHERIT';
    EXECUTE 'GRANT archie_system TO archie_app';
  END IF;
END $$;

-- Older code (before this migration) does system work by setting
-- app.system = 'on' without switching role. Under these policies that sees
-- nothing at all: sign-in finds nobody, webhooks find no company, crons list
-- no companies, all silently. Make it loud instead: the company function
-- raises when system work is attempted without the archie_system role. New
-- code sets app.system only together with the role, so it never trips this.
-- Honouring the old setting instead would need a policy for archie_app with
-- an OR on it, which is exactly what made every query a full scan.
CREATE OR REPLACE FUNCTION archie_old_code_system_error() RETURNS uuid
  LANGUAGE plpgsql STABLE
  AS $$
BEGIN
  RAISE EXCEPTION 'Archie: system work without the archie_system role. This database has migration 0008 (role-based system access) and the running code is older.'
    USING HINT = 'Deploy the current code, or run scripts/sql/revert-0008-rls-system-role.sql before running older code (rollback, preview, laptop).',
          ERRCODE = 'insufficient_privilege';
END $$;
CREATE OR REPLACE FUNCTION archie_current_company() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT CASE
    WHEN coalesce(current_setting('app.system', true), '') = 'on' AND current_user <> 'archie_system'
      THEN archie_old_code_system_error()
    ELSE nullif(current_setting('app.company_id', true), '')::uuid
  END $$;
GRANT EXECUTE ON FUNCTION archie_old_code_system_error() TO archie_app, archie_system;

-- archie_is_system() now reports the role, not a setting anyone can set.
-- No policy uses it: an OR on it is exactly what this migration removes.
-- Kept for diagnostics (select archie_is_system()).
CREATE OR REPLACE FUNCTION archie_is_system() RETURNS boolean
  LANGUAGE sql STABLE
  AS $$ SELECT current_user = 'archie_system' $$;

-- The one way a company table gets its protection, now and in later
-- migrations: SELECT archie_protect_company_table('new_table');
-- Row level security on and forced, the two policies, the grants for both app
-- roles, and an index starting with company_id when the table has none.
CREATE OR REPLACE FUNCTION archie_protect_company_table(t regclass) RETURNS void
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = t AND attname = 'company_id' AND NOT attisdropped) THEN
    RAISE EXCEPTION 'archie_protect_company_table: % has no company_id column', t;
  END IF;
  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', t);
  EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', t);
  EXECUTE format('DROP POLICY IF EXISTS company_isolation ON %s', t);
  EXECUTE format('DROP POLICY IF EXISTS company_system ON %s', t);
  EXECUTE format(
    'CREATE POLICY company_isolation ON %s
       USING (company_id = (SELECT archie_current_company()))
       WITH CHECK (company_id = (SELECT archie_current_company()))', t);
  EXECUTE format('CREATE POLICY company_system ON %s TO archie_system USING (true) WITH CHECK (true)', t);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %s TO archie_app, archie_system', t);
  IF NOT EXISTS (
    SELECT 1 FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = i.indkey[0]
     WHERE i.indrelid = t AND a.attname = 'company_id'
  ) THEN
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %s (company_id)',
      (SELECT relname FROM pg_class WHERE oid = t) || '_company_id_idx', t);
  END IF;
END $$;
REVOKE ALL ON FUNCTION archie_protect_company_table(regclass) FROM PUBLIC;

-- Every company table there is (0002's set plus 0004-0007's).
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
    WHERE c.table_schema = 'public' AND c.column_name = 'company_id'
    ORDER BY c.table_name
  LOOP
    PERFORM archie_protect_company_table(format('public.%I', r.table_name)::regclass);
  END LOOP;
END $$;

-- The companies table: a company reads its own row and nothing else, and
-- changes nothing. Creating, pausing or re-pointing a company is system work.
DROP POLICY IF EXISTS company_self_read ON companies;
DROP POLICY IF EXISTS company_system_insert ON companies;
DROP POLICY IF EXISTS company_system_update ON companies;
DROP POLICY IF EXISTS company_system_delete ON companies;
DROP POLICY IF EXISTS company_system ON companies;
CREATE POLICY company_self_read ON companies FOR SELECT
  USING (id = (SELECT archie_current_company()));
CREATE POLICY company_system ON companies TO archie_system USING (true) WITH CHECK (true);

-- What the system role may do: the same as the app role, no more. No DDL.
GRANT USAGE ON SCHEMA public TO archie_system;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO archie_system;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO archie_system;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = '_migrations' AND relnamespace = 'public'::regnamespace) THEN
    EXECUTE 'REVOKE ALL ON _migrations FROM archie_system';
  END IF;
END $$;
GRANT EXECUTE ON FUNCTION archie_current_company(), archie_is_system() TO archie_system;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO archie_system;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO archie_system;

-- Refuse to finish unless the roles are exactly as described above.
DO $$
DECLARE
  bad text;
BEGIN
  SELECT string_agg(rolname, ', ') INTO bad FROM pg_roles
   WHERE rolname IN ('archie_app', 'archie_system')
     AND (rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb OR rolreplication);
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'role(s) % must not be superuser, BYPASSRLS, CREATEROLE, CREATEDB or REPLICATION', bad;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'archie_system' AND rolcanlogin) THEN
    RAISE EXCEPTION 'archie_system must not be able to log in';
  END IF;
  -- archie_system is a member of nothing; archie_app of archie_system only,
  -- without ADMIN, and without inheriting it.
  IF EXISTS (SELECT 1 FROM pg_auth_members m WHERE m.member = 'archie_system'::regrole) THEN
    RAISE EXCEPTION 'archie_system must not be a member of any role';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_auth_members m WHERE m.member = 'archie_app'::regrole
              AND (m.roleid <> 'archie_system'::regrole OR m.admin_option)) THEN
    RAISE EXCEPTION 'archie_app may only be a member of archie_system, without ADMIN';
  END IF;
  IF pg_has_role('archie_app', 'archie_system', 'USAGE') THEN
    RAISE EXCEPTION 'archie_app must not inherit archie_system';
  END IF;
  IF current_setting('server_version_num')::int >= 160000 THEN
    -- (The SET privilege type exists from Postgres 16.)
    IF NOT pg_has_role('archie_app', 'archie_system', 'SET') THEN
      RAISE EXCEPTION 'archie_app must be able to SET ROLE archie_system';
    END IF;
  END IF;
END $$;

INSERT INTO _migrations (name) VALUES ('0008_rls_system_role.sql');

-- ===================== 0009_company_leading_indexes.sql
-- Archie: indexes that start with company_id for the hot "newest first" and
-- "since a date" reads. See docs/archie/01-multi-company.md.
--
-- With 0008's row level security every query carries an indexable company
-- condition (company_id = $0), so an index on (company_id, time) hands over a
-- company's newest rows directly (scanned backward for ORDER BY time DESC).
-- Without it these reads walked the global time index (calls_started_at_idx,
-- comm_messages_sent_at_idx) past every other company's rows, or read and
-- sorted all of the company's rows. Measured with scripts/rls-explain.sh.
--   leads:         /api/leads, the dashboard's recent leads, agent tools
--   calls:         /api/calls (newest 50), the comms summary (since a date)
--   comm_messages: the comms summary (since a date)
--
-- On a live database with many rows, build these by hand first, without
-- blocking writes, then run the migrations (IF NOT EXISTS skips them). From
-- psql on a direct connection, ONE STATEMENT AT A TIME (CONCURRENTLY refuses
-- to run inside a transaction, and an editor that sends several statements
-- together runs them in one):
--   SET statement_timeout = 0;
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS leads_company_created_at_idx ON leads (company_id, created_at);
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS calls_company_started_at_idx ON calls (company_id, started_at);
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS comm_messages_company_sent_at_idx ON comm_messages (company_id, sent_at);
-- Then check that none was left invalid (a build that failed or was cut off):
--   SELECT indexrelid::regclass FROM pg_index WHERE NOT indisvalid;
-- It must return nothing. For any row: DROP INDEX CONCURRENTLY <name>; and
-- build it again. (This migration also drops a same-named invalid index
-- before creating, so it never accepts a broken one.)
-- Left to this migration, each CREATE INDEX holds a SHARE lock on its table
-- (writes wait, reads do not) for as long as its build takes.

-- A CREATE INDEX CONCURRENTLY that failed or was cut off leaves an INVALID
-- index under the final name, which IF NOT EXISTS would then accept forever
-- (the planner never uses it). Drop any such leftover first.
DO $$
DECLARE
  n text;
BEGIN
  FOREACH n IN ARRAY ARRAY['leads_company_created_at_idx', 'calls_company_started_at_idx', 'comm_messages_company_sent_at_idx'] LOOP
    IF EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
                WHERE c.relname = n AND c.relnamespace = 'public'::regnamespace AND NOT i.indisvalid) THEN
      RAISE NOTICE 'dropping invalid index %', n;
      EXECUTE format('DROP INDEX public.%I', n);
    END IF;
  END LOOP;
END $$;
CREATE INDEX IF NOT EXISTS "leads_company_created_at_idx" ON "leads" USING btree ("company_id","created_at");
CREATE INDEX IF NOT EXISTS "calls_company_started_at_idx" ON "calls" USING btree ("company_id","started_at");
CREATE INDEX IF NOT EXISTS "comm_messages_company_sent_at_idx" ON "comm_messages" USING btree ("company_id","sent_at");

INSERT INTO _migrations (name) VALUES ('0009_company_leading_indexes.sql');

-- ===================== 0010_company_job_leases.sql
-- Archie: one run at a time per company and scheduled job.
-- See server/tenant/fan-out.ts and docs/archie/01-multi-company.md.
--
-- Two invocations of the same job could both find a company not yet done and
-- both run it (a manual run during the cron, a repeated cron delivery), and a
-- company that hit its time limit kept running in the background while the
-- next invocation started it again. A run now claims the company's row with
-- one conditional INSERT ... ON CONFLICT DO UPDATE ... RETURNING that only
-- succeeds when no unexpired lease is held, and may only record success
-- while its own lease is still valid.
--
-- Two nullable columns with no default: a catalog change only, no table
-- rewrite; the ACCESS EXCLUSIVE lock lasts milliseconds.

SET LOCAL lock_timeout = '5s';
ALTER TABLE "company_job_runs" ADD COLUMN IF NOT EXISTS "lease_token" uuid;
ALTER TABLE "company_job_runs" ADD COLUMN IF NOT EXISTS "lease_until" timestamp;

INSERT INTO _migrations (name) VALUES ('0010_company_job_leases.sql');

-- ===================== check (the last result is what to read)
select (select string_agg(name, ', ' order by name) from _migrations) as migrations,
  (select count(*) from pg_policies where schemaname='public' and policyname='company_isolation' and (qual ilike '%archie_is_system%' or qual ilike '% or %')) as old_style_left,
  (select count(*) from pg_policies where schemaname='public' and policyname='company_system' and roles <> '{archie_system}') as system_policy_wrong_role;
