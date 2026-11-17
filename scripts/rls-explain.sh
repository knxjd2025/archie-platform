#!/usr/bin/env bash
# Measure how row level security plans the app's hot queries at realistic
# volume. Builds a throwaway local database from the migrations (like
# scripts/test-db.sh), loads 200 companies of data as the owner, then runs
# EXPLAIN (ANALYZE, BUFFERS) as the app role (archie_app) in one company's
# context, and once as system work. Never point this at a real database.
#
#   PGUSER=root PGPASSWORD=root scripts/rls-explain.sh            # build, load, explain
#   PGUSER=root PGPASSWORD=root scripts/rls-explain.sh --no-build # explain only (reuse the data)
#
# Volume (per company x 200 companies): 2,000 leads, 5,000 messages,
# 1,500 calls, 15 team members. Override with RLS_BENCH_SCALE=0.1 for a quick run.
set -euo pipefail
cd "$(dirname "$0")/.."

DB="${RLS_BENCH_DB:-archie_rls_bench}"
HOST="${PGHOST:-localhost}"
OWNER_URL="postgres://${PGUSER:-$USER}${PGPASSWORD:+:$PGPASSWORD}@$HOST:5432"
APP_URL="postgres://archie_app:archie_app@$HOST:5432/$DB"
SCALE="${RLS_BENCH_SCALE:-1}"
COMPANIES=200

case "$OWNER_URL" in
  *localhost*|*127.0.0.1*) ;;
  *) echo "refusing: owner URL is not local" >&2; exit 1 ;;
esac

if [ "${1:-}" != "--no-build" ]; then
  ARCHIE_TEST_DB="$DB" ARCHIE_TEST_OWNER_URL="$OWNER_URL" ARCHIE_TEST_APP_PASSWORD=archie_app scripts/test-db.sh
  echo "loading data (scale $SCALE)..." >&2
  # The owner here is a local superuser, so row level security does not apply to the load.
  psql "$OWNER_URL/$DB" -v ON_ERROR_STOP=1 -q <<SQL
insert into companies (slug, name, status)
  select 'bench-' || g, 'Bench ' || g, 'active' from generate_series(1, $COMPANIES) g;
create temp table co as select id, row_number() over (order by slug) as n from companies;

insert into team_members (company_id, name, email, role, active)
  select co.id, 'Member ' || co.n || '-' || g, 'm' || co.n || '-' || g || '@bench.test',
         (case when g = 1 then 'admin' when g <= 3 then 'manager' else 'sales' end)::team_role,
         g % 7 <> 0
    from co, generate_series(1, greatest(1, (15 * $SCALE)::int)) g;

insert into leads (company_id, external_id, source, first_name, last_name, email, phone, city, stage, status, created_at, jt_sales_rep)
  select co.id, 'ext-' || co.n || '-' || g, 'ghl', 'First' || g, 'Last' || co.n, 'l' || g || '@c' || co.n || '.test',
         '+1555' || lpad((g % 10000000)::text, 7, '0'), 'City', case when g % 10 = 0 then 'Closed' else 'Open' end,
         'new', now() - (random() * interval '730 days'), 'Member ' || co.n || '-' || (g % 12 + 4)
    from co, generate_series(1, (2000 * $SCALE)::int) g;

insert into comm_messages (company_id, provider, channel, direction, from_addr, to_addr, lead_external_id, body, sent_at)
  select co.id, 'ghl', case when g % 3 = 0 then 'email' else 'sms' end, case when g % 2 = 0 then 'inbound' else 'outbound' end,
         '+15550000000', '+15551111111', 'ext-' || co.n || '-' || (g % (2000 * $SCALE)::int + 1), 'message body ' || g,
         now() - (random() * interval '365 days')
    from co, generate_series(1, (5000 * $SCALE)::int) g;

insert into calls (company_id, provider, direction, from_e164, to_e164, our_number, lead_external_id, status, outcome, started_at, duration_seconds)
  select co.id, 'ghl', case when g % 2 = 0 then 'inbound' else 'outbound' end, '+15550000000', '+15551111111',
         '+1555000' || (co.n % 1000), 'ext-' || co.n || '-' || (g % (2000 * $SCALE)::int + 1), 'completed',
         case when g % 3 = 0 then 'connected' else 'no_answer' end, now() - (random() * interval '365 days'), (random() * 600)::int
    from co, generate_series(1, (1500 * $SCALE)::int) g;
