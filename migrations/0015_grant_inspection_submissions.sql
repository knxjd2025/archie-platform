-- Migration 0015: grant the app's DB role access to inspection_submissions
--
-- 0014 created the table but omitted the grant every prior migration that
-- adds a table/column needs (see 0012's comment: "otherwise every write
-- fails with 42501 at runtime") -- confirmed live: GET/POST /api/inspections
-- were 500ing with "permission denied for table inspection_submissions"
-- because brnmig had no privileges on it.

GRANT SELECT, INSERT, UPDATE, DELETE ON inspection_submissions TO brnmig;
