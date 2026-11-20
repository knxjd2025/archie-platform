# The Roof Lee link

Roof Lee is the front door of a three-product family (Roof Lee, RoofN, Archie).
When a roofing company signs up in Roof Lee, Roof Lee asks Archie to make the
matching company, keeps its team up to date, and can pause or close it.

The agreement between the two products is written in the Roof Lee repository:
`docs/sisters/contract-v2.md` (version 2), which builds on
`docs/sisters/provisioning-contract.md` (version 1). That document is the
authority. This page says how Archie's half is built.

## It is off until the owner turns it on

Three settings, all unset by default:

| Setting | Unset means |
|---|---|
| `SISTERS_ARCHIE_SECRET` | Every request under `/api/sister` is refused with a bare `401`, no sign-in ticket is accepted, and no news is recorded or sent. Nothing about the link runs. |
| `SISTERS_ARCHIE_READY` | Archie answers "not ready", so Roof Lee shows no Archie button and uses no Archie tool for anyone. |
| `ROOFLI_EVENTS_URL` | Archie records and sends no news (a new lead, a finished job) for anyone. |

One optional setting, `ROOFLI_JOB_FINISHED_STAGE`, says which stage of the
production board means "job finished" for Roof Lee. Unset, it is `closed_out`.

Once migrations `0011_roofli_sister.sql` to `0016_job_photos.sql` are
in the database, deploying this code with none of these settings changes
nothing for any existing company.
The one visible difference is a new scheduled knock every ten minutes at
`/api/cron/sister-events` (`vercel.json`), which answers at once that there is
nothing to do. The
migrations have to be there first: see "Before deploying this code" below.

`SISTERS_ARCHIE_SECRET` is a fresh secret for this pair only. It is never
copied from another product, another repository or an older shared secret.
Archie never reads `SISTERS_SHARED_SECRET` at all.

Archie's own private photo store (the job photos of a company Roof Lee made,
"Photos" under "Archie's own jobs" below) has four settings of its own:
`ARCHIE_PHOTOS_ACCOUNT_ID`, `ARCHIE_PHOTOS_ACCESS_KEY_ID`,
`ARCHIE_PHOTOS_SECRET_ACCESS_KEY` and `ARCHIE_PHOTOS_BUCKET`. With any of them
unset the store is off: adding a photo to such a job answers "Photo storage
isn't switched on yet. Please try again later." and nothing else changes. No
other company's photos ever go there.

## Go-live checklist (owner only, in this order)

The whole job on one page. The sections below explain each step; this list is
what to tick off. Nothing here has been done for you: no migration has been
applied to a hosted database, no setting has been set, nothing has been
deployed. Stop at any step that does not check out.

**A. Database, before anything is deployed**

1. Run the four checks in step 1 of "Before deploying this code" below, as the
   database owner. They must show: the applied list ends at
   `0010_company_job_leases.sql`; `0008` is in force (not reverted); no
   company already holds two leads with the same `archie-` id.
2. From a checkout of this branch, apply the six migrations as the owner, in
   this exact order (the command does the order for you, one transaction each):
   1. `0011_roofli_sister.sql`
   2. `0012_roofli_sso.sql`
   3. `0013_roofli_lead_notes.sql`
   4. `0014_roofli_events.sql`
   5. `0015_archie_native_jobs.sql`
   6. `0016_job_photos.sql`

   (The numbers are provisional: they are renumbered after the Archie team's
   own migrations when the two branches meet. Apply whatever numbers this
   branch holds at the time, in order.)

   `DATABASE_URL=<owner url> npx tsx scripts/migrate.ts`
3. Check it worked: step 4 of "Before deploying this code" (three small reads
   that must not error, and five tables each showing
   `{company_isolation,company_system}`).

**B. Deploy the code, with the link still off**

4. Merge this branch into main (that is the deploy). Set no new setting yet.
   Check: people still sign in, leads still show, and
   `GET /api/sister/v1/ready` answers a bare `401` (the link is off).

**C. Settings, by name, and where each one goes**

| Setting | Where | Value |
|---|---|---|
| `SISTERS_ARCHIE_SECRET` | Archie's hosting **and** Roof Lee's hosting | One freshly made random secret, the same on both sides, used for nothing else. Never copied from another product. |
| `SISTERS_ARCHIE_URL` | Roof Lee's hosting only | Archie's own `https://` address, nothing after it. |
| `CRON_SECRET` | Archie's hosting | Already there for Archie's other scheduled jobs; just check it is set. |
| `ROOFLI_EVENTS_URL` | Archie's hosting | Roof Lee's own `https://` address (its `APP_BASE_URL`). Set at step 7, not before. |
| `ROOFLI_JOB_FINISHED_STAGE` | Archie's hosting, optional | Which production board stage means "job finished". Leave unset for `closed_out`. |
| `SISTERS_ARCHIE_READY` | Archie's hosting | `true`. Set **last**, at step 9. |
| `ARCHIE_PHOTOS_ACCOUNT_ID` | Archie's hosting (already set) | The Kynex Cloudflare account that holds the photo bucket. Never the Best Roofing Now account. |
| `ARCHIE_PHOTOS_BUCKET` | Archie's hosting (already set) | `archie-job-photos` on Production, `archie-job-photos-test` on Preview. Both private, with no public address. |
| `ARCHIE_PHOTOS_ACCESS_KEY_ID` | Archie's hosting, entered by James | An R2 key limited to that one bucket (read and write objects, nothing else). |
| `ARCHIE_PHOTOS_SECRET_ACCESS_KEY` | Archie's hosting, entered by James | Its secret. Never pasted anywhere else. |

The photo store needs no CORS rule yet: the phone sends each photo to Archie,
and Archie puts it in the bucket. (A rule letting phones send the full-size
original straight to the bucket comes with that later work, A2b.)

Archie never reads `SISTERS_SHARED_SECRET`. Do not set it in Archie.

**D. Switch on and prove it with a test company**

5. Set `SISTERS_ARCHIE_SECRET` on both sides and `SISTERS_ARCHIE_URL` in Roof
   Lee. Check: `GET /api/sister/v1/ready`, signed, now answers "not ready"
   instead of `401`.
6. Make the throwaway test company (Summit Ridge Roofing in Cedar Falls) from
   Roof Lee. Check: it appears in Archie with its team; change its team, and
   the change shows in Archie; its capabilities answer lists
   `messages.quiet` and `jobs.native`, and `photos.native` once the four photo
   settings are in (with any of them missing it is left out).
7. Set `ROOFLI_EVENTS_URL` (only once Roof Lee is ready to receive news). Add a
   lead by hand in the test company in Archie. Check: Roof Lee shows a
   `lead.created` for it within a minute or two.
8. From Roof Lee: add a lead, move it to Approved, open Archie as the test
   company's owner. Check: the lead is on Archie's production board, the
   sign-in lands in the right company, the same button does nothing for
   someone taken off the team, and no text or email went to the test customer.
   On that job's page, add a Before photo with a caption, open it large, and
   save the large copy: it opens, and it carries no location (no Exif block).
   Fill in its pre-construction checklist with photos from the phone and
   submit it: the job moves to Schedule Job. Turn on "Customer agreed to
   photos of this job being used", then ask Archie for the job from Roof Lee
   (signed `GET .../jobs/{id}`): its `photos` list the photo with its phase
   and caption, and the signed photo address gives back a JPEG with no
   location in it. Turn the switch off again: the list is empty and the photo
   address answers `404`.
   Then pause and close the test company and check nobody can sign in to it.
9. Only now set `SISTERS_ARCHIE_READY=true`. Check: the signed
   `GET /api/sister/v1/ready` answers ready, and Roof Lee shows its Archie
   button.

**To switch it off again**: unset `SISTERS_ARCHIE_READY` (Roof Lee stops
using Archie), or unset `SISTERS_ARCHIE_SECRET` (everything under
`/api/sister` refuses at once). Leave the migrations in place either way.

## Before deploying this code (owner only, must come first)

**Apply migrations `0011` to `0017` to the database before this code is
deployed. Not after, and not as part of switching the link on.**

