-- Archie: index for looking leads up by their source system's id
-- (eq(leads.externalId, ...) in about 51 places: client pages, reports,
-- webhooks). Company first, since every query runs as one company.
-- IF NOT EXISTS so a database where an operator already built it by hand
-- (for example CONCURRENTLY, ahead of this migration) is left alone.
-- Note: Postgres uses it when the query's company condition is indexable.
-- Under the current policy (company_id = archie_current_company() OR
-- archie_is_system()) a lookup that filters on external_id alone is still a
-- sequential scan; the row level security redesign (company condition
-- without the OR) is what lets every such lookup use this index.

CREATE INDEX IF NOT EXISTS "leads_company_external_id_idx" ON "leads" USING btree ("company_id","external_id");
