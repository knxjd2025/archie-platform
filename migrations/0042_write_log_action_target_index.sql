-- Finishing a signed document checks the write log for each of its steps
-- ("filed?", "copy sent to this signer?") every time anyone opens the job
-- (server/signatures/routes.ts). write_log had no index but its primary key,
-- so every one of those checks read the whole log — which only grows.
--
-- (action, target_id) rather than summary: target_id is always an id (a job,
-- a contact, a row), so it stays well inside a btree entry, where a free-text
-- summary could be long enough to make an insert fail on the index.
--
-- Idempotent: safe to run more than once.

CREATE INDEX IF NOT EXISTS write_log_action_target_idx ON write_log (action, target_id);
