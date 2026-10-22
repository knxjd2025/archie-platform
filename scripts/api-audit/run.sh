#!/usr/bin/env bash
# Sweep every registered API route against the throwaway e2e database.
# Prereqs: the same as scripts/e2e/run.sh (local Postgres + npm run build).
set -euo pipefail
cd "$(dirname "$0")/../.."
export PATH="/opt/homebrew/opt/postgresql@16/bin:$PATH"
DB="${E2E_DB:-bra_e2e}"; PORT="${E2E_PORT:-3999}"; OUT="${E2E_OUT:-/tmp/e2e}"; mkdir -p "$OUT"
export DATABASE_URL="postgres://$USER@localhost:5432/$DB"

psql -h localhost -U "$USER" -d postgres -qc "drop database if exists $DB" -c "create database $DB"
npx tsx scripts/e2e/ddl.ts > "$OUT/schema.sql"
psql -h localhost -U "$USER" -d "$DB" -v ON_ERROR_STOP=0 -q -f "$OUT/schema.sql" 2>&1 | grep ERROR || true
SESSION_SECRET=e2e-secret node scripts/e2e/seed.mjs > "$OUT/cookies.json"
npx tsx -e "import {collectRoutes} from './scripts/api-audit/manifest';console.log(JSON.stringify(collectRoutes()))" 2>/dev/null | tail -1 > "$OUT/routes.json"

SESSION_SECRET=e2e-secret NODE_ENV=production APP_BASE_URL="http://127.0.0.1:4000" PORT="$PORT" \
  JOBTREAD_API_KEY= JOBTREAD_TOKEN= JOBTREAD_COMPANY_ID= GHL_AGENCY_API_KEY= GHL_LOCATION_API_KEY= GHL_PIT_TOKEN= GHL_LOCATION_ID= GHL_ACCESS_TOKEN= \
  GROQ_API_KEY= ANTHROPIC_API_KEY= GOOGLE_SA_KEY= GOOGLE_SA_EMAIL= CRON_SECRET=e2e-cron BRAIN_DRY_RUN=1 ENABLE_OUTREACH=false \
  node dist/index.js > "$OUT/sweep-server.log" 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null || true' EXIT
for i in $(seq 1 30); do curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:$PORT/api/auth/me" | grep -q 401 && break; sleep 2; done

SWEEP_BASE="http://127.0.0.1:$PORT" SWEEP_COOKIES="$OUT/cookies.json" SWEEP_ROUTES="$OUT/routes.json" SWEEP_OUT="$OUT/sweep.json" \
  node scripts/api-audit/sweep.mjs
