-- Archie go-live, last piece of migration 0008 (for the Supabase SQL Editor).
-- The rest of 0008, and 0009 and 0010, were applied on Nov 18, 2026 without
-- these lines, because the Supabase connector asks for a confirmation on
-- DROP/REVOKE that could not be answered. Until this runs, the companies
-- table keeps its old policies; they already work with role-based system
-- access (archie_is_system() now checks the role), and the table is tiny.
-- Runs as one transaction. Running it twice fails on the _migrations row and
-- changes nothing.
REVOKE ALL ON FUNCTION archie_protect_company_table(regclass) FROM PUBLIC;
DROP POLICY IF EXISTS company_self_read ON companies;
DROP POLICY IF EXISTS company_system_insert ON companies;
DROP POLICY IF EXISTS company_system_update ON companies;
DROP POLICY IF EXISTS company_system_delete ON companies;
DROP POLICY IF EXISTS company_system ON companies;
CREATE POLICY company_self_read ON companies FOR SELECT
  USING (id = (SELECT archie_current_company()));
CREATE POLICY company_system ON companies TO archie_system USING (true) WITH CHECK (true);
INSERT INTO _migrations (name) VALUES ('0008_rls_system_role.sql');