| Migration | What it adds | When |
|---|---|---|
| `0011_roofli_sister.sql` | `companies.roofli_company_id`, `team_members.auth_user_id` and `source`, the table `sister_idempotency` | **Before deploy.** The code reads these columns on every sign-in and every company read. |
| `0012_roofli_sso.sql` | the table `sister_sso_tickets` | Same step. Nothing touches it until the link is on. |
| `0013_roofli_lead_notes.sql` | the table `lead_notes` | Same step. Nothing touches it until the link is on. |
| `0014_roofli_events.sql` | the table `outbound_events` | Same step. Nothing touches it until the link is on. |
| `0015_archie_native_jobs.sql` | six columns on `leads`, one partial unique index | **Before deploy.** The code reads these columns on every read of a lead. |
| `0016_job_photos.sql` | the table `job_photos` | Same step. Only the photos of a job of Archie's own read or write it, and only a company Roof Lee made has one. The number is provisional (renumbered when the branches meet). |
| `0017_crews.sql` | the tables `crews`, `crew_members`, `crew_assignments`, `job_milestones` | Same step. Only the crew and install routes read or write them, and they answer 404 to every company Roof Lee did not make. Provisional number, like `0016`. |

Why the order matters. This code reads the new columns every time it reads a
person, a company or a lead, whether or not the link is switched on. Deployed
against a database that does not have them yet, sign-in fails for everyone
("column team_members.auth_user_id does not exist"), so does all scheduled
company work ("column roofli_company_id does not exist"), and so does every
screen that shows a lead. Nothing in the build or the deploy runs migrations,
so this is a step a person has to do.

The other order is safe. The code that is live today names none of the new
columns or tables, so it carries on exactly as before with all seven applied:
the new columns are null (and `photo_consent` false) for every existing row,
the new index is empty, and the new tables are empty.

**How this sits with `0006` to `0010`.** Those five are main's and are already
in the live database; these seven come after them and change none of them.
They need `0008` (the system role) to be there, because each new table gets
its row level security from `archie_protect_company_table()`, which `0008`
created: the company's own rows for everyone, every row for the
`archie_system` role only, no `OR`. Note the order is the opposite of `0008`'s
own ("deploy the code first, then run the migration",
docs/archie/01-multi-company.md): here it is migrate first, then deploy. Both
hold at once because the code that is live already has `0008`.

1. Check where the database stands, as the owner. The list must end at
   `0010_company_job_leases.sql`, with no `roofli` name in it:
   `select name from _migrations order by name;`
   `select to_regprocedure('archie_protect_company_table(regclass)') is not null;`
   must answer `t`. Then make sure `0008` is in force and was not reverted
   (`scripts/sql/revert-0008-rls-system-role.sql` leaves that function in
   place, so the line above cannot tell). This must return no rows:
   `select tablename from pg_policies where schemaname = 'public' and qual like '%archie_is_system%';`
   and this must return more than zero:
   `select count(*) from pg_policies where schemaname = 'public' and policyname = 'company_system';`
   If either is wrong, `0008` was reverted: go forward again first, as
   01-multi-company.md says, and only then carry on here. Last, `0015` adds a
   unique index, so no company may already hold two leads with the same
   `archie-` id. This must return no rows:
   `select company_id, external_id, count(*) from leads where external_id like 'archie-%' group by 1, 2 having count(*) > 1;`
2. If `leads` is large, build `0015`'s index by hand first so writes to leads
   are not held up while it is built (the statements are at the top of
   `migrations/0015_archie_native_jobs.sql`; one statement at a time, on a
   direct connection). On a small table skip this.
3. Apply the migrations as the database owner, at a quiet hour, **from a
   checkout of this branch** (the command applies the files in the folder it
   is run from; run from main it finds nothing new, says so and exits clean):
   `DATABASE_URL=<owner url> npx tsx scripts/migrate.ts`
   It skips the eleven already applied and runs `0011` to `0017` in order,
   each in its own transaction. Each takes its locks for milliseconds and
   waits at most 5 seconds for one (`lock_timeout`); if one fails on the
   timeout, run the command again.
4. Check they are there: `select auth_user_id, source from team_members limit 1`,
   `select roofli_company_id from companies limit 1` and
   `select job_type, photo_consent from leads limit 1` all run without an
   error, and this returns nine rows, each with `{company_isolation,company_system}`:
   `select tablename, array_agg(policyname::text order by policyname) from pg_policies where tablename in ('sister_idempotency','sister_sso_tickets','lead_notes','outbound_events','job_photos','crews','crew_members','crew_assignments','job_milestones') group by 1;`
5. Only then deploy this code. Merging this branch into main IS the deploy,
   so steps 1 to 4 come before the merge. A preview build of this branch, if
   previews use the same database, fails sign-in and lead screens until then;
   that is this step not done yet, not a fault in the build.

If this code is ever rolled back, leave the migrations in place: the older
code does not notice them. (Main's rule still stands: never run code older
than `0008` against this database without reverting `0008` first. The revert
script and a later rerun of `0008` both cover the link's tables too.)

A link switched on without `0012` to `0014` answers every sign-in and every
request from Roof Lee with a refusal, which is why they go in the same step.

## Where the code is

| File | What it does |
|---|---|
| `server/sister/verify.ts` | Roof Lee's signing code, pasted word for word. Do not edit here. |
| `server/sister/door.ts` | Checks the signature on every request before anything else runs. |
| `server/sister/routes.ts` | The endpoints. |
| `server/sister/contract.ts` | Reads what Roof Lee sends. Maps its six roles to Archie's. |
| `server/sister/companies.ts` | Makes, updates, pauses and closes a company. |
| `server/sister/setup.ts` | Sets a new company up (advisors, knowledge base) once, and records it the way the seed cron does. |
| `server/sister/members.ts` | Makes the people Roof Lee sent exactly the list it sent, and leaves the people the company added in Archie alone. |
| `server/sister/facts.ts` | What Archie takes from a company's confirmed facts. |
| `server/sister/idempotency.ts` | Does a write once, however many times it arrives. |
| `server/sister/ticket.ts` | Roof Lee's sign-in ticket reader, pasted word for word. Do not edit here. |
| `server/sister/sso.ts` | One sign-in: spends a ticket and says who it signs in. |
| `server/sister/acting.ts` | Finds the person a request is for on the company's own team, and applies Archie's role rules to them. |
| `server/sister/leads.ts` | Leads, jobs and notes as Roof Lee's assistant reads and changes them, and a job's photos, with the customer's agreement only. |
| `server/sister/capabilities.ts` | What Archie says it can do for one company. |
| `server/sister/quiet.ts` | The messages Archie sends a customer by itself, and the one switch that says whether it may. |
| `server/integrations/ghl/new-contact.ts` | What happens when a new contact arrives from KynexPro. Skips a contact Roof Lee made. |
| `server/production/native-jobs.ts` | Archie's own jobs: the job identity Archie makes, who gets one, which system keeps a job (`jobBackendFor`, the one seam), and the record of a customer agreeing to photos. |
| `server/production/native-leads.ts` | A lead made in Archie (the lead form, a canvassed door) for a company that keeps its own jobs: its key, its first owner, the log line and the news. |
| `server/production/native-job-page.ts` | The client page for a job Archie keeps: its notes, a corrected phone or email, its messages and where it sits on the Production board. |
| `server/sister/events.ts` | News going back to Roof Lee: the outbox, the signing, the sending and the retries. |
| `server/photos/routes.ts` | A job's photos: from JobTread for a JobTread job (as before), from Archie's own store for a job Archie keeps (asks `jobBackendFor`). |
| `server/photos/native.ts` | Photos of a job Archie keeps: adding, listing, changing and deleting them, and who may; the check that a checklist names only the job's own photos; the list Roof Lee is told. |
| `server/photos/store.ts` | Archie's private photo store (Kynex's R2 bucket, S3-compatible). The only place its settings are read. Never a public address. |
| `server/photos/jpeg-clean.ts` | Takes every metadata block (location included) out of a JPEG before it is stored, and again before one is handed to Roof Lee, and checks its own work. |
| `shared/job-photos.ts` | The phases, the categories and the caption limit, shared by the server and the screens, and `photoAnswerIds` (the photos a checklist names). |
| `shared/crews.ts` | Crews and install dates: the booking check in plain words, company calendar dates and weeks, the crew's forward-only steps, the milestones, and `isCrewSeat` for billing. |
| `server/crews/access.ts` | `crewJobFor`, the one crew check: a job booked for this person's crew. Never `ownsLead`. |
| `server/crews/view.ts` | `crewJobView`, the allow-list of what a crew sees about a job. No money. |
| `server/crews/store.ts` | Crews, their people, a job's install, the crew week and the milestones, in the database. |
| `server/crews/routes.ts` | The office's crew and install routes and the crew's phone routes. 404 for every company Roof Lee did not make. |

