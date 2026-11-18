-- Archie: the operator console (server/operator/*).
-- See docs/archie/01-multi-company.md, "Operator console".
--
-- ORDER (read before running on a live database): run this migration FIRST,
-- then deploy the code that ships with it. The code reads
-- companies.trial_ends_at on every company read (sign-in included), so new
-- code against a database without the column cannot sign anyone in. Old code
-- is unaffected by this migration: it adds a nullable column and a table old
-- code never touches.
--
-- 1. companies.trial_ends_at: when a trial company's free period ends. Shown
--    on the operator page only; nothing enforces it yet (billing will).
--    Nullable, no default: a catalog change only, no table rewrite.
--
-- 2. operator_audit_log: one row per change an operator makes (create a
--    company, pause/resume/cancel it, mint a reset link): who, what, which
--    company, when, details. Never a link, token or password.
--
--    It is global (no company_id: it is about companies, not owned by one),
--    so it does not get the two company policies. Instead:
--      - archie_app has NO privileges on it at all. A query outside system
--        work fails with "permission denied" (42501), which is louder and
--        stronger than row level security's zero rows: no request a company
--        admin can make reads or writes it.
--      - archie_system may SELECT and INSERT, nothing else. The log is
--        append-only for the app: no UPDATE, DELETE or TRUNCATE, so an
--        action cannot be erased from inside the app. Only the operator
--        routes run system work against it.
--      - row level security is on and forced with one policy for
--        archie_system, so a future grant to another role still shows it no
--        rows unless a policy is added on purpose.

SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "trial_ends_at" timestamp;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "operator_audit_log" (
  "id" serial PRIMARY KEY NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "operator_email" text NOT NULL,
  "action" text NOT NULL,
  "target_company_id" uuid REFERENCES "companies"("id"),
  "details" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "operator_audit_log_company_created_idx"
  ON "operator_audit_log" ("target_company_id", "created_at");
--> statement-breakpoint
ALTER TABLE "operator_audit_log" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "operator_audit_log" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS operator_audit_system ON "operator_audit_log";
--> statement-breakpoint
CREATE POLICY operator_audit_system ON "operator_audit_log" TO archie_system USING (true) WITH CHECK (true);
--> statement-breakpoint
-- The default privileges from 0002 and 0008 gave both app roles everything on
-- the new table and its sequence. Take it back, then grant exactly what is
-- described above.
REVOKE ALL ON "operator_audit_log" FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON "operator_audit_log" FROM archie_app;
--> statement-breakpoint
REVOKE ALL ON "operator_audit_log" FROM archie_system;
--> statement-breakpoint
GRANT SELECT, INSERT ON "operator_audit_log" TO archie_system;
--> statement-breakpoint
REVOKE ALL ON SEQUENCE "operator_audit_log_id_seq" FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON SEQUENCE "operator_audit_log_id_seq" FROM archie_app;
--> statement-breakpoint
REVOKE ALL ON SEQUENCE "operator_audit_log_id_seq" FROM archie_system;
--> statement-breakpoint
GRANT USAGE ON SEQUENCE "operator_audit_log_id_seq" TO archie_system;
--> statement-breakpoint
-- Supabase's Data API roles, as in 0002.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON "operator_audit_log" FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON "operator_audit_log" FROM authenticated';
  END IF;
END $$;
