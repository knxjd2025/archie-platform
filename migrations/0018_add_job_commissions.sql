-- Migration 0018: Per-job commission records (admin side)
-- One row per sold JobTread job, created automatically when the job is sold
-- and walked through a rep + admin checklist before an admin approves/pays.
-- The rep's free-form `commissions` calculator table is untouched.
-- Checklist keys and readiness rules: shared/job-commission.ts.
--
-- Grants (table AND sequence) are in this same migration — see 0017's note:
-- a missing sequence grant makes every INSERT 500 in production.

DO $$ BEGIN
  CREATE TYPE job_commission_status AS ENUM ('open', 'approved', 'paid');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS job_commissions (
  id SERIAL PRIMARY KEY,
  job_external_id TEXT NOT NULL UNIQUE,
  job_name TEXT,
  team_member_id INTEGER REFERENCES team_members(id),
  rep_name TEXT,
  lead_source TEXT,
  job_type TEXT NOT NULL DEFAULT 'retail',
  manual_overhead_pct NUMERIC(5, 2),
  overhead_pct NUMERIC(5, 2),
  revenue NUMERIC(12, 2) NOT NULL DEFAULT 0,
  material NUMERIC(12, 2) NOT NULL DEFAULT 0,
  labor NUMERIC(12, 2) NOT NULL DEFAULT 0,
  other NUMERIC(12, 2) NOT NULL DEFAULT 0,
  profit NUMERIC(12, 2),
  commission_amount NUMERIC(12, 2),
  checks JSONB NOT NULL DEFAULT '{}',
  notes TEXT,
  status job_commission_status NOT NULL DEFAULT 'open',
  created_by TEXT NOT NULL,
  approved_by TEXT,
  approved_at TIMESTAMP,
  paid_by TEXT,
  paid_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_job_commissions_status ON job_commissions(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_job_commissions_member ON job_commissions(team_member_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON job_commissions TO brnmig;
GRANT USAGE, SELECT ON SEQUENCE job_commissions_id_seq TO brnmig;
