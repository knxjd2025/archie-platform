DO $$ BEGIN
 CREATE TYPE "team_role" AS ENUM('admin', 'manager', 'sales', 'production');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "team_members" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"role" "team_role" NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"can_login" boolean DEFAULT false NOT NULL,
	"notify_email" boolean DEFAULT true NOT NULL,
	"notify_sms" boolean DEFAULT false NOT NULL,
	"google_sub" text,
	"last_login_at" timestamp,
	"created_by" text,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "team_members_email_unique" UNIQUE("email")
);
