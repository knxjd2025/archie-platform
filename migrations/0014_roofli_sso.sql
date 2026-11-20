-- Archie: one sign-in from Roof Lee (docs/archie/02-roof-lee-link.md).
--
-- sister_sso_tickets   sign-in tickets that have been used, as a SHA-256 of
--                      the ticket's id. One row per ticket, kept until a
--                      little after the ticket would have run out anyway.
--
-- Only POST /api/sister/v1/sso reads or writes this table, and that address
-- is shut until SISTERS_ARCHIE_SECRET is set. Nothing here changes how any
-- existing company behaves. Needs 0008 (archie_protect_company_table).

SET LOCAL lock_timeout = '5s';
--> statement-breakpoint

CREATE TABLE "sister_sso_tickets" (
	"company_id" uuid DEFAULT archie_current_company() NOT NULL,
	"jti_hash" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sister_sso_tickets" ADD CONSTRAINT "sister_sso_tickets_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
-- Row level security the way every company table has it since 0008: on and
-- forced, the company's own rows for everyone (company_isolation), every row
-- for the archie_system role only (company_system), grants for both roles.
-- The primary key is the ticket, so this also makes sister_sso_tickets_company_id_idx.
SELECT archie_protect_company_table('sister_sso_tickets');
