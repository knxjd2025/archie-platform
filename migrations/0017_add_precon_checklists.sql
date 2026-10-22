-- Migration 0017: Sales Rep Pre-Construction Checklist
-- Filled by the rep at the point they collect the down payment: site photos
-- (material drop, dumpster, aerial, risk items) plus confirmation that the
-- standard pre-install talking points were covered with the homeowner.
-- Schema for the `answers` JSON blob lives in shared/preconstruction-checklist.ts.
--
-- Grant is included in this same migration (not a follow-up like
-- 0014/0015) -- 0015's comment documents that a missing grant makes every
-- write 500 with "permission denied for table" (42501) in production.
--
-- A table grant alone is NOT enough for a SERIAL column: confirmed live that
-- INSERT still 500s with "permission denied for sequence
-- precon_checklists_id_seq" until the sequence itself is granted too.
-- inspection_submissions_id_seq has this grant in production despite neither
-- 0014 nor 0015 mentioning it -- it was applied out-of-band and undocumented
-- until now. Granting it explicitly here so this table doesn't repeat that gap.

DO $$ BEGIN
  CREATE TYPE precon_checklist_status AS ENUM ('draft', 'submitted');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS precon_checklists (
  id SERIAL PRIMARY KEY,
  job_external_id TEXT NOT NULL,
  team_member_id INTEGER REFERENCES team_members(id),
  rep_name TEXT,
  answers JSONB NOT NULL DEFAULT '{}',
  status precon_checklist_status NOT NULL DEFAULT 'draft',
  submitted_at TIMESTAMP,
  jobtread_synced_at TIMESTAMP,
  created_by TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_precon_checklists_job ON precon_checklists(job_external_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_precon_checklists_member ON precon_checklists(team_member_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON precon_checklists TO brnmig;
GRANT USAGE, SELECT ON SEQUENCE precon_checklists_id_seq TO brnmig;
