-- Migration 0037: more than one rep on a job, and a payout for every check
--
-- Two things the commission record could not say.
--
-- 1. That two reps worked the job.
--
-- job_commissions carries one rep_name and one team_member_id, so a job worked
-- by two people had to be recorded as belonging to one of them. The fix is NOT
-- a second job_commissions row: that would copy the job's revenue and costs,
-- and a revenue figure stored twice is one that eventually disagrees with
-- itself — the same trap that already doubles a commission when a job carries
-- two approved proposals.
--
-- Instead the job keeps its money, and job_commission_splits says who shares
-- the pool it earned and in what proportion. Shares must come to 100%: a job
-- that pays out 90% of what it earned is either a typo or a decision nobody
-- wrote down. A rep settled on a figure of their own carries manual_amount
-- instead and is not counted in that 100%.
--
-- 2. That the rep is paid on every check, not once at the end.
--
-- advances_paid was a single number somebody kept up to date by hand, next to
-- a single paid_at. The company pays 10% off the top of each customer check as
-- it lands and settles the balance at the end, so one rep on one job is
-- several payments. job_commission_payouts is one row per payment, carrying
-- the check it came out of. "Advances paid" becomes the sum of the draw rows —
-- one place for the number, so there is no second one to disagree with it.
--
-- job_commissions keeps rep_name, team_member_id, commission_amount,
-- balance_due and status as a roll-up of the splits, rewritten on every write.
-- The L10 agenda, the scorecard, the AI tools and the rep-scoping predicate go
-- on reading the columns they always read.

CREATE TABLE IF NOT EXISTS job_commission_splits (
  id                SERIAL PRIMARY KEY,
  job_commission_id INTEGER NOT NULL REFERENCES job_commissions(id) ON DELETE CASCADE,
  team_member_id    INTEGER REFERENCES team_members(id),
  rep_name          TEXT,
  share_pct         NUMERIC(5,2) NOT NULL DEFAULT 100.00,
  manual_amount     NUMERIC(12,2),
  commission_amount NUMERIC(12,2),
  balance_due       NUMERIC(12,2),
  status            job_commission_status NOT NULL DEFAULT 'open',
  denied_reason     TEXT,
  denied_by         TEXT,
  denied_at         TIMESTAMP,
  approved_by       TEXT,
  approved_at       TIMESTAMP,
  notes             TEXT,
  created_by        TEXT NOT NULL,
  created_at        TIMESTAMP DEFAULT NOW(),
  updated_at        TIMESTAMP DEFAULT NOW(),
  CONSTRAINT job_commission_splits_share_range CHECK (share_pct >= 0 AND share_pct <= 100)
);

CREATE INDEX IF NOT EXISTS job_commission_splits_job_idx ON job_commission_splits (job_commission_id);
CREATE INDEX IF NOT EXISTS job_commission_splits_member_idx ON job_commission_splits (team_member_id);
CREATE INDEX IF NOT EXISTS job_commission_splits_status_idx ON job_commission_splits (status);

-- The same person twice on one job is a mistake every time, and it would make
-- the shares impossible to reason about. Only enforceable where we know who
-- they are; a split that is still just a JobTread name has no id to compare.
CREATE UNIQUE INDEX IF NOT EXISTS job_commission_splits_one_per_member_idx
  ON job_commission_splits (job_commission_id, team_member_id)
  WHERE team_member_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS job_commission_payouts (
  id         SERIAL PRIMARY KEY,
  split_id   INTEGER NOT NULL REFERENCES job_commission_splits(id) ON DELETE CASCADE,
  amount     NUMERIC(12,2) NOT NULL,
  kind       TEXT NOT NULL DEFAULT 'draw',
  reference  TEXT,
  note       TEXT,
  paid_at    TIMESTAMP NOT NULL DEFAULT NOW(),
  paid_by    TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  CONSTRAINT job_commission_payouts_kind CHECK (kind IN ('draw', 'balance'))
);

CREATE INDEX IF NOT EXISTS job_commission_payouts_split_idx ON job_commission_payouts (split_id, paid_at);

-- Backfill: every record that exists becomes one rep on 100% of the pool,
-- carrying its own approval, denial and status across unchanged. Without this
-- every commission in the system would read as having nobody on it.
INSERT INTO job_commission_splits (
  job_commission_id, team_member_id, rep_name, share_pct, manual_amount,
  commission_amount, balance_due, status, denied_reason, denied_by, denied_at,
  approved_by, approved_at, notes, created_by, created_at, updated_at
)
SELECT
  c.id, c.team_member_id, c.rep_name, 100.00, c.manual_commission,
  c.commission_amount, COALESCE(c.balance_due, c.commission_amount), c.status,
  c.denied_reason, c.denied_by, c.denied_at, c.approved_by, c.approved_at,
  c.notes, COALESCE(c.created_by, 'system:0037'), c.created_at, c.updated_at
FROM job_commissions c
WHERE NOT EXISTS (SELECT 1 FROM job_commission_splits s WHERE s.job_commission_id = c.id);

-- Draws already taken become the payment rows they always described. The
-- figure was a running total with no dates behind it, so it lands as one row
-- that says so rather than inventing a payment history that never happened.
INSERT INTO job_commission_payouts (split_id, amount, kind, reference, note, paid_at, paid_by)
SELECT s.id, c.advances_paid, 'draw', NULL,
       'Carried over from the advances-paid total on 0037 — the individual draws predate this record.',
       COALESCE(c.updated_at, NOW()), COALESCE(c.created_by, 'system:0037')
FROM job_commissions c
JOIN job_commission_splits s ON s.job_commission_id = c.id
WHERE c.advances_paid IS NOT NULL AND c.advances_paid > 0
  AND NOT EXISTS (SELECT 1 FROM job_commission_payouts p WHERE p.split_id = s.id);

-- A record already marked paid is settled: whatever was still outstanding on
-- it went out, so the ledger has to show that too or the rep looks unpaid.
INSERT INTO job_commission_payouts (split_id, amount, kind, reference, note, paid_at, paid_by)
SELECT s.id, s.commission_amount - COALESCE(c.advances_paid, 0), 'balance', NULL,
       'Carried over from the paid flag on 0037.',
       COALESCE(c.paid_at, c.updated_at, NOW()), COALESCE(c.paid_by, 'system:0037')
FROM job_commissions c
JOIN job_commission_splits s ON s.job_commission_id = c.id
WHERE c.status = 'paid'
  AND s.commission_amount IS NOT NULL
  AND s.commission_amount - COALESCE(c.advances_paid, 0) > 0;

GRANT SELECT, INSERT, UPDATE, DELETE ON job_commission_splits TO brnmig;
GRANT SELECT, INSERT, UPDATE, DELETE ON job_commission_payouts TO brnmig;
GRANT USAGE, SELECT ON SEQUENCE job_commission_splits_id_seq TO brnmig;
GRANT USAGE, SELECT ON SEQUENCE job_commission_payouts_id_seq TO brnmig;