Both entry files (`server/index.ts` and `api/index.ts`) keep the raw body for
`/api/sister` ahead of `express.json`. The signature is over the bytes as they
arrived, so without that nothing verifies. A test boots `api/index.ts`, the
production entry, to prove it.

## How it fits Archie's database rules

The rules are in docs/archie/01-multi-company.md. The link follows them like
any other part of Archie:

- **Its five tables** (`sister_idempotency`, `sister_sso_tickets`,
  `lead_notes`, `outbound_events`, `job_photos`) are company tables: each has a
  `company_id` and is protected in its migration with
  `archie_protect_company_table()`, so it has exactly the two policies every
  company table has. `isolation.test.ts` and `system-role.test.ts` find them
  in the database by themselves and hold them to the same checks.
- **Work for one company runs as that company** (`runAsCompany`), after the
  company has been found from Roof Lee's id.
- **Work across companies is system work** (`runAsSystem`, which runs as the
  `archie_system` database role), kept to these: finding a company by Roof
  Lee's id, making or updating or pausing one company's own row (a company
  cannot write its own row), asking whether an email address already belongs
  to someone, and the scheduled run asking which companies have news waiting.
  Each names its reason and reads or writes as little as it can.
- **A new company is set up once, after the answer.** Seeding is never done
  before a request is answered. `setup.ts` seeds the company as itself and
  records it in `company_job_runs` under the seed job, exactly as
  `provisionCompany` in `server/seed.ts` does, so `/api/cron/seed-companies`
  does not seed it a second time for the same version, and a repeat of the
  request seeds nothing. If it fails, or the company was made while paused,
  that cron (or the request that makes it live) sets it up later.
- **A full database is answered `503`** with `Retry-After`, the same as every
  other route, not `500`. The request's key is let go of so Roof Lee can send
  it again. If the database was too full even for that, the key stays held for
  up to a minute, and a repeat in that time is also answered `503` with
  `Retry-After`: "not yet", never a refusal.
- **The scheduled news run** takes companies in a fixed order, the one whose
  news has waited longest first, so a run that is cut short moves on next
  time instead of starting with the same companies.

## Endpoints built so far

