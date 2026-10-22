-- Org-chart roles + reporting hierarchy.
--
-- Two new roles: sales_director (oversees all of sales) and customer_service
-- (helps any customer, sees no money). 'manager' stays as the stored value for
-- a Sales Leader — renaming it would touch every atLeast('manager') call and
-- every existing row, for a label the UI can supply instead.
--
-- reports_to is the reporting line a Sales Leader's 'team' data scope reads.
-- Without it, "a leader sees only their own reps" is inexpressible: rank alone
-- cannot distinguish one leader's reps from another's.
--
-- Additive and idempotent — safe to re-run, and safe to apply before the code
-- that uses it ships.

-- Postgres cannot add enum values inside a transaction block that also uses
-- them, so these run first and separately.
ALTER TYPE team_role ADD VALUE IF NOT EXISTS 'sales_director';
ALTER TYPE team_role ADD VALUE IF NOT EXISTS 'customer_service';

ALTER TABLE team_members ADD COLUMN IF NOT EXISTS reports_to integer;
ALTER TABLE team_members ADD COLUMN IF NOT EXISTS jobtread_membership_id text;

-- Deleting a leader must not delete their reps; it orphans the line instead,
-- which the app treats as "reports to nobody" rather than cascading.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'team_members_reports_to_fkey'
  ) THEN
    ALTER TABLE team_members
      ADD CONSTRAINT team_members_reports_to_fkey
      FOREIGN KEY (reports_to) REFERENCES team_members(id) ON DELETE SET NULL;
  END IF;
END $$;

-- A person reporting to themselves would make the team-scope walk cycle.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'team_members_no_self_report'
  ) THEN
    ALTER TABLE team_members
      ADD CONSTRAINT team_members_no_self_report CHECK (reports_to IS DISTINCT FROM id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS team_members_reports_to_idx ON team_members(reports_to);
CREATE UNIQUE INDEX IF NOT EXISTS team_members_jt_membership_idx
  ON team_members(jobtread_membership_id) WHERE jobtread_membership_id IS NOT NULL;

-- The app's DB role needs explicit grants after any new column or table,
-- otherwise every write fails with 42501 at runtime.
GRANT SELECT, INSERT, UPDATE, DELETE ON team_members TO brnmig;
