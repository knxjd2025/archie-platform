-- Shared jobs + assignment provenance.
--
-- rep_assignments.job_external_id was UNIQUE, so a job could have exactly one
-- rep. Real jobs are worked by two people (verified: "D Carmicahel" has both
-- James and Banning on its tasks and comments), so the uniqueness moves to the
-- PAIR and a share is expressed as two rows.
--
-- `role` distinguishes the owner from the second rep: commission, follow-up
-- ownership and "my book" need one primary answer, while visibility should
-- include both.
--
-- `source` and `confidence` record HOW an assignment was decided. 400 of 420
-- leads are unassigned; those will be filled largely by inference from
-- JobTread task/comment evidence, and a human confirming later must be able to
-- tell a guess from a decision.
--
-- Additive and idempotent.

ALTER TABLE rep_assignments ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'primary';
ALTER TABLE rep_assignments ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual';
ALTER TABLE rep_assignments ADD COLUMN IF NOT EXISTS confidence text;
ALTER TABLE rep_assignments ADD COLUMN IF NOT EXISTS evidence text;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rep_assignments_job_external_id_unique') THEN
    ALTER TABLE rep_assignments DROP CONSTRAINT rep_assignments_job_external_id_unique;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rep_assignments_job_external_id_key') THEN
    ALTER TABLE rep_assignments DROP CONSTRAINT rep_assignments_job_external_id_key;
  END IF;
END $$;

-- One row per (job, person): a person cannot be assigned to the same job twice,
-- but two people can share it.
CREATE UNIQUE INDEX IF NOT EXISTS rep_assignments_job_member_idx
  ON rep_assignments(job_external_id, team_member_id);

-- A job has at most ONE primary. Enforced in the database so a race or a bad
-- write cannot produce two owners for one job.
CREATE UNIQUE INDEX IF NOT EXISTS rep_assignments_one_primary_idx
  ON rep_assignments(job_external_id) WHERE role = 'primary';

CREATE INDEX IF NOT EXISTS rep_assignments_member_idx ON rep_assignments(team_member_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON rep_assignments TO brnmig;
