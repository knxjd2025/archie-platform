-- Archie: email + password sign-in. Columns on team_members for the hash and
-- the lockout counters, and password_links for one-time set/reset links.
-- password_links is created after 0002's RLS loop ran, so it gets the same
-- policy and index here by hand.

ALTER TABLE team_members ADD COLUMN "password_hash" text;
--> statement-breakpoint
ALTER TABLE team_members ADD COLUMN "failed_logins" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE team_members ADD COLUMN "locked_until" timestamp;
--> statement-breakpoint

CREATE TABLE "password_links" (
	"company_id" uuid DEFAULT archie_current_company() NOT NULL,
	"token_hash" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"purpose" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	CONSTRAINT "password_links_purpose_check" CHECK ("purpose" IN ('welcome','reset'))
);
--> statement-breakpoint
ALTER TABLE "password_links" ADD CONSTRAINT "password_links_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE password_links ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE password_links FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY company_isolation ON password_links
  USING (company_id = archie_current_company() OR archie_is_system())
  WITH CHECK (company_id = archie_current_company() OR archie_is_system());
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS password_links_company_id_idx ON password_links (company_id);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON password_links TO archie_app;
