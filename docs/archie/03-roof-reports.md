# Roof reports

Roof reports were built in a separate program and are now being merged into
Archie (plan: `docs/superpowers/plans/2026-11-24-roof-reports-into-archie.md`).
A roofing company makes a roof report from an address, with or without photos:
an inspection, a measurement, a storm history, or any mix. Archie's own
documents (Inspection, Estimate, Proposal, Presentation, Combined) are not
changed; roof reports are their own family beside them.

This page covers what has been built so far: the tables, the photos, the
generation, the routes and the rules around them, the screens, the three looks,
the share link, emailing a report and (below) the PDF and rewriting a finding.
Comparison, satellite measurement and the copy of old reports come in later
stages.

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

Apply five migrations to the database, as the owner, before deploying code that
reads them. All five are safe under the code that is live today (0020, 0021, 0023
and 0024 only add tables nothing reads yet; 0022 only adds columns the live code never
names). Nothing in the build or deploy runs them. **0022 must be applied before
the code that names its columns is deployed**: that code reads `roof_reports`
with them, so deployed first it breaks every report read. 0023 should be applied
first too: the page route reads its table whenever it shows a presentation; a
deploy that got ahead of it would show the base presentation (a failed pack read
is treated as no pack), never an error, but apply it first anyway.

| file | what it adds | sha256 |
|---|---|---|
| `migrations/0020_roof_reports.sql` | `roof_reports`, `roof_report_photos` | `ace7bc60ebc3fc5d0dc040fb8d79ceb5b4300d5d34b8b23831b95b21c72ed55d` |
| `migrations/0021_model_costs.sql` | `model_costs` | `ca45ee62a6b90eaa514c94dca3bc702a4a679c93a36817b5aba80014a0b1a4a5` |
| `migrations/0022_roof_report_starts.sql` | `roof_reports.started_at` (filled from `created_at`, then required), `idempotency_key`, `request_hash`, and two indexes | `3bdf415c35ed403d629df6b7f723fc119cd6ec5b4065b35270078c13678b1e2e` |
| `migrations/0023_presentation_chapter_packs.sql` | `presentation_chapter_packs` (a new table only, one row a company) and the trigger that keeps the app from writing it | `5c2eeb75ec1f332563fc0294a78e0addd6b45191df479f4e4f5545080aab4c45` |
| `migrations/0024_roof_report_uses.sql` | `roof_report_uses` (a new table only: the record of each Send and each Rewrite, for the daily limits and the double click) | `c4d0d4a747bf6f9be230a1b18aeb5c384791a11feb4e9371bb010e7ac99d283a` |

Check the file you apply with `sha256sum` against the table. 0020, 0021, 0023 and 0024
need `0008` (the system role): each table is protected with the function `0008`
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

Moving a report to another job, or taking it off its job, takes more than being
allowed to change it (the `change_job` decision). The person must be able to see
the job it is on, **and** be the report's maker or a role that sees everything:
a salesperson or a manager may do it only for a report they made, never for a
colleague's or a team member's. The job it moves to must be one they may attach.
Putting a report that has no job onto one is not changing a job, and asking for
the job it already has changes nothing. Anyone else gets the plain "not found".

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
| `server/lib/roof-reports/__tests__/vendored-motion.test.ts` | the vendored motion library's bytes match the manifest and the hashes the page code carries |
| `server/lib/roof-reports/__tests__/report-nonce.test.ts` | every script every renderer writes carries the response's nonce, written where the renderer writes it; no renderer uses an inline handler; a script or handler that gets in anyway carries no nonce |
| `server/roof-reports/__tests__/packs-are-company-data.db.test.ts` | a pack is only ever read for the company in context; the app role never writes one; only the loader, a dry run by default, writes through the system role; a pack with problems is refused; no pack wording in code |
| `server/roof-reports/__tests__/public.db.test.ts` | the share link: one report and only its photos, the same plain page for an unknown, a turned-off and an archived link, the page's policy and headers, the rate limit, no token or internal id in a page |
| `server/roof-reports/__tests__/html-page.db.test.ts` | the page route: a fresh nonce on every response, the same one on every script in it, the sandbox and the other policy rules, the response headers |
| `server/crews/__tests__/crew-money-walk.db.test.ts` (existing) | crew are handed no money by any route; run it with the switch on to walk the roof report routes too |

## The routes

