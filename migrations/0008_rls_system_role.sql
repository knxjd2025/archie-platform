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
--> statement-breakpoint

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
--> statement-breakpoint

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
--> statement-breakpoint

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
--> statement-breakpoint
CREATE OR REPLACE FUNCTION archie_current_company() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT CASE
    WHEN coalesce(current_setting('app.system', true), '') = 'on' AND current_user <> 'archie_system'
      THEN archie_old_code_system_error()
    ELSE nullif(current_setting('app.company_id', true), '')::uuid
  END $$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION archie_old_code_system_error() TO archie_app, archie_system;
--> statement-breakpoint

-- archie_is_system() now reports the role, not a setting anyone can set.
-- No policy uses it: an OR on it is exactly what this migration removes.
-- Kept for diagnostics (select archie_is_system()).
CREATE OR REPLACE FUNCTION archie_is_system() RETURNS boolean
  LANGUAGE sql STABLE
  AS $$ SELECT current_user = 'archie_system' $$;
--> statement-breakpoint

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
--> statement-breakpoint
REVOKE ALL ON FUNCTION archie_protect_company_table(regclass) FROM PUBLIC;
--> statement-breakpoint

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
--> statement-breakpoint

-- The companies table: a company reads its own row and nothing else, and
-- changes nothing. Creating, pausing or re-pointing a company is system work.
DROP POLICY IF EXISTS company_self_read ON companies;
--> statement-breakpoint
DROP POLICY IF EXISTS company_system_insert ON companies;
--> statement-breakpoint
DROP POLICY IF EXISTS company_system_update ON companies;
--> statement-breakpoint
DROP POLICY IF EXISTS company_system_delete ON companies;
--> statement-breakpoint
DROP POLICY IF EXISTS company_system ON companies;
--> statement-breakpoint
CREATE POLICY company_self_read ON companies FOR SELECT
  USING (id = (SELECT archie_current_company()));
--> statement-breakpoint
CREATE POLICY company_system ON companies TO archie_system USING (true) WITH CHECK (true);
--> statement-breakpoint

-- What the system role may do: the same as the app role, no more. No DDL.
GRANT USAGE ON SCHEMA public TO archie_system;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO archie_system;
--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO archie_system;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = '_migrations' AND relnamespace = 'public'::regnamespace) THEN
    EXECUTE 'REVOKE ALL ON _migrations FROM archie_system';
  END IF;
END $$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION archie_current_company(), archie_is_system() TO archie_system;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO archie_system;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO archie_system;
--> statement-breakpoint

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
