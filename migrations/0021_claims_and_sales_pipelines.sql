-- Migration 0021: Claims pipeline (new stages + dispute steps) and Sales pipeline
--
-- Claims: the board's stage set becomes James's claim pipeline (Inspect →
-- File Claim → SA Signed → Inspection Report → Adjuster Inspection → Waiting
-- Results → Supplement → Disputing → Approved → Post-Supplementing → Request
-- Depreciation → Closed), with Disputing carrying ordered steps. The stage
-- column moves from the claim_stage enum to text so the set can evolve
-- without an enum migration; existing rows are re-keyed.
--
-- Sales: one row per job once it is moved on the sales board
-- (Inspection → Report → Sit Down Close → Follow Up → Approved → DP Received
-- → Reviews & Referrals). Rules in shared/sales-pipeline.ts.

ALTER TABLE claims ALTER COLUMN stage DROP DEFAULT;
ALTER TABLE claims ALTER COLUMN stage TYPE TEXT USING stage::text;
ALTER TABLE claims ALTER COLUMN stage SET DEFAULT 'file_claim';

UPDATE claims SET stage = CASE stage
  WHEN 'intake' THEN 'file_claim'
  WHEN 'inspection_done' THEN 'inspection_report'
  WHEN 'adjuster_scheduled' THEN 'adjuster_appt'
  WHEN 'adjuster_met' THEN 'adjuster_appt'
  WHEN 'decision_pending' THEN 'waiting_results'
  WHEN 'supplementing' THEN 'supplement'
  WHEN 'build_scheduled' THEN 'post_supplementing'
  WHEN 'build_done' THEN 'post_supplementing'
  WHEN 'final_invoiced' THEN 'post_supplementing'
  WHEN 'depreciation_pending' THEN 'request_depreciation'
  WHEN 'denied_dispute' THEN 'disputing'
  ELSE stage END;

ALTER TABLE claims
  ADD COLUMN IF NOT EXISTS dispute_steps JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS checks JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS history JSONB NOT NULL DEFAULT '[]';

CREATE TABLE IF NOT EXISTS sales_pipeline (
  id SERIAL PRIMARY KEY,
  job_external_id TEXT NOT NULL UNIQUE,
  stage TEXT NOT NULL,
  checks JSONB NOT NULL DEFAULT '{}',
  stage_entered_at TIMESTAMP DEFAULT NOW(),
  history JSONB NOT NULL DEFAULT '[]',
  updated_by TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sales_pipeline_stage ON sales_pipeline(stage);

GRANT SELECT, INSERT, UPDATE, DELETE ON sales_pipeline TO brnmig;
GRANT USAGE, SELECT ON SEQUENCE sales_pipeline_id_seq TO brnmig;
