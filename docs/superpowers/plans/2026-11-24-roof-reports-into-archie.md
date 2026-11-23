# Roof reports into Archie (merging the roof reports program) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Stages A and B are written to be executed as they stand. Stages C to F are coarser and are re-planned in detail before they start. Nothing in Stages A to D needs James to answer first; Stage E needs his company map and Stage F needs his go-ahead.

**Goal:** owner decision (James, 2026-11-24): "The roof reports project should be built into the new Archie so we don't need a separate program. For roof reports we are just going to merge it into Archie." When this plan is done, a roofing company makes, edits, presents, shares and emails roof reports inside Archie, under Archie's sign-in, company isolation and role rules, and the old program is no longer needed for reports. Nothing in the old program is deleted until James says so.

**Architecture:** the old program's report library (storm data, photo analysis, pricing, report assembly, the three ways a report is shown) moves almost unchanged into one sealed folder, `server/lib/roof-reports/`, beside Archie's own `server/lib/reports/` and never mixed with it. New Archie code around it (`server/roof-reports/`) gives it Archie's database (Drizzle, row level security), Archie's sign-in and roles, Archie's private photo store and a small cost record for every paid model call. The screens are rebuilt in Archie's own client (`client/src/pages/roof-reports.tsx`, `client/src/roof-reports/`), because the old screens are built on libraries Archie does not use. A one-time copy script brings existing reports and their photos across, dry run by default.

**Tech Stack:** unchanged for the server (Express 4, Drizzle over `pg`, Vitest, Vercel functions of at most 300 seconds). New dependencies: `@turf/area`, `@turf/boolean-point-in-polygon`, `@turf/helpers`, `@turf/length`, `@turf/simplify` (Stage A, measurement maths) and `@react-pdf/renderer` (Stage D, loaded only when someone downloads a PDF). Pin the versions the old program uses (`^7.3.3`, `^4.3.2`).

**Source:** `/home/user/roof-report-ai` (its `CLAUDE.md` describes the pipeline). **House style:** `/home/user/roofli/docs/superpowers/plans/2026-11-24-team-leader.md`. **Archie's rules:** `README.md`, `docs/archie/01-multi-company.md`, `docs/archie/02-roof-lee-link.md` (Archie has no `CLAUDE.md`).

**Out of scope:** the old program's other features (it is the whole old Archie CRM, not only reports: claims, proposals, quick reports, standalone storm reports, voice transcription, the hosted report worker); changing Archie's existing documents (Inspection, Estimate, Proposal, Presentation, Combined); any change to Roof Lee's contract.

---

## What the comparison found

### 1. What Archie already has (from code)

Archie already makes roof documents. It came from the same family of code, so much of the report library exists in a second, shorter, de-branded copy.

**Real and working:**

