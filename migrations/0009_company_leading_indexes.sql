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
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "leads_company_created_at_idx" ON "leads" USING btree ("company_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "calls_company_started_at_idx" ON "calls" USING btree ("company_id","started_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "comm_messages_company_sent_at_idx" ON "comm_messages" USING btree ("company_id","sent_at");
