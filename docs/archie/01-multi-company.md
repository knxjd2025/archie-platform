# Multi-company (tenancy) design

Archie serves many roofing companies from one app and one database. Each
company must only ever see its own data. This doc is the plan for that.

## The rule

Every row of company data carries a `company_id`. The database itself refuses to
show or change a row whose `company_id` is not the company the current request is
working for. Application code still filters, but the database is the backstop, so
a forgotten `where` clause cannot leak one company's customers to another.

## Pieces

### 1. `companies` table (global)

| column | notes |
|---|---|
| `id` | uuid, primary key |
| `slug` | short unique name, e.g. `acme-roofing` |
| `name` | display name |
| `trade` | `roofing` (Archie is for roofing companies; kept as a column for residential vs commercial focus later) |
| `status` | `trial`, `active`, `paused`, `cancelled` |
| `ghl_location_id` | the company's GHL sub-account (unique) |
| `branding` | jsonb: logo, colors, legal name, phone, website, license numbers |
| `settings` | jsonb: per-company options (warranty text, certifications, modules on/off) |
| `created_at` | |

### 2. `company_id` on every company table

Every table except the global ones below gets
`company_id uuid not null references companies(id)` with a default of
`current_setting('app.company_id')::uuid`. Because of that default, existing insert
code keeps working unchanged: the row is stamped with the company of the request.

Global tables (no `company_id`): `companies`, `session`, `_migrations`,
`company_integrations` (has its own `company_id` but is read by system code only).

### 3. Row Level Security (the backstop)

Two database roles, two policies per company table (migrations/0008):

```sql
alter table t enable row level security;
alter table t force row level security;
-- Everyone: the current company's rows only.
create policy company_isolation on t
  using (company_id = (select archie_current_company()))
  with check (company_id = (select archie_current_company()));
-- The system role only: every row.
create policy company_system on t to archie_system using (true) with check (true);
```

- `archie_current_company()` reads `current_setting('app.company_id', true)`.
  With no company set it is null, so every query sees **zero rows** and every
  insert **fails**. Missing context fails closed, never open.
- The app connects as `archie_app`: not a superuser, `NOBYPASSRLS`, so the
  policies apply to it. As itself it gets only `company_isolation`.
- Deliberate cross-company work (`runAsSystem`) switches its connection to the
  role `archie_system` (`set_config('role', 'archie_system', false)`, the same
  as `SET ROLE`). For that role the two policies combine to
  `company_id = ... OR true`, which Postgres folds to `true`.
- Migrations run as the owner.

**Why this shape (performance).** Postgres can only use an index on
`company_id` when the policy's company condition stands alone. The old policy,
`company_id = archie_current_company() OR archie_is_system()`, could not be
turned into an index condition, so a query with no other selective filter (and
almost no query filters by company itself) scanned every company's rows. Now
every query carries `company_id = $0` as an index condition. Wrapping the
function in `(select ...)` makes it an initplan, computed once per query
instead of once per row. Measured on 200 companies (1.7M rows), with
`scripts/rls-explain.sh`: the leads list went from a 156 ms sequential scan of
400,000 rows to a 0.7 ms index scan of the company's own rows.

Do not put an `OR` into a company policy (for example `OR archie_is_system()`):
it brings the full scans back. System access is the `company_system` policy.

**The two roles.**

