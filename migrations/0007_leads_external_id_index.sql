-- Archie: index for looking leads up by their source system's id
-- (eq(leads.externalId, ...) in about 51 places: client pages, reports,
-- webhooks). Company first, since every query runs as one company.
-- IF NOT EXISTS so a database where an operator already built it by hand
-- (for example CONCURRENTLY, ahead of this migration) is left alone. Build it
-- by hand from psql, one statement at a time, with SET statement_timeout = 0,
-- then check SELECT indexrelid::regclass FROM pg_index WHERE NOT indisvalid;
-- returns nothing (see 0009).
-- Note: Postgres uses it when the query's company condition is indexable.
-- Under the current policy (company_id = archie_current_company() OR
-- archie_is_system()) a lookup that filters on external_id alone is still a
-- sequential scan; the row level security redesign (company condition
-- without the OR) is what lets every such lookup use this index.

-- A CREATE INDEX CONCURRENTLY that failed or was cut off leaves an INVALID
-- index under the final name, which IF NOT EXISTS would then accept forever
-- (the planner never uses it). Drop any such leftover first.
DO $$
DECLARE
  n text;
BEGIN
  FOREACH n IN ARRAY ARRAY['leads_company_external_id_idx'] LOOP
    IF EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
                WHERE c.relname = n AND c.relnamespace = 'public'::regnamespace AND NOT i.indisvalid) THEN
      RAISE NOTICE 'dropping invalid index %', n;
      EXECUTE format('DROP INDEX public.%I', n);
    END IF;
  END LOOP;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "leads_company_external_id_idx" ON "leads" USING btree ("company_id","external_id");
