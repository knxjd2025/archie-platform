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
-- sit behind the policy leads already has.

ALTER TABLE "leads" ADD COLUMN "job_type" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "lat" double precision;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "lng" double precision;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "photo_consent" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "lead_source" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "post_ref" text;--> statement-breakpoint
CREATE UNIQUE INDEX "leads_company_native_job_uq" ON "leads" USING btree ("company_id","external_id") WHERE "leads"."external_id" LIKE 'archie-%';