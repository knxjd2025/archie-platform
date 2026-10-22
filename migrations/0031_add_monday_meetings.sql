-- Migration 0031: Monday meeting packs
--
-- Four meetings run back to back every Monday — Leadership 8:00, Claims 9:30,
-- Sales 10:30, Payroll 12:00. A Sunday-evening job assembles the numbers each
-- room needs from what the app already holds, and the meeting is run off the
-- page rather than off somebody's memory.
--
-- Three tables: the week's pack, the notes taken in each room, and the actions
-- that came out of it. Actions are the point — next Sunday's pack opens with
-- the ones still open, so nothing is quietly dropped or repeated.

CREATE TABLE IF NOT EXISTS meeting_weeks (
  id SERIAL PRIMARY KEY,
  -- The Monday this pack is for. One pack per Monday, so re-running the job is
  -- safe and a second run simply refreshes the numbers.
  monday DATE NOT NULL UNIQUE,
  -- The agendas as they were assembled, frozen. The pack is a record of what
  -- the room was shown, and it should still read the same next month even as
  -- the pipelines move underneath it.
  agendas JSONB NOT NULL DEFAULT '[]'::jsonb,
  week_from DATE,
  week_to DATE,
  generated_at TIMESTAMP,
  generated_by TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS meeting_notes (
  id SERIAL PRIMARY KEY,
  week_id INTEGER NOT NULL REFERENCES meeting_weeks(id) ON DELETE CASCADE,
  meeting TEXT NOT NULL,            -- leadership | claims | sales | payroll
  notes TEXT NOT NULL DEFAULT '',
  updated_by TEXT,
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (week_id, meeting)
);

CREATE TABLE IF NOT EXISTS meeting_actions (
  id SERIAL PRIMARY KEY,
  week_id INTEGER NOT NULL REFERENCES meeting_weeks(id) ON DELETE CASCADE,
  meeting TEXT NOT NULL,
  action_text TEXT NOT NULL,
  -- Who owns it. An email rather than a team_members id so an action survives
  -- somebody leaving the roster.
  owner_email TEXT,
  due_date DATE,
  done_at TIMESTAMP,
  done_by TEXT,
  created_by TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS meeting_actions_week_idx ON meeting_actions (week_id);
-- The carry-forward query: everything still open, oldest first.
CREATE INDEX IF NOT EXISTS meeting_actions_open_idx ON meeting_actions (done_at) WHERE done_at IS NULL;
