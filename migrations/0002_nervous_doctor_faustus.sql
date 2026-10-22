DO $$ BEGIN
 CREATE TYPE "invoice_kind" AS ENUM('ar', 'ap');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "sync_status" AS ENUM('ok', 'partial', 'error');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "appointments" (
	"id" serial PRIMARY KEY NOT NULL,
	"source_id" text NOT NULL,
	"title" text,
	"start" timestamp,
	"end" timestamp,
	"address" text,
	"calendar_source" text,
	"kind" text,
	"attendees" jsonb DEFAULT '[]'::jsonb,
	"synced_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "appointments_source_id_unique" UNIQUE("source_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "deals" (
	"id" serial PRIMARY KEY NOT NULL,
	"source_id" text NOT NULL,
	"customer" text,
	"amount" numeric(12, 2),
	"type" text,
	"status" text,
	"issue_date" text,
	"signed_at" timestamp,
	"job_ref" text,
	"owner_id" integer,
	"synced_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "deals_source_id_unique" UNIQUE("source_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "invoices" (
	"id" serial PRIMARY KEY NOT NULL,
	"source_id" text NOT NULL,
	"kind" "invoice_kind" NOT NULL,
	"party" text,
	"amount" numeric(12, 2),
	"balance" numeric(12, 2),
	"due_date" text,
	"issue_date" text,
	"status" text,
	"job_ref" text,
	"synced_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_source_id_unique" UNIQUE("source_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sync_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"status" "sync_status" NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"finished_at" timestamp,
	"counts" jsonb DEFAULT '{}'::jsonb,
	"error" text
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "deals" ADD CONSTRAINT "deals_owner_id_team_members_id_fk" FOREIGN KEY ("owner_id") REFERENCES "team_members"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
