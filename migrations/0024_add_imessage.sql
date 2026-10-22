-- Migration 0024: iMessage bridge — synced threads and the outbox the bridge sends from

CREATE TABLE IF NOT EXISTS imessages (
  id SERIAL PRIMARY KEY,
  owner TEXT NOT NULL,
  guid TEXT NOT NULL UNIQUE,
  chat_guid TEXT,
  handle TEXT,
  handle_key TEXT,
  direction TEXT NOT NULL,
  service TEXT,
  text TEXT,
  has_attachment BOOLEAN NOT NULL DEFAULT FALSE,
  is_group BOOLEAN NOT NULL DEFAULT FALSE,
  sent_at TIMESTAMP NOT NULL,
  matched_external_id TEXT,
  matched_name TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS imessages_owner_handle_idx ON imessages (owner, handle_key, sent_at);
CREATE INDEX IF NOT EXISTS imessages_owner_match_idx ON imessages (owner, matched_external_id);

CREATE TABLE IF NOT EXISTS imessage_outbox (
  id SERIAL PRIMARY KEY,
  owner TEXT NOT NULL,
  to_handle TEXT NOT NULL,
  body TEXT NOT NULL,
  external_id TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  error TEXT,
  created_by TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  sent_at TIMESTAMP
);
CREATE INDEX IF NOT EXISTS imessage_outbox_owner_status_idx ON imessage_outbox (owner, status);
