#!/usr/bin/env bash
# Rehearse the 0008 rollout (role-based system access) on a REHEARSAL
# database: a Supabase branch or scratch project on the production Postgres
# version. NEVER run this against production: it runs the migrations, writes
# test companies and rows, and runs the revert and forward scripts.
#
#   OWNER_URL='postgresql://postgres.<ref>:<pw>@<host>:5432/postgres' \
#   APP_URL='postgresql://archie_app.<ref>:<pw>@<host>:5432/postgres' \
#   scripts/rehearse-supabase.sh --i-am-on-a-rehearsal-database
#
# Both URLs on the session pooler (5432) or direct, never 6543.
# Before the first run, as the owner: once the migrations have created
# archie_app, give it a password: ALTER ROLE archie_app WITH LOGIN PASSWORD '...';
# (On a fresh branch: run step 3 below first, set the password, then rerun.)
#
# Steps (each prints what it checks and stops on the first failure):
#   1. version and read-only pre-checks
#   2. pre-build the composite indexes CONCURRENTLY, one at a time, and check validity
#   3. run the migrations as the owner
#   4. post-checks on roles, membership and policies
#   5. as the app: current_user inside and outside runAsSystem
#   6. the security tests against it, as archie_app: isolation.test.ts and system-role.test.ts
#   7. revert 0008, check old-style system access works, run 0008 again
set -euo pipefail
cd "$(dirname "$0")/.."

if [ "${1:-}" != "--i-am-on-a-rehearsal-database" ]; then
  echo "refusing: pass --i-am-on-a-rehearsal-database (and never point this at production)" >&2
  exit 1
fi
: "${OWNER_URL:?set OWNER_URL (the postgres owner, rehearsal database)}"
: "${APP_URL:?set APP_URL (archie_app, rehearsal database)}"
case "$OWNER_URL$APP_URL" in *:6543*) echo "refusing: transaction pooler (6543); use 5432" >&2; exit 1 ;; esac

q() { psql "$OWNER_URL" -X -v ON_ERROR_STOP=1 -At "$@"; }
step() { echo; echo "== $*"; }
expect_empty() { local out; out=$(q -c "$1"); if [ -n "$out" ]; then echo "FAIL: $2"; echo "$out"; exit 1; fi; echo "ok: $2"; }

step "1. version and pre-checks"
q -c "select version()"
q -c "select 'archie_system exists already: ' || exists (select 1 from pg_roles where rolname = 'archie_system')"
expect_empty "select c.relname from pg_class c join pg_attribute a on a.attrelid = c.oid and a.attname = 'company_id'
  where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
    and not exists (select 1 from pg_index i join pg_attribute x on x.attrelid = i.indrelid and x.attnum = i.indkey[0]
                     where i.indrelid = c.oid and x.attname = 'company_id')" \
  "every company table has an index starting with company_id (0008 builds none under its locks)"

step "2. pre-build indexes CONCURRENTLY, one statement at a time"
if q -c "select 1 from pg_class where relname = 'leads' and relnamespace = 'public'::regnamespace" | grep -q 1; then
  for stmt in \
    "CREATE INDEX CONCURRENTLY IF NOT EXISTS leads_company_external_id_idx ON leads (company_id, external_id)" \
    "CREATE INDEX CONCURRENTLY IF NOT EXISTS leads_company_created_at_idx ON leads (company_id, created_at)" \
    "CREATE INDEX CONCURRENTLY IF NOT EXISTS calls_company_started_at_idx ON calls (company_id, started_at)" \
    "CREATE INDEX CONCURRENTLY IF NOT EXISTS comm_messages_company_sent_at_idx ON comm_messages (company_id, sent_at)"; do
    echo "$stmt"
    psql "$OWNER_URL" -X -v ON_ERROR_STOP=1 -q -c "SET statement_timeout = 0" -c "$stmt"
  done
  expect_empty "select indexrelid::regclass from pg_index where not indisvalid" "no invalid indexes"
else
  echo "(no leads table yet: a fresh database; the migrations build them)"
fi

step "3. migrations as the owner"
DATABASE_URL="$OWNER_URL" npx tsx scripts/migrate.ts

step "4. post-checks"
q -c "select rolname, rolcanlogin, rolsuper, rolbypassrls, rolinherit from pg_roles where rolname like 'archie_%' order by 1"
expect_empty "select rolname from pg_roles where rolname in ('archie_app','archie_system') and (rolsuper or rolbypassrls)" "neither role is superuser or BYPASSRLS"
expect_empty "select 1 from pg_roles where rolname = 'archie_system' and rolcanlogin" "archie_system cannot log in"
expect_empty "select 1 where pg_has_role('archie_app', 'archie_system', 'USAGE')" "archie_app does not inherit archie_system"
expect_empty "select 1 where not pg_has_role('archie_app', 'archie_system', 'SET')" "archie_app may SET ROLE archie_system"
expect_empty "select 1 from pg_auth_members where member = 'archie_app'::regrole and admin_option" "no ADMIN option"
expect_empty "select count(*) from pg_policy where polname = 'company_system' and polroles <> array['archie_system'::regrole::oid] having count(*) > 0" "company_system is for archie_system only"
expect_empty "select tablename || '.' || policyname from pg_policies where schemaname = 'public' and policyname not in ('company_isolation','company_system','company_self_read')" "no other policies"
expect_empty "select relname from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and not relforcerowsecurity and relname not in ('session','_migrations')" "row level security forced on every other table"

step "5. as the app: the role inside and outside runAsSystem"
DATABASE_URL="$APP_URL" SESSION_SECRET=rehearsal npx tsx scripts/rehearse-role-check.ts

step "6. security tests as archie_app"
ARCHIE_REHEARSAL=1 DATABASE_URL="$APP_URL" ARCHIE_TEST_OWNER_URL="$OWNER_URL" SESSION_SECRET=rehearsal \
  npx vitest run server/tenant/__tests__/isolation.test.ts server/tenant/__tests__/system-role.test.ts

step "7. revert 0008, then forward again"
psql "$OWNER_URL" -X -v ON_ERROR_STOP=1 -q -1 -f scripts/sql/revert-0008-rls-system-role.sql
expect_empty "select 1 from pg_policies where policyname = 'company_system'" "reverted: no company_system policies"
psql "$OWNER_URL" -X -v ON_ERROR_STOP=1 -q -1 -f migrations/0008_rls_system_role.sql
expect_empty "select tablename from pg_policies where schemaname = 'public' and policyname = 'company_isolation' and qual like '%archie_is_system%'" "forward again: no OR policies"

echo
echo "Rehearsal passed."
