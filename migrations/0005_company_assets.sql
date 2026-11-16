-- Archie: images a company uploads for its own branding (the logo first),
-- kept in the database so no file storage service is needed. One row per
-- company and kind. Served publicly by /api/public/company/:id/logo, which
-- runs as that company, so row level security only ever finds its own row.
-- company_assets is created after 0002's RLS loop ran, so it gets the same
-- policy and index here by hand.

CREATE TABLE "company_assets" (
	"company_id" uuid DEFAULT archie_current_company() NOT NULL,
	"kind" text NOT NULL,
	"content_type" text NOT NULL,
	"bytes" bytea NOT NULL,
	"sha256" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "company_assets_company_id_kind_pk" PRIMARY KEY("company_id","kind"),
	CONSTRAINT "company_assets_kind_check" CHECK ("kind" IN ('logo')),
	CONSTRAINT "company_assets_content_type_check" CHECK ("content_type" IN ('image/png','image/jpeg','image/webp'))
);
--> statement-breakpoint
ALTER TABLE "company_assets" ADD CONSTRAINT "company_assets_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE company_assets ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE company_assets FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY company_isolation ON company_assets
  USING (company_id = archie_current_company() OR archie_is_system())
  WITH CHECK (company_id = archie_current_company() OR archie_is_system());
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS company_assets_company_id_idx ON company_assets (company_id);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON company_assets TO archie_app;
