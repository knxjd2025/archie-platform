-- Archie: row level security on every company table.
-- See docs/archie/01-multi-company.md.
--
-- Every table with a company_id column gets the same policy: a row is visible
-- and writable only for the company in app.company_id, or for deliberate
-- system work (app.system = 'on'). FORCE applies the policy to the table
-- owner too, so nothing short of a superuser or a BYPASSRLS role skips it.

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
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', r.table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', r.table_name);
    EXECUTE format('DROP POLICY IF EXISTS company_isolation ON %I', r.table_name);
    EXECUTE format(
      'CREATE POLICY company_isolation ON %I
         USING (company_id = archie_current_company() OR archie_is_system())
         WITH CHECK (company_id = archie_current_company() OR archie_is_system())',
      r.table_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I (company_id)', r.table_name || '_company_id_idx', r.table_name);
  END LOOP;
END $$;
--> statement-breakpoint

-- The companies table itself: a company may read its own row and nothing
-- else, and may not change it. Status, GHL location and the rest change only
-- through system work for one named company (admin tools, verified connects),
-- so a paused company cannot un-pause itself and nobody can claim a location.
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE companies FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS company_self ON companies;
--> statement-breakpoint
CREATE POLICY company_self_read ON companies FOR SELECT
  USING (id = archie_current_company() OR archie_is_system());
--> statement-breakpoint
CREATE POLICY company_system_insert ON companies FOR INSERT WITH CHECK (archie_is_system());
--> statement-breakpoint
CREATE POLICY company_system_update ON companies FOR UPDATE USING (archie_is_system()) WITH CHECK (archie_is_system());
--> statement-breakpoint
CREATE POLICY company_system_delete ON companies FOR DELETE USING (archie_is_system());
--> statement-breakpoint

-- Sessions (express-session via connect-pg-simple). Global: a session is
-- looked up before anyone knows which company it is for. Holds only the
-- signed-in person's email, name, role and company id.
CREATE TABLE IF NOT EXISTS "session" (
  "sid" varchar NOT NULL PRIMARY KEY,
  "sess" json NOT NULL,
  "expire" timestamp(6) NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");
--> statement-breakpoint

-- What the app role may do. No DDL: the schema changes only through migrations.
GRANT USAGE ON SCHEMA public TO archie_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO archie_app;
--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO archie_app;
--> statement-breakpoint
-- The migration log is the migration runner's, not the app's.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = '_migrations' AND relnamespace = 'public'::regnamespace) THEN
    EXECUTE 'REVOKE ALL ON _migrations FROM archie_app';
  END IF;
END $$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION archie_current_company(), archie_is_system() TO archie_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO archie_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO archie_app;
--> statement-breakpoint

-- On Supabase, the public schema is also reachable through its REST API as the
-- anon and authenticated roles. Archie never uses that API; take its access away.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM authenticated';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM authenticated';
  END IF;
END $$;
