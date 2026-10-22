#!/usr/bin/env bash
# End-to-end run against a throwaway local Postgres. Never touches production.
# Prereqs: Homebrew postgresql@16 running locally, `npm run build` done.
#   scripts/e2e/run.sh            # build DB from the schema, seed, start server, run checks
set -euo pipefail
cd "$(dirname "$0")/../.."
export PATH="/opt/homebrew/opt/postgresql@16/bin:$PATH"
DB="${E2E_DB:-bra_e2e}"; PORT="${E2E_PORT:-3999}"; OUT="${E2E_OUT:-/tmp/e2e}"; mkdir -p "$OUT"
# Clear the last run's results first. A suite that dies before writing its own
# leaves the previous file sitting there, and the summary below reads it and
# reports yesterday's numbers as though they were today's — a passing run that
# means nothing, which is worse than a failing one.
rm -f "$OUT/results.json" "$OUT/signatures.json" "$OUT/shell-ui.json" "$OUT/meetings.json"
export DATABASE_URL="postgres://$USER@localhost:5432/$DB"
# Only one run at a time, and it never tramples another.
#
# Two runs at once corrupt each other in ways that look like product failures:
# the second frees the port by killing the first's server, the first's suites
# then get connection errors or answers from the wrong process, and the
# rate-limit buckets of a shared server produce a page of 429s. Both runs
# report nonsense. This has bitten repeatedly, including on a machine where a
# second Claude session is working in the same repo.
#
# So: take a lock. Not `pgrep -f run.sh` — that matches the shell that invoked
# this script, and every waiting loop with the name in its command line, so the
# script ends up refusing to start because of itself.
LOCK="$OUT/.run.lock"
if ! mkdir "$LOCK" 2>/dev/null; then
  OWNER="$(cat "$LOCK/pid" 2>/dev/null || echo '?')"
  if [ "$OWNER" != '?' ] && kill -0 "$OWNER" 2>/dev/null; then
    echo "Another e2e run is already in progress (pid $OWNER)." >&2
    echo "Wait for it to finish — two runs at once corrupt each other's results." >&2
    exit 1
  fi
  echo "clearing a lock left behind by a run that was killed"
  rm -rf "$LOCK"; mkdir "$LOCK"
fi
echo $$ > "$LOCK/pid"
trap 'rm -rf "$LOCK"' EXIT
if lsof -ti "tcp:$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "port $PORT is held by a process no run owns; freeing it"
  lsof -ti "tcp:$PORT" -sTCP:LISTEN | xargs kill -9 2>/dev/null || true
  sleep 1
fi
psql -h localhost -U "$USER" -d postgres -qc "drop database if exists $DB" -c "create database $DB"
npx tsx scripts/e2e/ddl.ts > "$OUT/schema.sql"
psql -h localhost -U "$USER" -d "$DB" -v ON_ERROR_STOP=0 -q -f "$OUT/schema.sql" 2>&1 | grep ERROR || true
SESSION_SECRET=e2e-secret node scripts/e2e/seed.mjs > "$OUT/cookies.json"
# The dev entrypoint (tsx + Vite dynamic import) does not start on Node 26; run the built server.
SESSION_SECRET=e2e-secret NODE_ENV=production APP_BASE_URL="http://127.0.0.1:4000" PORT="$PORT" \
  JOBTREAD_API_KEY= JOBTREAD_TOKEN= JOBTREAD_COMPANY_ID= GHL_AGENCY_API_KEY= GHL_LOCATION_API_KEY= GHL_PIT_TOKEN= GHL_LOCATION_ID= GHL_ACCESS_TOKEN= \
  GROQ_API_KEY= ANTHROPIC_API_KEY= GOOGLE_SA_KEY= GOOGLE_SA_EMAIL= CRON_SECRET=e2e-cron BRAIN_DRY_RUN=1 ENABLE_OUTREACH=false \
  COMMERCIAL_SCAN_ENDPOINT="http://127.0.0.1:${E2E_SCAN_PORT:-3998}/v1/chat/completions" \
  node dist/index.js > "$OUT/server.log" 2>&1 &
SERVER=$!
# Kill only our own server, and only if it is still ours: a stale trap from an
# earlier run once reaped a PID that had been reused by a later run's server.
trap 'if kill -0 $SERVER 2>/dev/null && ps -o command= -p $SERVER | grep -q "dist/index.js"; then kill $SERVER 2>/dev/null || true; fi; rm -rf "$LOCK"' EXIT
for i in $(seq 1 30); do curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:$PORT/api/auth/me" | grep -q 401 && break; sleep 2; done
# The checks below are only worth reading if they reach OUR server. An older
# process answering on this port has different code and spent rate limits.
if ! kill -0 $SERVER 2>/dev/null; then
  echo "the server exited before the checks started — see $OUT/server.log" >&2
  exit 1
