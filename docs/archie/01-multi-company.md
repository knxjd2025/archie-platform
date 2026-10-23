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

For each company table:

```sql
alter table t enable row level security;
alter table t force row level security;
create policy company_isolation on t
  using (company_id = archie_current_company() or archie_is_system())
  with check (company_id = archie_current_company() or archie_is_system());
```

- `archie_current_company()` reads `current_setting('app.company_id', true)`.
- `archie_is_system()` reads `current_setting('app.system', true) = 'on'`.
- With neither set, every query sees **zero rows** and every insert **fails**.
  Missing context fails closed, never open.
- The app connects as a dedicated role `archie_app` that is not a superuser and
  has `NOBYPASSRLS`, so the policies apply to it. Migrations run as the owner.

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
it runs `select set_config('app.company_id', $1, false), set_config('app.system', $2, false)`
for the current context (or clears both when there is none), so the setting can
never leak from one request to the next on a pooled connection.

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

Each cron runs `for each active company: runAsCompany(id, job)`, so one company's
failure does not stop the others and no job ever runs without a company.

## Running it

- **Database URL.** Use the Supabase *session* pooler (port 5432) or a direct
  connection, as the `archie_app` role. The transaction pooler (6543) hands each
  statement to a different server connection, so the per-connection company
  setting would not stick; `server/db.ts` refuses to start on it.
- **Migrations** run as the database owner: `DATABASE_URL=<owner url> npx tsx scripts/migrate.ts`.
  Then give the app role a password: `ALTER ROLE archie_app WITH LOGIN PASSWORD '...'`.
- **A new company:** `npx tsx scripts/create-company.ts --slug acme --name "Acme Roofing" --admin-email owner@acme.com --admin-name "Pat Owner" [--ghl-location <id>]`.

## Pitfalls

- `runAsCompany` / `runAsSystem` are async and await their result inside the
  context. A drizzle query only runs when awaited, so a query returned from the
  callback still runs as the company.
- Scheduled jobs and webhooks have no session. Use `forEachLiveCompany` (crons)
  or look the company up first (`getCompanyByGhlLocation`, `companyFromToken`).

## Tests

- `scripts/test-db.sh --env` builds a local test database from the migrations and
  prints a `DATABASE_URL` for `archie_app`, so tests run with RLS on, the same as
  production.
- `server/tenant/__tests__/isolation.test.ts`: every table is covered, rows stay
  in their company, writes into or out of another company are refused, no
  company sees nothing, pooled connections never leak a company.
- `server/tenant/__tests__/api-isolation.test.ts`: the same through the real
  request path (session, middleware, roster re-check, routes).
- Cross-company tests: create two companies, write data as A, prove B sees none of
  it through the API and through direct queries, and that writes without a company
  fail.

## Out of scope for this step

- Removing Best Roofing Now names and facts (step 3 in the README).
- Replacing JobTread as the source of jobs (Archie gets its own jobs, backed by GHL).
