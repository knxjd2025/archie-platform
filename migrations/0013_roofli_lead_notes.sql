-- Archie: notes on a lead or job (docs/archie/02-roof-lee-link.md).
--
-- lead_notes   one row per note, with who it was written for and when.
--              leads.notes stays what it was: one block of text.
--
-- Only Roof Lee's signed endpoints read or write this table so far, and they
-- are shut until SISTERS_ARCHIE_SECRET is set. Nothing here changes how any
-- existing company behaves. Needs 0008 (archie_protect_company_table).
--
-- Locks on a live database: the foreign keys take a brief lock on companies
-- and leads (the new table is empty, so there is nothing to check).

SET LOCAL lock_timeout = '5s';
--> statement-breakpoint

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
-- Row level security the way every company table has it since 0008: on and
-- forced, the company's own rows for everyone (company_isolation), every row
-- for the archie_system role only (company_system), grants for both roles.
-- No index starts with company_id, so this also makes lead_notes_company_id_idx.
SELECT archie_protect_company_table('lead_notes');
--> statement-breakpoint
-- The function grants the table; the id sequence is granted here, to both
-- roles (system work may add a note too).
GRANT USAGE, SELECT ON SEQUENCE lead_notes_id_seq TO archie_app, archie_system;