All under `/api/roof-reports` except the job's list and the two customer-link routes (`/r/roof/...`, which the hosting already sends to the server with the rest of `/r/*`; no hosting setting changes). Each needs the switch, a
signed-in person, and a role that may use roof reports.

| method and path | what it does |
|---|---|
| `GET /status` | `{ on, photoStore, analysis }`, never which keys are set |
| `POST /photos` | one raw JPEG body (`?category=`), cleaned and stored privately |
| `DELETE /photos/:photoId` | takes back a photo that is not in a report yet: its row and both stored copies. By the person who uploaded it, or a role that sees every report; anyone else, another company and a missing id are all "not found". A photo already in a report is refused with a plain sentence (409): reports and their photos are archived, never deleted. If the store cannot remove the copies the row stays, so it can be tried again |
| `GET /:id/photos/:photoId/:variant` | one photo copy (`working` or `thumb`), after the report's access rule |
| `GET /linked-photo/:token` | one photo copy for a short signed link; no session, the signature is the check |
| `POST /generate` | make a report; 40 a person every ten minutes, 200 a company a day (a new report and a retry both count). An optional `Idempotency-Key` header makes a repeated submit return the first report and start nothing |
| `GET /` | list (`search`, `kind`, `status`, `page`), 25 a page, only what the person may see. `status` filters on the status the list shows: a run still `generating` after eight minutes is shown as failed, so `failed` includes it and `generating` leaves it out |
| `GET /:id` | one report with its photos, no share token |
| `PUT /:id` | change the named fields only; anything else is refused |
| `POST /:id/archive` | put it away; nothing is deleted |
| `POST /:id/retry` | run a failed report again from what was typed and the photos it has |
| `GET /:id/html` | the page, built only by the escaped renderers, served in a sandbox |
| `GET /api/clients/:externalId/roof-reports` | a job's reports, after the check that opens the job |
| `POST /:id/share-link` | makes the customer's link for a finished report (or gives the one it has) and answers its address; needs the `share` decision |
| `DELETE /:id/share-link` | turns the link off for good; needs the `unshare` decision. Fine to ask twice |
| `POST /:id/rewrite-finding` | asks a model to rewrite one finding (body `{ index }`, its place in the list); needs the `rewrite` decision (the same right as editing); see "Rewriting a finding or the summary" |
| `POST /:id/rewrite-summary` | the same for the summary (empty body) |
| `POST /:id/send` | emails the customer a short note with the report's link (see "Emailing a report"); needs the `send` decision and an `Idempotency-Key` header |
| `GET /r/roof/:token` | the shared report's page. No sign-in: the token is the key (see "The share link") |
| `GET /r/roof/:token/photos/:photoId/:variant` | one photo copy of that report only |

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
- Under a nonce the renderers write no script from any outside host (the CDN
  tags of the motion layer are left out): the policy would block them. The
  classic document's motion is served by Archie itself instead. The animation
  library the old program used (GSAP 3.14.2 and its ScrollTrigger, under
  GreenSock's standard "no charge" licence) is vendored byte for byte into
  `client/public/roof-reports/motion/`, with a `manifest.json` that records its
  version, sizes and hashes; `vendored-motion.test.ts` holds that the bytes on
  disk are the bytes recorded and are never edited. The page loads the two files
  from the app's own address (`/roof-reports/motion`), each script carrying the
  response's nonce, and `report-motion.ts` accepts only that exact folder. Motion
  is an enhancement: every hidden starting state sits under a class only the
  motion script adds, so a page whose scripts do not run hides nothing
  (`motion-content-first.test.ts`). The two scroll styles need no library. A
  stored or exported page (no nonce) keeps the pinned CDN copy with its integrity
  hashes.
- `connect-src 'none'`, `form-action 'none'`, `default-src 'none'`, `base-uri 'none'`.
- **Images come only from the app** (photo links are absolute addresses on it),
  `data:`, `blob:`, and the one origin the company's logo is on when that is a
  plain https address. An injected image cannot send anything to another host.
- `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`,
  `Cache-Control: private, no-store`.
- A page a person saved runs nothing: a bare `sandbox`, no `script-src`, and the
  same image and header rules. Its styles may come only from
  `https://fonts.googleapis.com` and its fonts only from `https://fonts.gstatic.com`
  (and `data:`), never from any https address: a stylesheet elsewhere is a beacon.
  (A page the app builds keeps `https:` for both; it is made by the escaped
  renderers, not by a person.)
- **Where a saved page may point** (`server/roof-reports/page-links.ts`). The page
  is served at the share address under the company's brand, so a link in it to a
  host of someone's choosing is a phishing link wearing that name. A saved page
  may point only at: the app's own origin (or a relative address), a fragment,
  `tel:`, `mailto:`, the company's own website (exact origin from its brand
  record, scheme and port included), Google Fonts for styles and fonts, and for
  pictures also the company's logo origin and a small inline picture. It may not
  hold a `<base>`, a refresh `<meta>`, a `<form>`, a `ping`, a `formaction`, a
  script scheme, a `data:` page, or a `url()`, `@import` or `image-set()` that
  breaks the same rule in a style block or style attribute. The reader decodes
  character references and CSS escapes first, drops tabs and newlines the way a
  browser does, and resolves every address against the app's origin so `//host`,
  double backslashes and `/\host` are seen as the host they are. The rule runs twice: on
  save (`PUT /:id`, refused with a plain sentence that names the host, never a
  silent strip of what someone typed) and on every serve (`servedPage`, taking
  the piece out and keeping the rest, for pages saved before the rule). The
  sentence is `pageLinkNotAllowed` in `shared/roof-reports.ts`.