| Piece | Where | Notes |
|---|---|---|
| Report table | `client_reports` in `shared/schema.ts:457`, created in `migrations/0001_archie_baseline.sql:267` | One row per document on a job (`job_external_id` not null): status, rendered `html`, report `data` (JSON), `share_token`, title, presented-at, JobTread push fields, customer engagement. Company table with both policies. |
| Document types | `server/reports/generate-local.ts:31` | `inspection`, `estimate`, `proposal`, `presentation`, `combined`. Estimate, Proposal and Presentation are built from a stored Inspection without new photo analysis. |
| Routes | `server/reports/routes.ts` (1,367 lines) | `GET /api/clients/:externalId/reports`, `POST /api/clients/:externalId/reports/generate`, `GET /api/reports/:id` (poll), refine chat, estimate editing, editor, preview, draft save, photo editing, `present`, `DELETE` (a hard delete), JobTread push (`to-jobtread`), signing hand-off, `GET /r/:token` share page and `POST /r/:token/track`. Every job route checks `ownsLead`. Generation is rate limited (40 per 10 minutes) and runs inside the request. |
| The "report push" | `server/reports/to-jobtread.ts`, `server/reports/jobtread-sync.ts`, `server/integrations/jobtread.ts:669` | Sends a finished document's line items to JobTread as a proposal and remembers it so a second push updates, not duplicates. This is the "roof report push"; it is a JobTread feature, not a Roof Lee one. |
| Library | `server/lib/reports/` (56 files, about 15,700 lines, 40 test files) | Its own copies of `comprehensive-roof-report.ts` (454 lines; the old program's is 1,630), `storm-history-service.ts`, `swdi-api-service.ts`, `iem-api-service.ts`, `groq-vision.ts`, `roof-repair-pricing.ts`, `damage-knowledge-base.ts`, plus renderers the old program does not have: `render-inspection-html.ts`, `render-estimate-html.ts`, `render-proposal-html.ts`, `render-proposal-scrollcraft.ts`, `render-presentation-scrollcraft.ts`, the commercial set, `report-narrative.ts`. The shared files have diverged: between 295 and 1,650 changed lines each. |
| Scroll engine | `server/lib/reports/scrollcraft-engine.ts` | Base64-embedded. Decoded, it is **the same engine** the old program vendors (`lib/scrollcraft-engine.ts`): identical JavaScript and CSS once Windows line endings are removed. Checked during planning. |
| Measurements | `server/lib/reports/measurement-doc.ts`, `solar-measurements.ts` | Reads an ordered measurement report attached to the job (GAF, EagleView) or the Google Solar estimate. No satellite outline detection. |
| Screens | `client/src/components/RoofReports.tsx` (1,007 lines, on the job page `client/src/pages/client-detail.tsx:582`), `client/src/pages/report-editor.tsx` (965 lines), `client/src/components/ReportRefineChat.tsx` | Generate, list, edit, refine and present a job's documents. No company-wide report list, no wizard, no comparison. |
| Share links | `server/tenant/public-links.ts` | `companyFromToken` finds a token's company with one narrow system lookup and runs the request as that company. `/r/*` is already rewritten to the server in `vercel.json`. |
| Photos | `server/photos/store.ts`, `server/photos/native.ts`, `migrations/0018_job_photos.sql` | Private R2 store (`ARCHIE_PHOTOS_*`), JPEGs cleaned of every metadata block (`server/photos/jpeg-clean.ts`), keys under `c/<company_id>/p/`. |
| Email | `server/integrations/company-mail.ts` | `sendCompanyEmail` sends from the company (its Google Workspace or its KynexPro sub-account). |
| PDF | `server/lib/pdf/simple-pdf.ts` | A small hand-made PDF writer for one-page documents. Not a report PDF. |

**Stubs, dead code and traps:**

- `server/lib/reports/generate-inspection.ts:241` (`persistReport`, called at line 232) writes `INSERT INTO roof_reports (...)`. **No `roof_reports` table exists in Archie's migrations**, so every write fails and the error is swallowed and logged. If this plan creates a `roof_reports` table without removing that write first, those inserts would start landing in it, with the wrong columns. Task B1 removes it first.
- `server/lib/reports/r2-storage.ts` is not wired up (its own header says "NOT WIRED UP", zero callers) and is public by design. Its header forbids storing job photos through it.
- `clientReports.engagement` is captured but no screen reads it.
- Photo analysis is **off** unless `REPORT_IMAGE_ANALYSIS=on` (`generate-local.ts:67`). Its provider order is fal.ai (Qwen3-VL), then OpenRouter, then Groq, then Gemini (`server/lib/reports/groq-vision.ts:285` and following). Qwen is made outside the United States; see "Needs the owner".
- Model ids are spread across files (`server/lib/llm-json.ts:7`, `server/lib/reports/groq-vision.ts`, `commercial-photo-scan.ts:223`, `server/agents/base-agent.ts`). There is no one place for them.
- **No cost record.** Archie writes no ledger of model spend, and it does not send Roof Lee the `cost.incurred` event the contract calls required (`/home/user/roofli/docs/sisters/contract-v2.md:489`).
- **Roof Lee and reports:** none of Archie's Roof Lee routes (`server/sister/`) touch reports. The contract's Archie table (`contract-v2.md:551` to `560`) has capabilities, jobs, stage moves, leads, notes and one consented photo. The "report approval" is Roof Lee's own: approval kind `'report'` (`/home/user/roofli/packages/db/src/schema.ts:442`), which a sales manager may approve (`packages/core/src/permissions.ts`). No Roof Lee tool sends a report through Archie today; only a test tool does (`packages/connections/src/approvals.test.ts:163`).

### 2. What the roof reports program has that Archie lacks

| Feature | Old program | Archie today | Gap |
|---|---|---|---|
| Report kinds chosen per report | `reportTypes`: any of inspection, measurement, storm (`server/src/routes/roof-report.ts:820`) | Fixed document types per job | Missing: a storm-only report and a measurement-only report, and mixing them |
| Address-first reports | Address plus optional lead or job link | Every document must hang off a job | Missing |
| Storm data | SWDI (PLSR and NEXRAD hail) plus IEM, 3 or 10 year window, 5 miles, 10-level hail scale, NOAA event links, radar images, county links, narratives (`buildEnhancedStormData`) | Older, shorter copy of the same services; storm section in documents | Missing: enhanced storm data, hail scale levels, the newer fallback and dedupe logic |
| Photo analysis | Groq Llama 4 Scout, then Gemini 2.5 Flash, then Claude Haiku; batches of 3 with a 1 second pause; `enhanced-vision-analysis.ts` (measurements, components, age, weather pattern, claim-worthiness 0 to 100, repair or replace) | fal Qwen3-VL first; off by default; no enhanced analysis | Missing: enhanced analysis and a US-only provider chain |
| Claude narrative | `server/src/lib/claude-report-narrator.ts`: findings and an executive summary written like an inspector, non-fatal, in parallel | `report-narrative.ts` writes findings and a solution for Proposal and Presentation | Partly overlapping; the inspector-style findings and summary are missing |
| Photo labels | `server/src/lib/claude-image-labeler.ts`: labels placed on a 3 by 3 grid over each photo | None | Missing |
| Repair pricing | `roof-repair-pricing.ts` (991 lines), 1.65 material to labour | Older 655-line copy | Diverged |
| Replacement tiers | `roof-report-pricing.ts` `calculateReplacementTiers` by material, squares, pitch, region, manufacturer packages | Good/Better/Best from Archie's own product catalog | Different model; old one missing |
| Measurement section | Segments, edge lengths, material takeoff (`material-takeoff.ts`, `geometry-utils.ts`, `measurement-report-html.ts`) | Squares only, from a document or Solar | Missing |
| Satellite outline detection | `server/src/routes/roof-measurement.ts`: Google Static Maps image, Llama 4 Scout finds the outline, facets, pitch, roof type | None | Missing |
| Four templates | `report-templates.ts`: insurance, homeowner, full, quick; 20+ section switches, tone, photo cap, styles | None | Missing |
| Three visual styles | Classic document `roof-analysis-report-html.ts` (2,740 lines); presentation `scroll-presentation-report.ts` (numbered chapters, rail, clock, price late); flight `scroll-flight-report.ts` (stills only, inspection rail); chosen in one place, `render-report-html.ts`, with a stated reason when it falls back | Archie's own presentation and proposal scroll pages, built differently | Missing as built |
| Per-company chapters | `presentation-tenant-chapters.ts`: one pack (Best Roofing Now, 8 chapters), chosen by matching email domain, website or name; anchors walk back through dropped chapters | None | Missing, and the matching method is unsafe in Archie (see Decisions) |
| PDF | `lib/pdf-templates/RoofReportPDF.tsx` (3,262 lines) plus `shared.tsx` (1,992), made in the browser with `@react-pdf/renderer` | None | Missing |
| Chart pictures | `lib/chart-capture.ts`: 8 canvas charts placed into the PDF (all optional) | None | Missing |
| Wizard | `RoofReportWizard.tsx`: 6 steps, draft kept in the browser for 24 hours | Generate panel on a job | Missing |
| Editor | `ReportEditor.tsx`, `ReportSectionEditor.tsx`, `FindingCardEditor.tsx`, `PhotoLabelEditor.tsx` | `report-editor.tsx` for Archie's documents | Missing for these reports |
| List | `RoofReportList.tsx`: search and filter, company-wide | Per job only | Missing |
| Comparison | `RoofReportComparison.tsx`: two reports side by side | None | Missing |
| Email send | `POST /:id/send`, `SendReportEmailDialog.tsx`, sent count and time | Signing hand-off only | Missing |
| Share link | `share_token`, `GET /public/:shareToken` | `/r/:token` for Archie documents | Missing for these reports |
| Monthly limits | Free plan: 2 of each kind a month (`server/src/lib/report-usage.ts`) | Rate limit only; Archie has no free plan | Not carried (Decision 7) |
| Rewrites | `rewrite-finding`, `rewrite-summary`, `label-photo` routes | Refine chat on Archie documents | Missing for these reports |
| Archive | Soft delete (`status = archived`) | Hard delete | Missing |

### 3. How different the two foundations are

| | Old program | Archie | Effect on the work |
|---|---|---|---|
| Server | Express, `server/src/routes/*.ts`, long-running on Render | Express 4 bundled into one Vercel function, 300 seconds | Generation must finish inside 300 seconds: photos capped, batches kept, everything non-essential non-fatal |
| Database access | `pg` pool and `@vercel/postgres` tagged SQL, `api/db/migrate-*.ts` scripts run through an admin route | Drizzle over a pool wrapper that sets the company on every checkout (`server/db.ts`), plain numbered SQL migrations run by hand as the owner | Every route and query is rewritten |
| Tenancy | `company_id uuid` column, filtered by hand in each query; no row level security | `company_id` with default `archie_current_company()`, row level security enabled and forced, `archie_protect_company_table()`, `runAsCompany` and `runAsSystem(reason)` | New tables get the two policies; nothing filters by hand alone |
| Sign-in and roles | JWT (`req.user`), plan tiers `free/solo/team/enterprise/...` | Session (`requireAuth`, `requireRole`), roles `admin, sales_director, manager, customer_service, sales, production` with a scope axis (`shared/rbac.ts`); Roof Lee's six roles map in `server/sister/contract.ts` (`ROLE_MAP`) | Access is rewritten around `ownsLead`, `visibleIdsFor` and the crew rule |
| Storage | Public R2 bucket (`R2_*`, `R2_REPORTS_*`); photos and hosted HTML have public addresses | Private R2 store (`ARCHIE_PHOTOS_*`); nothing public; share pages served from the database | Photos move into the private store and are shown through the report's own link |
| Hosting | Vercel front end, Render back end and AI services, Render Postgres (`roofy-db-prod`) | Vercel only, Supabase Postgres 17 | The copy crosses two databases |
| Front end | React, Vite, shadcn-style `components/ui/*`, React Query, framer-motion, heroicons, Capacitor haptics | React, Vite, Tailwind, Archie's own components, page switching in `client/src/App.tsx`, no router | Screens are rebuilt, not moved |
| Tests | Vitest in `__tests__/*.test.ts`, Playwright against the live site | Vitest in `server/**/__tests__/`, database tests `*.db.test.ts` on a local database from `scripts/test-db.sh` | Moved tests change folder and imports; no test touches a live site |
| Model providers | Groq, Gemini, Anthropic; a self-hosted vLLM Pixtral on Render (not moved) | Anthropic, fal, OpenRouter, Groq, Gemini | Moved code keeps to Groq, Google and Anthropic |
| Where model ids live | Spread across files | Spread across files | Moved code gets one file, `server/lib/roof-reports/models.ts` |

**Can move as it is** (pure library, about 22,000 lines in 36 files, with about 5,100 lines of tests in 24 files): the storm services, photo analysis, the report data shape and assembly, both pricing modules and their tables, quality scoring, editor helpers, measurement maths, templates, the classic document, the measurement document, report motion, the two scroll styles and the style chooser, the narrative and label writers. Each needs only import paths changed and a few type-only imports from the old front end replaced.

**Must be rewritten:** every route (JWT, hand-filtered SQL, `@vercel/postgres`), the database layer (new migrations, Drizzle schema), access rules, photo upload and serving, email sending, the share page, all screens (about 9,500 lines in `components/roof-report/`), and the per-company chapter pack's storage and matching.

### 4. Data

- **The old table.** `roof_reports` in the old program's Render database, built up by `api/db/migrate-roof-reports.ts`, `migrate-roof-report-v2.ts`, `-v3.ts`, `migrate-roof-report-signing.ts`, `migrate-multi-tenant-reports.ts`, `migrate-quick-reports.ts`, `migrate-claim-profile-links.ts` and columns added at runtime by `server/src/routes/admin.ts:236` to `260` and `:473`. Columns: `id text`, `user_id`, `lead_id`, `job_id`, `project_id`, `company_id` (uuid), `claim_id`, address fields and `latitude`/`longitude`, JSON columns `storm_data`, `damage_data`, `estimate_data`, `roof_details`, `damage_counts`, `replacement_data`, `measurements`, `measurement_data`, `storm_enhanced_data`, `report_json` (holds the Claude findings, photo labels, executive summary and the hosted `publicUrl`), plus `edited_html`, `title`, customer name, email and phone, `inspector_notes`, `report_version`, `inspection_date`, `status`, `report_types text[]`, `share_token`, `email_sent_at`, `email_sent_count`, `total_estimate`, `storm_events_count`, `damage_severity`, `data_quality`, signing columns (`signable`, `signatures`, `signed_at`, `signed_html_url`, `esignature_document_id`), claim columns (`stage`, `deadline_at`, `denial_reason`, `strength_score`, `selected_tier`), timestamps.
- **Do existing reports need to come across?** Yes, if any company still opens them: a customer may hold a share link, and a rep may need last year's report. How many there are and whose they are was not checked (no hosted service was called while planning). Stage E is a one-time copy, **dry run by default**, that reads the old database read-only, copies only companies James maps to an Archie company, never deletes or changes anything at the source, and can be run again safely (`legacy_id`). The old `lead_id`/`job_id` point at the old CRM's records and cannot be mapped, so copied reports arrive as address-first reports with no job link.
- **Photos.** Old photos sit in the old program's public R2 bucket. They are **copied** into Archie's private store, cleaned of all metadata (location included) on the way, and the copied report's references are rewritten. The old bucket is untouched.
- **Signing and claim columns** are not carried in Stage E (Archie signs its own way, `server/signatures/`); they are kept in the copied row's `legacy_extra` JSON so nothing is lost.

### 5. How Roof Lee reaches reports afterwards

Nothing changes in the contract. Today no Archie endpoint for Roof Lee touches reports, and this plan adds none. Three rules keep the merge inside the contract:

- Reports are made, sent and archived only by a signed-in person in Archie. **Nothing about a report is sent to a customer by itself** (contract rule 7, and `messages.quiet`, `contract-v2.md:542`): no email on generation, no reminder, no follow-up. The person-sent email (Task D5) is not an automatic message, so `messages.quiet` is unaffected.
- A Roof Lee member reaches reports through Roof Lee's one-time sign-in into Archie, under the Archie role `ROLE_MAP` gives them: a salesperson as `sales` (own only), a sales manager and office as `customer_service` (every report, no admin), crew as `production` (no reports at all, because reports carry prices).
- Letting Roof Lee list or fetch a job's reports, or route report approval through Roof Lee, would be a change to Roof Lee's `contract-v2.md` first. It is listed under "Needs the owner", not planned.

---

## Decisions taken while planning

Each is the recommended answer to a question the request left open. What it costs if James decides otherwise is said with it.

1. **Roof reports arrive as their own family, beside Archie's documents, not folded into them.** New table `roof_reports`, new routes under `/api/roof-reports`, new library folder `server/lib/roof-reports/`. Archie's Inspection, Estimate, Proposal, Presentation and Combined documents, `client_reports` and `server/lib/reports/` are not changed (apart from removing the dead write in B1). Why: the two report data shapes have drifted far apart (454 against 1,630 lines in the shared type alone), and joining them would put every document Archie makes today at risk. *If wrong:* a later plan folds one family into the other; until then a job page shows both, under one "Reports" heading.
2. **The library is moved, not merged with Archie's copies.** Its own storm, analysis and pricing files come with it, even where Archie has an older copy. *If wrong:* a later clean-up keeps one copy of each; the module boundary test (A1) makes that a contained job.
3. **One scroll engine.** The moved renderers import Archie's existing engine (`server/lib/reports/scrollcraft-engine.ts`), which is the same engine. The old copy is not brought across. A permanent test fixes the engine's fingerprint so nobody edits it. *If wrong:* nothing to undo; the engine is shared either way.
4. **Per-company chapters become that company's own data, never code.** In the old program the Best Roofing Now pack is code, chosen by matching an email domain, website or company name. In Archie anyone can type a company name, so that matching would hand one company's promises to another. The pack becomes rows in a new table, `presentation_chapter_packs`, written only by an operator script as the system role for one named Archie company id, readable by the app role and so only by that company (row level security). No Best Roofing Now wording, name, domain or fact enters Archie's code, seeds or tests (Archie's de-brand rule, README step 3). The pack's fact checks (no general contractor claim, CertainTeed only, the warranty stated as 50 year product plus 15 year workmanship backed by CertainTeed, never "50/50") travel inside the pack as its own `mustSay` and `mustNotSay` lists, and the loader refuses a pack that breaks them. A company with no pack gets the base presentation, which promises nothing. *If wrong:* the pack becomes a code file keyed by one company id, a small change; the table and loader would then go.
5. **Photos are private.** Report photos go into Archie's private photo store under `c/<company_id>/rr/<report_id>/`, cleaned of all metadata. A homeowner sees them only through the report's share link, which checks the photo belongs to that report. Photos are sent to analysis as image data, never as a public address. *If wrong:* a public bucket would need James's say-so and would break Archie's rule in `server/lib/reports/r2-storage.ts`.
6. **US model providers only, in one file.** Moved code calls Groq (Llama 4 Scout, Llama 4 Maverick), Google (Gemini 2.5 Flash) and Anthropic only, with every model id in `server/lib/roof-reports/models.ts`. The deprecated Llama 3.2 vision ids are dropped. The narrative uses `claude-sonnet-5` (Archie's own default for text, `server/lib/llm-json.ts:7`) and labels use `claude-haiku-4-5`. *If wrong:* one line each in `models.ts`.
7. **No monthly report limits.** The old free plan's "2 a month" caps are not carried: Archie has no free plan and its billing gate already locks a lapsed company. A per-person rate limit stays (40 generations in 10 minutes, as Archie's documents). *If wrong:* one table and one check in the generate route.
8. **A small cost record, `model_costs`, written by every paid call in the moved pipeline** (Groq, Gemini, Anthropic, Google Static Maps), with the company, operation, provider, model, tokens and cents. NOAA and IEM are free and not recorded. Archie has no ledger today, so this is new; sending these costs to Roof Lee as `cost.incurred` is a separate decision (Needs the owner). *If wrong:* one table to drop, and the wrapper becomes a pass-through.
9. **Crew never see a roof report.** Reports carry prices, and Archie's permanent crew walk (`server/crews/__tests__/crew-money-walk.db.test.ts`) refuses any route that hands a crew money. Every roof report route answers 404 to the `production` role. *If wrong:* a crew view would be a separate, price-free route, walked by the same test.
10. **Who sees what.** Roles whose scope is `all` (`admin`, `sales_director`, `customer_service`, so also Roof Lee's owner, admin, office and sales manager) see every report in the company. A sales leader (`manager`) and a sales rep (`sales`, Roof Lee's salesperson) see a report only when they own its job (`ownsLead`) or, for a report with no job, when its maker is among the people they may see (`visibleIdsFor`). Anything else is 404, the same as a report that is not there. *If wrong:* the one function `visibleRoofReportWhere` changes.
11. **Archive, never delete.** "Delete" in the screens sets `status = 'archived'`; the row, its photos and its share token stay, and the share link stops working. *If wrong:* a hard delete is one route, but then the copy's "never deletes" promise has an exception.
12. **Off until switched on.** `ARCHIE_ROOF_REPORTS=on` turns the feature on; without it every roof report route answers 404 and the menu hides the page. So each stage can ship without changing what any company sees. *If wrong:* the default flips in one function.
13. **The PDF is made in the browser,** as in the old program, from a lazily loaded chunk, so the server bundle does not grow and the chart pictures (browser canvas) keep working. The email carries the share link, not a PDF. *If wrong:* a server-side PDF needs the charts redrawn without a canvas.
14. **No pipeline side effects.** Making a roof report does not move a sale or claim stage (Archie's `onReportGenerated` is not called) and logs no KPI. *If wrong:* one call after a successful generation.
15. **Copied reports keep their old share tokens,** so Stage F can send old links to the same report in Archie. Tokens are random and checked unique on the way in.

## Needs the owner

Plain sentences for James.

1. Which companies still use roof reports in the old program, and which Archie company each one is. The copy only moves reports for companies you name.
2. Will Best Roofing Now be a company inside Archie? If so, may its own approved presentation chapters be stored as that company's data in Archie, loaded once by us from the old program, for that one company only?
3. The old program's photo storage: whose account is it, and may we read from it once to copy photos? We will not delete anything there.
4. The old program is the whole old Archie, not only reports. This plan retires only its reports. What happens to the rest is a separate decision.
5. Archie already makes its own inspection documents on a job. After this, a job will show both kinds. Do you want to keep both, or later pick one?
6. Archie's existing photo checks (switched off today) would use a model made outside the United States when switched on. The new roof reports do not. Should Archie's existing path be changed to US-only too?
7. Archie does not tell Roof Lee what it spends on AI for a company. This plan records it. Should Archie start sending those costs to Roof Lee?
8. For a company Roof Lee set up, may a person in Archie email a report to the customer straight from Archie, or should report emails wait for an approval in Roof Lee?
9. Should Roof Lee be able to see a job's roof reports? That would be a change to the Roof Lee and Archie agreement first.
10. When to switch roof reports on in Archie, and when to stop new reports in the old program.

## Global Constraints

They bind every task.

- **Company isolation** (`docs/archie/01-multi-company.md`). Every new company table has `company_id uuid not null default archie_current_company() references companies(id)` and is protected in its migration with `SELECT archie_protect_company_table('<table>');`. Never put an `OR` into a company policy. Cross-company work only through `runAsSystem('<reason>', fn)`, kept to the smallest lookup, then `runAsCompany`. A request naming another company's record answers 404. `server/tenant/__tests__/isolation.test.ts` and `system-role.test.ts` find new tables by themselves and must pass.
- **Roles.** Archie holds `admin, sales_director, manager, customer_service, sales, production` (`shared/rbac.ts`). Roof Lee's six roles (`owner, admin, office, crew, sales_manager, salesperson`) arrive through `ROLE_MAP` (`server/sister/contract.ts`) and are never trusted from a request. A salesperson sees only their own. Crew see no report (Decision 9). The crew money walk is permanent: never delete, skip or weaken it.
- **Off switch.** Every route under `/api/roof-reports` and `/r/roof/` answers 404 unless `ARCHIE_ROOF_REPORTS=on`.
- **Models.** US providers only (Groq, Google, Anthropic). Model ids only in `server/lib/roof-reports/models.ts`. Every paid call goes through `meteredModelCall` and writes one `model_costs` row. Every test stubs `fetch`; a test that reaches the network fails.
- **Photos and location.** Job and inspection photos are the uploaded originals: no code path generates or alters one beyond resize, crop, caption overlay and the company's mark. Stored copies are cleaned (`server/photos/jpeg-clean.ts`). Nothing is public; photos leave the store only through a signed-in route or the report's own share link.
- **The scroll engine is vendored and never edited.** Theme it with CSS custom properties, drive it with `data-sc-*`.
- **The flight is stills only.** There is no ffmpeg on Vercel or Render. Never add `<video>` to a flight.
- **No Best Roofing Now values** in Archie's code, seeds, fixtures or tests: no name, domain, phone, staff name, warranty wording or manufacturer choice as a default. Fixtures use the fictional "Summit Ridge Roofing" in "Cedar Falls" and the customer "Dana Whitfield", `dana@example.com`, "12 Elm Street".
- **Words on screen and in email.** Plain English. No error codes, ids, stack traces or internal names reach a screen; failures go through `sendFailure` / `sendUpstreamFailure`. No em dashes (U+2014) in any new string, comment or doc; moved customer-facing copy loses its em dashes in Task D1. Product names follow `server/__tests__/product-names.test.ts` ("Current CRM", "KynexPro").
- **Never log a customer's name, phone, email or address, a share token or a photo key,** and never put a provider error's text on a screen.
- **Migrations** are plain numbered SQL in `migrations/`, never edited once applied, applied by hand as the owner before the code that reads them is deployed. Nothing in build or deploy runs them.
- **Generation fits in 300 seconds:** at most 40 photos analysed (Archie's `ANALYZE_LIMIT`), batches of 3, narrative and labels non-fatal and time-boxed.
- **Git:** branch `claude/practical-goldberg-r4su9a` in each repo; commit after every task; push only to that branch and only when told. The old repo is changed only in Stage F, and only after James says so.

## Commands

```bash
cd /home/user/knxjd2025/archie-platform
scripts/test-db.sh                         # once: local test database built from the migrations
eval "$(scripts/test-db.sh --env)"         # DATABASE_URL for the app role
SESSION_SECRET=test npx vitest run server/lib/roof-reports   # one folder while iterating
SESSION_SECRET=test npx vitest run         # everything
npm run check                              # TypeScript, no emit
```

Every task: write the failing test, run it and see it fail for the right reason, implement, run `npm run check` and the full `npx vitest run`, read the output, commit. The baseline (`npm run check` and the full suite on the branch before Task A1) is recorded in the first commit message, so a failure that was already there is not blamed on this work.

## Permanent tests this plan adds or relies on

| Test | What it holds | Touched in |
|---|---|---|
| `server/crews/__tests__/crew-money-walk.db.test.ts` (existing, PERMANENT) | every read route refuses crew or hands no money | Walks the new routes by itself. Run in B7, C6, D4. |
| `server/tenant/__tests__/isolation.test.ts`, `system-role.test.ts` (existing) | every company table has exactly the two policies | Find the new tables by themselves. Run in B2, B3, D2. |
| `server/lib/roof-reports/__tests__/module-boundary.test.ts` (new, PERMANENT) | the moved library imports nothing from Archie except the engine; model ids only in `models.ts`; no Best Roofing Now value anywhere in the folder | A1, then every Stage A task |
| `server/lib/roof-reports/__tests__/engine-unchanged.test.ts` (new, PERMANENT) | the engine's fingerprint | A6 |
| `server/roof-reports/__tests__/roof-report-roles.db.test.ts` (new, PERMANENT) | for each Archie role and each Roof Lee role through `ROLE_MAP`: which reports it sees, may make, edit, send and archive | B4, extended in B7, C5, D5 |
| `server/roof-reports/__tests__/packs-are-company-data.test.ts` (new, PERMANENT) | a pack is only ever read for the current company; no pack text in code | D2 |

## File Structure (additions)

```
archie-platform/
  migrations/0020_roof_reports.sql            roof_reports, roof_report_photos
  migrations/0021_model_costs.sql             one row per paid model call
  migrations/0022_presentation_packs.sql      per-company chapter packs (Stage D)
  shared/schema.ts                            (modified) Drizzle tables for the above
  shared/roof-reports.ts                      labels, kinds, templates, styles, plain sentences
  server/lib/roof-reports/                    the moved library (Stage A)
    models.ts  old-types.ts  platform.ts  fonts.ts
    escape-html.ts  url-safety.ts  safe-url.ts  safe-fetch.ts  safe-download.ts
    fetch-with-retry.ts  prompt-sanitize.ts
    storm-history-service.ts  swdi-api-service.ts  iem-api-service.ts
    groq-vision.ts  groq-chat.ts  enhanced-vision-analysis.ts  damage-knowledge-base.ts
    comprehensive-roof-report.ts  roof-repair-pricing.ts  roof-report-pricing.ts
    default-pricing.ts  regional-pricing.ts  manufacturer-shingle-packages.ts
    report-quality-scoring.ts  report-editor-utils.ts  geometry-utils.ts  material-takeoff.ts
    report-templates.ts  report-sections.ts  report-motion.ts  company-header-html.ts
    roof-analysis-report-html.ts  measurement-report-html.ts
    scroll-presentation-report.ts  scroll-flight-report.ts  render-report-html.ts
    presentation-chapters.ts                  (was presentation-tenant-chapters.ts, no pack inside)
    claude-report-narrator.ts  claude-image-labeler.ts
    __tests__/ (24 moved test files, fixtures/report.ts, module-boundary, engine-unchanged)
  server/roof-reports/                        Archie's side (Stage B onward)
    switch.ts  access.ts  metered.ts  photos.ts  brand.ts  generate.ts  store.ts  routes.ts
    public.ts  send.ts  packs.ts  rewrite.ts
    __tests__/
  server/photos/store.ts                      (modified) report photo keys
  server/routes.ts                            (modified) register the routes
  client/src/pages/roof-reports.tsx           list, wizard and editor host
  client/src/roof-reports/                    wizard steps, editor, comparison, pdf/ (Stage C, D)
  shared/menu.ts                              (modified) the Roof reports page
  scripts/load-presentation-pack.ts           operator: one pack for one company (Stage D)
  scripts/copy-old-roof-reports.ts            one-time copy, dry run by default (Stage E)
  docs/archie/03-roof-reports.md              how it works, switches, migration order
```

---

## Stage A: move the pure library and its tests

Leaves Archie working: nothing calls the folder yet, so behaviour is unchanged. About 36 files moved (about 22,000 lines), 4 new small files, 24 test files moved plus 2 new, 7 tasks.

Rules for every Stage A task: copy the file from `/home/user/roof-report-ai/lib/` (or `server/src/lib/`) to `server/lib/roof-reports/`, change only import paths, the few type-only imports named below and model ids (to `models.ts`); move its test from `/home/user/roof-report-ai/__tests__/` to `server/lib/roof-reports/__tests__/`, changing only imports and any Best Roofing Now value in a fixture (to the fictional ones). A test that fails after the move is fixed in the moved code only if the failure is an import or path; anything else is written down in the commit message and asked about, not "fixed" by changing the assertion.

### Task A1: The folder, its boundary test, models and the safety helpers

**Files:**
- Create: `server/lib/roof-reports/models.ts`, `old-types.ts`, `platform.ts`, `fonts.ts`
- Move: `escape-html.ts`, `url-safety.ts`, `safe-url.ts`, `safe-fetch.ts`, `fetch-with-retry.ts` (the old program's version, not Archie's), `prompt-sanitize.ts`
- Move tests: `escape-html.test.ts`, `safe-url.test.ts`, `prompt-sanitize.test.ts`
- Create test: `server/lib/roof-reports/__tests__/module-boundary.test.ts` (PERMANENT)

**Interfaces:**
- `models.ts`:
  ```ts
  export type ModelProvider = 'groq' | 'google' | 'anthropic';
  export const US_MODEL_PROVIDERS: readonly ModelProvider[] = ['groq', 'google', 'anthropic'];
  export const ROOF_REPORT_MODELS = {
    vision: { provider: 'groq', id: 'meta-llama/llama-4-scout-17b-16e-instruct' },
    visionAlternative: { provider: 'groq', id: 'meta-llama/llama-4-maverick-17b-128e-instruct' },
    visionFallback: { provider: 'google', id: 'gemini-2.5-flash' },
    visionLastResort: { provider: 'anthropic', id: 'claude-haiku-4-5' },
    narrative: { provider: 'anthropic', id: 'claude-sonnet-5' },
    labels: { provider: 'anthropic', id: 'claude-haiku-4-5' },
    measurement: { provider: 'groq', id: 'meta-llama/llama-4-scout-17b-16e-instruct' },
  } as const satisfies Record<string, { provider: ModelProvider; id: string }>;
  export type ModelRole = keyof typeof ROOF_REPORT_MODELS;
  /** Cents per million tokens, input and output. The only prices in the folder. */
  export const MODEL_PRICES_CENTS_PER_MTOK: Record<string, { input: number; output: number }>;
  ```
  Prices are filled from each provider's published price list at the time of the task and dated in a comment; an id with no price records 0 cents and `priced: false` (Task B3).
- `old-types.ts`: the type-only shapes the moved files took from the old front end: `RoofAnalysisRecord`, `CompanyProfile`, `SystemPackage`, `ProductItem` (from old `lib/api-client.ts`) and `EstimateTierData` (from old `lib/pdf-templates/EstimatePDF.tsx`), copied as types only, nothing else.
- `platform.ts`: `export const PLATFORM_NAME = 'Archie';` (replaces old `lib/branding.ts`).
- `fonts.ts`: `getGoogleFontUrl`, `getCssFontFamily`, copied from old `lib/pdf-templates/shared.tsx` with nothing else from that file.
- `module-boundary.test.ts` reads every `.ts` file under `server/lib/roof-reports/` (tests excluded unless said) and asserts: (a) every import is relative inside the folder, a Node built-in, one of `@turf/*`, or exactly `../reports/scrollcraft-engine.js`; (b) no file but `models.ts` contains a string matching `/(claude|gemini|llama|qwen|gpt|mistral|deepseek)[-\w.]*/i` inside quotes; (c) no file, tests and fixtures included, contains `bestroofingnow`, `bestroofersnow`, `best roofing now` (any case), `Bailey`, or a phone number of the form `\(?\d{3}\)?[-. ]\d{3}[-. ]\d{4}` other than `319-555-01xx`; (d) `US_MODEL_PROVIDERS` holds exactly `groq`, `google`, `anthropic` and every entry of `ROOF_REPORT_MODELS` uses one of them. Header: "PERMANENT. Never delete, skip or weaken this file."

- [ ] **Step 1:** Write `module-boundary.test.ts` and the three moved tests. Run them; they fail (folder missing).
- [ ] **Step 2:** Create the folder, the four new files and the six moved helpers. Run; pass. Run `npm run check` and the full suite; record the baseline in the commit message.
- [ ] **Step 3:** Commit `feat(roof-reports): the library's home, its boundary test and safety helpers (A1)`.

### Task A2: Storm data

**Files:**
- Move: `storm-history-service.ts`, `swdi-api-service.ts`, `iem-api-service.ts`
- Move tests: `storm-history-service.test.ts`, `swdi-api-service.test.ts`, `iem-api-service.test.ts` (the last is stored with non-text bytes in the old repo; copy it byte for byte)

**Interfaces (unchanged from the old program):** `generateStormReport(address, city, state, zip, options)`, `buildEnhancedStormData(...)`, `fetchSWDIStormEvents`, `deduplicateEvents`, `fetchIEMLSREvents`, the 10-level hail scale and its `damageRating` and `haagRef`.

- [ ] **Step 1:** Move the tests. Add, at the top of each, `vi.stubGlobal('fetch', vi.fn(() => { throw new Error('no network in tests'); }))` unless the test already stubs `fetch` itself. Run; fail (modules missing).
- [ ] **Step 2:** Move the three files. Pass. The comment naming a city in `storm-history-service.ts` (an example density figure) is changed to a fictional town if the boundary test flags it; otherwise left. Commit `feat(roof-reports): storm data from NOAA SWDI and IEM (A2)`.

### Task A3: Photo analysis

**Files:**
- Move: `groq-vision.ts`, `enhanced-vision-analysis.ts`, `damage-knowledge-base.ts` (the old program's versions)
- Create: `groq-chat.ts` (only `groqChat` and the model list `enhanced-vision-analysis.ts` takes from the old `lib/groq-ai-assistant.ts`, 481 lines; nothing else from that file)
- Move tests: `groq-vision.test.ts`, `enhanced-vision-analysis.test.ts`

**Interfaces:** `analyzeRoofImage(url, apiKey, options)`, `analyzeRoofImageWithFallback(url, groqKey, geminiKey, options, anthropicKey)`, `analyzeMultipleImages`, `combineAnalysisResults`, `RoofAnalysisResult`, and the enhanced analysis entry points, unchanged in shape. Every model id is read from `ROOF_REPORT_MODELS`; the two Llama 3.2 ids are removed. The rule "fall back unless `result.success && result.data.length > 0`" is kept.

- [ ] **Step 1:** Move the tests, with `fetch` stubbed. Add one case to `groq-vision.test.ts`: with Groq answering an error, Gemini answering an error and no Anthropic key, the result is `success: false` and no other host was called (the stub records every URL; only `api.groq.com` and `generativelanguage.googleapis.com` appear). Run; fail.
- [ ] **Step 2:** Move and adapt. Pass. Commit `feat(roof-reports): photo analysis on US providers only (A3)`.

### Task A4: The report's data, pricing and measurement maths

**Files:**
- Move: `comprehensive-roof-report.ts`, `roof-repair-pricing.ts`, `roof-report-pricing.ts`, `default-pricing.ts`, `regional-pricing.ts`, `manufacturer-shingle-packages.ts`, `report-quality-scoring.ts`, `report-editor-utils.ts`, `geometry-utils.ts`, `material-takeoff.ts`
- Modify: `package.json` (the five `@turf/*` packages at `^7.3.3`)
- Move tests: `comprehensive-roof-report.test.ts`, `roof-repair-pricing.test.ts`, `roof-report-pricing.test.ts`, `report-quality-scoring.test.ts`, `report-editor-utils.test.ts`, `roof-report-pipeline.test.ts`, `report-narrative-pluralization.test.ts`

**Interfaces:** `ComprehensiveRoofReport`, `createComprehensiveReport`, `ReportType = 'inspection' | 'measurement' | 'storm'`, `ReportTemplate = 'insurance' | 'homeowner' | 'full' | 'quick'`, `ReportVisualStyle`, `generateEstimateFromDamageAnalysis`, `calculateReplacementTiers`, `formatCurrency`, `formatUnit`, unchanged. The type-only imports from `api-client` and `EstimatePDF` point at `old-types.ts`.

- [ ] **Step 1:** Move the tests; run; fail.
- [ ] **Step 2:** Move the files, add the dependencies (`npm install`), pass. Confirm `damage-knowledge-base.ts` in this folder is the one these files import, never `../reports/damage-knowledge-base.js` (the boundary test enforces it). Commit `feat(roof-reports): report data, repair and replacement pricing, measurement maths (A4)`.

### Task A5: Templates, the classic document and the measurement document

**Files:**
- Move: `report-templates.ts`, `report-sections.ts`, `report-motion.ts`, `company-header-html.ts`, `roof-analysis-report-html.ts`, `measurement-report-html.ts`
- Create: `server/lib/roof-reports/__tests__/fixtures/report.ts` (from the old `__tests__/fixtures/comprehensive-report.ts`, with the city, company, email and website changed to the fictional ones)
- Move tests: `report-templates.test.ts` (its `@/lib/` import becomes relative), `roof-report-html.test.ts`, `report-confidence-and-evidence.test.ts`, `measurement-report-html.test.ts`, `report-motion.test.ts` (without the case that imports the old server's `gsap-inline`; that case is listed in the commit message as not carried)

**Interfaces:** `getTemplateConfig`, `resolveVisualStyle`, `isFlightStyle`, `generateComprehensiveReportHTML(report, options)`, `generateRoofAnalysisReportHTML(...)`, the measurement document generator, `motionStyles`, `motionRuntime`, unchanged. `PLATFORM_NAME` comes from `platform.ts`; fonts from `fonts.ts`.

- [ ] **Step 1:** Move the tests and the fixture; run; fail.
- [ ] **Step 2:** Move the files; pass. Commit `feat(roof-reports): four templates, the classic document and the measurement document (A5)`.

### Task A6: The two scroll styles, the style chooser and chapter packs as input

**Files:**
- Move: `scroll-presentation-report.ts`, `scroll-flight-report.ts`, `render-report-html.ts`
- Create: `presentation-chapters.ts` (from old `presentation-tenant-chapters.ts`)
- Move tests: `scroll-presentation-report.test.ts`, `scroll-flight-report.test.ts`
- Create test: `engine-unchanged.test.ts` (PERMANENT)

**Interfaces:**
- Both renderers import `SCROLLCRAFT_CSS`, `SCROLLCRAFT_JS` from `../reports/scrollcraft-engine.js`. The old engine file is not copied.
- `presentation-chapters.ts` keeps the mechanism and none of the content:
  ```ts
  export interface TenantChapterContext { n: (id: string) => string; company: string; phone: string; hasWork: boolean; report: ComprehensiveRoofReport }
  export interface PackChapter {
    id: string; label: string; minutes: number; after: string; onlyWithWork: boolean;
    heading: string; ledes: string[];
    steps?: { title: string; text: string }[];
    questions?: { q: string; a: string }[];
    note?: string;
  }
  export interface ChapterPack { chapters: PackChapter[]; mustSay: string[]; mustNotSay: string[] }
  export function packChapterHtml(c: TenantChapterContext, ch: PackChapter): string;   // same markup the old head/step/qa helpers made, every value escaped
  export function chaptersToRender(pack: ChapterPack | null, c: TenantChapterContext): PackChapter[];  // drops onlyWithWork chapters when !hasWork
  export function packProblems(pack: ChapterPack): string[];  // plain sentences: a mustNotSay phrase present, a mustSay phrase missing, an unknown anchor, a bad id
  ```
  `TENANT_SIGNALS`, `tenantKeyFor`, `BRN_CHAPTERS` and every word of their copy are **not** carried.
- `generateScrollPresentationHTML(report, brandColors, pack: ChapterPack | null)` and `renderReportHtml(report, brandColors, opts: { pack?: ChapterPack | null })` take the pack from the caller. The anchor walk-back (a chapter whose anchor was dropped follows the nearest earlier chapter that rendered) is kept exactly.
- `engine-unchanged.test.ts`: the SHA-256 of `SCROLLCRAFT_JS` and of `SCROLLCRAFT_CSS` (with `\r` removed) equal two recorded hex strings, computed once in this task and written into the test with a comment saying what they are.

- [ ] **Step 1:** Move the two tests. Replace every Best Roofing Now case with the same case on a fictional pack for "Summit Ridge Roofing" (two chapters after `age`, one `onlyWithWork`, one questions chapter anchored to the first): a no-work report shows only the chapters without `onlyWithWork`; dropping the first chapter leaves the questions chapter rendered after `age` (the walk-back); a company with no pack gets exactly the base chapter set; `packProblems` names a `mustNotSay` phrase found in a chapter. Keep the stills-only cases (no `<video>` anywhere in a flight) and the downgrade cases (`MIN_FLIGHT_PHOTOS`, `MIN_PRESENTATION_CHAPTERS`). Write `engine-unchanged.test.ts`. Run; fail.
- [ ] **Step 2:** Move and adapt; pass; the boundary test passes with no Best Roofing Now text anywhere. Commit `feat(roof-reports): presentation and flight styles, chapter packs as input, the engine fixed (A6)`.

### Task A7: The narrative and the photo labels

**Files:**
- Move: `claude-report-narrator.ts`, `claude-image-labeler.ts`, `safe-download.ts` (from old `server/src/lib/`)
- Move tests: `claude-report-narrator.test.ts`, `claude-image-labeler.test.ts`

**Interfaces:** `generateNarrativeWithClaude(report, opts)` and `labelPhotosWithClaude(photos, opts)`, unchanged in what they return (`NarrativeFinding[]` with `executiveSummary`; `ImageLabel[]` on the nine-cell grid), with two changes: the model comes from `ROOF_REPORT_MODELS.narrative` / `.labels`, and a photo may be given as image bytes (`{ bytes: Buffer; mediaType: 'image/jpeg' }`) as well as a URL. Both stay non-fatal: any failure returns `null`.

- [ ] **Step 1:** Move the tests with `fetch` stubbed; add cases: a photo given as bytes is sent as base64 and no download is made; a 500 from the provider returns `null` and the error text is not logged. Run; fail.
- [ ] **Step 2:** Move and adapt; pass. Run the whole folder, `npm run check`, the full suite. Commit `feat(roof-reports): inspector narrative and photo labels (A7)`.

---

## Stage B: database and the generate, list, get, update and archive routes under Archie's sign-in

Leaves Archie working and shippable: the routes are off until `ARCHIE_ROOF_REPORTS=on`, and existing documents are untouched. About 3 migrations, 1 schema change, 9 new server files, 9 test files, 8 tasks.

### Task B1: Remove the dead `roof_reports` write

**Files:**
- Modify: `server/lib/reports/generate-inspection.ts` (remove `persistReport`, line 241, and its call at line 232)
- Test: `server/lib/reports/__tests__/no-roof-reports-write.test.ts`

**Interfaces:** none new. `generateInspectionReport` returns what it returns today.

- [ ] **Step 1:** Test: the source of `server/lib/reports/` (every `.ts`, tests excluded) contains no `roof_reports`. Run; fail (one hit).
- [ ] **Step 2:** Remove the function and the call. Run `server/lib/reports` and `server/reports` tests: still green (the write never succeeded, so nothing depended on it). Commit `fix(reports): drop a write to a table Archie never had, before roof_reports exists (B1)`.

### Task B2: Migration 0020, the roof reports tables

**Files:**
- Create: `migrations/0020_roof_reports.sql`, `server/roof-reports/__tests__/migration-0020.db.test.ts`
- Modify: `shared/schema.ts` (`roofReports`, `roofReportPhotos`, types)

**Interfaces:**
```sql
-- Archie: roof reports, merged from the roof reports program (plan
-- docs/superpowers/plans/2026-11-24-roof-reports-into-archie.md). Off until
-- ARCHIE_ROOF_REPORTS=on. Needs 0008. Never edit this file once applied.
SET LOCAL lock_timeout = '5s';
CREATE TABLE "roof_reports" (
  "company_id" uuid DEFAULT archie_current_company() NOT NULL REFERENCES companies(id),
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "job_external_id" text,                       -- the job it belongs to; null for an address-first report
  "created_by_member_id" integer,               -- team_members.id of the maker; null for a copied report with nobody to match
  "status" text DEFAULT 'generating' NOT NULL CHECK (status IN ('generating','ready','failed','archived')),
  "report_types" text[] NOT NULL CHECK (report_types <@ ARRAY['inspection','measurement','storm']::text[] AND cardinality(report_types) > 0),
  "template" text DEFAULT 'full' NOT NULL CHECK (template IN ('insurance','homeowner','full','quick')),
  "visual_style" text CHECK (visual_style IN ('formal','presentation','flight')),
  "title" text, "address" text NOT NULL, "city" text, "state" text, "zip" text,
  "latitude" numeric(10,7), "longitude" numeric(10,7),
  "customer_name" text, "customer_email" text, "customer_phone" text,
  "inspection_date" timestamptz, "inspector_notes" text,
  "report_json" jsonb,                          -- the whole ComprehensiveRoofReport, narrative and labels included
  "edited_html" text,                           -- a person's saved edit of the page, at most 500 KB
  "total_estimate" numeric(12,2), "damage_severity" text, "storm_events_count" integer, "data_quality" text,
  "share_token" text,
  "email_sent_at" timestamptz, "email_sent_count" integer DEFAULT 0 NOT NULL,
  "problem" text,                               -- a plain sentence for the person, never a provider's error
  "legacy_id" text, "legacy_extra" jsonb,       -- the old program's id and its columns Archie does not use (Stage E)
  "created_at" timestamptz DEFAULT now() NOT NULL, "updated_at" timestamptz DEFAULT now() NOT NULL
);
SELECT archie_protect_company_table('roof_reports');
CREATE UNIQUE INDEX "roof_reports_share_token_uq" ON "roof_reports" ("share_token");
CREATE UNIQUE INDEX "roof_reports_legacy_uq" ON "roof_reports" ("company_id", "legacy_id");
CREATE INDEX "roof_reports_company_created" ON "roof_reports" ("company_id", "created_at");
CREATE INDEX "roof_reports_company_job" ON "roof_reports" ("company_id", "job_external_id");

CREATE TABLE "roof_report_photos" (
  "company_id" uuid DEFAULT archie_current_company() NOT NULL REFERENCES companies(id),
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "report_id" uuid,                             -- null while uploaded but not yet used in a report
  "uploaded_by_member_id" integer,
  "position" integer DEFAULT 0 NOT NULL,
  "category" text,                              -- overview, roof_surface, flashing, vent, closeup (the flight's order)
  "working_key" text NOT NULL, "thumb_key" text NOT NULL,
  "analysis" jsonb, "labels" jsonb,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "roof_report_photos_keys_in_company" CHECK (
    working_key LIKE 'c/' || company_id::text || '/rr/%' AND thumb_key LIKE 'c/' || company_id::text || '/rr/%')
);
SELECT archie_protect_company_table('roof_report_photos');
CREATE INDEX "roof_report_photos_company_report" ON "roof_report_photos" ("company_id", "report_id", "position");
```
No foreign key from `roof_report_photos.report_id` to `roof_reports` (foreign keys skip row level security; the code looks the report up as the company first, as `0018` does).

- [ ] **Step 1:** `migration-0020.db.test.ts` (local database): a row with only `address` and `report_types` reads back `status = 'generating'`, `template = 'full'`, `email_sent_count = 0`; `report_types = '{}'` and `'{roof}'` are refused; `template = 'luxury'` refused; two rows with the same `share_token` refused, even in different companies; the same `legacy_id` twice in one company refused, in two companies allowed; as `archie_app` with company A set, company B's rows are invisible and an update touches zero rows; a photo row whose key sits under another company's prefix is refused. Run `isolation.test.ts` and `system-role.test.ts`: they find and pass both tables. Run; fail.
- [ ] **Step 2:** Write the migration and the Drizzle tables. Pass. Commit `feat(db): roof reports and their photos (0020)`.

### Task B3: Migration 0021 and the metered call

**Files:**
- Create: `migrations/0021_model_costs.sql`, `server/roof-reports/metered.ts`
- Modify: `shared/schema.ts` (`modelCosts`)
- Test: `server/roof-reports/__tests__/metered.db.test.ts`

**Interfaces:**
- Table `model_costs`: `company_id` (protected as above), `id uuid`, `operation text not null` (`'photo_analysis' | 'narrative' | 'photo_labels' | 'rewrite' | 'measurement_detect' | 'satellite_image'`), `provider text not null check in ('groq','google','anthropic')`, `model text`, `input_tokens integer`, `output_tokens integer`, `cents numeric(10,4) not null default 0`, `priced boolean not null`, `ref text` (the report id), `created_at`. Index `(company_id, created_at)`.
- `meteredModelCall<T>(input: { operation; role: ModelRole | 'staticMap'; ref: string | null }, call: () => Promise<{ value: T; usage?: { input: number; output: number } }>): Promise<T>`: refuses a provider not in `US_MODEL_PROVIDERS` before calling (throws `NotUsProviderError`); runs the call; writes one row whether the call succeeded or threw (a throw with no usage writes 0 cents, `priced: true`); a failed write is logged as "a cost row could not be written" with the error's kind only and never fails the call.
- `estimateCents(modelId, usage)`: from `MODEL_PRICES_CENTS_PER_MTOK`; unknown model gives `{ cents: 0, priced: false }`.

- [ ] **Step 1:** Tests: a successful call writes one row with the right cents; a throwing call writes one row and rethrows; a provider not on the list throws before the call runs and writes nothing; the row is written as the current company and invisible to another; a failing insert does not fail the call and logs no message text. Run; fail.
- [ ] **Step 2:** Implement. Pass. Commit `feat(roof-reports): one cost row for every paid model call (0021)`.

### Task B4: Who may see and do what

**Files:**
- Create: `server/roof-reports/switch.ts`, `server/roof-reports/access.ts`, `shared/roof-reports.ts`
- Test: `server/roof-reports/__tests__/roof-report-roles.db.test.ts` (PERMANENT)

**Interfaces:**
- `switch.ts`: `roofReportsOn(env = process.env): boolean` (true only for the exact string `on`); `requireRoofReportsOn` middleware answering a bare 404 when off.
- `access.ts`:
  ```ts
  export function mayUseRoofReports(role: TeamRole): boolean;           // false only for 'production'
  export async function visibleRoofReportWhere(user: SessionUser): Promise<SQL>;
  //   scope 'all'  -> true (row level security already holds the company)
  //   otherwise    -> (job_external_id is not null and the job is one ownsLead allows, through ownedLeadWhere/scopedLeadWhere)
  //                   or (job_external_id is null and created_by_member_id in visibleIdsFor(user))
  export async function roofReportFor(user: SessionUser, id: string): Promise<RoofReport | null>;  // null for a bad uuid, another company's, an unseen or an archived report
  export async function mayAttachJob(user: SessionUser, jobExternalId: string): Promise<boolean>;  // ownsLead
  ```
- `shared/roof-reports.ts`: `REPORT_KINDS`, `TEMPLATES`, `VISUAL_STYLES` with plain labels, and the plain sentences every route uses, for example `NOT_FOUND = 'That report could not be found.'`, `NEEDS_ADDRESS = 'Please enter the street address.'`, `PICK_A_KIND = 'Pick at least one: inspection, measurements or storm history.'`, `TOO_MANY_PHOTOS = 'Please pick 40 photos or fewer.'`, `GENERATE_FAILED = 'The report could not be finished. Please try again.'`, `SWITCHED_OFF` (never shown; the routes 404).

- [ ] **Step 1:** The permanent test, with the header "PERMANENT. Never delete, skip or weaken this file." On a fictional company with five reports (one on a job owned by rep A, one on a job owned by rep B, one address-first made by rep A, one address-first made by the sales leader, one archived) and a second company with one report, a hand-written table of what each role sees: `admin`, `sales_director`, `customer_service`: the four live reports of their company; `manager` (leading rep A): rep A's two and their own; `sales` as rep A: rep A's two; `sales` as rep B: rep B's one; `production`: none, and `mayUseRoofReports` is false. Then the same through `ROLE_MAP` for Roof Lee's six roles (owner, admin, office, sales_manager see all four; salesperson sees only their own; crew none). Nobody ever sees the second company's report or the archived one. Run; fail.
- [ ] **Step 2:** Implement. Pass. Commit `feat(roof-reports): who sees and does what, held by a permanent test (B4)`.

### Task B5: Photos for a report, kept private

**Files:**
- Modify: `server/photos/store.ts` (add `roofReportPhotoKey(companyId, reportScope: string, photoId, variant)` building `c/<company>/rr/<scope>/<photo>/<variant>.jpg`, and widen `isPhotoObjectKey` to accept it)
- Create: `server/roof-reports/photos.ts`
- Test: `server/roof-reports/__tests__/photos.db.test.ts`, additions to `server/photos/__tests__/store.test.ts`

**Interfaces:**
- `addReportPhoto(user, bytes: Buffer, category?: string): Promise<{ id: string }>`: refuses a non-JPEG, cleans it with `cleanJpeg`, makes a working copy and a thumbnail the way `server/photos/native.ts` does, stores both under the uploader's company with scope `pending`, writes a `roof_report_photos` row with `report_id` null. Plain sentences reuse `PHOTO_STORE_OFF`, `PHOTO_NOT_JPEG`, `PHOTO_TOO_LARGE`, `PHOTO_NOT_SAVED`.
- `claimPhotos(user, reportId, photoIds: string[])`: sets `report_id` and `position` for photos the same person uploaded with `report_id` null; any other id is silently left out (not an error that confirms it exists).
- `reportPhotoBytes(reportId, photoId, variant)`: bytes only when the photo belongs to that report in the current company.
- Routes (registered in B7): `POST /api/roof-reports/photos` (raw JPEG body, at most `MAX_PHOTO_BYTES`) and `GET /api/roof-reports/:id/photos/:photoId/:variant` (through `roofReportFor`).

- [ ] **Step 1:** Tests with the fake store (`setPhotoStoreForTests`): a JPEG with a GPS block is stored with none; keys sit under the company's `rr/` prefix; a photo uploaded by rep A cannot be claimed by rep B; another company's photo id is never returned; the store switched off answers 503 with `PHOTO_STORE_OFF`; crew get 404. Run; fail.
- [ ] **Step 2:** Implement. Pass. Commit `feat(roof-reports): report photos in Archie's private store, cleaned (B5)`.

### Task B6: The generation service

**Files:**
- Create: `server/roof-reports/brand.ts`, `server/roof-reports/generate.ts`, `server/roof-reports/store.ts`
- Test: `server/roof-reports/__tests__/generate.test.ts`

**Interfaces:**
- `brand.ts`: `brandFor(company): { brandColors; companyHeader; contact: { company: string; phone: string } }` from `shared/company.ts`'s branding (name, logo, colors, phone, website). No name or domain matching of any kind.
- `generate.ts`:
  ```ts
  export interface GenerateRequest {
    reportTypes: Array<'inspection' | 'measurement' | 'storm'>; template: 'insurance' | 'homeowner' | 'full' | 'quick';
    address: string; city?: string; state?: string; zip?: string;
    photoIds: string[]; roofDetails?: unknown; damageCounts?: unknown; measurements?: unknown;
    inspectorNotes?: string; customer?: { name?: string; email?: string; phone?: string }; jobExternalId?: string;
  }
  export interface GenerateDeps {
    storm: typeof generateStormReport; enhancedStorm: typeof buildEnhancedStormData;
    analyze: (photo: { bytes: Buffer }, reportId: string) => Promise<RoofAnalysisResult>;   // through meteredModelCall
    narrate: typeof generateNarrativeWithClaude; label: typeof labelPhotosWithClaude;     // through meteredModelCall
    photoBytes: (reportId: string, photoId: string) => Promise<Buffer | null>;
    now: () => Date;
  }
  export async function runGeneration(reportId: string, req: GenerateRequest, deps: GenerateDeps): Promise<{ report: ComprehensiveRoofReport; warning: string | null }>;
  ```
  Steps, as the old route: storm (always, it geocodes); photo analysis only when `inspection` is asked and there are photos, at most 40, batches of 3 with a 1 second pause, each image sent as bytes; repair estimate when `inspection`; replacement tiers when `inspection` and squares above 0; measurement section when `measurement`; `createComprehensiveReport`; narrative and labels in parallel, each time-boxed to 60 seconds and non-fatal. A report that analysed no photos says so in `warning` (a plain sentence, never "no damage").
- `store.ts`: `saveGenerated(reportId, report)` writes `report_json`, the summary columns (`total_estimate`, `damage_severity`, `storm_events_count`, `data_quality`, `latitude`, `longitude`), `status = 'ready'`; `markFailed(reportId, sentence)` writes `status = 'failed'` and `problem`.

- [ ] **Step 1:** Tests with every dependency faked: inspection with 5 photos calls `analyze` 5 times in batches of 3 (fake timers) and `label` once; storm only calls no analysis and no estimate; 45 photo ids are refused with `TOO_MANY_PHOTOS` before anything runs; narrative throwing still saves the report with no narrative; analysis failing on every photo saves the report with a warning sentence; no fake is ever handed a URL for a photo; nothing in the saved JSON contains a photo store key. Run; fail.
- [ ] **Step 2:** Implement. Pass. Commit `feat(roof-reports): generation in Archie, inside 300 seconds, every paid call metered (B6)`.

### Task B7: The routes

**Files:**
- Create: `server/roof-reports/routes.ts`
- Test: `server/roof-reports/__tests__/routes.db.test.ts`

**Interfaces** (all behind `requireRoofReportsOn` and `requireAuth`; `production` gets 404 on every one; every write logged through `logWrite` with the report id only):
- `GET /api/roof-reports/status`: `{ on: true, photoStore: boolean, analysis: boolean }` (whether the Groq key is set; never which keys).
- `POST /api/roof-reports/photos`, `GET /api/roof-reports/:id/photos/:photoId/:variant` (Task B5).
- `POST /api/roof-reports/generate` (rate limit 40 per 10 minutes per person): validates `GenerateRequest` (plain sentences from `shared/roof-reports.ts`), checks `mayAttachJob` when a job is named, inserts the row (`status 'generating'`, `created_by_member_id`, a 32-byte hex `share_token`), claims the photos, runs `runGeneration` inside the request, renders the classic document for the response check, answers `{ id, status }`. A geocoding failure answers 422 with "We couldn't find that address on the map. Check the street, city and ZIP." Anything else: `markFailed` and `sendFailure` with `GENERATE_FAILED`.
- `GET /api/roof-reports?search=&kind=&status=&page=`: newest first, 25 a page, only `visibleRoofReportWhere`, archived left out unless `status=archived` is asked by a scope-`all` role. Answers id, title, address, city, status, kinds, template, created, customer name, job key, `totalEstimate`.
- `GET /api/clients/:externalId/roof-reports`: the job's reports, after `ownsLead`.
- `GET /api/roof-reports/:id`: the row through `roofReportFor`, without `share_token` unless the person may send it (any role that may see it).
- `PUT /api/roof-reports/:id`: may change `title`, customer fields, `inspector_notes`, `inspection_date`, `report_json` (validated as an object, at most 2 MB), `edited_html` (at most 500 KB), `template`, `visual_style`, `job_external_id` (through `mayAttachJob`, or null). Anything else in the body is refused with 400 and a plain sentence.
- `POST /api/roof-reports/:id/archive`: `status = 'archived'`; nothing deleted. A report still generating answers 409 "This report is still being made. Archive it once it finishes."
- `GET /api/roof-reports/:id/html`: the page to show in the app: `edited_html` when present, else `renderReportHtml` (classic document in Stage B).
- Stale guard: a report left `generating` for 8 minutes reads as `failed` with `GENERATE_FAILED` (as Archie's `STALE_AFTER_MS`).

- [ ] **Step 1:** Route tests through the real app harness (`server/crews/__tests__/harness.ts` pattern, every outside client throwing): switched off, every route is 404; switched on, each case of the B4 table holds through the routes; another company's id is 404 on get, update, archive, html and photo; a salesperson attaching a job they do not own gets 404; an unknown field in `PUT` is 400; archive keeps the row and hides it from the list; crew 404 everywhere; no answer body ever contains a provider's error text. Run `crew-money-walk.db.test.ts`: passes with the new routes in it. Run; fail.
- [ ] **Step 2:** Implement. Pass. Commit `feat(roof-reports): make, list, open, change and archive reports under Archie's sign-in (B7)`.

### Task B8: Wire up and write it down

**Files:**
- Modify: `server/routes.ts` (register after `registerRoofReportRoutes`), `.env.example` (`ARCHIE_ROOF_REPORTS=` with a comment: "Roof reports merged from the old program. Off unless 'on'. Needs migrations 0020 and 0021 first."), `README.md` (one line in the build plan and the migration note)
- Create: `docs/archie/03-roof-reports.md`

- [ ] **Step 1:** `docs/archie/03-roof-reports.md`: what roof reports are, the switch, the migration order ("apply 0020 and 0021 as the owner before deploying code that reads them; both are safe under the code live today"), who sees what (the B4 table in plain words), photos (private, cleaned, shown through the report's link from Stage D), models (US only, ids in one file, each paid call recorded), what is not carried (monthly limits, signing, claims).
- [ ] **Step 2:** The whole suite, `npm run check`, a search of every file this stage touched for U+2014 finding nothing. Commit `docs(archie): roof reports, switch and migration order (B8)`.

---

## Stage C: the screens in Archie's client

About 9 client files, 3 small server routes, 6 tasks. Built in Archie's own components and Tailwind; nothing from the old `components/ui/*`, React Query, framer-motion or heroicons. Every async click shows its state within about 100 ms (a per-item "Making your report...", "Saving...", "Archiving..."), cleared on success or failure, with a 10 second safety timeout on anything event-driven. Errors use Archie's plain-sentence pattern.

### Task C1: The Roof reports page and its list
- **Files:** `shared/menu.ts` (page `roof-reports`, group `deliver`, hidden for `production` and when `/api/roof-reports/status` is not on), `client/src/App.tsx`, `client/src/pages/roof-reports.tsx`, `client/src/roof-reports/api.ts`, `client/src/roof-reports/ReportList.tsx`; test `client/src/roof-reports/__tests__/list-view.test.ts` (pure helpers: filters, plain status labels).
- **Holds:** search, kind and status filters, 25 a page, empty state "No roof reports yet.", archived shown only to scope-`all` roles. `product-names.test.ts` passes.

### Task C2: Wizard steps 1 and 2 (where, and photos)
- **Files:** `client/src/roof-reports/Wizard.tsx`, `StepWhere.tsx`, `StepPhotos.tsx`, `client/src/roof-reports/draft.ts` (browser-kept draft, 24 hours, key `archie.roofReportDraft.<memberId>`, wrapped in try and catch).
- **Holds:** address with an optional job picked from the person's own jobs only; photos taken or chosen, turned into JPEG in the browser (as `JobPhotos.tsx` does), uploaded one by one to `POST /api/roof-reports/photos` with a per-photo state; at most 40 offered for analysis.

### Task C3: Wizard steps 3 and 4 (measurements, damage counts)
- **Files:** `StepMeasurements.tsx`, `StepDamage.tsx`, `client/src/roof-reports/__tests__/measurements.test.ts`.
- **Holds:** squares, pitch, stories, material; wind, hail and general counts; values checked in plain words before going on.

### Task C4: Wizard steps 5 and 6 (review, generate, wait)
- **Files:** `StepReview.tsx`, `StepGenerate.tsx`.
- **Holds:** pick kinds and template with plain descriptions; inspector notes; generate with rotating plain status lines ("Pulling storm history...", "Looking at your photos...", "Writing the findings...") and a thin progress bar (no sparkle or magic icons); a failure shows `GENERATE_FAILED` and keeps the draft.

### Task C5: The editor
- **Files:** `client/src/roof-reports/Editor.tsx`, `SectionEditor.tsx`, `FindingEditor.tsx`, `PhotoLabelEditor.tsx`; server `server/roof-reports/rewrite.ts` with `POST /api/roof-reports/:id/rewrite-finding`, `/rewrite-summary`, `/label-photo` (each through `meteredModelCall`, rate limited 60 per 10 minutes, roles as B4); tests `server/roof-reports/__tests__/rewrite.db.test.ts`, extend the permanent roles test.
- **Holds:** the page shown in a frame from `GET /:id/html`; section switches, finding text, photo labels saved with `PUT /:id`; rewrites never save on their own (the person saves).

### Task C6: On the job page
- **Files:** `client/src/pages/client-detail.tsx` (a "Roof reports" block beside the existing `RoofReports` component, from `GET /api/clients/:externalId/roof-reports`, with "New roof report" opening the wizard with the job filled in).
- **Holds:** a job that is not the person's own never shows the block (the route is 404); the crew money walk still passes.

---

## Stage D: presentation styles, per-company chapters, PDF, email and share link

About 1 migration, 1 operator script, 8 server files, 6 client files, 7 tasks.

### Task D1: Presentation and flight in Archie
- **Files:** `server/roof-reports/routes.ts` (`GET /:id/html` picks the style through `renderReportHtml`, passing the company's pack from D2), client style picker in the editor showing the downgrade reason as a plain sentence ("This report has only 2 photos, so it is shown as a document. A flight needs 3 or more."); test that every moved renderer's output for the fixture contains no U+2014 and no `<video`, and fixing the moved customer-facing copy that does.
- **Holds:** the price comes late in the presentation (the moved test already holds `CHAPTER_ORDER`); stills only.

### Task D2: Chapter packs as company data
- **Files:** `migrations/0022_presentation_packs.sql` (`presentation_chapter_packs`: company table, one row per company, `pack jsonb not null`, `loaded_at`, `loaded_by text`; `archie_app` granted SELECT only, `archie_system` SELECT, INSERT, UPDATE; protected with both policies), `server/roof-reports/packs.ts` (`packForCurrentCompany(): Promise<ChapterPack | null>`), `scripts/load-presentation-pack.ts` (`--company <uuid> --file <path outside the repo> [--apply]`, dry run by default, runs `packProblems` and refuses on any, writes through `runAsSystem('operator: load one company\'s presentation pack', ...)`), test `server/roof-reports/__tests__/packs-are-company-data.test.ts` (PERMANENT: company A's pack never renders for company B; the app role cannot write a pack; no `.ts` file in `server/` or `shared/` contains pack wording from the test's fictional pack; a pack failing its own `mustNotSay` is refused by the loader).
- **Holds:** a company with no row gets the base presentation.

### Task D3: The Best Roofing Now pack (only after James answers "Needs the owner" 2)
- **Files:** none in the repo. An operator converts the eight chapters from the old program's `lib/presentation-tenant-chapters.ts` into a pack JSON kept outside both repos, with `mustNotSay: ['general contractor', 'GAF', 'Owens Corning', '50/50']` and `mustSay` holding the warranty sentence as approved, then runs the loader for the one Archie company James names, dry run first. A person reads the rendered presentation for that company before `--apply`.
- **Holds:** nothing Best Roofing Now enters Archie's code, tests or seeds; the boundary and packs tests still pass.

### Task D4: The share link
- **Files:** `server/roof-reports/public.ts` (`GET /r/roof/:token` and `GET /r/roof/:token/photos/:photoId/:variant`, through `companyFromToken(roofReports, roofReports.shareToken)`, a per-address rate limit as Archie's report page, archived or unknown answers the same plain "This report is not available." page, `Cache-Control: no-store`), the page's photo addresses rewritten to the token route at render time; test `server/roof-reports/__tests__/public.db.test.ts`.
- **Holds:** a token opens one report and only its photos; another report's photo id under that token is 404; no store key ever appears in the page; `/r/*` is already sent to the server by `vercel.json`, so no deploy setting changes.

### Task D5: Email a report
- **Files:** `server/roof-reports/send.ts` (`POST /api/roof-reports/:id/send`, body `{ email, customerName?, message? }`, sends through `sendCompanyEmail` a short plain message with the share link, increments `email_sent_count` and sets `email_sent_at` only after the provider returns an id), client `SendDialog.tsx`; tests in `send.db.test.ts` and the permanent roles test.
- **Holds:** only a person's click sends; nothing sends on generation or on a schedule; the address is never logged; for a company Roof Lee made, follow James's answer to "Needs the owner" 8 (until then the button is shown with the same rules as any company).

### Task D6: The PDF
- **Files:** `package.json` (`@react-pdf/renderer@^4.3.2`), `client/src/roof-reports/pdf/RoofReportPDF.tsx`, `pdf/shared.tsx`, `pdf/chart-capture.ts` (moved from the old `lib/`, imports adjusted, types imported with `import type` from `server/lib/roof-reports/comprehensive-roof-report`), a "Download PDF" button that loads them with `import()` only when pressed.
- **Holds:** the main bundle does not grow by the PDF library (checked by comparing the built entry chunk size before and after); photos in the PDF come through the signed-in photo route.

### Task D7: Comparison and satellite measurement
- **Files:** `client/src/roof-reports/Comparison.tsx` (two reports the person may see, side by side); `server/roof-reports/measure.ts` with `POST /api/roof-reports/measurements/detect` (Google Static Maps image through `meteredModelCall` with role `staticMap`, outline found by `ROOF_REPORT_MODELS.measurement`, answer `{ outline, facets, roofType, confidence }`), the wizard's measurement step offering "Find it from the satellite"; tests with both calls faked.
- **Holds:** the image is fetched only from `maps.googleapis.com`; the key never reaches the client or a log.

---

## Stage E: one-time copy of existing reports and photos

One script and its tests, about 5 tasks. Run only after James answers "Needs the owner" 1 and 3.

### Task E1: Read the old reports, read-only, and a dry run
- **Files:** `scripts/copy-old-roof-reports.ts`, `scripts/lib/old-roof-reports.ts`, tests in `scripts/__tests__/copy-old-roof-reports.test.ts`.
- **Holds:** `OLD_DATABASE_URL` is opened with `default_transaction_read_only = on` and the script refuses to run if a write would be possible (it checks `SHOW transaction_read_only`); `--map <file>` (`{ "<old company uuid>": "<archie company uuid>" }`) is required; the default is a dry run printing counts only (reports per company, photos, skipped and why), never names, addresses or tokens.

### Task E2: People and fields
- **Holds:** old column to new column as Section 4 lists; `report_json` and the JSON columns copied as they are; signing and claim columns into `legacy_extra`; `created_by_member_id` set only when the old maker's email equals an active team member's email **inside the same mapped Archie company**, else null (then only scope-`all` roles see it); `job_external_id` always null.

### Task E3: Photos
- **Holds:** each photo address found in the report's JSON and `edited_html` is fetched only from the old bucket's host given by `--photo-host`, never following a redirect; cleaned with `cleanJpeg`; stored under `c/<company>/rr/<report>/`; the report's references rewritten to the photo's id; an unreadable photo is counted and left out, the report still copied.

### Task E4: Apply, safely twice
- **Holds:** `--apply` writes each report as its Archie company (`runAsCompany`), inserting on `(company_id, legacy_id)` and skipping existing ones, so a second run copies nothing twice; the old share token is kept; nothing at the source is changed or deleted; a final summary of counts only.

### Task E5: Rehearse
- **Holds:** a rehearsal on a scratch copy of the old database and a local Archie database: counts match, ten reports opened by a person in each style, their share links work, a salesperson sees none of them unless matched in E2. Written up in `docs/archie/03-roof-reports.md`.

---

## Stage F: retire the old program's reports (nothing deleted until James says)

About 4 tasks, the first two in the old repo, after James says go.

### Task F1: Point people to Archie (old repo)
- **Holds:** the old report screens show one plain line, "Roof reports now live in Archie," with a link; the old generate route answers that sentence and makes nothing new. Nothing is removed from the old code.

### Task F2: Old share links (old repo)
- **Holds:** an old public report link whose token was copied answers a redirect to Archie's `/r/roof/<token>`; one not copied keeps working as today.

### Task F3: Owner steps (James, written in `docs/archie/03-roof-reports.md`)
- **Holds:** a dated read-only snapshot of the old database; the old photo bucket kept as it is; the old scheduled jobs that touch reports paused, not removed.

### Task F4: The removal list
- **Holds:** a written list of what could be removed later (old report routes, tables, bucket objects, screens), each with what depends on it. Nothing on it is removed until James says so, item by item.

---

## Size, honestly

| Stage | What moves or is written | Tasks | Notes |
|---|---|---|---|
| A | about 36 library files moved (about 22,000 lines), 4 new small files, 24 test files moved (about 5,100 lines) plus 2 new | 7 | Mostly mechanical; the risk is in A6 (packs out, engine in) |
| B | 3 migrations, schema, about 9 server files, about 9 test files | 8 | The real work: access, photos, generation inside 300 seconds |
| C | about 9 client files, 3 small routes | 6 | The old screens (about 9,500 lines) are a reference, not copied |
| D | 1 migration, 1 operator script, about 8 server and 6 client files, PDF (about 5,300 lines moved) | 7 | D3 waits for James |
| E | 1 script, its helper and tests | 5 | Waits for James's company map |
| F | small changes in the old repo, owner steps | 4 | Waits for James's go |

## Review Focus

1. A report, photo or share link of one company reachable from another (B2, B4, B5, B7, D4).
2. A salesperson seeing a report they do not own, or crew seeing any report or price (B4, B7, C1, C6).
3. A photo stored with location data, stored publicly, or sent to a model as a public address (B5, B6, D4, E3).
4. A model call to a provider outside the US list, a model id outside `models.ts`, or a paid call with no cost row (A1, A3, A7, B3, B6, C5, D7).
5. A Best Roofing Now word, name, domain or fact in Archie's code, tests or seeds, or one company's chapter pack showing for another (A1, A6, D2, D3).
6. An edit to the scroll engine, or a `<video>` in a flight (A6, D1).
7. Anything sent to a customer without a person's click (D5).
8. Anything deleted or changed at the old program or its storage (E1 to E4, F1 to F4).
9. A provider error, id or code on a screen; an em dash in new copy (all).