| Method | Path | Signature |
|---|---|---|
| `POST` | `/api/sister/v1/companies` | version 1 (timestamp and body) |
| `PUT` | `/api/sister/v1/companies/{roofliCompanyId}/members` | version 1 |
| `GET` | `/api/sister/v1/ready` | version 1 |
| `GET` | `/api/sister/v1/companies/{roofliCompanyId}` | version 2 (also the method and address) |
| `DELETE` | `/api/sister/v1/companies/{roofliCompanyId}` | version 2 |
| `POST` | `/api/sister/v1/sso` | none: the browser posts a one-time ticket |
| `GET` | `/api/sister/v1/companies/{roofliCompanyId}/capabilities` | version 2 |
| `GET` | `/api/sister/v1/companies/{roofliCompanyId}/jobs` | version 2 |
| `GET` | `/api/sister/v1/companies/{roofliCompanyId}/jobs/{id}` | version 2 |
| `POST` | `/api/sister/v1/companies/{roofliCompanyId}/leads` | version 2 |
| `PATCH` | `/api/sister/v1/companies/{roofliCompanyId}/leads/{id}` | version 2 |
| `POST` | `/api/sister/v1/companies/{roofliCompanyId}/leads/{id}/notes` | version 2 |
| `POST` | `/api/sister/v1/companies/{roofliCompanyId}/jobs/{id}/stage` | version 2 |
| `GET` | `/api/sister/v1/companies/{roofliCompanyId}/jobs/{id}/photos/{photoId}` | version 2 (with the customer's agreement only, see "Photos" below) |

Each address takes exactly one form of signature and never the other. Anything
else under `/api/sister` answers `404` to a signed request and a bare `401` to
an unsigned one.

Archie also sends: `POST {Roof Lee}/api/sister/v1/events` (version 2
signature), and answers its own scheduler at `GET /api/cron/sister-events`
(`CRON_SECRET`).

Every Archie task in Roof Lee's Stage 1 plan (A1 to A9) is now built. What is
left is the live step ("Turning it on" below).

## Read and write for Lee

Lee is Roof Lee's assistant. These endpoints let it read a company's leads
and jobs, add a lead, change one and add a note.

- **The company comes from the address**, by Roof Lee's id, and the work then
  runs as that company. A lead id that belongs to another company answers
  `404`, exactly as if it did not exist. A company that is paused or closed
  answers `409` to all of these: Archie does nothing for it.
- **Who it is for.** A write names the person in its `acting` block; a read in
  its address (`?actingUserId=...&actingRole=...`). Archie finds that person
  on the company's own team by their shared sign-in id and applies its own
  role rules (`shared/rbac.ts`) to the role it holds for them. Where Roof Lee
  states a lower role than Archie holds, the lower one counts. Someone not on
  the team, or added in Archie rather than sent by Roof Lee, is answered
  `403`.
- **What each role gets.** Owners, admins, office staff and sales managers
  can see and work every lead, owned or not. A sales manager works like the
  office (Roof Lee's own words), so Archie holds them as office staff
  (`customer_service`): every customer and lead, no money, and no reporting
  line needed. Their approving happens in Roof Lee. A salesperson (a sales
  rep here) sees and changes only their own leads and jobs, in reads and
  writes alike: anyone else's is answered `404`, exactly as if it did not
  exist, whether it is read, changed, noted or moved. Crew (the production
  role here) cannot see leads in Archie at all: a list comes back empty, one
  lead answers `404`, a write `403`.
- **A write is done once.** Every write must carry an `idempotency-key`. A new
  lead, and a new note, are saved in the same transaction as the answer to
  that key, so the same key can never make a second one. A refusal is not
  remembered, so the same request can be sent again once the team list has
  caught up.
- **A lead Roof Lee adds stays in Archie.** It is stored with source `roofli`,
  with no call to JobTread, KynexPro or anything else, and no message to
  anyone. It gets its job key at once and starts in `New Lead` (so its
  `stage` in an answer reads `New Lead` until it is moved), which lets office
  staff open it in Archie. A lead added for a salesperson is theirs from the
  start (one `rep_assignments` row, written with the lead), so they can open
  it straight away, the same rule as Archie's own lead form. Anyone else's,
  a sales manager's included, has no owner yet and waits on the Assignments
  page; they see it already. Every change is written to the company's log under the person it was
  for.
- **Ids** are Archie's own row numbers, as digits. Leads and jobs share one
  list; a record is a `job` once it sits on the production board and a `lead`
  until then.
- **Fields.** `message` is the lead's standing note (`leads.notes`), which
  `PATCH` replaces when it sends `notes`. `notes` in an answer is the list of
  notes added one at a time (`lead_notes`, migration `0013`), newest first.
  No money is ever in an answer.
- **Photos** (Stage A4, Archie's side). `photoConsent` is `true` only when a
  person recorded, in Archie, that the customer agreed (the switch on the
  job's page). Only then, and only for a job Archie keeps, `photos` lists the
  job's own photos (`server/sister/leads.ts` `getJob`, `photosForRoofLee` in
  `server/photos/native.ts`), and the photo address hands one over
  (`jobPhotoFile`):
  - **The list.** Ready photos only (never one that is deleted or never
    finished saving), Before, then During, then After, then any with no
    phase, oldest first within each (by when it was added to Archie), at most
    40, because Roof Lee keeps at most 40 a job. Each is exactly
    `{ id, phase, caption, takenAt }`: nothing about who added it, where it is
    kept or how big it is.
  - **One photo.** The job's working copy (up to 1600 pixels), sent as the
    file's own bytes with `content-type: image/jpeg`, never a redirect and
    never a link. It was cleaned of every metadata block when it was taken in,
    and it is cleaned and checked again on the way out
    (`server/photos/jpeg-clean.ts`), so a copy that reached the store some
    other way still carries no location; one that is not a whole JPEG is not
    handed over at all.
  - **Not found.** `404`, exactly as for a photo that is not there, when the
    job has no recorded agreement (including one taken back), the photo is
    deleted or never finished saving, it is another job's or another
    company's, the job is one this person may not see (a crew sees none, a
    salesperson only their own), or the id is not one of Archie's photo ids.
    With the photo store switched off, a photo that would otherwise be handed
    over is answered `503` with "Photo storage isn't switched on yet. Please
    try again later."
  - The scheduled run, which names nobody, reads the company's own job.
- **Capabilities.** Each is worked out in `server/sister/capabilities.ts` from
  the switch the feature itself reads, never typed as a fixed answer.
  `jobs.native` and `messages.quiet` are both reported for every company Roof
  Lee made. `photos.native` is reported for such a company only while the
  photo store is switched on (all four `ARCHIE_PHOTOS_*` settings present,
  `photoStoreConfigured`), the same switch that lets a photo be added. Roof
  Lee adds and changes no lead and moves no job until it has heard
  `messages.quiet`, and Archie holds itself to the same rule: adding a lead,
  changing one and moving a job answer `409` for a company that is not quiet
  (moving a job also needs `jobs.native`). Reading and adding a note are not
  held back.

### The agreement's photo section, as Archie holds to it

Archie keeps no copy of `docs/sisters/contract-v2.md` itself (the Roof Lee
repository holds the one copy, and that copy is the authority). This is the
wording of its photo section that this code is built to, and the change it
needs there:

> - `GET .../jobs/{id}`: `{ "job": { ...the same fields, "address", "message",
>   "notes": [ { "text", "at" } ], "photoConsent", "photos": [ { "id",
>   "phase", "caption", "takenAt" } ] } }`. `id` must be the one asked for.
>   `photoConsent` is `true` only when the customer agreed to their photos
>   being used; `photos` lists uploaded photos only, and is left empty
>   without that consent. `phase` is `before`, `during`, `after` or `null`;
>   `caption` is the caption a person gave it, or `null`; `takenAt` is when
>   the photo was taken, or `null` when that is not known. The list is in
>   this order: Before, then During, then After, then any with no phase,
>   oldest first within each (by when it was added to Archie), and holds at
>   most 40.
> - `GET .../jobs/{id}/photos/{photoId}`: the file itself, a JPEG with no
>   location data in it (at most 30 MB), with its `content-type`. `404` when
>   the job has no recorded consent, or the photo is not an uploaded photo of
>   that job. Never a redirect and never a link to somewhere else: Roof Lee
>   does not follow one.
>
> **Photos of a finished job.** Roof Lee fetches them only when the
> `job.finished` event said `photoConsent: true` and `GET .../jobs/{id}` still
> says so when asked. Each is kept as a private copy in Roof Lee. Nothing is
> made public or published because of the event.

## No messages of its own

For a company Roof Lee made, Archie sends a customer nothing by itself. Such a
message would skip Roof Lee's approval, its cap per company and its cost
ledger.

"By itself" means nobody pressed send on that message: it goes out because a
lead arrived, because an advisor (a model) decided to, or because a schedule
came round.

What was found by reading the code, and what was done:

| Feature | Where | Now |
|---|---|---|
| The text a new lead gets the moment it arrives (speed to lead) | `CMOAgent.handleNewLead`, reached from the KynexPro, JobTread and Twilio webhooks | Asks the switch. Off for a Roof Lee company: the lead is kept and scored, nothing is sent. |
| A text an advisor decides to send a lead | the marketing advisor's `send_sms_to_lead` tool (chats, tasks, the scheduled advisor run) | Asks the switch. Off for a Roof Lee company. |
| A payment reminder an advisor sends | the finance advisor's `send_payment_reminder` tool and its overdue sweep | Asks the switch. Off for a Roof Lee company. |
| Follow-ups | `server/followups`, the advisors' follow-up tasks | Nothing is sent to a customer: a follow-up is a task for a person. Listed in the switch for whoever builds a sent one. |
| Review requests | the marketing advisor's `draft_review_request` | Nothing is sent: it only writes the words for a person. Listed in the switch for the same reason. |

Not counted, because a person presses send on each message: a text or email
written on a contact or a lead, a signature request and its reminder, a
certificate of completion, an insurance letter. Also not counted: the signed
copy emailed back to a customer after they sign a document a person sent
them, and mail to the company's own people (password links, the daily
reminder to reps). None of these can leave for a Roof Lee company today in any
case, because it has no sending account of its own in Archie.

How it is kept:

- **One switch.** `server/sister/quiet.ts` lists every such feature and
  answers one question, `maySendOwnMessage(kind)`, which each feature asks
  just before it would send. For a company Roof Lee made the answer is no. For
  a company that cannot be found it is also no. For every other company it is
  yes, exactly as before.
- **`messages.quiet` comes from the same switch.** It is said only while the
  answer is no for every kind. Switching one of them on for a company later
  takes the capability away without anyone remembering to.
- **A contact Roof Lee made creates nothing.** Roof Lee tags every KynexPro
  contact it makes `roofli`. When such a contact arrives at
  `/api/webhooks/gohighlevel` it is not taken in: no second lead, no news back
  to Roof Lee, no text. This holds for every company.
- **A company Roof Lee made takes in no KynexPro contact at all**, whoever made
  it (`handleGhlNewContact` answers `roofli_company` first). Roof Lee's lead
  hub is the only way a lead comes in for such a company, so no lead keyed to
  KynexPro appears in Archie and nothing echoes back to Roof Lee as news.
- **New code that sends must say which kind it is.** A test
  (`server/sister/__tests__/quiet.test.ts`) lists every file that hands a
  text or an email to a provider. A new file that starts sending fails the
  test until someone decides whether a person presses send, or it asks the
  switch.

## Archie's own jobs

Archie's boards are keyed on a job key (`leads.external_id`). For the original
company that is JobTread's id for the job. A company Roof Lee made has no
JobTread, so Archie gives its leads keys of its own.

- **An identity Archie makes.** A lead of such a company is given a key of
  Archie's own when it is made: `archie-` and 32 hex characters. That holds
  for a lead Roof Lee adds, a lead typed into Archie's lead form, and a
  canvassed door turned into a lead. It starts in `New Lead`, so it shows on
  the Sales board and opens like any other client. An older lead with no key
  is given one the first time it is put on the production board. The lead
  keeps its key for good. The id Roof Lee uses for the record (the row's
  number) does not change when a lead becomes a job.
- **Only for a company Roof Lee made.** `keepsOwnJobs` in
  `server/production/native-jobs.ts` is the one switch. The `jobs.native`
  capability and the code that makes an identity both read it. No other
  company's lead is ever given one, so nothing changes for it.
- **Which system keeps a job** is answered in one place, `jobBackendFor` in
  the same file: Archie for a key of Archie's own, or for a job with no key
  yet in a company that keeps its own jobs; JobTread for everything else,
  exactly as before. Code that would tell JobTread something asks it first.
- **Leads made in Archie.** For such a company the lead form
  (`POST /api/leads/create`) and turning a canvassed door into a lead
  (`POST /api/canvass/{id}/convert`) store the lead with source `archie` and
  call no JobTread, no KynexPro (Roof Lee owns it for this company) and no
  calendar. Each is written to the company's log (system `archie`) and told
  to Roof Lee as `lead.created`. The lead form does not offer booking for
  such a company (the screens read `profile.madeByRoofli` from
  `GET /api/auth/me`), and a booking sent anyway answers "Booking is not
  available for your company yet." and the lead is still made. Booking an
  existing job of Archie's own (`POST /api/clients/{key}/appointment`)
  answers `409` in the same words, with no calendar touched, and the
  Schedule's availability board offers no booking to such a company (it
  shows the times and says booking is not available yet), so an open time
  never makes a new lead on every try. A lead made on the form keeps the
  customer's whole name as its job name, the way a lead Roof Lee adds does.
