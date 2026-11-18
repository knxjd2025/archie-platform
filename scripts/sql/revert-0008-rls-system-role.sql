-- Revert migration 0008 (role-based system access) to the policies before it,
-- so that code older than 0008 works again. See
-- docs/archie/01-multi-company.md, "Rolling out 0008 and rolling back".
--
-- WHEN: before running code older than 0008 against this database: a Vercel
-- rollback (Instant Rollback) past the 0008 deployment, a preview deployment
-- or a laptop on old code. Old code after 0008 cannot do system work
-- (sign-in, webhook routing, crons); since 0008 it gets a loud error instead.
--
-- WHAT: every company table gets back its single 0002-style policy,
--   company_id = archie_current_company() OR archie_is_system()
-- (with the full-scan cost that 0008 removed), the companies table its four
-- old policies, and archie_current_company() / archie_is_system() their old
-- definitions (reading app.company_id and app.system). The archie_system role,
-- its grants and archie_protect_company_table() are left in place: harmless,
-- and the CURRENT code keeps working on the reverted database too (it sets
-- app.system as well as the role). Data is not touched.
--
-- HOW: as the owner (Supabase: postgres), one transaction:
--   psql "$OWNER_URL" -v ON_ERROR_STOP=1 -1 -f scripts/sql/revert-0008-rls-system-role.sql
-- Idempotent: safe to run twice. Locks: ACCESS EXCLUSIVE on each company
-- table for the policy swap, held until commit (tens of milliseconds in all,
-- like 0008). If it fails on lock_timeout, run it again.
--
-- TO GO FORWARD AGAIN (current code deployed): run the 0008 file the same way
--   psql "$OWNER_URL" -v ON_ERROR_STOP=1 -1 -f migrations/0008_rls_system_role.sql
-- (it is idempotent; scripts/migrate.ts will not rerun it, it is recorded as applied).

SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION archie_current_company() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.company_id', true), '')::uuid $$;

CREATE OR REPLACE FUNCTION archie_is_system() RETURNS boolean
  LANGUAGE sql STABLE
  AS $$ SELECT coalesce(current_setting('app.system', true), '') = 'on' $$;

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
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', r.table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', r.table_name);
    EXECUTE format('DROP POLICY IF EXISTS company_system ON %I', r.table_name);
    EXECUTE format('DROP POLICY IF EXISTS company_isolation ON %I', r.table_name);
    EXECUTE format(
      'CREATE POLICY company_isolation ON %I
         USING (company_id = archie_current_company() OR archie_is_system())
         WITH CHECK (company_id = archie_current_company() OR archie_is_system())',
      r.table_name);
  END LOOP;
END $$;

DROP POLICY IF EXISTS company_system ON companies;
DROP POLICY IF EXISTS company_self_read ON companies;
DROP POLICY IF EXISTS company_system_insert ON companies;
DROP POLICY IF EXISTS company_system_update ON companies;
DROP POLICY IF EXISTS company_system_delete ON companies;
CREATE POLICY company_self_read ON companies FOR SELECT
  USING (id = archie_current_company() OR archie_is_system());
CREATE POLICY company_system_insert ON companies FOR INSERT WITH CHECK (archie_is_system());
CREATE POLICY company_system_update ON companies FOR UPDATE USING (archie_is_system()) WITH CHECK (archie_is_system());
CREATE POLICY company_system_delete ON companies FOR DELETE USING (archie_is_system());
