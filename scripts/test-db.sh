#!/usr/bin/env bash
# Build a throwaway local test database the same way production is built:
# migrations run as the owner, the app connects as archie_app (row level
# security on). Never point this at a real database.
#
#   scripts/test-db.sh                 # (re)create archie_test
#   eval "$(scripts/test-db.sh --env)" # also print the env for the test run
set -euo pipefail
cd "$(dirname "$0")/.."

DB="${ARCHIE_TEST_DB:-archie_test}"
HOST="${PGHOST:-localhost}"
OWNER_URL="${ARCHIE_TEST_OWNER_URL:-postgres://${PGUSER:-$USER}${PGPASSWORD:+:$PGPASSWORD}@$HOST:5432}"
APP_PASSWORD="${ARCHIE_TEST_APP_PASSWORD:-archie_app}"

case "$OWNER_URL" in
  *localhost*|*127.0.0.1*) ;;
  *) echo "refusing: owner URL is not local" >&2; exit 1 ;;
esac

psql "$OWNER_URL/postgres" -qc "drop database if exists $DB" -c "create database $DB" >/dev/null
DATABASE_URL="$OWNER_URL/$DB" npx tsx scripts/migrate.ts >/dev/null
psql "$OWNER_URL/$DB" -qc "alter role archie_app with login password '$APP_PASSWORD'" >/dev/null

if [ "${1:-}" = "--env" ]; then
  echo "export DATABASE_URL=postgres://archie_app:$APP_PASSWORD@$HOST:5432/$DB"
  echo "export ARCHIE_TEST_OWNER_URL=$OWNER_URL/$DB"
fi
