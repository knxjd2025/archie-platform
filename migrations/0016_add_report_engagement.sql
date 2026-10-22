-- Migration 0016: track customer engagement with a shared report (Presentation/
-- Proposal) — which chapters they actually scrolled to and which Good/Better/
-- Best tier they tapped, the way tools like SumoQuote/Leap surface "did the
-- customer even look at this" back to the rep instead of a fire-and-forget PDF.
--
-- Just a new column on an existing, already-granted table (client_reports) —
-- table-level GRANTs cover columns added later via ALTER TABLE, so no new
-- GRANT is needed here (unlike a brand-new table, see 0015's comment).

ALTER TABLE client_reports ADD COLUMN IF NOT EXISTS engagement jsonb;
