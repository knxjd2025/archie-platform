-- Migration 0020: Production pipeline
-- The app's own eleven-stage production pipeline (Approved → Waiting for DP →
-- Pre-Production → Schedule Job → Material Check → Install/Production →
-- Final Walk Through → Final Invoice → Final Payment → Warranty → Closed Out)
-- with the trades on each job (roofing, gutters, soffit/fascia, siding,
-- painting — in site order) and the per-stage tick-boxes. One row per job,
-- created the first time it is moved on the board. Stage keys, trade keys
-- and gate rules live in shared/production-pipeline.ts.
--
-- Table AND sequence grants included, per 0017's note.

CREATE TABLE IF NOT EXISTS production_pipeline (
  id SERIAL PRIMARY KEY,
  job_external_id TEXT NOT NULL UNIQUE,
  stage TEXT NOT NULL,
  trades JSONB NOT NULL DEFAULT '[{"key":"roofing","done":false}]',
  checks JSONB NOT NULL DEFAULT '{}',
  deposit_received_at TIMESTAMP,
  stage_entered_at TIMESTAMP DEFAULT NOW(),
  history JSONB NOT NULL DEFAULT '[]',
  updated_by TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_production_pipeline_stage ON production_pipeline(stage);

GRANT SELECT, INSERT, UPDATE, DELETE ON production_pipeline TO brnmig;
GRANT USAGE, SELECT ON SEQUENCE production_pipeline_id_seq TO brnmig;
