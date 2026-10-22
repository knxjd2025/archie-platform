-- Migration 0033: a scorecard number may appear in more than one room
--
-- 0032 made scorecard_metrics.key globally unique, which quietly ruled out the
-- most ordinary case: leadership and sales both want "new leads" on their
-- scorecard, with their own owner and their own goal. The key identifies the
-- MEASURE the pack computes; the room is the other half of the identity.
--
-- Corrective, and safe to run: the table is empty apart from anything seeded
-- after 0032, and the new index is strictly weaker than the constraint it
-- replaces (everything unique on (key) is unique on (key, meeting)).

ALTER TABLE scorecard_metrics DROP CONSTRAINT IF EXISTS scorecard_metrics_key_key;

CREATE UNIQUE INDEX IF NOT EXISTS scorecard_metrics_key_meeting_idx
  ON scorecard_metrics (key, meeting);