## Looks: document, presentation, flight

A report is shown in one of three looks, chosen in the editor (or the template's
usual one when none was chosen). `chooseStyle` in
`server/lib/roof-reports/render-report-html.ts` is the only place that decides,
and the page route (`renderReportHtml`) and the editor's answer both use it, so
what a person is told is the page they get. A flight needs 3 photos with a usable
address; a presentation needs 4 chapters of real content from the base set (a
company's own chapters never make a thin report presentable). A report with less
is shown as a document, and the editor says so under the Look control in one
plain sentence made from the counts, for example "This report has only 2 photos,
so it is shown as a document. A flight needs 3 or more." (`styleNotice` in
`shared/roof-reports.ts`; `GET` and `PUT /:id` carry `look: { shown, notice }`).
The price comes late in the presentation (`CHAPTER_ORDER`, held by its own test),
and the flight is stills only: no renderer writes a video element, source or
clip (`no-video.test.ts`, there is no ffmpeg on this hosting). Every script
either style writes carries the response's nonce. The deep-walk injection test
and the no-em-dash test run all three looks through the one renderer the route
uses, with a nonce, the motion address and a chapter pack applied.

## Presentation chapters (a company's own pages in the presentation)

Anything in a presentation that is a **promise** (how the crew works, what the
warranty covers, how long a job takes) belongs to one company and is that
company's **data**, never code, and is never chosen by matching a name, an email
domain or a website (anyone can type a company name). The base presentation says
only what the report found. A company with no pack gets exactly that.

- **Where it lives.** `presentation_chapter_packs` (migration 0023), one row a
  company, with the two standard company policies. The page route reads the pack
  of the company in context (`packForCurrentCompany`, `server/roof-reports/packs.ts`)
  and hands it to the renderer; row level security shows a company only its own
  row, so another company's pack is simply not there. A read that fails is no
  pack (the base presentation), logged by its kind only.
- **The app can never write one.** A trigger refuses every insert, update and
  delete made as `archie_app` (SQLSTATE 42501), for any company. The policies stay
  exactly the two every company table has (the isolation tests need that), so the
  trigger is the extra lock. The system role can read, insert and update a pack
  but not delete one (it is replaced, never deleted).
