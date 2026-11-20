# Archie Platform

Archie is a field and office platform for roofing companies.
It has its own look and feel and uses GoHighLevel (GHL) as a hidden backend for contacts, messaging, calendars,
pipelines, reviews and automations.

## Where this code came from

This repo started as a copy of the Best Roofing AI app's code (files only, no git history, no customer data,
no keys). The Best Roofing AI app and its repo are separate and are not changed by work here.

## Build plan

1. **Baseline import**: code copied over, data files, one-off scripts and keys left out. ✅
2. **Multi-company**: every table gets a `company_id`, enforced by row level security in the database. ✅ (docs/archie/01-multi-company.md)
3. **De-brand**: remove all Best Roofing Now names, facts and people; move them into per-company settings
   (shared/company.ts: name, logo, colors, contact, claims, time zone). ✅ BRN-only parts removed: the ops
   brain, the iMessage bridge, outreach and lead scraping, RoofLink sync and the Vapi voice agent (each
   company's AI voice agent is GHL Voice AI in its own sub-account). Monday meetings stay, per company.
4. **Roofing depth**: each roofing company's own price book, products, warranties and inspection settings.
5. **New features**: project management, plus the full GHL-backed feature set (CRM, inbox, calendar,
   pipeline, reviews, AI agent, automations, forms, payments, reports).
6. **New look**: Archie's own design system.

## The Roof Lee link

Roof Lee can make, update, pause and close companies in Archie through signed
requests under `/api/sister`, sign its members in to Archie with a one-time
ticket, and read and add leads for them. Archie tells Roof Lee about new leads
and finished jobs. All of it is off until `SISTERS_ARCHIE_SECRET` is set (and,
for the news, `ROOFLI_EVENTS_URL`). See docs/archie/02-roof-lee-link.md.

**Before this code is deployed, apply migrations `0011_operator_console.sql`
to `0019_crews.sql` to the database, as the owner** (the ordered list is at the
top of docs/archie/02-roof-lee-link.md). The code reads the columns `0011` and
`0013` add on every sign-in and the ones `0017` adds on every read of a lead,
link on or off, so deploying first breaks sign-in and every lead screen for
every existing company. All nine are safe to apply under the code that is live
today. `0011` and `0012` are the operator console and billing; `0013` to `0019`
are the Roof Lee link's. Nothing in the build or deploy runs migrations.

They come after `0006` to `0010`, which are already in the live database, and
they need `0008` (the system role) to be there: each new table is protected
with the function `0008` created. So this is the opposite order to `0008`
itself, which was "deploy the code first, then migrate"
(docs/archie/01-multi-company.md): for the link it is migrate first, then
deploy. The steps and checks are in docs/archie/02-roof-lee-link.md, "Before
deploying this code".

## Not in this repo on purpose

- `ios/` and `android/` app shells (will be regenerated with Archie's own bundle IDs)
- Any `.env` file or real API keys (see `.env.example`)

## Running tests

    scripts/test-db.sh                       # once: local test database from the migrations
    eval "$(scripts/test-db.sh --env)"       # sets DATABASE_URL for the app role
    SESSION_SECRET=test npx vitest run