fi
if [ "$(lsof -ti "tcp:$PORT" -sTCP:LISTEN | head -1)" != "$SERVER" ]; then
  echo "something other than this run's server is answering on $PORT — refusing to report its results" >&2
  exit 1
fi
E2E_BASE="http://127.0.0.1:$PORT" E2E_COOKIES="$OUT/cookies.json" E2E_OUT="$OUT/results.json" node scripts/e2e/api.mjs > "$OUT/run.log" 2>&1 || true

# The signature flow: its own fixtures, so it neither needs nor disturbs the above.
E2E_BASE="http://127.0.0.1:$PORT" E2E_COOKIES="$OUT/cookies.json" E2E_OUT="$OUT/signatures.json" node scripts/e2e/signatures.mjs >> "$OUT/run.log" 2>&1 || true

# Monday's meeting pack: the Sunday job, what each room may see, and the
# actions that carry forward.
E2E_BASE="http://127.0.0.1:$PORT" E2E_COOKIES="$OUT/cookies.json" E2E_OUT="$OUT/meetings.json" node scripts/e2e/meetings.mjs >> "$OUT/run.log" 2>&1 || true
# The document builders, which need no server.
npx tsx scripts/e2e/signatures-docs.ts >> "$OUT/run.log" 2>&1 && echo "signature documents: PASS" || echo "signature documents: FAIL (see $OUT/run.log)"
# Chrome, opt-in: the rep's panel and a customer signing on a phone.
if [ "${E2E_UI:-}" = "1" ]; then
  # A browser suite that cannot start must not pass in silence. `puppeteer-core`
  # sits in devDependencies precisely because it was once installed with
  # --no-save: the next `npm install` removed it, both suites stopped running,
  # and the summary still printed a clean API total.
  UI_FAILED=0

  # The signature flow in a real browser — the rep's panel and a customer signing.
  if ! E2E_BASE="http://127.0.0.1:$PORT" E2E_COOKIES="$OUT/cookies.json" node scripts/e2e/signatures-ui.mjs 2>&1 | tail -20; then
    echo "BROWSER SUITE DID NOT COMPLETE: signatures-ui — its checks are NOT in the totals above" >&2
    UI_FAILED=1
  fi

  # The frame around every feature: navigation, what each role can reach, and
  # whether it survives a 390px phone. No component tests exist in this repo,
  # so this is the only thing that can catch a shell change breaking the shell.
  if ! E2E_BASE="http://127.0.0.1:$PORT" E2E_COOKIES="$OUT/cookies.json" node scripts/e2e/shell-ui.mjs 2>&1 | tail -20; then
    echo "BROWSER SUITE DID NOT COMPLETE: shell-ui — its checks are NOT in the totals above" >&2
    UI_FAILED=1
  fi

  # A rep making commercial reports: the New report form, the Inspection with
  # the photo scan and pricing, the Proposal's pinned layer diagram under a real
  # scroll, the editor's Commercial tab, and every document on a phone.
  if ! E2E_BASE="http://127.0.0.1:$PORT" E2E_COOKIES="$OUT/cookies.json" node scripts/e2e/reports-ui.mjs 2>&1 | tail -20; then
    echo "BROWSER SUITE DID NOT COMPLETE: reports-ui — its checks are NOT in the totals above" >&2
    UI_FAILED=1
  fi

  if [ "$UI_FAILED" = "1" ]; then
    echo "INCOMPLETE — a browser suite failed to run; do not read this as a pass" >&2
  fi
fi

node -e "
const load = (f, name) => {
  try { return require(f); }
  catch { console.log('MISSING:', name, '— that suite did not finish; see $OUT/run.log'); return null; }
};
const app = load('$OUT/results.json', 'api.mjs');
const sig = load('$OUT/signatures.json', 'signatures.mjs');
const mtg = load('$OUT/meetings.json', 'meetings.mjs');
const shell = process.env.E2E_UI === '1' ? load('$OUT/shell-ui.json', 'shell-ui.mjs') : [];
const all = [...(app || []), ...(sig || []), ...(mtg || []), ...(shell || [])];
const p = all.filter((x) => x.ok).length;
console.log('PASS', p, 'FAIL', all.length - p, 'of', all.length);
all.filter((x) => !x.ok).forEach((x) => console.log('FAIL:', x.name, '::', x.evidence));
if (app === null || sig === null || shell === null) { console.log('INCOMPLETE — the run did not finish, do not read the totals above as a pass'); process.exit(1); }
"
