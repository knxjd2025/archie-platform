-- Archie: crews and install dates for a job Archie keeps itself (Stage D,
-- docs/archie/02-roof-lee-link.md, "Crews and install dates").
--
-- crews             a company's crews, by name. No rates, no prices.
-- crew_members      who is on which crew, one crew per person (a team member on
--                   the Production role; the code checks the person as the
--                   company before it writes, as there is no foreign key to
--                   team_members).
-- crew_assignments  a job's install: crew, first and last day, start time and
--                   status (scheduled, in_progress, done), one per job, keyed on
--                   the job key like job_photos. Dates are plain calendar dates
--                   in the company's own time zone. scheduled_at, started_at and
--                   done_at are kept for Roof Lee (Stage E).
-- job_milestones    each install milestone as it happens, append only, for
--                   Roof Lee to be told later (Stage E, job.milestone).
--
-- The number is provisional: it is renumbered with the rest of the Roof Lee
-- link's migrations when the link branch meets the Archie team's.
--
-- crew_members and crew_assignments name their crew through (company_id,
-- crew_id), so a row can only ever name a crew of its own company: a foreign
-- key skips row level security, but the company column inside it does not.
--
-- Only a company Roof Lee made gets rows here; nothing reads these tables for
-- any other company, so nothing changes for it. Needs 0008
-- (archie_protect_company_table). New tables only: no lock on any table in use
-- beyond the brief one each foreign key takes on companies.

SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
CREATE TABLE "crews" (
	"company_id" uuid DEFAULT archie_current_company() NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"color" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "crews_name_check" CHECK (char_length("crews"."name") BETWEEN 1 AND 60)
);
--> statement-breakpoint
ALTER TABLE "crews" ADD CONSTRAINT "crews_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "crews_company_id_uq" ON "crews" USING btree ("company_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "crews_company_name_uq" ON "crews" USING btree ("company_id",lower("name"));
--> statement-breakpoint
CREATE TABLE "crew_members" (
	"company_id" uuid DEFAULT archie_current_company() NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"crew_id" uuid NOT NULL,
	"team_member_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "crew_members" ADD CONSTRAINT "crew_members_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "crew_members_company_person_uq" ON "crew_members" USING btree ("company_id","team_member_id");
--> statement-breakpoint
CREATE INDEX "crew_members_company_crew_idx" ON "crew_members" USING btree ("company_id","crew_id");
--> statement-breakpoint
ALTER TABLE "crew_members" ADD CONSTRAINT "crew_members_crew_fk" FOREIGN KEY ("company_id","crew_id") REFERENCES "public"."crews"("company_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE TABLE "crew_assignments" (
	"company_id" uuid DEFAULT archie_current_company() NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"crew_id" uuid NOT NULL,
	"job_key" text NOT NULL,
	"install_date" date NOT NULL,
	"end_date" date,
	"start_time" text,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"notes" text,
	"scheduled_at" timestamp DEFAULT now() NOT NULL,
	"started_at" timestamp,
	"done_at" timestamp,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "crew_assignments_status_check" CHECK ("crew_assignments"."status" IN ('scheduled','in_progress','done')),
	CONSTRAINT "crew_assignments_start_time_check" CHECK ("crew_assignments"."start_time" IS NULL OR "crew_assignments"."start_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
	CONSTRAINT "crew_assignments_end_check" CHECK ("crew_assignments"."end_date" IS NULL OR ("crew_assignments"."end_date" >= "crew_assignments"."install_date" AND "crew_assignments"."end_date" < "crew_assignments"."install_date" + 14)),
	CONSTRAINT "crew_assignments_notes_check" CHECK (char_length("crew_assignments"."notes") <= 1000)
);
--> statement-breakpoint
ALTER TABLE "crew_assignments" ADD CONSTRAINT "crew_assignments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "crew_assignments_company_job_uq" ON "crew_assignments" USING btree ("company_id","job_key");
--> statement-breakpoint
CREATE INDEX "crew_assignments_company_day_idx" ON "crew_assignments" USING btree ("company_id","install_date");
--> statement-breakpoint
CREATE INDEX "crew_assignments_company_crew_idx" ON "crew_assignments" USING btree ("company_id","crew_id");
--> statement-breakpoint
ALTER TABLE "crew_assignments" ADD CONSTRAINT "crew_assignments_crew_fk" FOREIGN KEY ("company_id","crew_id") REFERENCES "public"."crews"("company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE TABLE "job_milestones" (
	"company_id" uuid DEFAULT archie_current_company() NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_key" text NOT NULL,
	"kind" text NOT NULL,
	"install_date" date,
	"occurred_at" timestamp DEFAULT now() NOT NULL,
	"actor" text,
	CONSTRAINT "job_milestones_kind_check" CHECK ("job_milestones"."kind" IN ('install_scheduled','install_started','install_done'))
);
--> statement-breakpoint
ALTER TABLE "job_milestones" ADD CONSTRAINT "job_milestones_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "job_milestones_company_job_idx" ON "job_milestones" USING btree ("company_id","job_key","occurred_at");
--> statement-breakpoint
-- Row level security the way every company table has it since 0008.
SELECT archie_protect_company_table('crews');
--> statement-breakpoint
SELECT archie_protect_company_table('crew_members');
--> statement-breakpoint
SELECT archie_protect_company_table('crew_assignments');
--> statement-breakpoint
SELECT archie_protect_company_table('job_milestones');
