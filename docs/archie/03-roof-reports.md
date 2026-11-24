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

Apply three migrations to the database, as the owner, before deploying code that
reads them. All three are safe under the code that is live today (0020 and 0021
only add tables nothing reads yet; 0022 only adds columns the live code never
names). Nothing in the build or deploy runs them. **0022 must be applied before
the code that names its columns is deployed**: that code reads `roof_reports`
with them, so deployed first it breaks every report read.

| file | what it adds | sha256 |
|---|---|---|
| `migrations/0020_roof_reports.sql` | `roof_reports`, `roof_report_photos` | `ace7bc60ebc3fc5d0dc040fb8d79ceb5b4300d5d34b8b23831b95b21c72ed55d` |
| `migrations/0021_model_costs.sql` | `model_costs` | `ca45ee62a6b90eaa514c94dca3bc702a4a679c93a36817b5aba80014a0b1a4a5` |
| `migrations/0022_roof_report_starts.sql` | `roof_reports.started_at` (filled from `created_at`, then required), `idempotency_key`, `request_hash`, and two indexes | `3bdf415c35ed403d629df6b7f723fc119cd6ec5b4065b35270078c13678b1e2e` |

Check the file you apply with `sha256sum` against the table. 0020 and 0021 need
`0008` (the system role): each table is protected with the function `0008`
created, so each has exactly the two company policies; 0022 needs `0020`. A
migration is never edited once applied.

0022 is safe on a live table: one transaction, with a five second lock timeout.
The column is added with no default, filled from `created_at`, and only then
given its default and made required, so no row is ever seen without a value. The
table is young and small (the feature is off until it is switched on), so the
backfill and the two index builds are brief.

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
| `server/lib/roof-reports/__tests__/report-nonce.test.ts` | every script every renderer writes carries the response's nonce, written where the renderer writes it; no renderer uses an inline handler; a script or handler that gets in anyway carries no nonce |
| `server/roof-reports/__tests__/html-page.db.test.ts` | the page route: a fresh nonce on every response, the same one on every script in it, the sandbox and the other policy rules, the response headers |
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
| `POST /generate` | make a report; 40 a person every ten minutes, 200 a company a day (a new report and a retry both count). An optional `Idempotency-Key` header makes a repeated submit return the first report and start nothing |
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

## The report page

`GET /:id/html` builds the page only with the escaped renderers and serves it in
a sandbox with no origin of its own (no `allow-same-origin`), so nothing in it
can reach the app's cookies or API. The rules, in `server/roof-reports/page-policy.ts`:

- **Scripts run only with this response's nonce.** The policy says
  `script-src 'nonce-...'`, never `'unsafe-inline'`, and the nonce is 18 random
  bytes made fresh for every response. A renderer writes the nonce on each
  script of its own **at the point it writes the script** (`nonceAttr` in
  `html-safety.ts`), including the vendored scroll engine, which is not edited.
  It is never added to a finished page by a pass over its tags: that would bless
  an injected script too. **A new script in a renderer must carry it, and no
  renderer may use an inline event handler** (`onclick` and the rest): a nonce
  policy cannot allow one, so use a listener in the renderer's own nonce script.
  A nonce that is not a plain token is refused, so it can never open an attribute.
- Under a nonce the renderers write no outside script (the CDN tags of the motion
  layer are left out): the policy would block them anyway.
- `connect-src 'none'`, `form-action 'none'`, `default-src 'none'`, `base-uri 'none'`.
- **Images come only from the app** (photo links are absolute addresses on it),
  `data:`, `blob:`, and the one origin the company's logo is on when that is a
  plain https address. An injected image cannot send anything to another host.
- `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`,
  `Cache-Control: private, no-store`.
- A page a person saved runs nothing: a bare `sandbox`, no `script-src`, and the
  same image and header rules.

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

The daily cap holds under parallel requests. Counting the day's starts and adding
the new report happen in one transaction that first takes a lock on the company
(`pg_advisory_xact_lock`), and what is counted is `started_at`, which a new
report and every retry both set. A retry of a report first made on an earlier
day therefore counts today, and a retry at a full day is refused and leaves the
report as it was. (A report retried several times in one day counts once, since
a row has one start time; each retry also needs a run that failed, and the
per-person limit above applies.)

A request key is 8 to 200 characters of letters, digits and `_ . : -`. The same
person, in the same company, sending the same key with the same request gets the
first report back (its state as it stands) and nothing is started or counted.
The same key asking for something different (any change to what is asked,
compared by a fingerprint of the parsed request) is refused with a plain
sentence. A key that is not usable is refused, never quietly ignored.

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
