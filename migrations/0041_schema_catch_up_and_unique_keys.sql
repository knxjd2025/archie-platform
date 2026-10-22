-- Migration 0041: catch the migrations up with shared/schema.ts, and add the
-- unique keys the code already relies on
--
-- 1. Tables and columns that only ever existed through `db:push`
--
-- follow_ups, agent_chats, agent_chat_messages and write_log had no migration
-- at all, and neither did client_reports, canvass_properties or
-- rep_assignments as tables (0005, 0013 and 0016 only ALTER them). leads is
-- missing every JobTread-mirror column (job_name ... insurance_claim) and
-- team_members is missing jobtread_sales_rep. A database built from these
-- files alone fails the jobs sync, follow-ups, the advisors' daily chats and
-- the write audit log on the first query.
--
-- Every statement is IF NOT EXISTS, and NOT NULL is only applied to a column
-- that holds no nulls, so this is safe on a database that already has some or
-- all of these objects (production was built with db:push).
--
-- 2. agent_chats (user_email, agent_key, day) unique
--
-- server/agents/chat-store.ts opens today's thread with
-- INSERT ... ON CONFLICT (user_email, agent_key, day), and Postgres rejects
-- that with "there is no unique or exclusion constraint matching the ON
-- CONFLICT specification" unless this index exists. Duplicate threads made
-- before the index are merged into the earliest one first: their messages are
-- re-pointed, not deleted, and the merged day's summary is cleared so the
-- nightly job summarizes the whole day again.
--
-- 3. agents.role unique
--
-- Seeding runs on every cold start and checked "is there a row for this role?"
-- before inserting, so two cold starts at once could both insert the same
-- advisor. Code looks advisors up by role and takes whichever row comes back.
-- Duplicates are merged into the earliest row: every foreign key that points
-- at agents(id) (conversations, tasks, decisions, the communication and
-- knowledge logs, leads.qualified_by, agents.reports_to) is re-pointed first,
-- found from the catalog so a reference added later is covered too.

