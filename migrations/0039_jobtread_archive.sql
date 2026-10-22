-- Migration 0039: a complete, raw copy of everything in JobTread
--
-- Step one of leaving JobTread. Before anything is rebuilt in the app, every
-- record JobTread holds is copied here exactly as JobTread returned it, so the
-- history survives the day the subscription ends and every later step (the
-- app becoming the source of truth, the GHL backfill) reads from this instead
-- of calling JobTread again.
--
-- 1. jobtread_archive
--
-- One row per JobTread record: jobs, contacts, custom-field definitions,
-- documents (estimates, invoices, purchase orders, bills), document line
-- items, payments, files, comments, daily logs and tasks. `data` is the raw
-- JSON. `job_id` ties a record to its job where it has one, so "everything
-- about job X" is one indexed query. Re-running the export overwrites the row
-- rather than duplicating it.
--
-- 2. jobtread_archive_steps
--
-- The export runs in chunks (a server request is capped at five minutes and
-- JobTread is slow), so each step keeps its place: `cursor` is JobTread's next
-- page token for a paged list, or the last job/document id done for a
-- per-record step. `errors` keeps the most recent failures so a field JobTread
-- rejects is visible without reading server logs.

CREATE TABLE IF NOT EXISTS jobtread_archive (
  entity_type TEXT NOT NULL,
  jt_id TEXT NOT NULL,
  job_id TEXT,
  data JSONB NOT NULL,
  fetched_at TIMESTAMP NOT NULL DEFAULT now(),
  PRIMARY KEY (entity_type, jt_id)
);

CREATE INDEX IF NOT EXISTS jobtread_archive_job_idx ON jobtread_archive (job_id);

CREATE TABLE IF NOT EXISTS jobtread_archive_steps (
  step TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'pending',
  cursor TEXT,
  counts JSONB NOT NULL DEFAULT '{}'::jsonb,
  errors JSONB NOT NULL DEFAULT '[]'::jsonb,
  started_at TIMESTAMP,
  finished_at TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT now()
);