- **Who owns a new lead.** A salesperson only sees a job they are assigned.
  So a new lead is owned from the start by: the salesperson a sales leader
  picked on the form, else the rep whose door it was (canvassing), else the
  person who typed it in when they would not otherwise see it (a rep, or a
  sales leader who sees only their team). Never a crew member, because owning
  a job opens its money. Anyone else's new lead (office staff, an admin) has
  no owner yet and waits on the Assignments page, where a manager gives it to
  a salesperson. In such a company everyone active who can own jobs is
  offered there under their own name (nobody has a JobTread rep name), no
  owner is worked out from JobTread, and nothing is written back to it. The
  same people are offered when reps are changed on the client page
  (`GET /api/team/reps`), and the assignment itself (`POST /api/assignments`)
  refuses anyone who cannot own a job (a crew member, office staff) as owner
  or sharer: "Only people who sell can own or share a job." It does so in such
  a company and for any job of Archie's own; for every other company the
  route is unchanged.
- **Nothing goes to JobTread for such a job.** Every place that would tell
  JobTread about a move (the production, sales and claim boards) checks the
  key first and, for one of Archie's own, keeps the status in Archie instead.
  No outside call, and no failed-call line in the company's log.
- **The client page for such a job.** Everything on it is kept in Archie, and
  nothing on it asks JobTread or KynexPro anything:
  - a note (`POST /api/jobs/{key}/note`) is kept in `lead_notes` with who wrote
    it (system `archie`) and written to the company's log. Roof Lee reads it
    with the job's other notes. A note is at most 2000 characters, like one
    Roof Lee adds;
  - a corrected phone or email (`PATCH /api/leads/{key}/contact`) is written to
    the lead and logged. A blank one clears it; one that does not look right is
    refused in plain words;
  - the stage control on the page (`POST /api/production/{key}/stage`) answers
    `409` "Move this job on the Production board.": such a job has no JobTread
    status, and the board moves it with its own checks;
  - an admin's corrections (`PATCH /api/clients/{key}/account`) change the
    customer's name, the job name, the address, the project manager and the
    insurance-claim tick on the lead, and are logged. The claim details kept
    only in JobTread (carrier, claim and policy numbers, adjuster and the rest)
    are refused in plain words, not dropped, and the list of fields offered
    (`GET /api/jobtread/account-fields`) holds only the two the lead can keep;
  - the client's messages (`GET /api/clients/{key}/messages`) are the job's
    notes, newest first, each labelled "Note", or "From Roof Lee" for one that
    came through Roof Lee;
  - the client (`GET /api/clients/{key}`) also says `backend` (`archie`), and,
    for such a job only, `photoConsent` and `boardStage` (the Production board
    stage's key and label, or null). Nothing about money is added, and a crew
    still cannot open the page.
  For every other company these answer exactly as before, apart from the client
  carrying `backend: "jobtread"`.
- **The client page on screen** (`client/src/pages/client-detail.tsx`, choices
  in `client/src/lib/own-jobs.ts`), for a job Archie keeps only: no "Open in
  Current CRM" link and no documents linking to JobTread; the stage is shown,
  not picked, as the Production board has it, with "Start production" while
  the job is not on the board yet (see below); the admin's corrections are
  offered; the note says "Note saved"; call, text and email are the phone's
  own, with no KynexPro tags and no booking (that company has no calendar in
  Archie yet); the job's notes show "Note" or "From Roof Lee"; the photo
  switch is on the page (below); and the photo box keeps the job's photos in
  Archie (Photos, below), with no CompanyCam push. The account editor
  says "Save" and "Account saved", offers only what the job can keep, and
  names no CRM; a roof report has no "→ Current CRM" button and no CRM in its
  words; the commission box has no "Save PDF to job" (Preview still opens the
  statement); and changing reps does not claim to update a CRM. Every other
  job's page is exactly as before.
- **Call, text and email on every screen** (the Leads list, a canvassed door,
  the schedule and the client page) are the phone's own for a job of
  Archie's own, because its company's KynexPro is Roof Lee's
  (`contactRouteKey` in `client/src/lib/own-jobs.ts`, read by
  `ContactActions`). The schedule shows no JobTread link for such a job. The
  canvassing screen, the Leads list's empty state, the Assignments page and
  a Production board card name no CRM for such a company or job.
- **Start production.** `POST /api/production/{key}/pipeline/stage` with
  `{ "stage": "approved" }`, from the client page, puts such a job on the
  Production board at Approved, for anyone who may open the job (never a
  crew). The status the rest of Archie reads moves with it (`Buyer Approved`),
  as when Roof Lee puts a job on the board. Pressed twice it changes nothing.
  For a JobTread job the route is unchanged: putting it on the board writes
  nothing, here or to JobTread.
- **Moving a job from Roof Lee.** `POST .../jobs/{id}/stage` with `stage` (one
  of the board's own stage keys, `approved` to `closed_out`) and `acting`. It
  is the same move a person makes in Archie, made as the person named, so the
  board's rules hold: a stage that is waiting for something (the
  pre-construction checklist, the final walkthrough, a ticked box) answers
  `409` with the reason in plain words, and the same request can be sent again
  later. A lead that is turned down on its very first move is not put on the
  board (an older lead with no key is not given one either). An unknown stage answers `400`. Crew cannot move a job this way
  (`403`), the same as they cannot see leads. A job that another system keeps
  answers `409` and is left alone. Each move is written to the company's log
  under the person it was for.
- **A finished job is news.** When one of these jobs reaches the finished
  stage, `job.finished` goes to Roof Lee like any other, including for a lead
  Roof Lee itself added.
- **Consent to use photos** is a yes a person records on the job:
  `POST /api/production/{job key}/photo-consent` with `{ "agreed": true }`,
  signed in to Archie. Nothing sets it by itself, and it is written to the
  company's log. The client page has the switch, "Customer agreed to photos
  of this job being used", with one sentence on what it allows: the
  company's website and social posts, naming only the town, never the
  address.
- **Photos.** The original company's photos live in its JobTread, exactly as
  before. A job Archie keeps has its photos kept by Archie itself, in Kynex's
  own private photo store (a Cloudflare R2 bucket with no public address;
  `server/photos/store.ts`), with a row each in `job_photos` (migration `0016`):
  - **Keyed on the job key** (`job_photos.job_key`, the `archie-` key), never
    on the lead's row number, which the JobTread sync can change. A foreign
    key would skip row level security, so the job is looked up as the company
    just before a row is written.
  - **No location, anywhere.** The phone reads only the date the photo was
    taken (Exif `DateTimeOriginal`) before redrawing it as a plain JPEG; the
    server then keeps only the blocks a picture needs and drops every other
    one, whatever it is called (`server/photos/jpeg-clean.ts`). Kept: the
    start and end, one APP0 only when it is a bare JFIF header straight after
    the start, the quantisation and Huffman tables, the frame header, the
    restart interval, the line count, and each scan with its data. Dropped:
    APP1 to APP15, any other APP0, comments, the JPGn and reserved markers,
    and anything after the end of the picture. A kept block that carries
    anything past what its own fields say (a packet tucked after the tables)
    is refused, and so are the arithmetic and hierarchical tables (DAC, DHP,
    EXP), which the browser never makes and which cannot be dropped without
    changing the picture. It then checks its own work on a fresh walk: it
    starts `FFD8`, ends `FFD9`, holds only those blocks, and nowhere holds a
    mark of Exif, XMP, Photoshop or a GPS tag name (`Exif\0\0`, the XMP
    namespace and packet, `GPSLatitude` and the like), the scan's own data
    included. The same function cleans the copy again on its way to Roof Lee.
    Anything that is not a whole JPEG (a PNG, a WebP, a HEIC, a cut-off file)
    is refused. The table has no location column.
  - **Stored under the company's own prefix.** A copy's address in the bucket
    is built on the server from the row alone:
    `c/<company id>/p/<photo id>/working.jpg` (up to 1600 pixels) and
    `thumb.jpg` (up to 400). The database refuses any other company's prefix
    (`job_photos_keys_in_company`), and a photo is `ready` only once its
    working copy is stored (`job_photos_ready_has_copy`). A failure part way
    leaves a `pending` row, never a stored copy with no row. Deleted and
    pending rows keep their copies for now; a later sweep clears them.
  - **The routes** (each asks `jobBackendFor` first; a JobTread job takes
    exactly its old path):
    - `GET /api/clients/{key}/photos?limit=&before=&phase=`: ready photos,
      newest first, a page at a time (30, at most 100), in the old shape
      (`id, name, url, description, createdAt`) plus `thumbUrl, phase,
      category, caption, takenAt, width, height, uploadedByName, mayEdit,
      mayDelete`, with `totalFiles` and `nextBefore` (the id to pass as
      `before` for the next page). `url` is `/api/photos/{id}/working`.
    - `GET /api/clients/{key}/files`: the same photos as files, each
      `isImage: true`. Documents come later.
    - `POST /api/clients/{key}/photos` with `{ base64, thumbBase64?,
      contentType: 'image/jpeg', phase?, category?, caption?, takenAt? }`:
      answers `{ ok, fileId, name }`, the shape the pre-construction
      checklist already reads. Written to the company's log (system `archie`,
      `upload_photo`). With the store switched off it answers `503` "Photo
      storage isn't switched on yet. Please try again later." and writes
      nothing.
    - `GET /api/photos/{id}/{thumb|working}`: the copy, streamed through
      Archie as `image/jpeg` with `Cache-Control: private, max-age=300`.
      Never a redirect, never a public address.
    - `PATCH /api/photos/{id}` with `{ caption?, phase?, category? }`: the
      person who added it, or a sales leader and up. Logged (`edit_photo`).
    - `DELETE /api/photos/{id}`: the person who added it, on the same day in
      the company's time zone, or a sales leader and up. The row is marked
      deleted with who and when. Logged (`delete_photo`).
  - **Who.** Anyone who may open the job (`ownsLead`) sees and adds its
    photos; everyone else, another company included, gets `404` on every one
    of these, the same as a photo that is not there. A crew (`production`)
    gets `404` on these routes too, even with a rep assignment row on the job:
    crews get no job access through `ownsLead`. A crew adds and sees a job's
    photos through its own routes instead, only for a job booked for its crew
    (see "Crews and install dates"), and may open one photo's copy
    (`GET /api/photos/{id}/{thumb|working}`) through the same crew check.
  - **Phases and categories.** Before, During or After (Roof Lee's own three
    words), an optional category from a fixed list (`shared/job-photos.ts`,
    including `checklist`), and an optional caption of at most 500
    characters.
  - **On screen** (`client/src/components/JobPhotos.tsx`, words in
    `client/src/lib/job-photos-view.ts`): a Before, During or After picker
    and an optional category and caption, chosen before the camera opens;
    every photo, a page at a time, with a phase filter; each new photo shows
    "Saving..." until it lands (a failed one says so and can be tapped to try
    again); tap a photo to see it large; edit its caption, phase and category,
    and Delete with a confirm, offered only to the people allowed. No
    CompanyCam push.
  - **An insurance letter** for such a job carries the photos picked for it
    straight from the store; it has no documents on file yet.
  - **The checklists use the job's own photos** (Stage A3). A photo taken in
    the pre-construction checklist is filed as a Before photo, one taken in
    the final walkthrough as an After photo, both under the category
    `checklist` and captioned with the checklist item it was taken for
    (`checklistPhotoFiling` in `client/src/lib/job-photos-view.ts`), so it
    shows in the job's photo box too. "Use a photo already on the job" picks
    from the same photos. On submit, every photo the checklist names
    (`photoAnswerIds` in `shared/job-photos.ts`, photo items only) must be
    one of this job's own ready photos (`allReadyPhotosOfJob` in
    `server/photos/native.ts`, asked as the company); a made-up id, another
    job's or another company's photo, a deleted one or one that never
    finished saving is refused with `400` "One of the photos didn't finish
    saving. Please add it again." and the checklist stays a draft. The
    checklist row is locked (`select ... for update`) before its answers are
    checked and stays locked until it is submitted, so the answers checked
    are the answers locked, and the walkthrough's follow-ups come from those
    same answers: an autosave that lands meanwhile waits, then finds it
    submitted and answers `404`, and a second tap on Submit waits and answers
    as before. (The lock is taken for every company, since the required-items
    check had the same gap; a JobTread company's submit gives the same answer
    as before.) Asked only
    when the key is one of Archie's own (`isNativeJobId`): a JobTread job's
    checklist names JobTread file ids and is accepted exactly as before. The
    board's own gates (`entryBlocker`, `STAGE_CHECKS`) are the same for every
    company. With its photos accepted, the checklist moves the board as
    before: Schedule Job, then Final Invoice after the walkthrough.
  - **Roof Lee** is told about a job's photos, and can fetch one, only with
    the customer's recorded agreement: see "Read and write for Lee", Photos.
  - **Not yet:** the phone sending the full-size original straight to the
    bucket (A2b: it needs a CORS rule on the bucket, and the private original
    is never served); reports reading these photos (Stage C); a sweep that
    clears old pending and deleted rows and their stored copies; Roof Lee's
    own side of A4 (reading `phase`, `caption` and `takenAt`, and storing the
    phase), which is in the Roof Lee repository.