- **Only the operator script writes**, through the system role with a written
  reason (`runAsSystem`), for one named company:

  ```
  npx tsx scripts/load-presentation-pack.ts --company <company id> --file <pack.json outside the repo>
  npx tsx scripts/load-presentation-pack.ts --company <company id> --file <pack.json outside the repo> --apply
  ```

  The first form is a dry run (the default): it checks everything, says what it
  would do and writes nothing. A person reads the rendered presentation for that
  company before `--apply`. A file inside the repository is refused (a pack is a
  company's own words). It prints counts and chapter ids, never the words. Run it
  with the app's `DATABASE_URL` (user `archie_app`), as the other operator scripts.
- **A pack is checked** (`parsePack`, in the library) when it is loaded and again
  every time it is read back to be shown: exactly the known fields and nothing
  more (a field a pack has no place for, such as a script, a style, a link or an
  image address, is refused, never ignored); plain text with no angle brackets or
  control characters, with a size cap; ids that are plain lowercase ids; whole
  minutes from 0 to 120; only the two placeholders `{company}` and `{phone}`;
  anchors that are a standard chapter or an earlier pack chapter; and the pack's
  own `mustSay` and `mustNotSay` phrases. A pack with any problem is refused with
  plain sentences and nothing is written. At render, ids and minutes are checked
  again, and every word is escaped.
- **The placeholders** are filled in one pass, only from the company's own brand
  record the page was built with, never from the report and never from another
  company. (A `$` in a company's name is a `$`; it is not a replacement pattern.)
- **Nothing of any real company is in the code.** Tests use the fictional Summit
  Ridge Roofing in Cedar Falls. The permanent test scans the code for the test
  pack's wording and for any writer of the table other than the loader.

## The share link

A person who may share a report (`share` and `unshare` in `ROOF_REPORT_RULES`,
the same reach as sending: everything, a leader's team, or their own) makes a
customer link from the editor ("Copy link") and turns it off ("Turn link off").
Each click is answered in its own frame ("Making the link...", "Turning the link
off..."). Nothing is ever sent to the customer by it.

- **The token** is 32 random bytes, written as 64 hex characters, made when the
  link is made. It is stored as it is made, in `roof_reports.share_token`, the
  same way the share links of Archie's own documents (`/r/:token`) are, and is
  never listed or put in a report's answer (the answer says only `shareLinkOn`).
  Making a link is one statement that fills the token only where it is empty, so
  two people pressing at once get the same link. Turning it off clears the token;
  a link made afterwards is a different token and the old one stays dead.
- **It opens one report.** A narrow system lookup finds the report and its
  company from the token (and nothing else); everything after runs as that
  company. Only a finished report that is not archived opens: **archiving the
  report kills the link at once** (the row and the token stay, as for every
  archived report; the link stops working).
- **Unknown, turned off, archived, still being made, not a token: one answer.**
  They take one code path and give the same plain page ("This report is not
  available."), the same status (404) and the same headers, byte for byte
  (`public.db.test.ts` compares them). The page never says which it was.
- **The page** is built by the same code as the signed-in view (`page.ts`) and
  served under the same sandbox and nonce policy (no `allow-same-origin`; scripts
  only with the response's nonce; images only from the app). It is sent with
  `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex, nofollow`
  and `nosniff`. A page a person saved is shown as saved (no script), with every
  photo address in it turned into this link's own or taken out, so no other
  report's photo can be shown.
- **Photos** come only through `/r/roof/:token/photos/:photoId/:variant`, which
  asks for the photo and the report together: another report's photo id (of the
  same company or another) under this token is the same "not available". No
  storage key, company id, staff email or id, job key, cost or other report's
  id is in a page.
- **How often.** One address may ask for 120 pages in ten minutes (as the
  public page of Archie's own documents does) and 1,200 photos; past that it is
  answered a plain page to wait, with `Retry-After`.
- **Logging.** The token is a credential: it is never logged, and the request
  logger hides it in the addresses it writes down. Creating and turning off a
  link are written to the write log (without the token).
- **Held by** `public.db.test.ts`; both authenticated routes and both public
  routes are walked by `route-walk.db.test.ts` (with the switch off, as another
  company, as crew and as a salesperson who does not own the report);
  `share` and `unshare` have their rows in `roof-report-roles.db.test.ts`.

## Emailing a report

A person who may send a report (`send` in `ROOF_REPORT_RULES`: everything, a
leader's team, or their own) presses "Email this report" in the editor, checks
the customer's address and the optional note, and presses "Send email". Nothing
else sends: making, opening, editing, sharing and archiving a report never email,
and nothing runs on a schedule (`send.db.test.ts` holds this).

- **What is sent** is short and plain: a greeting, the company's name, the
  person's note (plain text, up to 1,000 characters, escaped, its line breaks
  kept) and one button with the report's share link. The link is made through the
  very same code as "Copy link" when none is on (`ensureShareToken`), so the two
  always give the same address. Never the report's contents, never a photo, never
  an attachment. It goes through the company's own email (`sendCompanyEmail`), from the
  person who pressed the button.
- **The address** comes from the request, is checked (one plain address: no names,
  brackets, quotes, lists or line breaks), and is used only to call the sender. It
  is never logged, never stored (the use record has no address column) and never put
  in an error: every failure is one of a few plain sentences, and a log line says only
  the kind of failure. The name and the address are refused if they hold a line break
  or a control character, so nothing typed can add a header to the email.
- **Counters** (`email_sent_count`, `email_sent_at`) change only after the sender
  hands back a message id, in the same step that closes the use record. A send that
  threw, or answered with no id, changes nothing and gives its place back.
- **A double click sends once.** The screen makes one request key for each try and
  sends it as `Idempotency-Key` (needed: no key is a 400). The second request with
  the same key finds the first and sends nothing; the same key asking for a
  different email is refused with a plain sentence.
- **Limits**: 5 a day for a report, 100 a day for a company, 20 a person in ten
  minutes. The daily two are counted from `roof_report_uses` and a place is taken in
  one transaction that first locks the company (the same approach as the cap on
  starting a report), so requests that arrive together cannot overrun them. Each
  refusal is a plain sentence.
- **Who**: crew and any role nobody decided are refused (the report is simply not
  there for them); a salesperson only for a report they may see; another company's
  report is "not found". The route is in the route walk and `send` has its row in
  the permanent roles test.
- **Tests never send**: the route takes the sender as an option, and every test hands
  in a fake. The repo's email sender has no test sink of its own.

## Rewriting a finding or the summary

Next to the summary and each finding in the editor there is a **Rewrite** button
(text only: no icon, no sparkle, no wand). Pressing it answers in the same frame,
on that one field ("Rewriting..."); the new words are saved at once and **Undo
rewrite** puts the old ones back through the field's ordinary save. Typing in the
field yourself forgets the undo. A box with unsaved typing cannot be rewritten
("Save your changes to this box first."), and only one rewrite runs at a time.

- **Who**: `rewrite` in `ROOF_REPORT_RULES`, exactly the right to edit (the
  permanent roles test holds that it equals `edit` for every role). Crew and another
  company's person get "not found". Both routes are in the route walk.
- **Metered**: each call goes through `meteredModelCaller`, so it writes one
  `model_costs` row (operation `rewrite`, tagged with the report) for the company
  that caused it. The model is the `rewrite` role in `models.ts` and nowhere else.
- **What the model is told** (`promptFacts`): that report's own finding, or for
  the summary that report's findings, with the roof's material, size and pitch and
  the storm counts. Never a name, address, contact, inspector note, id, another
  report, another company or a member of staff. The finding text is cleaned and cut
  first.
- **One deadline** (60 seconds) covers the call. What comes back is untrusted text:
  markup, fences, wrapping quotes, control characters and em dashes are taken out
  and it is cut to length (1,500 characters for a finding, 2,000 for the summary); a
  reply too short to be a narrative is a failure.
- **Stored only through the normalizer** (`sanitizeReportJson`, the one a hand edit
  goes through), and only if the report has not changed since it was read: an edit
  made while the model was thinking wins, and the person is told nothing was changed.
- **A failure** of any kind (no answer, a refusal, nothing usable, out of time) is one
  plain sentence and changes nothing. No provider words, error text or id reaches the
  screen or a log; a log line says only the kind of failure.
- **Limits**: 20 a day for a report, 300 a day for a company, 30 a person in ten
  minutes, counted and taken in one locked step like the email limits (same table,
  `roof_report_uses`). A rewrite that reached the model counts even if it did not work
  (it may have cost money); one that could not start because no model is set up uses
  nothing up and answers "Rewriting is not available right now."
- Two rewrites of the same report that arrive together each ask the model (both
  count), but only the first to finish is stored; the other finds the report already
  changed and says so.

## The PDF

"Download PDF" in the editor makes a printable copy **on the person's own device**:
the server is not asked to make it. The button answers in the same frame
("Preparing PDF...") and says one plain sentence if it fails; a second press while
it is preparing does nothing.

- **The library loads only on that click.** `@react-pdf/renderer` is pinned to
  exactly `4.5.1` (the version the old program ran) and is reached by one dynamic
  import (`client/src/roof-reports/pdf-loader.ts`); nothing else imports it or the
  `pdf/` folder in the ordinary way (`pdf-lazy.test.ts` reads the source and fails if
  anything does). Built sizes, checked by hand: the page everyone opens
  (`index-*.js`) was 1,555.75 kB before the PDF work and is 1,558.93 kB after (the
  button, its small model and its words, +3.2 kB); the PDF library and the document
  are a separate chunk of 1,467.59 kB that is fetched only on the click.
- **No network is used to make it.** The PDF's own built-in fonts (Helvetica) are
  used. The old program fetched five font families from a font host at run time; that
  is not carried over.
- **Photos** are fetched from this report's own signed-in photo route, the small copy
  of each (480 pixels), a few at a time. Only an address of exactly the form
  `/api/roof-reports/<this report>/photos/<photo>/thumb` or `/working` is ever
  fetched, and the reply must be a JPEG or PNG; a photo that fails is left out and the
  rest go in.
- **Charts** (`pdf/chart-capture.ts`) are two plain canvas bar charts, not a chart
  library: storm events by year and damage found by kind. They draw only from report
  numbers: every text on a chart is a count (0 to 99,999), a four digit year or one of
  a fixed set of words in that file; a damage kind with no word there is "Other".
- **Everything written in the report** (summary, findings, notes, captions, a
  company's name) is cleaned and cut to length before it is drawn (`pdfText`): no
  control or invisible characters, no emoji, no em dash, one kind of line break.
- **What the PDF holds**: a cover, then only the sections the report has (summary,
  findings, damage found, storm history, estimate, measurements, photos, notes) and
  a plain note that it is not a guarantee of insurance coverage. The old program's
  longer layout (fifteen sections, lifespan gauge, radar, ROI and bubble charts,
  replacement tiers) is not carried over.

## The wizard's draft in the browser

The wizard keeps a draft in the browser (`client/src/roof-reports/draft.ts`) for
24 hours so a refresh does not lose work. It holds a homeowner's name, email,
phone and address and the inspector's notes, so it never outlives the sign-in
(`draft-clean.ts`, called from `client/src/lib/auth.tsx`): every key starting
`archie.roofReportDraft.` (the drafts in local storage and the "wizard was open"
markers in session storage) is removed on sign-out, when the session ends (the
expiry event and a 401 or 403 from the session check), and, on any sign-in, the
drafts of everyone but the person who just signed in. Whenever the roof reports
page loads, every draft of anyone that is past its day, from a clock far ahead,
not readable or of another version is removed too. Blocked storage means nothing
to clear, said to nobody. The functions are pure over a storage and are tested
in `draft-clean.test.ts`.

## Photos

Report photos are kept in Archie's private photo store under
`c/<company>/rr/...`, never at a public address. What is stored is a JPEG with
every metadata block taken out (`server/photos/jpeg-clean.ts`), so no location
ever reaches the store. An upload is checked by what it is: a real JPEG (SVG,
PNG, HEIC and the rest are refused), no larger than the size cap, and at most
100 photos waiting unused per person per day; a report holds at most 40.

Each photo is stored twice: the full cleaned copy (the working copy the report and
the analysis use) and a real thumbnail, made from the cleaned copy by
`server/roof-reports/thumbnail.ts`: the longest side shrunk to 480 px (never
enlarged), written as a fresh JPEG that holds only a bare JFIF header and the
picture, then walked by the same cleaner, so no location can come through it.
It is made with `jpeg-js` (pure JavaScript, no native code, no dependencies,
about 76 KB), the only JPEG library Archie has and the one added for this. A
picture that cleans but cannot be decoded, or that claims more than 48 million
pixels, keeps the cleaned copy as its thumbnail, as it always was.

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

**Why the token is in the address.** A cookie or a header would keep it out of
access logs, but the page is sandboxed without an origin of its own: a cookie is
not sent with its image requests (they count as cross-site), an `<img>` cannot
carry a header, and the page's script may not connect anywhere (`connect-src
'none'`), which is what would turn a header into a blob. Loosening the sandbox
to get one would be the larger risk, so the token stays in the address and is
kept to one purpose: one photo copy of one report, signed with a key made for
this alone, `GET` only, and **ten minutes**, which is as short as a long page
needs (its pictures load as the reader scrolls to them). The app itself never
writes the address down with the token in it: both entrypoints use
`requestLogger` (`server/lib/request-log.ts`), and `loggablePath` also hides it
in the address a recorded server failure keeps. The host's own access logs are
not the app's to change, which is the other reason for the ten minutes. The
photo response sends `Referrer-Policy: no-referrer`.

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
company that caused it. The storm step's Google geocoding lookup is a paid call
too, and is recorded the same way (`operation = 'geocode'`, provider `google`,
no tokens) once for each lookup made, answered or not. Its price is
unconfirmed, so the row is unpriced: 0 cents and `priced = false`, never a
guess. No schema change was needed for it (the table already holds `google` and
the operation is free text). Only the two Anthropic prices are confirmed. The Groq
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
