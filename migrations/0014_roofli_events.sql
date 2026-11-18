-- Archie: news going back to Roof Lee (docs/archie/02-roof-lee-link.md).
--
-- outbound_events   one row per piece of news (a new lead, a finished job)
--                   for a company Roof Lee made, kept until Roof Lee has it.
--
-- Nothing writes a row unless SISTERS_ARCHIE_SECRET and ROOFLI_EVENTS_URL are
-- both set, and then only for a company with a roofli_company_id. Nothing
-- here changes how any existing company behaves. Needs 0008
-- (archie_protect_company_table).
--
-- Indexes: (company_id, dedupe_key) is the company-first index every read as
-- one company uses. outbound_events_due_idx (next_attempt_at, undelivered rows
-- only) is for the one system read, the scheduled run asking which companies
-- have news waiting; it stays small because delivered rows leave it.

SET LOCAL lock_timeout = '5s';
--> statement-breakpoint

CREATE TABLE "outbound_events" (
	"company_id" uuid DEFAULT archie_current_company() NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"dedupe_key" text NOT NULL,
	"type" text NOT NULL,
	"data" jsonb NOT NULL,
	"occurred_at" timestamp NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp DEFAULT now() NOT NULL,
	"delivered_at" timestamp,
	"gave_up_at" timestamp,
	"last_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "outbound_events" ADD CONSTRAINT "outbound_events_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "outbound_events_company_dedupe_uq" ON "outbound_events" USING btree ("company_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "outbound_events_due_idx" ON "outbound_events" USING btree ("next_attempt_at") WHERE "outbound_events"."delivered_at" IS NULL AND "outbound_events"."gave_up_at" IS NULL;
--> statement-breakpoint
-- Row level security the way every company table has it since 0008: on and
-- forced, the company's own rows for everyone (company_isolation), every row
-- for the archie_system role only (company_system), grants for both roles.
-- outbound_events_company_dedupe_uq starts with company_id, so no separate company index is made.
SELECT archie_protect_company_table('outbound_events');