- **The job's forms stay in Archie.** The pre-construction checklist, the
  final walkthrough (and the follow-ups its issues become), the inspection
  form, a follow-up and the choice of rep are saved and do their board moves
  as for any job, and none of them is copied to JobTread. A signed
  certificate or signed document stays in Archie, the report context and the
  insurance letter read nothing from JobTread. Sending a proposal to other
  job software answers `409` "Sending this to other job software is coming
  soon for your company.", and saving a commission statement on the job
  answers `409` "Saving files to a job is coming soon for your company. Open
  the statement with Preview instead."
- **No other job software, CompanyCam or KynexPro can be connected** by such
  a company, and nothing is checked or saved. Each says so in its own words,
  promising only what is planned: other job software
  (`PUT /api/integrations/crm/connection`) answers `409` "Connecting other job
  software is coming soon for your company."; CompanyCam
  (`PUT /api/integrations/companycam/connection`) "CompanyCam can't be
  connected for your company."; and KynexPro
  (`PUT /api/integrations/ghl/connection`, and making a new webhook secret)
  "Roof Lee looks after your KynexPro, so Archie does not connect to it."
  `GET /api/integrations/ghl/connection` says `heldByRoofLee: true` with no
  webhook (no secret is made), so the admin is never shown the "Connect
  KynexPro" reminder and the KynexPro card says who looks after it. Every
  other company's status carries `heldByRoofLee: false` and is otherwise
  unchanged. So the company never holds a mix of JobTread jobs and its own, and
  Archie's buttons cannot message its customers outside Roof Lee's approvals.
  With no connection of its own, and the deployment's keys belonging to the
  original company alone, every JobTread or KynexPro call made for it stops
  with "not connected" before anything leaves Archie.
- **Every place that makes a JobTread or KynexPro client is listed** in
  `server/production/__tests__/outside-systems.test.ts`, with what it does for
  a job Archie keeps: an Archie path of its own, a plain refusal, or the reason
  a Roof Lee company can never reach it. That test is permanent: a new place
  fails it until someone decides. `outside-systems.db.test.ts` walks a job
  Archie keeps through every one of these steps with clients that throw on any
  call, and checks the original JobTread company still reaches JobTread.
- **New columns on `leads`** (migration `0015`): `job_type` (what Roof Lee
  called the job, also kept in `service_type`), `photo_consent`, and four that
  nothing fills yet because the agreement has no field for them: `lat`, `lng`,
  `lead_source`, `post_ref`.

A Roof Lee company's lead gets onto the board when Roof Lee moves it, or when
a person presses "Start production" on its page; from there everything on the
board works from inside Archie.

## Crews and install dates

Stage D, for a company Roof Lee made only (`keepsOwnJobs`). Every route below
answers `404` to any other company, for every role, and none of its screens
change (`crewScreensFor` in `client/src/lib/crews-view.ts`). Homeowner
appointments are not here: Roof Lee books them in Kynex Pro.

- **The tables** (migration `0017`, provisional number): `crews` (a name, a
  colour, switched on or off; no rates or prices), `crew_members` (who is on
  which crew, one crew per person), `crew_assignments` (a job's install: crew,
  first day, optional last day, optional start time, a note for the crew, and
  status `scheduled`, `in_progress` or `done`; one per job, keyed on the job
  key like `job_photos`) and `job_milestones`. Each is behind
  `archie_protect_company_table`. A crew member row and an install name their
  crew through `(company_id, crew_id)`, so a row can never name another
  company's crew. A person is checked as the company before they are put on a
  crew (there is no foreign key to `team_members`).