-- ---------------------------------------------------------------------------
-- 1a. Tables
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS rep_assignments (
  id SERIAL PRIMARY KEY,
  job_external_id TEXT NOT NULL,
  team_member_id INTEGER NOT NULL REFERENCES team_members(id),
  role TEXT NOT NULL DEFAULT 'primary',
  source TEXT NOT NULL DEFAULT 'manual',
  confidence TEXT,
  evidence TEXT,
  assigned_by TEXT,
  assigned_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS follow_ups (
  id SERIAL PRIMARY KEY,
  job_external_id TEXT,
  client_name TEXT,
  note TEXT NOT NULL,
  due_date DATE,
  assigned_to INTEGER REFERENCES team_members(id),
  created_by TEXT,
  done BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW(),
  completed_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS agent_chats (
  id SERIAL PRIMARY KEY,
  user_email TEXT NOT NULL,
  agent_key TEXT NOT NULL,
  day TEXT NOT NULL,
  summary TEXT,
  summarized_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agent_chat_messages (
  id SERIAL PRIMARY KEY,
  chat_id INTEGER NOT NULL REFERENCES agent_chats(id),
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS client_reports (
  id SERIAL PRIMARY KEY,
  job_external_id TEXT NOT NULL,
  report_id TEXT NOT NULL UNIQUE,
  report_type TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  report_url TEXT,
  pdf_url TEXT,
  error TEXT,
  created_by TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  html TEXT,
  data JSONB,
  share_token TEXT,
  title TEXT,
  presented_at TIMESTAMP,
  presented_by TEXT,
  jobtread_document_id TEXT,
  jobtread_pushed_at TIMESTAMP,
  jobtread_pushed_hash TEXT,
  jobtread_doc_status TEXT,
  engagement JSONB
);

CREATE TABLE IF NOT EXISTS canvass_properties (
  id SERIAL PRIMARY KEY,
  address TEXT NOT NULL,
  city TEXT,
  state TEXT,
  zip TEXT,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  status TEXT NOT NULL DEFAULT 'not_knocked',
  notes TEXT,
  owner_name TEXT,
  phone TEXT,
  email TEXT,
  storm_summary JSONB,
  measurements JSONB,
  lead_external_id TEXT,
  knocked_by TEXT,
  knocked_at TIMESTAMP,
  created_by TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS write_log (
  id SERIAL PRIMARY KEY,
  actor TEXT NOT NULL,
  system TEXT NOT NULL,
  action TEXT NOT NULL,
  target_id TEXT,
  summary TEXT,
  ok BOOLEAN NOT NULL,
  error TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- 1b. Columns on tables that already existed
-- ---------------------------------------------------------------------------

ALTER TABLE leads ADD COLUMN IF NOT EXISTS job_name TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS job_number TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS stage TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS jt_sales_rep TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS project_manager TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS projected_value NUMERIC(12, 2);
ALTER TABLE leads ADD COLUMN IF NOT EXISTS schedule_start TIMESTAMP;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS schedule_end TIMESTAMP;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS closed_on TIMESTAMP;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS insurance_claim BOOLEAN;

ALTER TABLE team_members ADD COLUMN IF NOT EXISTS jobtread_sales_rep TEXT;

ALTER TABLE rep_assignments ADD COLUMN IF NOT EXISTS assigned_by TEXT;
ALTER TABLE rep_assignments ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMP DEFAULT NOW();

ALTER TABLE canvass_properties ADD COLUMN IF NOT EXISTS storm_summary JSONB;
ALTER TABLE canvass_properties ADD COLUMN IF NOT EXISTS measurements JSONB;
ALTER TABLE canvass_properties ADD COLUMN IF NOT EXISTS knocked_by TEXT;
ALTER TABLE canvass_properties ADD COLUMN IF NOT EXISTS knocked_at TIMESTAMP;

ALTER TABLE client_reports ADD COLUMN IF NOT EXISTS report_id TEXT;
ALTER TABLE client_reports ADD COLUMN IF NOT EXISTS report_type TEXT;
ALTER TABLE client_reports ADD COLUMN IF NOT EXISTS report_url TEXT;
ALTER TABLE client_reports ADD COLUMN IF NOT EXISTS pdf_url TEXT;
ALTER TABLE client_reports ADD COLUMN IF NOT EXISTS share_token TEXT;
ALTER TABLE client_reports ADD COLUMN IF NOT EXISTS jobtread_document_id TEXT;
ALTER TABLE client_reports ADD COLUMN IF NOT EXISTS jobtread_pushed_at TIMESTAMP;
ALTER TABLE client_reports ADD COLUMN IF NOT EXISTS jobtread_pushed_hash TEXT;
ALTER TABLE client_reports ADD COLUMN IF NOT EXISTS jobtread_doc_status TEXT;
-- The rest of client_reports, for a table that predates them.
ALTER TABLE client_reports ADD COLUMN IF NOT EXISTS error TEXT;
ALTER TABLE client_reports ADD COLUMN IF NOT EXISTS created_by TEXT;
ALTER TABLE client_reports ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW();
ALTER TABLE client_reports ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();
ALTER TABLE client_reports ADD COLUMN IF NOT EXISTS html TEXT;
ALTER TABLE client_reports ADD COLUMN IF NOT EXISTS data JSONB;
ALTER TABLE client_reports ADD COLUMN IF NOT EXISTS title TEXT;
ALTER TABLE client_reports ADD COLUMN IF NOT EXISTS presented_at TIMESTAMP;
ALTER TABLE client_reports ADD COLUMN IF NOT EXISTS presented_by TEXT;
ALTER TABLE client_reports ADD COLUMN IF NOT EXISTS engagement JSONB;

-- report_id is NOT NULL UNIQUE in the schema. A column just added above to a
-- table with rows is all nulls, and SET NOT NULL would fail the whole
-- migration, so it is only tightened once every row has a value.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM client_reports WHERE report_id IS NULL) THEN
    ALTER TABLE client_reports ALTER COLUMN report_id SET NOT NULL;
  END IF;
  -- db:push named this constraint client_reports_report_id_key; any unique
  -- index on the column alone already gives the guarantee.
  IF NOT EXISTS (
    SELECT 1 FROM pg_index i
    WHERE i.indrelid = 'client_reports'::regclass
      AND i.indisunique
      AND i.indnatts = 1
      AND i.indkey[0] = (SELECT attnum FROM pg_attribute
                         WHERE attrelid = 'client_reports'::regclass AND attname = 'report_id')
  ) THEN
    CREATE UNIQUE INDEX client_reports_report_id_unique ON client_reports (report_id);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. One daily thread per (person, agent, day)
-- ---------------------------------------------------------------------------

UPDATE agent_chat_messages m
SET chat_id = d.keep_id
FROM (
  SELECT id, min(id) OVER (PARTITION BY user_email, agent_key, day) AS keep_id
  FROM agent_chats
) d
WHERE m.chat_id = d.id AND d.id <> d.keep_id;

UPDATE agent_chats
SET summary = NULL, summarized_at = NULL
WHERE id IN (
  SELECT min(id) FROM agent_chats
  GROUP BY user_email, agent_key, day
  HAVING count(*) > 1
);

DELETE FROM agent_chats c
USING (
  SELECT id, min(id) OVER (PARTITION BY user_email, agent_key, day) AS keep_id
  FROM agent_chats
) d
WHERE c.id = d.id AND d.id <> d.keep_id;

CREATE UNIQUE INDEX IF NOT EXISTS agent_chats_user_agent_day_uq
  ON agent_chats (user_email, agent_key, day);

-- ---------------------------------------------------------------------------
-- 3. One agents row per role
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  fk RECORD;
BEGIN
  FOR fk IN
    SELECT n.nspname AS sch, c.relname AS tbl, a.attname AS col
    FROM pg_constraint k
    JOIN pg_class c ON c.oid = k.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = k.conkey[1]
    WHERE k.contype = 'f'
      AND k.confrelid = 'agents'::regclass
      AND array_length(k.conkey, 1) = 1
  LOOP
    EXECUTE format(
      'UPDATE %I.%I t SET %I = d.keep_id
         FROM (SELECT id, min(id) OVER (PARTITION BY role) AS keep_id FROM agents) d
        WHERE t.%I = d.id AND d.id <> d.keep_id',
      fk.sch, fk.tbl, fk.col, fk.col
    );
  END LOOP;

  DELETE FROM agents a
  USING (SELECT id, min(id) OVER (PARTITION BY role) AS keep_id FROM agents) d
  WHERE a.id = d.id AND d.id <> d.keep_id;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS agents_role_uq ON agents (role);

-- ---------------------------------------------------------------------------
-- 1c. NOT NULL and foreign keys on columns added above, where the data allows
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM client_reports WHERE job_external_id IS NULL) THEN
    ALTER TABLE client_reports ALTER COLUMN job_external_id SET NOT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM canvass_properties WHERE address IS NULL) THEN
    ALTER TABLE canvass_properties ALTER COLUMN address SET NOT NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'rep_assignments'::regclass AND contype = 'f'
      AND confrelid = 'team_members'::regclass
  ) AND NOT EXISTS (
    SELECT 1 FROM rep_assignments r
    WHERE NOT EXISTS (SELECT 1 FROM team_members t WHERE t.id = r.team_member_id)
  ) THEN
    ALTER TABLE rep_assignments
      ADD CONSTRAINT rep_assignments_team_member_id_team_members_id_fk
      FOREIGN KEY (team_member_id) REFERENCES team_members(id);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Grants (see 0015): the app connects as brnmig in production. Guarded so a
-- local database without that role can run this file too.
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'brnmig') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON
      rep_assignments, follow_ups, agent_chats, agent_chat_messages,
      client_reports, canvass_properties, write_log
      TO brnmig;
    GRANT USAGE, SELECT ON SEQUENCE
      rep_assignments_id_seq, follow_ups_id_seq, agent_chats_id_seq,
      agent_chat_messages_id_seq, client_reports_id_seq,
      canvass_properties_id_seq, write_log_id_seq
      TO brnmig;
  END IF;
END $$;
