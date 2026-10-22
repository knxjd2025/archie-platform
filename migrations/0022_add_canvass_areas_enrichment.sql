-- Migration 0022: drawn canvassing areas and Tracerfy enrichment
--
-- canvass_properties is owned by the postgres role, so nothing is added to it;
-- Tracerfy data lives in its own table keyed by canvass_property_id.

CREATE TABLE IF NOT EXISTS canvass_areas (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  shape JSONB NOT NULL,
  filters JSONB NOT NULL,
  geography JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  tracerfy_list_id INTEGER,
  preview_count INTEGER,
  requested_count INTEGER,
  delivered_count INTEGER,
  in_area_count INTEGER,
  credits_deducted INTEGER,
  error TEXT,
  created_by TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  completed_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS canvass_enrichment (
  id SERIAL PRIMARY KEY,
  canvass_property_id INTEGER NOT NULL UNIQUE,
  area_id INTEGER,
  source TEXT NOT NULL DEFAULT 'tracerfy',
  in_area BOOLEAN,
  owner_name TEXT,
  owner2_name TEXT,
  mailing_address TEXT,
  phones JSONB NOT NULL DEFAULT '[]'::jsonb,
  emails JSONB NOT NULL DEFAULT '[]'::jsonb,
  litigator BOOLEAN,
  contact_clean BOOLEAN,
  property_type TEXT,
  year_built INTEGER,
  building_sqft INTEGER,
  roof_material TEXT,
  roof_construction TEXT,
  estimated_value INTEGER,
  equity_percent DOUBLE PRECISION,
  years_owned INTEGER,
  owner_occupied BOOLEAN,
  absentee_owner BOOLEAN,
  high_equity BOOLEAN,
  free_clear BOOLEAN,
  vacant BOOLEAN,
  mls_active BOOLEAN,
  roof_score INTEGER,
  sell_score INTEGER,
  raw JSONB,
  credits_spent INTEGER,
  created_by TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS canvass_enrichment_area_idx ON canvass_enrichment (area_id);
