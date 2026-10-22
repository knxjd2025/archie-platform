-- Migration 0005: Sales-activity KPI tracking
-- Doors knocked, leads run (contacted), reports made and presented.

DO $$ BEGIN
  CREATE TYPE kpi_event_type AS ENUM ('door_knock', 'lead_contacted', 'report_created', 'report_presented');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS kpi_events (
  id SERIAL PRIMARY KEY,
  team_member_id INTEGER REFERENCES team_members(id),
  rep_name TEXT,                     -- fallback label when attribution can't resolve a team_member_id
  type kpi_event_type NOT NULL,
  ref_table TEXT,                    -- 'canvass_properties' | 'client_reports' | 'leads'
  ref_id TEXT,
  occurred_at TIMESTAMP NOT NULL DEFAULT NOW(),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_kpi_events_member_type_time ON kpi_events(team_member_id, type, occurred_at);

-- "Presented to the customer" is distinct from "generated" and from a JobTread
-- proposal send — no such concept exists on client_reports yet.
ALTER TABLE client_reports ADD COLUMN IF NOT EXISTS presented_at TIMESTAMP;
ALTER TABLE client_reports ADD COLUMN IF NOT EXISTS presented_by TEXT;
