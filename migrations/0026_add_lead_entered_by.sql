-- Migration 0026: credit whoever entered the lead
--
-- A lead typed in by the call centre is owned by a sales rep but was won by
-- whoever took the call. `entered_by` records that person so the KPI board can
-- give them credit for it, separately from the rep who gets the commission.

ALTER TABLE leads ADD COLUMN IF NOT EXISTS entered_by TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS entered_by_name TEXT;

CREATE INDEX IF NOT EXISTS leads_entered_by_idx ON leads (entered_by);
