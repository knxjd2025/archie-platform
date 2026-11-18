-- Archie: one run at a time per company and scheduled job.
-- See server/tenant/fan-out.ts and docs/archie/01-multi-company.md.
--
-- Two invocations of the same job could both find a company not yet done and
-- both run it (a manual run during the cron, a repeated cron delivery), and a
-- company that hit its time limit kept running in the background while the
-- next invocation started it again. A run now claims the company's row with
-- one conditional INSERT ... ON CONFLICT DO UPDATE ... RETURNING that only
-- succeeds when no unexpired lease is held, and may only record success
-- while its own lease is still valid.
--
-- Two nullable columns with no default: a catalog change only, no table
-- rewrite; the ACCESS EXCLUSIVE lock lasts milliseconds.

SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
ALTER TABLE "company_job_runs" ADD COLUMN IF NOT EXISTS "lease_token" uuid;
--> statement-breakpoint
ALTER TABLE "company_job_runs" ADD COLUMN IF NOT EXISTS "lease_until" timestamp;
