-- Migration 0040: bug reports and caught errors
--
-- One table for both: what a person sends with the "Report a bug" button
-- (kind = 'report'), and what the app catches by itself — a screen that crashed
-- in the browser ('client_error') or a request that failed on the server
-- ('server_error').
--
-- Caught errors carry a fingerprint and are counted, not repeated: the same
-- failure a hundred times is one row with occurrences = 100. A person's report
-- has no fingerprint and is always its own row.
--
-- The server also creates this table on first use (server/bugs/store.ts), so
-- bug capture works even before this file is run. Running it is still right —
-- it is the record of the schema.

CREATE TABLE IF NOT EXISTS bug_reports (
  id SERIAL PRIMARY KEY,
  kind TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',
  fingerprint TEXT,
  message TEXT NOT NULL,
  details TEXT,
  page TEXT,
  url TEXT,
  user_email TEXT,
  user_agent TEXT,
  context JSONB NOT NULL DEFAULT '{}'::jsonb,
  screenshot TEXT,
  occurrences INTEGER NOT NULL DEFAULT 1,
  first_seen TIMESTAMP NOT NULL DEFAULT NOW(),
  last_seen TIMESTAMP NOT NULL DEFAULT NOW(),
  notes TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS bug_reports_fingerprint_uq
  ON bug_reports (fingerprint) WHERE fingerprint IS NOT NULL;
CREATE INDEX IF NOT EXISTS bug_reports_last_seen_idx ON bug_reports (last_seen DESC);
