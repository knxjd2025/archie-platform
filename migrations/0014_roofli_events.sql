-- Archie: news going back to Roof Lee (docs/archie/02-roof-lee-link.md).
--
-- outbound_events   one row per piece of news (a new lead, a finished job)
--                   for a company Roof Lee made, kept until Roof Lee has it.
--
-- Nothing writes a row unless SISTERS_ARCHIE_SECRET and ROOFLI_EVENTS_URL are
-- both set, and then only for a company with a roofli_company_id. Nothing
-- here changes how any existing company behaves. Created after 0002's RLS
-- loop ran, so it gets the same policy and index here by hand.

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
ALTER TABLE outbound_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE outbound_events FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY company_isolation ON outbound_events
  USING (company_id = archie_current_company() OR archie_is_system())
  WITH CHECK (company_id = archie_current_company() OR archie_is_system());
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS outbound_events_company_id_idx ON outbound_events (company_id);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON outbound_events TO archie_app;
