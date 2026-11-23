# Roof reports

Roof reports were built in a separate program and are now being merged into
Archie (plan: `docs/superpowers/plans/2026-11-24-roof-reports-into-archie.md`).
A roofing company makes a roof report from an address, with or without photos:
an inspection, a measurement, a storm history, or any mix. Archie's own
documents (Inspection, Estimate, Proposal, Presentation, Combined) are not
changed; roof reports are their own family beside them.

This page covers what Stage B built: the tables, the photos, the generation,
the routes and the rules around them. The screens, the presentation styles, the
PDF, the email and share link and the copy of old reports come in later stages.

## The switch

`ARCHIE_ROOF_REPORTS` turns it on. It is on only when it is exactly `on`. It is
read on every request, so changing it needs no restart. While it is off, every
roof report route answers a bare 404 and nothing else in Archie changes. This is
held by `server/roof-reports/__tests__/route-walk.db.test.ts`, which walks
every route with the switch off.

Besides the switch, the feature reads these settings, all of which Archie
already has: `ARCHIE_PHOTOS_*` (the private photo store; without it photo
upload answers 503 in plain words), `GROQ_API_KEY`, `GEMINI_API_KEY` and
`ANTHROPIC_API_KEY` (the models; a model whose key is not set is never called),
`GOOGLE_MAPS_API_KEY` (placing the address) and `APP_BASE_URL` (the address
photo links inside a page are made against).

## Before this code is deployed

Apply two migrations to the database, as the owner, before deploying code that
reads them. Both are safe under the code that is live today (they only add
tables nothing reads yet). Nothing in the build or deploy runs them.

| file | what it adds | sha256 |
|---|---|---|
| `migrations/0020_roof_reports.sql` | `roof_reports`, `roof_report_photos` | `ace7bc60ebc3fc5d0dc040fb8d79ceb5b4300d5d34b8b23831b95b21c72ed55d` |
| `migrations/0021_model_costs.sql` | `model_costs` | `ca45ee62a6b90eaa514c94dca3bc702a4a679c93a36817b5aba80014a0b1a4a5` |

Check the file you apply with `sha256sum` against the table. Both need `0008`
(the system role): each table is protected with the function `0008` created, so
each has exactly the two company policies. A migration is never edited once
applied.

## Who sees and does what

The role is read from the signed-in session on the server, never from the
request. Reports carry prices, so crew never see one.

