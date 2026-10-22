-- Migration 0023: inbox watch — per-mailbox scan windows and the flagged emails

CREATE TABLE IF NOT EXISTS inbox_scans (
  id SERIAL PRIMARY KEY,
  mailbox TEXT NOT NULL,
  from_at TIMESTAMP NOT NULL,
  to_at TIMESTAMP NOT NULL,
  messages_seen INTEGER NOT NULL DEFAULT 0,
  items_added INTEGER NOT NULL DEFAULT 0,
  flagged INTEGER NOT NULL DEFAULT 0,
  started_by TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS inbox_scans_mailbox_idx ON inbox_scans (mailbox, to_at DESC);

CREATE TABLE IF NOT EXISTS inbox_items (
  id SERIAL PRIMARY KEY,
  mailbox TEXT NOT NULL,
  message_id TEXT NOT NULL,
  thread_id TEXT,
  from_name TEXT,
  from_email TEXT,
  subject TEXT,
  snippet TEXT,
  received_at TIMESTAMP,
  category TEXT NOT NULL DEFAULT 'other',
  score INTEGER NOT NULL DEFAULT 0,
  reason TEXT,
  matched_external_id TEXT,
  matched_name TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  unread BOOLEAN,
  handled_by TEXT,
  handled_at TIMESTAMP,
  follow_up_id INTEGER,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS inbox_items_mailbox_message_idx ON inbox_items (mailbox, message_id);
CREATE INDEX IF NOT EXISTS inbox_items_mailbox_status_idx ON inbox_items (mailbox, status);
