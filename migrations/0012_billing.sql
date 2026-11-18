-- Archie: subscription billing with Stripe (server/billing/*).
-- See docs/archie/01-multi-company.md, "Billing".
--
-- ORDER: run this migration FIRST, then deploy the code that ships with it.
-- Old code never touches these tables, so it is unaffected. New code reads
-- company_billing on every signed-in request once STRIPE_SECRET_KEY is set;
-- with the key unset billing is off and nothing reads them.
--
-- 1. company_billing: one row per company. Its Stripe customer and
--    subscription ids, the plan and seats Stripe bills for, the subscription
--    status and period, and the last seat-sync failure (retried hourly by
--    /api/cron/billing-seats). Never card data: cards live only at Stripe.
--    A company table: protected like every other one (row level security,
--    the two policies, both roles).
--
-- 2. stripe_events: the ids of Stripe webhook events already handled, so a
--    repeated delivery does nothing. Global (an event is not owned by a
--    company until it is read), so it does not get the company policies.
--    Like operator_audit_log (0011): archie_app has NO privileges on it;
--    archie_system may SELECT, INSERT and DELETE (an event that failed half
--    way is released so Stripe's retry runs it again); row level security is
--    on and forced with one policy for archie_system.

SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "company_billing" (
  "company_id" uuid PRIMARY KEY NOT NULL DEFAULT archie_current_company() REFERENCES "companies"("id"),
  "stripe_customer_id" text,
  "stripe_subscription_id" text,
  "plan" text,
  "seats" integer,
  "subscription_status" text,
  "current_period_end" timestamp,
  "cancel_at_period_end" boolean DEFAULT false NOT NULL,
  "seat_sync_error" text,
  "seat_sync_failed_at" timestamp,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "company_billing_plan_check" CHECK ("plan" IS NULL OR "plan" IN ('solo', 'team'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "company_billing_customer_uq" ON "company_billing" ("stripe_customer_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "company_billing_subscription_uq" ON "company_billing" ("stripe_subscription_id");
--> statement-breakpoint
SELECT archie_protect_company_table('company_billing');
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "stripe_events" (
  "id" text PRIMARY KEY NOT NULL,
  "type" text NOT NULL,
  "received_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "stripe_events" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "stripe_events" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS stripe_events_system ON "stripe_events";
--> statement-breakpoint
CREATE POLICY stripe_events_system ON "stripe_events" TO archie_system USING (true) WITH CHECK (true);
--> statement-breakpoint
REVOKE ALL ON "stripe_events" FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON "stripe_events" FROM archie_app;
--> statement-breakpoint
REVOKE ALL ON "stripe_events" FROM archie_system;
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON "stripe_events" TO archie_system;
--> statement-breakpoint
-- Supabase's Data API roles, as in 0002.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON "stripe_events" FROM anon';
    EXECUTE 'REVOKE ALL ON "company_billing" FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON "stripe_events" FROM authenticated';
    EXECUTE 'REVOKE ALL ON "company_billing" FROM authenticated';
  END IF;
END $$;
