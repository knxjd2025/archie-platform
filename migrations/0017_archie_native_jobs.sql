-- Archie: its own jobs (docs/archie/02-roof-lee-link.md, "Archie's own jobs").
--
-- leads.job_type, lat, lng, photo_consent, lead_source, post_ref
--     what a job kept on Archie's own board needs to carry. All empty (and
--     photo_consent false) for every lead there is today.
-- leads_company_native_job_uq
--     an Archie-made job identity ('archie-...' in external_id) names one
--     lead in its company. No lead has one today, so the index starts empty.
--
-- APPLY THIS BEFORE DEPLOYING THE CODE THAT COMES WITH IT. That code reads
-- these columns every time it reads a lead, for every company, so deployed
-- against a database without them every lead screen fails. The other order
-- is safe: the code that is live today never names any of them.
--
-- Only a company Roof Lee made is ever given an Archie-made job identity, and
-- only through Roof Lee's signed endpoints, which are shut until
-- SISTERS_ARCHIE_SECRET is set. Nothing here changes how any existing company
-- behaves. No new table, so no new row level security policy: these columns
-- sit behind the two policies leads already has (0008).
--
-- Locks on a live database. The six ADD COLUMNs are catalog changes only (the
-- one default is a constant, so no table rewrite); the ACCESS EXCLUSIVE lock
-- on leads lasts milliseconds, and lock_timeout makes the migration fail
-- instead of queueing behind a long query and blocking every lead screen. If
-- it fails on the timeout, run it again (IF NOT EXISTS makes that safe).
-- The unique index is partial and no lead matches it today, so it is empty,
-- but building it still reads every lead while writes to leads wait. On a
-- database with many leads, build it by hand first without blocking writes,
-- after the columns exist or not (it names none of them). From psql on a
-- direct connection, ONE STATEMENT AT A TIME:
--   SET statement_timeout = 0;
--   CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS leads_company_native_job_uq ON leads (company_id, external_id) WHERE external_id LIKE 'archie-%';
--   SELECT indexrelid::regclass FROM pg_index WHERE NOT indisvalid;   -- must return nothing
-- Then run the migrations: IF NOT EXISTS skips it. As in 0007 and 0009, a
-- same-named INVALID leftover of a failed concurrent build is dropped first,
-- so a broken index is never accepted.

SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "job_type" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "lat" double precision;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "lng" double precision;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "photo_consent" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "lead_source" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "post_ref" text;--> statement-breakpoint
DO $$
DECLARE
  n text;
BEGIN
  FOREACH n IN ARRAY ARRAY['leads_company_native_job_uq'] LOOP
    IF EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
                WHERE c.relname = n AND c.relnamespace = 'public'::regnamespace AND NOT i.indisvalid) THEN
      RAISE NOTICE 'dropping invalid index %', n;
      EXECUTE format('DROP INDEX public.%I', n);
    END IF;
  END LOOP;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "leads_company_native_job_uq" ON "leads" USING btree ("company_id","external_id") WHERE "leads"."external_id" LIKE 'archie-%';