- **Dates are the company's own.** An install is a plain calendar date
  (`YYYY-MM-DD`), never an instant, and "today" and "this week" come from the
  company's time zone (`shared/company.ts` `timeZone`, through `etToday`),
  never Eastern time written in. Weeks run Monday to Sunday. Pure rules are in
  `shared/crews.ts`.
- **Crew members are a kind of team member billing can count.** A crew
  member is a team member on the Production role. `isCrewSeat` and
  `countCrewSeats` in `shared/crews.ts` answer "is this a crew sign-in"
  (active, may sign in, Production) for the Archie team's billing, which is
  not built here.
- **The office** (office staff and up: `mayScheduleCrews`, never a salesperson
  or a crew; for one job, someone who may open it):
  - `GET /api/crews` the crews with who is on each, and everyone who can be on
    one; `POST /api/crews` `{ name, color? }`; `PATCH /api/crews/{id}`
    `{ name?, color?, active? }` (a crew with installs still ahead cannot be
    switched off); `PUT /api/crews/{id}/members` `{ memberIds }` (Production
    people only, "Only people on the Production role can be on a crew."; a
    person on another crew moves).
  - `GET /api/crews/week?week=YYYY-MM-DD` the week holding that date: each
    install on every day it covers, and the jobs on the production board
    (Approved to Install) still waiting for one. Names, towns and dates only:
    old Archie's board selected the approved price and the map pin, and this
    one never does.
  - `GET|PUT|DELETE /api/jobs/{key}/install` a job's booking
    (`{ crewId, installDate, endDate?, startTime?, notes? }`, refused in plain
    words); it can come off the schedule only while the crew has not started.
    `POST /api/jobs/{key}/install/status` `{ status }` lets the office set any
    status.
  - On screen: an Install box on the job's page and on its Production board
    card, and a "Crew week" view beside the board, with the jobs waiting and
    the crews and their people.
- **The crew's phone.** A crew member of such a company lands on their crew's
  jobs instead of Home (`client/src/pages/crew-home.tsx`): today and late
  ones first, then coming up, then finished in the last two weeks. Each job
  shows the customer's name, the address with a Directions link, the day and
  start time, the office's note, the work as a tick for each trade, Start and
  Done, and During or After photos. The routes:
  - `GET /api/crew/jobs`, `GET /api/crew/jobs/{key}`;
  - `POST /api/crew/jobs/{key}/status` `{ status }`, forward one step at a
    time (Scheduled, then Working on it, then Done);
  - `POST /api/crew/jobs/{key}/trade-done` `{ trade }`, the same tick the
    production board makes (`completeTrade`);
  - `GET|POST /api/crew/jobs/{key}/photos`, into `job_photos` with phase
    During (the default) or After, cleaned of location like every photo.
- **One crew check, never `ownsLead`.** Every crew route asks one question,
  `crewJobFor` in `server/crews/access.ts`: is the person on the Production
  role, on an active crew, and is this job booked for that crew? Anything
  else is `404`, the same as a job that is not there. `ownsLead` is not
  widened for crews, because two routes that return money check only
  `ownsLead` (a job's estimates and daily logs).
- **Crews never see money.** What a crew is shown is built by `crewJobView`
  (`server/crews/view.ts`), an allow-list: no projected value, estimate,
  invoice, deposit, payment tick or commission, and not the lead's own notes
  (office staff may have typed a price there). The homeowner's phone and
  email are left out until the owner decides (open question D9). The note the
  office writes for the crew is labelled "no prices: the crew sees this".
- **Milestones for Roof Lee.** Booking an install, booking it again for
  another crew, day or time, the crew starting and the crew finishing each add
  a row to `job_milestones` (`install_scheduled`, `install_started`,
  `install_done`), and the booking keeps `scheduled_at`, `started_at` and
  `done_at`. Nothing reads them yet: Stage E will send `job.milestone` to Roof
  Lee from them. No message goes to Roof Lee now.
- **Every step is logged** in the company's log (system `archie`): crew made,
  changed and its people, install booked, cleared and its status, and each
  crew photo (`upload_photo`).
- **Not yet:** a crew asking the office for extra work from the phone;
  showing crews the homeowner's phone (D9); the checklist's "no later than
  7:00 AM" as a company setting and the walkthrough's follow-up date in the
  company's time zone (both still in the plan's Stage D list); and sending the
  milestones to Roof Lee (Stage E).

## One sign-in

A person signed in to Roof Lee presses "Open Archie". Roof Lee hands their
browser a page that posts one form field, `ticket`, to
`POST /api/sister/v1/sso`. The ticket is signed with the pair secret, lives
sixty seconds and works once. Archie then:

1. Checks the signature over the bytes as they arrived, before reading them,
   with `SISTERS_ARCHIE_SECRET` and nothing else.
2. Refuses a ticket that is not version 2, not made for `archie`, past its
   end, from the future, or claiming a life other than sixty seconds.
3. Records the ticket's id (a SHA-256 of it, in `sister_sso_tickets`) in one
   step, so a second use, or a copy arriving at the same moment, is refused.
4. Finds the person by their shared sign-in id inside the company the ticket
   names, among the people Roof Lee sent. Never by email.
5. Applies the usual gates: the company is live, the person is active and may
   sign in, and the deployment's own block and allow lists.
6. Starts a brand-new session (never the session id the browser arrived with)
   and sends the browser to `/`.

The role in the ticket grants nothing: the person gets the role Archie holds
for them from the last team list. A ticket may carry any of Roof Lee's six
roles (the reader, pasted from Roof Lee, knows all six). Only people Roof Lee
sent come in this way; someone the company added in Archie signs in by email
as before. Every refusal is the same page, with one
plain sentence, status `401`, no session and no reason. The ticket is read
from the form body only, never from the address, and is never logged.

Taking someone off the team in Roof Lee ends their Archie sessions (the next
team list leaves them out). Signing out of Roof Lee does not.

Known limit, set by the agreement: anyone who holds a valid, unused ticket can
have a browser post it. It is worth one sign-in for sixty seconds, as the
person it names.

## News going back to Roof Lee

Archie tells Roof Lee when something happens that Roof Lee did not cause:

| Event | When | What is sent |
|---|---|---|
| `lead.created` | A lead is made inside Archie: typed in by a person, or come in from a form or a text. Never for a lead Roof Lee added (source `roofli`), and never from the JobTread sync, which does not report leads at all. A lead a person types in is reported even when the company's own JobTread accepted it. | `leadId`, `source`, `name`, `phone`, `email`, `message`, `jobType`, `town` |
| `job.finished` | A job reaches the finished stage on the production board. Told from inside the move itself, so a move made by automation counts too. Once per job. | `jobId`, `jobType`, `town`, `photoConsent` (`true` only when a person recorded it), `finishedAt` |

How it works:

- **Only for companies Roof Lee made, and only when switched on.** With
  `SISTERS_ARCHIE_SECRET` or `ROOFLI_EVENTS_URL` unset, nothing is written and
  nothing is sent, for anyone. A company without a Roof Lee id never gets a
  row. A paused or closed company's news is held back until it is live again.
- **Written first, sent after.** The news goes into `outbound_events`
  (migration `0014`) when the thing happens, and is sent right after the
  person who caused it has their answer. Recording it never fails the work
  that caused it.
- **Signed like every other version 2 request**: over the method, the address
  `/api/sister/v1/events` and the body, with the pair secret. Archie never
  follows a redirect with a signed event.
- **Tried again until Roof Lee has it.** Anything but a `2xx` is tried again
  after 1 minute, then 5, 15, 60 and so on up to once a day, by the scheduled
  run at `/api/cron/sister-events` (every ten minutes, guarded by
  `CRON_SECRET`). A `400` means Roof Lee cannot read it, so Archie gives up on
  that one. News more than 7 days old is no longer sent.
- **Delivered once.** A delivered event is never sent again. A row is taken
  before it is sent, so two runs at once do not both send it. If Archie dies
  between sending and writing that down, the same event id goes out again and
  Roof Lee, which handles each id once, ignores the repeat.
