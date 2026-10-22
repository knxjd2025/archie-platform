-- Two things the commission record could not previously represent.
--
-- 1. Where each money line came from.
--
-- Revenue, material and labor were single typed numbers. On a job with two
-- suppliers and two crews that meant an admin adding four invoices up in their
-- head and typing the total: the arithmetic was real but invisible, so a wrong
-- figure looked exactly like a right one, and afterwards nobody could tell
-- which invoices a number was meant to cover.
--
-- `sources` holds the pieces: { "material": [ {id, kind, label, amount, docId,
-- docNumber, docStatus, addedBy, addedAt}, ... ], "labor": [...] }. `kind` is
-- 'doc' (a JobTread document picked off the job) or 'manual' (typed by hand);
-- a line stacks as many of either as the job actually had.
--
-- The numeric columns stay authoritative — every read path, the payouts board
-- and the PDF keep using them. A line with sources simply has its column
-- rewritten to their sum on every save, so the two can never disagree.
--
-- 2. What the rep has already been paid.
--
-- The rep draws 10% off the top of every customer payment until the final one,
-- and the commission form settles up at the end. Without somewhere to record
-- those draws the final figure was the whole commission over again, so paying
-- it would pay the rep twice. `advances_paid` is that record, and `balance_due`
-- is what is actually still owed — commission_amount minus the draws, deducted
-- from the rep's half alone. The company's half is not touched by it.
--
-- Existing records: sources '{}' and no advances, so their balance is their
-- commission and nothing about them changes.

-- 3. A commission the formula cannot produce, and a way to say no.
--
-- Some jobs are settled on something other than half the profit. Without a
-- field for it the only way to reach the agreed figure was to bend the costs
-- until the formula produced it, which leaves a record that reads as fact and
-- is not. `manual_commission` overrides the number and shows what it overrode.
--
-- And a commission could only ever be approved. A record that is wrong, or a
-- job that is not going to pay one, had nowhere to go but sit open for ever.
-- 'denied' is that end state, with the reason attached, and Reopen undoes it.

ALTER TYPE job_commission_status ADD VALUE IF NOT EXISTS 'denied' AFTER 'approved';

ALTER TABLE job_commissions
  ADD COLUMN IF NOT EXISTS sources jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS advances_paid numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS balance_due numeric(12,2),
  ADD COLUMN IF NOT EXISTS manual_commission numeric(12,2),
  ADD COLUMN IF NOT EXISTS denied_reason text,
  ADD COLUMN IF NOT EXISTS denied_by text,
  ADD COLUMN IF NOT EXISTS denied_at timestamp;

-- No backfill. Every read path already falls back to commission_amount when a
-- record has no balance yet, and the payouts total coalesces the two, so an
-- existing record needs no write at all to keep behaving as it did. Touching
-- rows that are mid-argument to populate a derived column would be a change
-- nobody asked for.
