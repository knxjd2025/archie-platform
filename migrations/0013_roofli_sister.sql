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
-- NEEDS 0008 (the system role): the new table is protected with
-- archie_protect_company_table(), which 0008 creates. Numbered 0013 so it
-- runs after 0006 to 0012 (0011 and 0012 are the operator console and billing).
--
-- Nothing here changes how an existing company behaves: every new column is
-- null for it.
--
-- Locks on a live database: three ADD COLUMNs with no default (a catalog
-- change, no rewrite), a unique constraint on companies and a partial unique
-- index on team_members (both small tables, built in milliseconds). Each takes
-- its lock briefly; lock_timeout makes the migration fail instead of queueing
-- behind a long query and blocking sign-in. If it fails on the timeout, run it
-- again.

SET LOCAL lock_timeout = '5s';
--> statement-breakpoint

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
-- Row level security the way every company table has it since 0008: on and
-- forced, the company's own rows for everyone (company_isolation), every row
-- for the archie_system role only (company_system), grants for both roles.
-- The primary key starts with company_id, so no separate company index is made.
SELECT archie_protect_company_table('sister_idempotency');
