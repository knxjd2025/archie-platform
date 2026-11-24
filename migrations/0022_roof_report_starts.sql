-- Archie: every START of a roof report is counted, and a repeated submit finds
-- its report (plan docs/superpowers/plans/2026-11-24-roof-reports-into-archie.md).
-- Off until ARCHIE_ROOF_REPORTS=on. Needs 0020 (roof_reports). Never edit this
-- file once applied.
--
-- roof_reports.started_at       when the latest generation of the report began.
--                               A new report sets it and so does every retry, so
--                               the per-company daily cap counts starts, not just
--                               first creations (created_at never moves). Existing
--                               rows are filled from created_at.
-- roof_reports.idempotency_key  the key a person's screen sent with the request
--                               that made the report (null when none was sent).
-- roof_reports.request_hash     a fingerprint of what that request asked for, so
--                               the same key asking for something else is told
--                               apart from a repeat.
-- roof_reports_idempotency_uq   one report per company, person and key. Only rows
--                               that carry a key are in it.
--
-- Apply this by hand, as the owner, BEFORE any deploy of the code that reads it:
-- that code names the new columns whenever it reads roof_reports. It is safe
-- under the code that is live today (nothing there names them).
--
-- Safe on a live table. The file runs as one transaction: the column is added
-- with no default (instant), filled, and only then given its default and its
-- NOT NULL, all before anyone else's insert can see the table, so no row is
-- ever seen without a value. lock_timeout makes it give up in five seconds
-- instead of queueing behind a long query. The table is young and small (the
-- feature is off until it is switched on), so the one backfill and the two
-- index builds are brief; they take a short write lock on roof_reports only.

SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
ALTER TABLE "roof_reports" ADD COLUMN "started_at" timestamp with time zone;
--> statement-breakpoint
UPDATE "roof_reports" SET "started_at" = "created_at" WHERE "started_at" IS NULL;
--> statement-breakpoint
ALTER TABLE "roof_reports" ALTER COLUMN "started_at" SET DEFAULT now();
--> statement-breakpoint
ALTER TABLE "roof_reports" ALTER COLUMN "started_at" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "roof_reports" ADD COLUMN "idempotency_key" text;
--> statement-breakpoint
ALTER TABLE "roof_reports" ADD COLUMN "request_hash" text;
--> statement-breakpoint
CREATE INDEX "roof_reports_company_started" ON "roof_reports" USING btree ("company_id","started_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "roof_reports_idempotency_uq" ON "roof_reports" USING btree ("company_id","created_by_member_id","idempotency_key") WHERE "roof_reports"."idempotency_key" IS NOT NULL;