| | `archie_app` | `archie_system` |
|---|---|---|
| logs in | yes (the app's `DATABASE_URL`) | no (`NOLOGIN`): only `SET ROLE` from `archie_app` |
| superuser, `BYPASSRLS`, `CREATEROLE`, `CREATEDB` | no | no |
| table grants | `SELECT, INSERT, UPDATE, DELETE` (not `_migrations`) | the same |
| rows | its company's (`company_isolation`) | every company's (`company_system`) |
| membership | in `archie_system` with `SET` only: no `INHERIT`, no `ADMIN` | in nothing |

This is not weaker than the old `app.system = 'on'` setting: before, any SQL
the app role could run could turn system access on with `set_config`; now it
takes `SET ROLE archie_system`, which needs the same (arbitrary SQL as the app
role) and grants exactly what `app.system` did. Neither role can grant itself
more: no `ADMIN` on any role, no `CREATEROLE`, and it owns no table, so it
cannot alter, disable or drop a policy. `app.system` no longer grants anything,
and `archie_is_system()` now reports the role. The tests check all of this.

**On a pooled connection** (`server/db.ts`): the role is set on every checkout
together with the company, in one statement (or confirmed unchanged), so it
never carries over; a connection leaving system work is reset to no role and no
company as it is released (and thrown away if the reset fails); and a
connection released in the middle of a transaction is thrown away, because a
later rollback would undo settings made inside it. The role comes only from
`runAsSystem`, never from anything in a request.

**A new company table** gets its protection with one call in its migration,
after `CREATE TABLE`:

```sql
SELECT archie_protect_company_table('my_new_table');
```

It turns row level security on and forces it, creates both policies, grants
both roles, and adds a `(company_id)` index when no index starts with
`company_id`. `isolation.test.ts` fails for any table with a `company_id` that
lacks exactly these two policies, and `system-role.test.ts` proves the
behaviour on every such table.

**Indexes.** Every company table has an index that starts with `company_id`.
For a hot query that also filters or sorts on another column, use a composite
index with `company_id` first, for example `(company_id, external_id)` (0007)
or `(company_id, created_at)` (0009, scanned backward for newest first).
Measure with `scripts/rls-explain.sh` before adding one. On a live database,
build large indexes with `CREATE INDEX CONCURRENTLY` by hand first; the
migration's `CREATE INDEX IF NOT EXISTS` then does nothing.

### 4. Request context

`server/tenant/context.ts` holds the current company in `AsyncLocalStorage`.

- `requireAuth` / `requireRole` put the signed-in member's `companyId` into context
  for the rest of the request.
- `runAsCompany(companyId, fn)` for background work for one company.
- `runAsSystem(reason, fn)` for the few places that must look across companies
  before they know which company they belong to (sign-in by email, a public share
  link token, a GHL webhook by location id, a cron fanning out to companies). Each
  use names a reason and is kept to the smallest lookup, then hands off to
  `runAsCompany`.

`server/db.ts` gives drizzle a pool wrapper. Every time a connection is checked out
it sets `app.company_id` and the role (`archie_system` inside `runAsSystem`,
otherwise back to `archie_app`) for the current context in one statement (or
clears both when there is none), so neither can leak from one request to the
next on a pooled connection. See "On a pooled connection" above.

### 5. Sessions and sign-in

- `team_members.company_id` ties each person to one company.
- Email stays unique across Archie for v1 (one person, one company). A person in
  more than one company is a later feature (a `memberships` table).
- `req.session.user` gains `companyId`. The roster re-check on each request also
  re-reads the company and ends the session if the company is paused or cancelled.

### 6. Unique keys

A value that only has to be unique inside a company becomes unique per company:
`unique (company_id, x)`. Random tokens (share links, signing links, handoff tokens)
stay globally unique. Upserts (`onConflictDoUpdate`) are updated to the new targets.

### 7. Integrations per company

`company_integrations (company_id, provider, credentials (encrypted), meta, updated_at)`
holds each company's GHL OAuth tokens (and later others). The GHL client is built
per request from the current company's row instead of from env vars.

### 8. Background jobs

Each cron runs its work once per live company, as that company, through
`runCompanyJob` (`server/tenant/fan-out.ts`), so one company's failure does not
stop the others and no job ever runs without a company. With hundreds of
companies and one 300s function, each job is also:

- **ordered**: companies tried least recently go first, then by id, so a run
  that is cut off rotates instead of starving the same companies;
- **bounded**: a cap per company, and no company starts that could not finish
  inside the invocation (270s budget);
- **resumable and idempotent**: `company_job_runs` (migration 0006) records the
  last period each company finished (its local date, or local hour for
  meetings); later runs in that period skip it, and work cut off part-way is
  picked up by the next run. The crons run often (vercel.json) so the list
  drains;
- **in the company's time zone**: the period comes from the company's own
  `settings.timeZone`. The rep check-in goes out in the company's 8 AM to noon
  window, once per rep per day (`rep_daily_reminders`);
- **parallel where safe**: a few companies at once for jobs that wait on other
  services (reminders, chat summaries); one at a time for database-heavy ones;
- **exclusive**: a run claims each company with one conditional
  `INSERT ... ON CONFLICT DO UPDATE ... RETURNING` on `company_job_runs`
  (a lease, migration 0010), so overlapping invocations (a manual run during
  the cron, a repeated delivery) never run the same company twice. The lease
  lasts `perCompanyMs` plus a margin; a crashed run's lease expires and a later
  run takes over. Success is recorded only while the run still holds its lease,
  so a run that timed out (its work cannot be stopped from outside; `signal` is
  aborted) never marks the period done. A job's `run` must honour `deadline`
  and `signal`, and be idempotent.

Seeding (advisors, knowledge base) is one of these jobs (`/api/cron/seed-companies`,
once per deployment per company) plus at company creation. It is never on the
request path.

### 9. Operator console

The people who run Archie (not anyone inside a roofing company) use the
Operator page and `/api/operator/*` (`server/operator/`).

- **Who:** emails in `ARCHIE_OPERATOR_EMAILS` (comma separated), signed in
  normally. Read on every request, so removing an email revokes access at
  once. Being a company admin never makes anyone an operator. Unset: nobody.
- **What:** list every company with its numbers, view one (team, connected
  apps by name, recent operator actions), create a company with its first
  admin (returns a 72-hour welcome link to hand over), pause, resume or cancel
  (pausing or cancelling ends every session of that company's people), and
  make a 1-hour reset link for a member.
- **Access:** reads of one company run as that company (`runAsCompany`, the
  id only ever from the URL); the company list, status changes and the audit
  log are `runAsSystem`, each with its own reason.
- **Audit:** every change appends to `operator_audit_log` (migration 0011):
  global, no `company_id`, RLS forced with one policy for `archie_system`;
  `archie_app` has no privileges on it (42501), `archie_system` only
  `SELECT, INSERT` (append-only). Links and tokens are never written to it.
- **Trials:** `companies.trial_ends_at`, set to `ARCHIE_TRIAL_DAYS` (default
  14) from creation for a trial. Enforced by billing once it is on (below).
- **Billing columns:** plan, seats and monthly total (what the team costs now,
  from `shared/billing/pricing.ts`), Stripe's subscription status, and a
  "No subscription" flag for every company without an active, trialing or
  past-due subscription (including grandfathered ones).

### 10. Billing (Stripe)

`server/billing/*`, prices in `shared/billing/pricing.ts` (the only place),
lock rules in `shared/billing/status.ts`. **Off** while `STRIPE_SECRET_KEY` is
unset: no gate, no Billing page, no Stripe calls.

- **Prices.** Billable seats are team members who are `active` and `canLogin`.
  1 seat: Solo $149. 2: Solo + 1 extra at $99 = $248. 3 or more: Team $299
  includes 3, + $49 each beyond 3. 0 seats bills as 1. Plan changes on its own
  at the 2/3 line. Four Stripe prices (`STRIPE_PRICE_SOLO_BASE`,
  `_SOLO_EXTRA`, `_TEAM_BASE`, `_TEAM_EXTRA`); `scripts/stripe-setup.ts --yes`
  finds or creates them by lookup key and prints the ids.
- **Data.** `company_billing` (migration 0012): one row per company, a normal
  company table (both policies). Stripe customer and subscription ids, plan,
  seats Stripe bills for, status, period end, cancel-at-period-end, the last
  seat-sync failure. Never card data. `stripe_events`: ids of webhook events
  already handled; global, `archie_app` has no access, `archie_system` may
  `SELECT, INSERT, DELETE`.
- **Checkout / portal.** `POST /api/billing/checkout` and `/portal` (admins).
  One Stripe customer per company, made with metadata `archie_company_id`
  (idempotency key per company). Inside the trial, the subscription's
  `trial_end` is the company's `trial_ends_at`, so nobody is charged early;
  Stripe only accepts a trial end 48 hours or more away, so a company adding a
  card in the last two days of its trial is charged at once.
- **Seat sync.** After the team change is saved (`POST /api/team`,
  `PATCH /api/team/:id` when sign-in turns on or off, the operator's first
  admin), `afterSeatChange` updates the subscription items with proration. It
  compares first (nothing to do: no call), uses an idempotency key derived
  from the change, waits at most 8 seconds, and never fails the team change. A
  failure is written to `company_billing.seat_sync_error`; the hourly cron
  `/api/cron/billing-seats` (`runCompanyJob`, companies with a subscription)
  fixes it.
- **Webhook.** `POST /api/webhooks/stripe`: raw body (the `/api/webhooks` raw
  parser runs before the JSON parser in `api/index.ts` and `server/index.ts`;
  a body that was already parsed is refused), Stripe-Signature checked with
  `STRIPE_WEBHOOK_SECRET` (5 minute tolerance), each event id handled once.
  The subscription is re-read from Stripe, and the company comes **only** from
  the `archie_company_id` metadata on the subscription and the customer, which
  must agree with each other and with the customer Archie stored. Nothing else
  in the payload (client_reference_id, emails, the event's own metadata) is
  used. A refused event is answered 200 and logged, so Stripe does not retry
  it; a failure releases the event id and answers 500, so Stripe does.
- **Company status, and the operator override.** The webhook writes
  `company_billing` and changes `companies.status` in exactly one case: a
  subscription that is `active` moves a company from `trial` to `active`
  (`UPDATE ... WHERE status = 'trial'`). It never touches a company the
  operator paused or cancelled, and never pauses or cancels anyone itself:
  being locked for billing is worked out from `company_billing`, not stored
  as a status. To keep a company running whatever Stripe says, the operator
  leaves it `active` with no trial end (grandfathered); to stop it, pause it.
- **Gate.** `billingGate` (one middleware on `/api`): a company is locked when
  its subscription is `unpaid`, `canceled` or `incomplete_expired`, or its
  trial has ended with no `active`, `trialing` or `past_due` subscription.
  `trial_ends_at` null with no subscription is not locked (grandfathered).
  Locked: 402 with a plain sentence on every API route except `/api/auth`,
  `/api/billing`, `/api/webhooks` and `/api/operator`. Admins see only the
  Billing page; everyone else a page asking them to tell their admin. Data is
  kept. `past_due` keeps access with a banner for admins; the trial banner
  starts 5 days before the end. A failed gate check lets the request through.
- **Companies Roof Lee made.** A company with `companies.roofli_company_id`
  set is billed by Roof Lee, not here (`billedByRoofLee` in
  `shared/billing/status.ts`, the one question everything below asks). It is
  never locked and never shown a banner, whatever its trial date or billing
  row says; its Billing page is the one sentence "Your plan is managed in Roof
  Lee."; checkout and the portal answer 409 with that sentence and call
  Stripe for nothing; the seat sync skips it (`managed`); a Stripe event
  naming it is refused. The Operator page shows "Billed by Roof Lee" in place
  of a plan and price. Roof Lee pauses or closes such a company itself
  (docs/archie/02-roof-lee-link.md).
- **Migration order.** `0011` and `0012` come before the Roof Lee link's
  (`0013` to `0019`). The full go-live list is at the top of
  docs/archie/02-roof-lee-link.md.

## Running it

- **Database URL.** Use the Supabase *session* pooler (port 5432) or a direct
  connection, as the `archie_app` role. The transaction pooler (6543) hands each
  statement to a different server connection, so the per-connection company
  setting would not stick; `server/db.ts` refuses to start on it.
- **Migrations** run as the database owner: `DATABASE_URL=<owner url> npx tsx scripts/migrate.ts`.
  Then give the app role a password: `ALTER ROLE archie_app WITH LOGIN PASSWORD '...'`.
  `archie_system` needs no password: it cannot log in. On Supabase the owner is
  `postgres`, which has what the migrations need (`CREATEROLE`, ownership of the
  tables); nothing needs a superuser.
- **Operator scripts** (`create-company.ts`, `seed-companies.ts`) use the app's
  `DATABASE_URL` (`archie_app`), like the app. Run with the owner's URL they
  stop at once and say which URL to use (as the owner, system work would be
  refused: the owner is not a member of `archie_system`).
- **Rolling out 0008, and rolling back.** See the section below.
- **A new company:** `npx tsx scripts/create-company.ts --slug acme --name "Acme Roofing" --admin-email owner@acme.com --admin-name "Pat Owner" [--ghl-location <id>]`.
  It is seeded (advisors, knowledge base) as it is created (`provisionCompany`).
- **Seeding is never on the request path.** A new server instance does no
  per-company work before answering. To backfill companies or push edited
  advisor wording to all of them: `npx tsx scripts/seed-companies.ts
  [--company <slug>]`. Idempotent; one company's failure does not stop the rest.

## Rolling out 0008 (system role), and rolling back

0008 changes how system work gets its access (a role instead of the
`app.system` setting). Code older than 0008 cannot do system work on a
database that has it: sign-in finds nobody, GHL webhooks find no company,
crons list no companies. Since there is no sound way to honour the old
setting without putting the `OR` back into every query's plan, 0008 makes it
fail loudly instead: older code gets the error "system work without the
archie_system role" (SQLSTATE 42501) with a hint naming the revert script.

The rules:

1. **Deploy the code first, then run the migration.** The current code works
   on both sides: before 0008 it falls back to `app.system` (and logs once
   that it is on the fallback), after it uses the role.
2. **Never run code older than 0008 against the database without reverting
   first.** That includes a Vercel Instant Rollback past the deployment that
   shipped 0008, a preview deployment, or a laptop on an old branch. Revert as
   the owner, in one transaction (idempotent, tens of milliseconds of locks):
   `psql "$OWNER_URL" -v ON_ERROR_STOP=1 -1 -f scripts/sql/revert-0008-rls-system-role.sql`.
   The current code keeps working on the reverted database (it sets the role
   and the old setting), so revert first, then roll back.
3. **To go forward again** after a revert, rerun the migration file the same
   way: `psql "$OWNER_URL" -v ON_ERROR_STOP=1 -1 -f migrations/0008_rls_system_role.sql`
   (`scripts/migrate.ts` will not, it is recorded as applied).

Before running 0008 on production, check that no company table lacks an
index starting with `company_id` (0008 would build one while holding its
locks). Expect no rows:

```sql
select c.relname from pg_class c
  join pg_attribute a on a.attrelid = c.oid and a.attname = 'company_id'
 where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
   and not exists (select 1 from pg_index i join pg_attribute x on x.attrelid = i.indrelid and x.attnum = i.indkey[0]
                    where i.indrelid = c.oid and x.attname = 'company_id');
```

Run 0008 at the quietest hour: it takes a short ACCESS EXCLUSIVE lock on
every company table, waiting at most 5s for each (`lock_timeout`); while it
waits, traffic on tables it already locked queues. If it fails on the
timeout, run it again.

### Rehearsal on a Supabase branch

Before production, rehearse on a Supabase branch (or a scratch project) on the
production Postgres version (17). Never on production itself: it writes test
rows and runs the revert.

```sh
OWNER_URL='postgresql://postgres.<ref>:<pw>@<host>:5432/postgres' \
APP_URL='postgresql://archie_app.<ref>:<pw>@<host>:5432/postgres' \
scripts/rehearse-supabase.sh --i-am-on-a-rehearsal-database
```

On a fresh branch the first run stops at step 5 because `archie_app` has no
password yet: set one as the owner (`ALTER ROLE archie_app WITH LOGIN
PASSWORD '...'`) and run it again. The steps:

1. version and read-only pre-checks (no company table lacks a company index);
2. the four `CREATE INDEX CONCURRENTLY` one at a time, then no invalid index;
3. the migrations as the owner (`postgres`: proves `CREATE ROLE` and
   `GRANT ... WITH INHERIT FALSE, SET TRUE` are allowed under Supabase);
4. roles, membership and policies are exactly as designed;
5. through the app's pool (`scripts/rehearse-role-check.ts`):
   `select current_user` is `archie_system` inside `runAsSystem` and
   `archie_app` outside (proves the session pooler keeps the role per
   connection), and no context sees no company;
6. the two security test files against it, as `archie_app`:
   `ARCHIE_REHEARSAL=1 DATABASE_URL="$APP_URL" ARCHIE_TEST_OWNER_URL="$OWNER_URL"
   npx vitest run server/tenant/__tests__/isolation.test.ts server/tenant/__tests__/system-role.test.ts`
   (they load one row per company into every company table as the owner, with
   every constraint in force, and need no superuser);
7. the revert script, then 0008 again.

It was run end to end locally on Postgres 16 with a non-superuser
`CREATEROLE` owner (the shape of Supabase's `postgres`); Postgres 17 and
Supabase's pooler are what the rehearsal is for.

## Capacity: database connections

Each Vercel instance has one pool (`server/db.ts`), shared with the session
store. On the Supabase session pooler every pooled client holds one Postgres
connection, and instances multiply under load, so the limit that matters is
roughly: busy instances x `DB_POOL_MAX` <= the pooler's pool size <= Postgres
`max_connections` (minus what Supabase reserves for itself).

App settings (env vars, defaults in brackets):

| var | default | what it does |
|---|---|---|
| `DB_POOL_MAX` | 5 | clients per instance |
| `DB_IDLE_TIMEOUT_MS` | 5000 | idle clients close, so a frozen instance holds none (with `attachDatabasePool`) |
| `DB_CONNECT_TIMEOUT_MS` | 5000 | a query waiting longer for a client fails with "Database busy" (503) |
| `DB_STATEMENT_TIMEOUT_MS` | 30000 | `statement_timeout` on every app connection |
| `DB_IDLE_IN_TXN_TIMEOUT_MS` | 60000 | `idle_in_transaction_session_timeout` on every app connection |

What the operator must check as the number of companies grows. These are
things to verify on the project's own dashboards, not known values:

- **Supabase pool size** (Database > Settings > Connection pooling). Compare it
  with the peak number of concurrent Vercel instances (Vercel > Observability)
  times `DB_POOL_MAX`. If "Database busy" errors or pooler "max clients" errors
  appear, raise the pool size before raising `DB_POOL_MAX`.
- **Compute size.** The pool size can only go as high as the compute's
  `max_connections` allows; a larger compute raises both. Check the current
  values for the plan in use.
- **Region.** Vercel functions should run in the same region as the database;
  every query is a round trip.
- Do **not** switch to the transaction pooler (port 6543): company isolation
  depends on per-connection settings, and `server/db.ts` refuses to start on it.

## Pitfalls

- `runAsCompany` / `runAsSystem` are async and await their result inside the
  context. A drizzle query only runs when awaited, so a query returned from the
  callback still runs as the company.
- Scheduled jobs and webhooks have no session. Use `runCompanyJob` (crons),
  `forEachLiveCompany` (operator scripts) or look the company up first
  (`getCompanyByGhlLocation`, `companyFromToken`).

## Tests

- `scripts/test-db.sh --env` builds a local test database from the migrations and
  prints a `DATABASE_URL` for `archie_app`, so tests run with RLS on, the same as
  production.
- `server/tenant/__tests__/isolation.test.ts`: every table is covered, rows stay
  in their company, writes into or out of another company are refused, no
  company sees nothing, pooled connections never leak a company.
- `server/tenant/__tests__/api-isolation.test.ts`: the same through the real
  request path (session, middleware, roster re-check, routes).
- `server/tenant/__tests__/system-role.test.ts`: on every company table (found
  in the database, not a list), with a row for two companies: no context sees
  and writes nothing, one company never sees or writes the other's, system work
  sees both; system access never survives on a pooled connection (after
  success, an error, a statement timeout, or a release mid-transaction); neither
  role can widen its access.
- `scripts/rls-explain.sh`: loads 200 companies of data into a throwaway
  database and prints `EXPLAIN (ANALYZE, BUFFERS)` for the hot queries as the
  app role. Rerun it before adding an index or changing a policy.
- Cross-company tests: create two companies, write data as A, prove B sees none of
  it through the API and through direct queries, and that writes without a company
  fail.

## Out of scope for this step

- Removing Best Roofing Now names and facts (step 3 in the README).
- Replacing JobTread as the source of jobs (Archie gets its own jobs, backed by GHL).
