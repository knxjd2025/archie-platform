-- Migration 0019: Final Walkthrough
-- Done by the sales rep or project manager once the crew is off the roof:
-- magnetic nail sweep, cleanup and leftovers, property and roof damage
-- checks, the homeowner conversation. Each "Issue found" becomes a follow-up
-- on submit. Schema for the `answers` JSON blob lives in shared/final-walkthrough.ts.
--
-- Reuses the precon_checklist_status enum (draft / submitted) from 0017 —
-- same two-state lifecycle, no reason for a second identical type.
--
-- Table AND sequence grants included, per 0017's note: a SERIAL insert still
-- fails with "permission denied for sequence" until the sequence is granted.

CREATE TABLE IF NOT EXISTS final_walkthroughs (
  id SERIAL PRIMARY KEY,
  job_external_id TEXT NOT NULL,
  team_member_id INTEGER REFERENCES team_members(id),
  walked_by TEXT,
  answers JSONB NOT NULL DEFAULT '{}',
  status precon_checklist_status NOT NULL DEFAULT 'draft',
  issue_count INTEGER NOT NULL DEFAULT 0,
  submitted_at TIMESTAMP,
  jobtread_synced_at TIMESTAMP,
  created_by TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_final_walkthroughs_job ON final_walkthroughs(job_external_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_final_walkthroughs_member ON final_walkthroughs(team_member_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON final_walkthroughs TO brnmig;
GRANT USAGE, SELECT ON SEQUENCE final_walkthroughs_id_seq TO brnmig;
