# Archie Platform

Archie is a field and office platform for home service companies (roofing, HVAC, plumbing, electrical and more).
It has its own look and feel and uses GoHighLevel (GHL) as a hidden backend for contacts, messaging, calendars,
pipelines, reviews and automations.

## Where this code came from

This repo started as a copy of the Best Roofing AI app's code (files only, no git history, no customer data,
no keys). The Best Roofing AI app and its repo are separate and are not changed by work here.

## Build plan

1. **Baseline import**: code copied over, data files, one-off scripts and keys left out. ✅
2. **Multi-company**: every table gets a `company_id`, enforced by row level security in the database. ✅ (docs/archie/01-multi-company.md)
3. **De-brand**: remove all Best Roofing Now names, facts and people; move them into per-company settings.
4. **Trade packs**: make inspections and reports work for any trade, with roofing as the first pack.
5. **New features**: project management, plus the full GHL-backed feature set (CRM, inbox, calendar,
   pipeline, reviews, AI agent, automations, forms, payments, reports).
6. **New look**: Archie's own design system.

## Not in this repo on purpose

- `ios/` and `android/` app shells (will be regenerated with Archie's own bundle IDs)
- Any `.env` file or real API keys (see `.env.example`)

## Running tests

    scripts/test-db.sh                       # once: local test database from the migrations
    eval "$(scripts/test-db.sh --env)"       # sets DATABASE_URL for the app role
    SESSION_SECRET=test npx vitest run
