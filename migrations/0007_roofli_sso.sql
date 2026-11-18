-- Archie: one sign-in from Roof Lee (docs/archie/02-roof-lee-link.md).
--
-- sister_sso_tickets   sign-in tickets that have been used, as a SHA-256 of
--                      the ticket's id. One row per ticket, kept until a
--                      little after the ticket would have run out anyway.
--
-- Only POST /api/sister/v1/sso reads or writes this table, and that address
-- is shut until SISTERS_ARCHIE_SECRET is set. Nothing here changes how any
-- existing company behaves. Created after 0002's RLS loop ran, so it gets the
-- same policy and index here by hand.

CREATE TABLE "sister_sso_tickets" (
	"company_id" uuid DEFAULT archie_current_company() NOT NULL,
	"jti_hash" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sister_sso_tickets" ADD CONSTRAINT "sister_sso_tickets_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE sister_sso_tickets ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE sister_sso_tickets FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY company_isolation ON sister_sso_tickets
  USING (company_id = archie_current_company() OR archie_is_system())
  WITH CHECK (company_id = archie_current_company() OR archie_is_system());
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS sister_sso_tickets_company_id_idx ON sister_sso_tickets (company_id);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON sister_sso_tickets TO archie_app;
