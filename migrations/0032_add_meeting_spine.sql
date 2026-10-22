-- Migration 0032: the meeting spine — scorecard, rocks, issues, ratings
--
-- The Monday pack (0031) assembles what each room needs to know. This is what
-- the room does with it, borrowed from EOS and fitted to how this company
-- already runs:
--
--   scorecard_metrics  a weekly number with ONE owner and a goal. "Down from
--                      last week" can be argued with and cannot be acted on;
--                      "6 against a goal of 10, Banning's number" can be both.
--   rocks              priorities for the quarter. Everything else the pack
--                      computes is this week or last week — there was no
--                      horizon past seven days anywhere in the app.
--   meeting_issues     the reason for all of it. The pack recomputes its
--                      findings every Monday, so an unsolved problem was never
--                      solved — it was read out again. An issue here persists,
--                      and carries the week it first appeared.
--   meeting_ratings    1–10 at the close, which is the loop that makes the
--                      meeting itself get better.
--
-- Nothing here is destructive and nothing touches 0031's tables.

CREATE TABLE IF NOT EXISTS scorecard_metrics (
  id SERIAL PRIMARY KEY,
  -- Stable identifier the pack computes against (e.g. 'new_leads'), so a
  -- relabelled metric keeps its history and its goal.
  key TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  meeting TEXT NOT NULL DEFAULT 'leadership',   -- leadership | claims | sales
  -- One owner. A number owned by everybody is owned by nobody.
  owner_email TEXT,
  -- NULL on purpose: a metric nobody has set a goal for shows as "unset"
  -- rather than quietly passing. That gap is the finding.
  goal NUMERIC,
  direction TEXT NOT NULL DEFAULT 'at_least',   -- at_least | at_most
  unit TEXT NOT NULL DEFAULT 'count',           -- count | money | days
  sort_order INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rocks (
  id SERIAL PRIMARY KEY,
  meeting TEXT NOT NULL DEFAULT 'leadership',
  title TEXT NOT NULL,
  owner_email TEXT,
  quarter TEXT NOT NULL,                        -- '2026-Q3'
  status TEXT NOT NULL DEFAULT 'on_track',      -- on_track | off_track | done
  due_date DATE,
  notes TEXT,
  created_by TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS rocks_quarter_idx ON rocks (quarter, meeting);

CREATE TABLE IF NOT EXISTS meeting_issues (
  id SERIAL PRIMARY KEY,
  meeting TEXT NOT NULL,                        -- leadership | claims | sales
  title TEXT NOT NULL,
  detail TEXT,
  source TEXT NOT NULL DEFAULT 'manual',        -- manual | scorecard | rock | pack
  -- Stable per finding, so the Sunday job raises an auto-filed issue ONCE
  -- instead of a fresh copy every week. Partial-unique below, because manual
  -- issues have no key and several of them may coexist.
  source_key TEXT,
  raised_by TEXT,
  raised_at TIMESTAMP DEFAULT NOW(),
  -- The Monday it first appeared. This is the number that makes a chronic
  -- issue impossible to keep nodding at.
  first_seen_week DATE,
  priority INTEGER,                             -- 1..3 once picked for the week
  solved_at TIMESTAMP,
  solved_note TEXT,
  solved_by TEXT,
  dropped_at TIMESTAMP,
  dropped_by TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- One open auto-filed issue per finding per room. Once it is solved or dropped
-- the index lets go, so the same finding may legitimately come back later as a
-- new issue with a new first_seen_week.
CREATE UNIQUE INDEX IF NOT EXISTS meeting_issues_open_source_idx
  ON meeting_issues (meeting, source_key)
  WHERE source_key IS NOT NULL AND solved_at IS NULL AND dropped_at IS NULL;

CREATE INDEX IF NOT EXISTS meeting_issues_open_idx
  ON meeting_issues (meeting, solved_at, dropped_at);

CREATE TABLE IF NOT EXISTS meeting_ratings (
  id SERIAL PRIMARY KEY,
  meeting TEXT NOT NULL,
  monday DATE NOT NULL,
  rater_email TEXT NOT NULL,
  score INTEGER NOT NULL CHECK (score BETWEEN 1 AND 10),
  note TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- One score per person per meeting per week; rating again replaces it. Named
-- explicitly so it matches shared/schema.ts — the E2E database is built from
-- the schema, and an index that differs only in name there is an index whose
-- behaviour nothing actually tests.
CREATE UNIQUE INDEX IF NOT EXISTS meeting_ratings_person_idx
  ON meeting_ratings (meeting, monday, rater_email);