SQL
  psql "$OWNER_URL/$DB" -qc "vacuum analyze" >/dev/null
fi

CO=$(psql "$OWNER_URL/$DB" -Atc "select id from companies where slug = 'bench-100'")
EXT="ext-$(psql "$OWNER_URL/$DB" -Atc "select n from (select slug, row_number() over (order by slug) n from companies) s where slug = 'bench-100'")-777"

echo "== database: $DB, company bench-100 = $CO"
psql "$OWNER_URL/$DB" -Atc "select 'rows: leads ' || (select count(*) from leads) || ', comm_messages ' || (select count(*) from comm_messages) || ', calls ' || (select count(*) from calls) || ', team_members ' || (select count(*) from team_members)"
echo "== policy on leads:"
psql "$OWNER_URL/$DB" -Atc "select policyname || ' TO ' || array_to_string(roles, ',') || ' USING ' || coalesce(qual, '') from pg_policies where tablename = 'leads' order by policyname"

# Each query runs twice; the second (warm cache) plan is printed.
explain() {
  local title="$1" setup="$2" query="$3"
  echo
  echo "### $title"
  echo "$query"
  psql "$APP_URL" -X -q -v ON_ERROR_STOP=1 <<SQL | grep -v '^$' | sed -n '/QUERY PLAN/,$p' | tail -n +3
$setup
explain (analyze, buffers) $query;
\o /dev/null
\o
\echo '----'
SQL
}

COMPANY_SETUP="select set_config('app.company_id', '$CO', false) \\g /dev/null"
explain_twice() {
  # Warm the cache once, then print.
  psql "$APP_URL" -X -q -c "select set_config('app.company_id', '$CO', false)" -c "$2" >/dev/null 2>&1 || true
  explain "$1" "$COMPANY_SETUP" "$2"
}

explain_twice "Q1 leads list page (/api/leads: newest 250 open clients)" \
  "select * from leads where coalesce(stage, '') <> 'Closed' order by created_at desc limit 250"
explain_twice "Q2 leads count (/api/leads total)" \
  "select count(*) from leads where coalesce(stage, '') <> 'Closed'"
explain_twice "Q3 lead by external id (client page, webhooks)" \
  "select * from leads where external_id = '$EXT'"
explain_twice "Q4 calls for one client (/api/clients/:id/calls)" \
  "select id, started_at, outcome from calls where lead_external_id = '$EXT' order by started_at desc limit 200"
explain_twice "Q5 message summary, last 30 days (/api/comms/summary)" \
  "select channel, direction, count(*) from comm_messages where sent_at >= now() - interval '30 days' group by channel, direction"
explain_twice "Q6 newest 50 messages" \
  "select * from comm_messages order by sent_at desc limit 50"
explain_twice "Q7 newest 50 calls (/api/calls)" \
  "select * from calls order by started_at desc limit 50"
explain_twice "Q7b calls summary by number, last 30 days (/api/comms/summary)" \
  "select our_number, direction, count(*) from calls where started_at >= now() - interval '30 days' group by our_number, direction"
explain_twice "Q7c dashboard: 6 most recent leads" \
  "select id, first_name, last_name, created_at from leads order by created_at desc limit 6"
explain_twice "Q8 active team members (roster, reminders)" \
  "select id, name, email from team_members where active order by name"

# System work: sign-in looks a member up by email across companies. Under the
# role design this runs as archie_system; under the setting design, app.system.
if psql "$OWNER_URL/$DB" -Atc "select 1 from pg_roles where rolname = 'archie_system'" | grep -q 1; then
  SYS_SETUP="select set_config('role', 'archie_system', false) \\g /dev/null"
else
  SYS_SETUP="select set_config('app.system', 'on', false) \\g /dev/null"
fi
explain "S1 system: member by email (sign-in)" "$SYS_SETUP" \
  "select id, company_id from team_members where email = 'm100-3@bench.test'"
