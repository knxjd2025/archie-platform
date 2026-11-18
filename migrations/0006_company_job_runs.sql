-- Archie: where each company stands in each scheduled fan-out job
-- (server/tenant/fan-out.ts). One row per company and job: the last period
-- whose work finished (so a cron cut off at the time limit resumes with the
-- companies it did not reach, and never repeats one already done) and when
-- the company was last tried (so the least recently tried go first).
-- Created after 0002's RLS loop ran, so it gets the same policy by hand. The
-- primary key starts with company_id, so no separate company index is needed.

CREATE TABLE "company_job_runs" (
	"company_id" uuid DEFAULT archie_current_company() NOT NULL,
	"job" text NOT NULL,
	"done_period" text,
	"done_at" timestamp,
	"attempted_at" timestamp,
	"last_error" text,
	CONSTRAINT "company_job_runs_company_id_job_pk" PRIMARY KEY("company_id","job")
);
--> statement-breakpoint
ALTER TABLE "company_job_runs" ADD CONSTRAINT "company_job_runs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE company_job_runs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE company_job_runs FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY company_isolation ON company_job_runs
  USING (company_id = archie_current_company() OR archie_is_system())
  WITH CHECK (company_id = archie_current_company() OR archie_is_system());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON company_job_runs TO archie_app;
