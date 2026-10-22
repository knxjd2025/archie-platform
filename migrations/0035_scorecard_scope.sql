-- Migration 0035: company numbers and rep numbers are different scorecards
--
-- The company scorecard is leadership's, and it is not everybody's business:
-- total revenue closed belongs in the admin room. A rep needs the same shape of
-- scorecard about THEIR OWN week — their leads, their sales, their diary — and
-- nothing about anyone else's.
--
--   scope='company'  one number for the business. Admin only.
--   scope='rep'      computed per rep. An admin sees every rep's row; a rep
--                    sees exactly one, their own.
--
-- The goal on a rep-scoped metric is the target for ONE rep, not the team.

ALTER TABLE scorecard_metrics
  ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'company';

-- The identity of a metric is now the measure, the room AND the scope: "new
-- leads" is a fair thing to track both as a company total and per rep.
DROP INDEX IF EXISTS scorecard_metrics_key_meeting_idx;

CREATE UNIQUE INDEX IF NOT EXISTS scorecard_metrics_key_meeting_scope_idx
  ON scorecard_metrics (key, meeting, scope);
