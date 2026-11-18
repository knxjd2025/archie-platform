-- Archie: the Roof Lee link (docs/archie/02-roof-lee-link.md).
--
-- companies.roofli_company_id   Roof Lee's id for a company Roof Lee made.
--                               Null for every other company.
-- team_members.auth_user_id     the person's shared sign-in id, for people
--                               Roof Lee sent. One per company.
-- team_members.source           'roofli' for those people, null otherwise.
-- sister_idempotency            answers already given to Roof Lee's writes,
--                               one row per company and idempotency-key.
--
-- APPLY THIS BEFORE THE CODE THAT USES IT IS DEPLOYED. That code names the
-- new columns in every read of team_members and companies, so deployed first
-- it breaks sign-in for everyone. This file is safe under the older code.
--
-- Nothing here changes how an existing company behaves: every new column is
-- null for it. sister_idempotency is created after 0002's RLS loop ran, so it
-- gets the same policy and index here by hand.

CREATE TABLE "sister_idempotency" (
	"company_id" uuid DEFAULT archie_current_company() NOT NULL,
	"key" text NOT NULL,
	"response" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "sister_idempotency_company_id_key_pk" PRIMARY KEY("company_id","key")
);
--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "roofli_company_id" uuid;--> statement-breakpoint
ALTER TABLE "team_members" ADD COLUMN "auth_user_id" uuid;--> statement-breakpoint
ALTER TABLE "team_members" ADD COLUMN "source" text;--> statement-breakpoint
ALTER TABLE "sister_idempotency" ADD CONSTRAINT "sister_idempotency_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "team_members_company_auth_user_uq" ON "team_members" USING btree ("company_id","auth_user_id") WHERE "team_members"."auth_user_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_roofli_company_id_unique" UNIQUE("roofli_company_id");
--> statement-breakpoint
ALTER TABLE sister_idempotency ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE sister_idempotency FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY company_isolation ON sister_idempotency
  USING (company_id = archie_current_company() OR archie_is_system())
  WITH CHECK (company_id = archie_current_company() OR archie_is_system());
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS sister_idempotency_company_id_idx ON sister_idempotency (company_id);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON sister_idempotency TO archie_app;
