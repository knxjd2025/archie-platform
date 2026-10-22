-- Archie: helpers that company isolation is built on.
-- See docs/archie/01-multi-company.md.
--
-- server/db.ts sets two settings on every connection it checks out:
--   app.company_id  the company the current request is for ('' for none)
--   app.system      'on' only for deliberate cross-company system work
-- Row level security policies (0002) and company_id column defaults read them
-- through these functions. With neither set, no company's rows are visible
-- and inserts into company tables fail.

CREATE OR REPLACE FUNCTION archie_current_company() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.company_id', true), '')::uuid $$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION archie_is_system() RETURNS boolean
  LANGUAGE sql STABLE
  AS $$ SELECT coalesce(current_setting('app.system', true), '') = 'on' $$;
--> statement-breakpoint

-- The role the app connects as. It is not a superuser and cannot bypass row
-- level security, so the policies apply to every query the app makes.
-- Created without a password; set one when provisioning:
--   ALTER ROLE archie_app WITH LOGIN PASSWORD '...';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'archie_app') THEN
    CREATE ROLE archie_app NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END $$;
