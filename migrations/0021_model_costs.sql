-- Archie: one row for every paid model call the roof reports make (plan
-- docs/superpowers/plans/2026-11-24-roof-reports-into-archie.md, Decision 8).
-- Off until ARCHIE_ROOF_REPORTS=on. Needs 0008 (archie_protect_company_table).
-- Never edit this file once applied.
--
-- model_costs   what each call cost, in cents, and which company it was for.
--               The company is the one doing the work (the default reads it
--               from the connection), so a company sees only its own rows.
--               `priced` is false when the price of the model is not known:
--               the row then holds the tokens and 0 cents, never a guess.
--               The provider is limited to the three United States providers
--               the roof reports use. `ref` is the report the call was for.
--
-- Apply this by hand, as the owner, BEFORE any deploy that reads this table.
-- Nothing in the build or the deploy runs migrations.
--
-- Locks on a live database: the foreign key to companies takes a brief lock on
-- companies (the new table is empty, so there is nothing to check).

SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
CREATE TABLE "model_costs" (
	"company_id" uuid DEFAULT archie_current_company() NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operation" text NOT NULL,
	"provider" text NOT NULL,
	"model" text,
	"input_tokens" integer,
	"output_tokens" integer,
	"cents" numeric(10, 4) DEFAULT '0' NOT NULL,
	"priced" boolean NOT NULL,
	"ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "model_costs_provider_check" CHECK ("model_costs"."provider" IN ('groq','google','anthropic'))
);
--> statement-breakpoint
ALTER TABLE "model_costs" ADD CONSTRAINT "model_costs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "model_costs_company_created" ON "model_costs" USING btree ("company_id","created_at");
--> statement-breakpoint
-- Row level security the way every company table has it since 0008: on and
-- forced, the company's own rows for everyone (company_isolation), every row
-- for the archie_system role only (company_system), grants for both roles.
-- The id is a uuid, so there is no sequence to grant (compare 0015).
SELECT archie_protect_company_table('model_costs');
