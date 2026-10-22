-- Migration 0006: Commission calculator
-- Ported from the standalone BRN Commission Calculator tool.

DO $$ BEGIN
  CREATE TYPE commission_status AS ENUM ('draft', 'approved');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS commissions (
  id SERIAL PRIMARY KEY,
  job_external_id TEXT,
  job_name TEXT NOT NULL,
  team_member_id INTEGER REFERENCES team_members(id),
  rep_name TEXT NOT NULL,
  lead_source TEXT NOT NULL,
  job_type TEXT NOT NULL,
  overhead_pct NUMERIC(5, 2) NOT NULL,
  override_used BOOLEAN NOT NULL DEFAULT FALSE,
  revenue NUMERIC(12, 2) NOT NULL,
  material NUMERIC(12, 2) NOT NULL DEFAULT 0,
  labor NUMERIC(12, 2) NOT NULL DEFAULT 0,
  other NUMERIC(12, 2) NOT NULL DEFAULT 0,
  profit NUMERIC(12, 2) NOT NULL,
  commission_amount NUMERIC(12, 2) NOT NULL,
  status commission_status NOT NULL DEFAULT 'draft',
  created_by TEXT NOT NULL,
  approved_by TEXT,
  approved_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_commissions_status ON commissions(status);
CREATE INDEX IF NOT EXISTS idx_commissions_team_member ON commissions(team_member_id);
