-- Migration 0036: a lost deal has to say why
--
-- The Lost column shipped without a reason, which makes it a number and
-- nothing else. "We lost 14 deals" is not actionable; "we lost 9 of them on
-- price and 3 because nobody called back" is two different problems with two
-- different fixes, and only one of them is about the price.
--
--   lost_reason  one of the keys in SALES_LOST_REASONS (shared/sales-pipeline.ts)
--   lost_note    optional detail, and required when the reason is 'other'
--
-- Both are cleared when a deal is reopened: a deal that came back was not
-- lost, and leaving the old reason on the row would have it turn up in the
-- next count of why deals die.

ALTER TABLE sales_pipeline
  ADD COLUMN IF NOT EXISTS lost_reason TEXT,
  ADD COLUMN IF NOT EXISTS lost_note TEXT;

-- Counting why deals die is the whole point, so make that count cheap.
CREATE INDEX IF NOT EXISTS sales_pipeline_lost_reason_idx
  ON sales_pipeline (lost_reason) WHERE lost_reason IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON sales_pipeline TO brnmig;