- **One piece of news, one event.** Reporting the same lead twice, or moving a
  job out of the finished stage and back, makes no second event.
- **`ROOFLI_EVENTS_URL`** is Roof Lee's own address (`https://...`), with or
  without the events path. It must be `https`. Anything else counts as unset.

Not sent yet: `cost.incurred`. Archie spends none of Kynex's money for a Roof
Lee company today (its paid integrations are off for such a company). The
first feature that does must send it.

## Rules this code keeps

- **A company is found by Roof Lee's id and nothing else.**
  `companies.roofli_company_id`, looked up as system work, then everything
  runs as that company. Archie's own company id in an address finds nothing.
- **Never adopt.** A new Roof Lee id always makes a new company, with its own
  slug. Nothing that already existed is attached, whatever name, slug or email
  matches. A person whose email already belongs to someone else in Archie is
  left out and named in the answer, never moved or merged.
- **The team list is the whole truth for people Roof Lee sent.** Exactly the
  people in it have access through Roof Lee. Someone Roof Lee sent before and
  now leaves out is switched off and their sessions are ended at once. Rows
  are kept, so their history stays.
- **Not everyone signs in to Roof Lee.** Someone the company added in Archie
  itself (on the Team page: no source, no shared sign-in id) is not on Roof
  Lee's list and is not Roof Lee's to remove. Whatever list arrives, they keep
  their access, their role and their email sign-in, and stay signed in. They
  never act for Roof Lee: a request naming them, even by a matching sign-in
  id, is answered `403`, and a team list naming that id leaves the person out
  (`skipped`) rather than taking the row over.
- **People Roof Lee sent have no email sign-in.** They have no password, and
  the lookup every email sign-in starts with (`findSignInMember`) never finds
  them. Their only way in is Roof Lee's hand-off ("One sign-in" below).
- **No credentials from Archie's own settings.** The JobTread key and the
  other values in the environment belong to the one original company. A
  company Roof Lee made never owns them, even if
  `ARCHIE_ENV_CREDENTIALS_COMPANY_ID` were pointed at it by mistake. With none
  of its own, each such integration is simply off for it. Archie keeps a Roof
  Lee company's KynexPro location as an id only, with no credential, so it
  makes no KynexPro call for it either.
- **Pausing and closing delete nothing.** `pause` sets the company to
  `paused`, `close` to `cancelled`. Nobody can sign in and no scheduled work
  runs for it. A paused company comes back when Roof Lee sends it again with
  an active plan. A closed one stays closed.
- **Archie checks who is asking.** When a pause or close names a person, that
  person must be on this company's team in Archie right now, as someone Roof
  Lee sent, found by their shared sign-in id inside this company, and hold the
  admin role here (an owner or admin in Roof Lee). A sales manager or a
  salesperson never can. The role the request states must agree. Anyone
  else is answered `403` and nothing changes. A refusal is not remembered, so
  the same request can be sent again once the team list has caught up. A pause
  that names nobody (a subscription ended) is allowed, as the contract says.
- **A write sent twice is done once.** The key from the `idempotency-key`
  header is claimed per company in `sister_idempotency` before the work
  starts, and the first answer is given again to any repeat. A repeat that
  arrives while the first copy is still being worked on is answered `503` with
  `Retry-After` (come back), not a `4xx`, which Roof Lee would read as "no".
- **Every failure looks the same from outside.** A wrong secret, an old
  timestamp and an unset secret all answer a bare `401`. A `500` never carries
  detail. (A database that is full for a moment answers `503` with
  `Retry-After` instead: send it again.)

## Role map

Roof Lee has six roles and tells Archie each of them as it is, wherever a role
is sent: a team list, an `acting` block, `actingRole` in an address, and a
sign-in ticket. Archie takes all six (`ROLE_MAP` in `server/sister/contract.ts`).
A role Archie did not know would leave that person out of a team list
(`skipped`), with no access, so a new Roof Lee role must be added here before
Roof Lee sends it.

| Roof Lee | Archie | What it means in Archie |
|---|---|---|
| owner | admin | Everything. |
| admin | admin | Everything. |
| office | customer_service | Every customer and lead, no money. |
| crew | production | No leads at all, no money. |
| sales_manager | customer_service | Like the office: every customer and lead, owned or not, no money. |
| salesperson | sales (Sales Rep) | Only their own leads and jobs, through Roof Lee and in Archie alike. |

Where Roof Lee states a role lower than the one Archie holds, the lower one
counts, and someone held to their own book by that lower role sees nothing of
their own (the list may not have caught up yet).

Why a sales manager is not Archie's Sales Leader (`manager`): that role sees
only its own leads and its direct reports', worked out from a reporting line
(`team_members.reports_to`) that Roof Lee never sends and the team list never
sets. Leads the office or the website add through Roof Lee have no owner, so
a sales manager held as a Sales Leader would see none of them, and office
staff promoted to sales manager would lose every lead. Roof Lee tells the
owner the role is "Like the office, and can approve reports, proposals and
messages to customers", with approving decided per kind of request, never as
a wider tier, so Archie holds them exactly like the office. Roof Lee's
contract (`contract-v2.md`, "Archie") still names `manager` for this line and
needs the same change on its side.

## Turning it on (live step, owner only)

The migrations (`0011` to `0016`) are not a step here. They were applied
before this code was deployed ("Before deploying this code" above).

1. Generate one fresh secret and set it as `SISTERS_ARCHIE_SECRET` in both
   Archie and Roof Lee.
2. Prove the link with a throwaway test company (Summit Ridge Roofing in Cedar
   Falls): make it, change its team, pause it, close it. Check that the
   contract's worked examples verify against the deployed address, including
   one request with a query in its address.
3. Set `ROOFLI_EVENTS_URL` to Roof Lee's address and check `CRON_SECRET` is
   set. Add a lead by hand in the test company and see it arrive in Roof Lee.
   Leave this until Roof Lee is ready to receive: news that cannot be
   delivered is kept for 7 days and then dropped.
4. Open Archie from Roof Lee as the test company's owner, and check that the
   same button does nothing for someone taken off the team.
5. Only then set `SISTERS_ARCHIE_READY=true`.

Still open for the owner: which stage means "job finished" (the default is
closed out), and whether the hosting plan runs a scheduled job every ten
minutes. If it does not, change the schedule in `vercel.json`: news is still
sent right away, and only the retries after a failure get slower.

Before `SISTERS_ARCHIE_READY` is set, also check with the test company: ask
for its capabilities and see both `messages.quiet` and `jobs.native`; add a
lead from Roof Lee and move it to Approved, and see it on the production
board in Archie; and confirm no text or email reached the test customer.

## Tests

    scripts/test-db.sh
    eval "$(scripts/test-db.sh --env)"
    SESSION_SECRET=test npx vitest run server/sister server/tenant server/production server/photos server/crews

The roles and the team list are tested in
`server/sister/__tests__/roles.test.ts`: both sales roles kept on every list
and in a sign-in, a salesperson held to their own leads and jobs through Roof
Lee and in Archie, someone added in Archie surviving every list with their
email sign-in, someone Roof Lee left out switched off, and the original
company exactly as before.

Crews and install dates are tested in `server/crews/__tests__`:
`crews.db.test.ts` (the office books, the crew week in the company's own
dates, a crew starts, ticks, adds a photo and finishes with each milestone
recorded, another crew's or company's job is 404 on every crew route, and a
company Roof Lee did not make gets 404 on all of it with its board as before)
and `crew-money-walk.db.test.ts`, which is PERMANENT: it lists every read
route the app registers and reads each as a crew member booked on a job with
a price, and fails if any answer holds that price or a money field with
anything in it. A new route is walked without any change there. A field that
only looks like money is listed in it, by hand, with the reason.

The photo tests are `server/photos/__tests__` (the photo routes, and the
checklists using the job's own photos in `checklist-photos.db.test.ts`) and
`server/sister/__tests__/photos.test.ts` (what Roof Lee is told and handed).

The database tests skip themselves unless `DATABASE_URL` points at a local
database. Fixtures use the fictional Summit Ridge Roofing in Cedar Falls. The
photo tests never make a real photo store client: they hand in an in-memory
one (`setPhotoStoreForTests`), so no test talks to Cloudflare.