| role | sees | makes, changes, archives |
|---|---|---|
| Admin, Sales Director, Customer Service (and Roof Lee's owner, admin, office and sales manager, through the role Archie gives them) | every report of the company, and archived ones | every report |
| Sales Leader | reports on jobs their data scope covers, and address reports made by the people they lead or by themselves | the same |
| Sales Rep (Roof Lee's salesperson) | only their own: reports on their own jobs, and address reports they made | the same |
| Production (crew) | nothing | nothing |

A report that is not yours, is in another company, is archived or is not there
at all is the same answer, "not found", never "forbidden". The written decisions
are `ROOF_REPORT_RULES` in `shared/roof-reports.ts`, held by the permanent test
`server/roof-reports/__tests__/roof-report-roles.db.test.ts`.

## Permanent tests

Never delete, skip or weaken these.

| test | what it holds |
|---|---|
| `server/roof-reports/__tests__/route-walk.db.test.ts` | every roof report route, read from the router itself, as another company with this company's ids, as crew, as a salesperson who does not own the report, and with the switch off |
| `server/roof-reports/__tests__/roof-report-roles.db.test.ts` | who sees and does what, for every Archie role and every Roof Lee role |
| `server/lib/roof-reports/__tests__/module-boundary.test.ts` | the moved library stands alone, model ids live in one file, no Best Roofing Now value, US providers only |
| `server/lib/roof-reports/__tests__/engine-unchanged.test.ts` | the vendored scroll engine is never edited |
| `server/crews/__tests__/crew-money-walk.db.test.ts` (existing) | crew are handed no money by any route; run it with the switch on to walk the roof report routes too |

## The routes

All under `/api/roof-reports` except the last. Each needs the switch, a
signed-in person, and a role that may use roof reports.

| method and path | what it does |
|---|---|
| `GET /status` | `{ on, photoStore, analysis }`, never which keys are set |
| `POST /photos` | one raw JPEG body (`?category=`), cleaned and stored privately |
| `GET /:id/photos/:photoId/:variant` | one photo copy (`working` or `thumb`), after the report's access rule |
| `GET /linked-photo/:token` | one photo copy for a short signed link; no session, the signature is the check |
| `POST /generate` | make a report; 40 a person every ten minutes, 200 a company a day |
| `GET /` | list (`search`, `kind`, `status`, `page`), 25 a page, only what the person may see |
| `GET /:id` | one report with its photos, no share token |
| `PUT /:id` | change the named fields only; anything else is refused |
| `POST /:id/archive` | put it away; nothing is deleted |
| `POST /:id/retry` | run a failed report again from what was typed and the photos it has |
| `GET /:id/html` | the page, built only by the escaped renderers, served in a sandbox |
| `GET /api/clients/:externalId/roof-reports` | a job's reports, after the check that opens the job |

The company always comes from the session. Nothing in a body, a query or an
address says whose a report is; an update with a company, a status, a share token
or an id in it is refused.

## Photos

Report photos are kept in Archie's private photo store under
`c/<company>/rr/...`, never at a public address. What is stored is a JPEG with
every metadata block taken out (`server/photos/jpeg-clean.ts`), so no location
ever reaches the store. An upload is checked by what it is: a real JPEG (SVG,
PNG, HEIC and the rest are refused), no larger than the size cap, and at most
100 photos waiting unused per person per day; a report holds at most 40.

A photo belongs to one report of one company. It is uploaded first, then
claimed by the report its maker starts: only by the person who uploaded it, only
once, and only into a report of their own company that they may see. A claim
naming any other id quietly takes nothing, so no answer ever confirms an id
exists.

A photo leaves the store only two ways: through the signed-in route (after the
report's access rule), or through a short signed link. The page route makes
those links after the same rule passes: each names the company, the report, the
photo and the copy, is signed with a key derived from the session secret, and
runs out after ten minutes. The links stop working when a report is archived. A
token is a credential and is never logged.

## Generation

A report is made inside the request that asks for it (about 300 seconds on this
hosting). The run has one 240 second deadline (`createDeadline`), shared by the
storm fetch, every photo and the narrative. At most 40 photos, analysed three
at a time with a pause between. Storm and photo analysis return what they have
rather than throw; the narrative and the labels are non-fatal and get a minute
each. A report that is missing part of itself says so in one plain sentence.

A report row exists from the start as `generating`. It becomes `ready` only
through one statement that writes the whole report and its summary together,
and only if it can be shown. A run that fails cleanly is `failed` at once with
a plain sentence; a run that dies is `generating` until eight minutes pass, then
it reads as `failed`. Either can be tried again. There is never a half-written
ready report.

## Models and what they cost

US providers only: Groq, Google and Anthropic. Every model id lives in
`server/lib/roof-reports/models.ts`. Every paid call goes through the metered
call (`server/roof-reports/metered.ts`) and writes one `model_costs` row for the
company that caused it. Only the two Anthropic prices are confirmed. The Groq
and Google prices are **unconfirmed**: those calls are recorded with their
tokens, 0 cents and `priced = false`, never a guess. Add a price only after
reading the provider's own page.

## Nothing is deleted

"Delete" in the screens is archive: it sets `status = 'archived'`. The row, its
photos and its share token stay, and the report's photo links stop working.

## What is not carried over

The old program's monthly report limits (Archie has no free plan; there is a
per-person and per-company rate limit instead), its signing and claim columns,
its hosted report worker, and sending anything about a report to a customer by
itself: nothing is sent automatically.
