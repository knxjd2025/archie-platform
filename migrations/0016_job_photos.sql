-- Archie: photos of a job Archie keeps itself (docs/archie/02-roof-lee-link.md,
-- "Archie's own jobs", Photos).
--
-- job_photos   one row per photo of a job of Archie's own, stored privately
--              in Archie's photo store (server/photos/store.ts). Keyed on
--              the job key (leads.external_id, an 'archie-' key), never on
--              leads.id: the JobTread sync deletes and re-inserts leads.
--
-- The number is provisional: it is renumbered with the rest of the Roof Lee
-- link's migrations when the link branch meets the Archie team's.
--
-- No location column, on purpose. The stored copies are JPEGs with every
-- metadata block taken out (server/photos/jpeg-clean.ts), and every object
-- key sits under the company's own prefix 'c/<company_id>/p/', which the
-- job_photos_keys_in_company check holds. A 'ready' photo always has its
-- working copy (job_photos_ready_has_copy).
--
-- Only a company Roof Lee made has jobs of Archie's own, so only such a
-- company ever gets a row; nothing here changes how any existing company
-- behaves. There is no foreign key to leads (foreign keys skip row level
-- security, and the key is text): the code looks the job up as the company
-- before it inserts. Needs 0008 (archie_protect_company_table).
--
-- Locks on a live database: the foreign key takes a brief lock on companies
-- (the new table is empty, so there is nothing to check).

SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
CREATE TABLE "job_photos" (
	"company_id" uuid DEFAULT archie_current_company() NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_key" text NOT NULL,
	"phase" text,
	"category" text,
	"caption" text,
	"source" text DEFAULT 'archie_app' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"original_key" text,
	"working_key" text,
	"thumb_key" text,
	"width" integer,
	"height" integer,
	"taken_at" timestamp,
	"uploaded_by" text NOT NULL,
	"uploaded_by_name" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"deleted_by" text,
	CONSTRAINT "job_photos_phase_check" CHECK ("job_photos"."phase" IN ('before','during','after')),
	CONSTRAINT "job_photos_caption_check" CHECK (char_length("job_photos"."caption") <= 500),
	CONSTRAINT "job_photos_source_check" CHECK ("job_photos"."source" IN ('archie_app','roofli','companycam')),
	CONSTRAINT "job_photos_status_check" CHECK ("job_photos"."status" IN ('pending','ready','deleted')),
	CONSTRAINT "job_photos_keys_in_company" CHECK (("job_photos"."original_key" IS NULL OR "job_photos"."original_key" LIKE 'c/' || "job_photos"."company_id"::text || '/p/%')
    AND ("job_photos"."working_key" IS NULL OR "job_photos"."working_key" LIKE 'c/' || "job_photos"."company_id"::text || '/p/%')
    AND ("job_photos"."thumb_key" IS NULL OR "job_photos"."thumb_key" LIKE 'c/' || "job_photos"."company_id"::text || '/p/%')),
	CONSTRAINT "job_photos_ready_has_copy" CHECK ("job_photos"."status" <> 'ready' OR "job_photos"."working_key" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "job_photos" ADD CONSTRAINT "job_photos_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "job_photos_company_job_idx" ON "job_photos" USING btree ("company_id","job_key","created_at" DESC NULLS LAST);
--> statement-breakpoint
-- Row level security the way every company table has it since 0008: on and
-- forced, the company's own rows for everyone (company_isolation), every row
-- for the archie_system role only (company_system), grants for both roles.
-- The id is a uuid, so there is no sequence to grant (compare 0013).
SELECT archie_protect_company_table('job_photos');
