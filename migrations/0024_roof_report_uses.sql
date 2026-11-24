-- Archie: the record every email sent from a roof report and every rewrite of a
-- finding or summary leaves (plan docs/superpowers/plans/2026-11-24-roof-reports-into-archie.md,
-- Tasks D5 and the rewrite actions). Off until ARCHIE_ROOF_REPORTS=on. Needs 0008
-- (archie_protect_company_table). Never edit this file once applied. It creates
-- ONE NEW TABLE and touches no existing one.
--
-- roof_report_uses   one row for each time a person pressed "Send" or "Rewrite".
--                    It is what a daily limit is counted from (a report's and a
--                    company's, counted and added in one step under a lock on the
--                    company, so requests that arrive together cannot overrun it)
--                    and what makes a double click send once (the request key the
--                    screen made for that click).
--                    `status`: reserved (asked for, not finished), done, failed
--                    (a send that was not delivered, or a rewrite that did not
--                    work) or unused (a rewrite that never reached a model).
--                    The row holds NO address, no name and no text: only the
--                    report, the kind, who pressed it, the key and a fingerprint
--                    of what was asked.
--
-- Apply this by hand, as the owner, BEFORE any deploy of the code that reads it.
-- Nothing reads it while ARCHIE_ROOF_REPORTS is off, and nothing in the build or
-- the deploy runs migrations.
--
-- There is no foreign key from report_id to roof_reports (foreign keys skip row
-- level security): the code looks the report up as the company first, as 0018
-- and 0020 do.
--
-- Locks on a live database: the foreign key to companies takes a brief lock on
-- companies (the new table is empty, so there is nothing to check).

SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
CREATE TABLE "roof_report_uses" (
	"company_id" uuid DEFAULT archie_current_company() NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"report_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"member_id" integer,
	"idempotency_key" text,
	"request_hash" text,
	"status" text DEFAULT 'reserved' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "roof_report_uses_kind_check" CHECK ("roof_report_uses"."kind" IN ('send','rewrite')),
	CONSTRAINT "roof_report_uses_status_check" CHECK ("roof_report_uses"."status" IN ('reserved','done','failed','unused'))
);
--> statement-breakpoint
ALTER TABLE "roof_report_uses" ADD CONSTRAINT "roof_report_uses_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "roof_report_uses_company_kind_created" ON "roof_report_uses" USING btree ("company_id","kind","created_at");
--> statement-breakpoint
CREATE INDEX "roof_report_uses_company_report_kind_created" ON "roof_report_uses" USING btree ("company_id","report_id","kind","created_at");
--> statement-breakpoint
-- One request key holds one live use of one report: a repeated click finds it instead of making another. A use that failed lets go of its key.
CREATE UNIQUE INDEX "roof_report_uses_key_uq" ON "roof_report_uses" USING btree ("company_id","report_id","kind","idempotency_key") WHERE "roof_report_uses"."idempotency_key" IS NOT NULL AND "roof_report_uses"."status" IN ('reserved','done');
--> statement-breakpoint
-- Row level security the way every company table has it since 0008: on and
-- forced, the company's own rows for everyone (company_isolation), every row
-- for the archie_system role only (company_system), grants for both roles.
-- The id is a uuid, so there is no sequence to grant (compare 0015).
SELECT archie_protect_company_table('roof_report_uses');
