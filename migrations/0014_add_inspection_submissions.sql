-- Migration 0014: In-app field inspection form
-- Reps fill this out on-site (not JobTread) so the answers can drive
-- Inspection/Estimate/Proposal/Presentation generation directly. Schema for
-- the `answers` JSON blob lives in shared/inspection-form.ts.

DO $$ BEGIN
  CREATE TYPE inspection_submission_status AS ENUM ('draft', 'submitted', 'reviewed');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS inspection_submissions (
  id SERIAL PRIMARY KEY,
  job_external_id TEXT NOT NULL,
  team_member_id INTEGER REFERENCES team_members(id),
  inspector_name TEXT,
  inspection_type TEXT,
  recommendation TEXT,
  answers JSONB NOT NULL DEFAULT '{}',
  status inspection_submission_status NOT NULL DEFAULT 'draft',
  signed_at TIMESTAMP,
  reviewed_by TEXT,
  reviewed_at TIMESTAMP,
  jobtread_synced_at TIMESTAMP,
  created_by TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inspection_submissions_job ON inspection_submissions(job_external_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inspection_submissions_member ON inspection_submissions(team_member_id);
