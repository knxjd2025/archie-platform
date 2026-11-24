-- Archie: each company's own presentation chapters, as that company's data (plan
-- docs/superpowers/plans/2026-11-24-roof-reports-into-archie.md, Decision 4).
-- Off until ARCHIE_ROOF_REPORTS=on. Needs 0008 (archie_protect_company_table).
-- Never edit this file once applied. It creates ONE NEW TABLE and touches no
-- existing one.
--
-- presentation_chapter_packs   at most one row a company: `pack` is the company's
--                              own chapters (how its crew works, what its
--                              warranty covers), `loaded_at` and `loaded_by`
--                              say when and by whom (the operator's login name,
--                              never an email).
--
-- Who reads and who writes:
--   * The app reads only its own company's row (company_isolation, as every
--     company table). The row is found by the company in the session, never by a
--     name, an email domain or a website.
--   * The app can NEVER write one. A trigger refuses every insert, update and
--     delete made as archie_app (SQLSTATE 42501). The row level security
--     policies stay exactly the two every company table has, which the
--     isolation tests require; the trigger is the extra lock.
--   * Only the operator script (scripts/load-presentation-pack.ts) writes, as
--     the system role (runAsSystem with a written reason): archie_system may
--     read, insert and update; it may not delete (a pack is replaced, not
--     deleted; the grant is taken back below).
--   * A company with no row gets the base presentation, which promises nothing.
--
-- Apply this by hand, as the owner, BEFORE any deploy of the code that reads it:
-- the page route reads this table whenever it shows a presentation. The code
-- treats a read that fails as "no pack", so a deploy that got ahead of this file
-- would show the base presentation, never an error; but apply it first anyway.
-- Nothing in the build or the deploy runs migrations.
--
-- The check says the pack is an object: an object contains the empty object, an
-- array, a number or a string does not.
--
-- Locks on a live database: the foreign key to companies takes a brief lock on
-- companies (the new table is empty, so there is nothing to check).

SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
CREATE TABLE "presentation_chapter_packs" (
	"company_id" uuid DEFAULT archie_current_company() NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pack" jsonb NOT NULL,
	"loaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"loaded_by" text NOT NULL,
	CONSTRAINT "presentation_chapter_packs_pack_is_object" CHECK ("presentation_chapter_packs"."pack" @> '{}'::jsonb)
);
--> statement-breakpoint
ALTER TABLE "presentation_chapter_packs" ADD CONSTRAINT "presentation_chapter_packs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "presentation_chapter_packs_company_uq" ON "presentation_chapter_packs" USING btree ("company_id");
--> statement-breakpoint
-- Row level security the way every company table has it since 0008.
SELECT archie_protect_company_table('presentation_chapter_packs');
--> statement-breakpoint
-- The app never writes a pack. Everyone but archie_app (the owner running this
-- file, the system role) passes through.
CREATE FUNCTION archie_presentation_packs_operator_only() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF current_user = 'archie_app' THEN
    RAISE EXCEPTION 'a presentation chapter pack is written only by the operator script, never by the app'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF TG_OP = 'TRUNCATE' THEN RETURN NULL; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER presentation_chapter_packs_operator_only
  BEFORE INSERT OR UPDATE OR DELETE ON "presentation_chapter_packs"
  FOR EACH ROW EXECUTE FUNCTION archie_presentation_packs_operator_only();
--> statement-breakpoint
CREATE TRIGGER presentation_chapter_packs_operator_only_truncate
  BEFORE TRUNCATE ON "presentation_chapter_packs"
  FOR EACH STATEMENT EXECUTE FUNCTION archie_presentation_packs_operator_only();
--> statement-breakpoint
-- The system role reads, inserts and updates a pack; it never deletes one.
REVOKE DELETE ON "presentation_chapter_packs" FROM archie_system;
