-- Archie: notes on a lead or job (docs/archie/02-roof-lee-link.md).
--
-- lead_notes   one row per note, with who it was written for and when.
--              leads.notes stays what it was: one block of text.
--
-- Only Roof Lee's signed endpoints read or write this table so far, and they
-- are shut until SISTERS_ARCHIE_SECRET is set. Nothing here changes how any
-- existing company behaves. Created after 0002's RLS loop ran, so it gets the
-- same policy and index here by hand.

CREATE TABLE "lead_notes" (
	"company_id" uuid DEFAULT archie_current_company() NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"lead_id" integer NOT NULL,
	"text" text NOT NULL,
	"author" text NOT NULL,
	"author_name" text,
	"system" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lead_notes" ADD CONSTRAINT "lead_notes_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_notes" ADD CONSTRAINT "lead_notes_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lead_notes_lead_idx" ON "lead_notes" USING btree ("lead_id","created_at");
--> statement-breakpoint
ALTER TABLE lead_notes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE lead_notes FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY company_isolation ON lead_notes
  USING (company_id = archie_current_company() OR archie_is_system())
  WITH CHECK (company_id = archie_current_company() OR archie_is_system());
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS lead_notes_company_id_idx ON lead_notes (company_id);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON lead_notes TO archie_app;
--> statement-breakpoint
GRANT USAGE, SELECT ON SEQUENCE lead_notes_id_seq TO archie_app;
