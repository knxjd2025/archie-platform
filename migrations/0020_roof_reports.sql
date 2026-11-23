-- Archie: roof reports, merged from the roof reports program (plan
-- docs/superpowers/plans/2026-11-24-roof-reports-into-archie.md). Off until
-- ARCHIE_ROOF_REPORTS=on. Needs 0008 (archie_protect_company_table). Never edit
-- this file once applied.
--
-- roof_reports        one row per roof report: an inspection, a measurement or a
--                     storm history, alone or together, for a job or for an
--                     address with no job. The whole report is kept as JSON.
-- roof_report_photos  the photos of a report, kept in Archie's private photo
--                     store (server/photos/store.ts) under the company's own
--                     prefix 'c/<company_id>/rr/', which the table checks.
--
-- Apply this by hand, as the owner, BEFORE any deploy that reads these tables.
-- Nothing reads them while ARCHIE_ROOF_REPORTS is off, and nothing in the build
-- or the deploy runs migrations.
--
-- There is no foreign key from roof_report_photos.report_id to roof_reports
-- (foreign keys skip row level security): the code looks the report up as the
-- company first, as 0018 does for job photos.
--
-- Locks on a live database: the foreign key to companies takes a brief lock on
-- companies (both new tables are empty, so there is nothing to check).

SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
CREATE TABLE "roof_reports" (
	"company_id" uuid DEFAULT archie_current_company() NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_external_id" text,
	"created_by_member_id" integer,
	"status" text DEFAULT 'generating' NOT NULL,
	"report_types" text[] NOT NULL,
	"template" text DEFAULT 'full' NOT NULL,
	"visual_style" text,
	"title" text,
	"address" text NOT NULL,
	"city" text,
	"state" text,
	"zip" text,
	"latitude" numeric(10, 7),
	"longitude" numeric(10, 7),
	"customer_name" text,
	"customer_email" text,
	"customer_phone" text,
	"inspection_date" timestamp with time zone,
	"inspector_notes" text,
	"report_json" jsonb,
	"edited_html" text,
	"total_estimate" numeric(12, 2),
	"damage_severity" text,
	"storm_events_count" integer,
	"data_quality" text,
	"share_token" text,
	"email_sent_at" timestamp with time zone,
	"email_sent_count" integer DEFAULT 0 NOT NULL,
	"problem" text,
	"legacy_id" text,
	"legacy_extra" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "roof_reports_status_check" CHECK ("roof_reports"."status" IN ('generating','ready','failed','archived')),
	CONSTRAINT "roof_reports_kinds_check" CHECK ("roof_reports"."report_types" <@ ARRAY['inspection','measurement','storm']::text[] AND cardinality("roof_reports"."report_types") > 0),
	CONSTRAINT "roof_reports_template_check" CHECK ("roof_reports"."template" IN ('insurance','homeowner','full','quick')),
	CONSTRAINT "roof_reports_visual_style_check" CHECK ("roof_reports"."visual_style" IN ('formal','presentation','flight'))
);
--> statement-breakpoint
ALTER TABLE "roof_reports" ADD CONSTRAINT "roof_reports_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "roof_reports_share_token_uq" ON "roof_reports" USING btree ("share_token");
--> statement-breakpoint
CREATE UNIQUE INDEX "roof_reports_legacy_uq" ON "roof_reports" USING btree ("company_id","legacy_id");
--> statement-breakpoint
CREATE INDEX "roof_reports_company_created" ON "roof_reports" USING btree ("company_id","created_at");
--> statement-breakpoint
CREATE INDEX "roof_reports_company_job" ON "roof_reports" USING btree ("company_id","job_external_id");
--> statement-breakpoint
CREATE TABLE "roof_report_photos" (
	"company_id" uuid DEFAULT archie_current_company() NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"report_id" uuid,
	"uploaded_by_member_id" integer,
	"position" integer DEFAULT 0 NOT NULL,
	"category" text,
	"working_key" text NOT NULL,
	"thumb_key" text NOT NULL,
	"analysis" jsonb,
	"labels" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "roof_report_photos_keys_in_company" CHECK ("roof_report_photos"."working_key" LIKE 'c/' || "roof_report_photos"."company_id"::text || '/rr/%' AND "roof_report_photos"."thumb_key" LIKE 'c/' || "roof_report_photos"."company_id"::text || '/rr/%')
);
--> statement-breakpoint
ALTER TABLE "roof_report_photos" ADD CONSTRAINT "roof_report_photos_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "roof_report_photos_company_report" ON "roof_report_photos" USING btree ("company_id","report_id","position");
--> statement-breakpoint
-- Row level security the way every company table has it since 0008: on and
-- forced, the company's own rows for everyone (company_isolation), every row
-- for the archie_system role only (company_system), grants for both roles.
-- The ids are uuids, so there is no sequence to grant (compare 0015).
SELECT archie_protect_company_table('roof_reports');
--> statement-breakpoint
SELECT archie_protect_company_table('roof_report_photos');
