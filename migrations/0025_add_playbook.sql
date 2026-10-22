-- Migration 0025: Sales Playbook — per-job stage checklists and each rep's income goal plan

CREATE TABLE IF NOT EXISTS job_checklists (
  id SERIAL PRIMARY KEY,
  job_external_id TEXT NOT NULL,
  checklist_key TEXT NOT NULL,
  items JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_by TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS job_checklists_job_key_idx ON job_checklists (job_external_id, checklist_key);

CREATE TABLE IF NOT EXISTS rep_goals (
  id SERIAL PRIMARY KEY,
  team_member_id INTEGER NOT NULL UNIQUE REFERENCES team_members(id),
  income_goal INTEGER NOT NULL DEFAULT 100000,
  avg_commission INTEGER NOT NULL DEFAULT 1500,
  close_rate INTEGER NOT NULL DEFAULT 40,
  selling_months INTEGER NOT NULL DEFAULT 9,
  updated_at TIMESTAMP DEFAULT NOW()
);
