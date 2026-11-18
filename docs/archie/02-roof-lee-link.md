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

Once migration `0006_roofli_sister.sql` is in the database, deploying this
code with none of these settings changes nothing for any existing company.
The one visible difference is a new scheduled knock every ten minutes at
`/api/cron/sister-events` (`vercel.json`), which answers at once that there is
nothing to do. The
migration has to be there first: see "Before deploying this code" below.

`SISTERS_ARCHIE_SECRET` is a fresh secret for this pair only. It is never
copied from another product, another repository or an older shared secret.
Archie never reads `SISTERS_SHARED_SECRET` at all.

## Before deploying this code (owner only, must come first)

**Apply migration `0006_roofli_sister.sql` to the database before this code is
deployed. Not after, and not as part of switching the link on.**

This code reads the new columns every time it reads a person or a company,
whether or not the link is switched on. Deployed against a database that does
not have them yet, sign-in fails for everyone ("column
team_members.auth_user_id does not exist") and so does all scheduled company
work ("column roofli_company_id does not exist"). Nothing in the build or the
deploy runs migrations, so this is a step a person has to do.

The other order is safe. The migration only adds three columns that are null
for every existing company and person, one index, one uniqueness rule and one
new table. The code that is live today never names any of them, so it carries
on exactly as before with the migration applied.

1. Apply the migration as the database owner:
   `DATABASE_URL=<owner url> npx tsx scripts/migrate.ts`
2. Check it is there: `select auth_user_id, source from team_members limit 1`
   and `select roofli_company_id from companies limit 1` both run without an
   error.
3. Only then deploy this code.

If this code is ever rolled back, leave the migration in place.

The later migrations `0007_roofli_sso.sql` to `0009_roofli_events.sql` only
add new tables that nothing touches until the link is switched on. Apply them
in the same step, before deploying: a link switched on without them answers
every sign-in and every request from Roof Lee with a refusal.

**`0010_archie_native_jobs.sql` is like `0006`: it must be in the database
before the code that comes with it is deployed.** It adds six columns to
`leads`, and that code reads them every time it reads a lead, for every
company, link or no link. Deployed without it, every screen that shows a lead
fails. Applied first, it changes nothing: the columns are empty for every lead
there is, and the one new index is empty too.

## Where the code is

| File | What it does |
|---|---|
| `server/sister/verify.ts` | Roof Lee's signing code, pasted word for word. Do not edit here. |
| `server/sister/door.ts` | Checks the signature on every request before anything else runs. |
| `server/sister/routes.ts` | The endpoints. |
| `server/sister/contract.ts` | Reads what Roof Lee sends. Maps roles. |
| `server/sister/companies.ts` | Makes, updates, pauses and closes a company. |
| `server/sister/members.ts` | Makes the team exactly the list Roof Lee sent. |
| `server/sister/facts.ts` | What Archie takes from a company's confirmed facts. |
| `server/sister/idempotency.ts` | Does a write once, however many times it arrives. |
| `server/sister/ticket.ts` | Roof Lee's sign-in ticket reader, pasted word for word. Do not edit here. |
| `server/sister/sso.ts` | One sign-in: spends a ticket and says who it signs in. |
| `server/sister/acting.ts` | Finds the person a request is for on the company's own team, and applies Archie's role rules to them. |
| `server/sister/leads.ts` | Leads, jobs and notes as Roof Lee's assistant reads and changes them. |
| `server/sister/capabilities.ts` | What Archie says it can do for one company. |
| `server/sister/quiet.ts` | The messages Archie sends a customer by itself, and the one switch that says whether it may. |
| `server/integrations/ghl/new-contact.ts` | What happens when a new contact arrives from KynexPro. Skips a contact Roof Lee made. |
| `server/production/native-jobs.ts` | Archie's own jobs: the job identity Archie makes, who gets one, and the record of a customer agreeing to photos. |
| `server/sister/events.ts` | News going back to Roof Lee: the outbox, the signing, the sending and the retries. |

Both entry files (`server/index.ts` and `api/index.ts`) keep the raw body for
`/api/sister` ahead of `express.json`. The signature is over the bytes as they
arrived, so without that nothing verifies. A test boots `api/index.ts`, the
production entry, to prove it.

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
| `GET` | `/api/sister/v1/companies/{roofliCompanyId}/jobs/{id}/photos/{photoId}` | version 2 (always `404` today, see "Archie's own jobs") |

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
  the team is answered `403`.
- **What each role gets.** Owners, admins and office staff can see and work
  every lead. Crew (the production role here) cannot see leads in Archie at
  all: a list comes back empty, one lead answers `404`, a write `403`.
- **A write is done once.** Every write must carry an `idempotency-key`. A new
  lead, and a new note, are saved in the same transaction as the answer to
  that key, so the same key can never make a second one. A refusal is not
  remembered, so the same request can be sent again once the team list has
  caught up.
- **A lead Roof Lee adds stays in Archie.** It is stored with source `roofli`,
  with no call to JobTread, KynexPro or anything else, and no message to
  anyone. Every change is written to the company's log under the person it
  was for.
- **Ids** are Archie's own row numbers, as digits. Leads and jobs share one
  list; a record is a `job` once it sits on the production board and a `lead`
  until then.
- **Fields.** `message` is the lead's standing note (`leads.notes`), which
  `PATCH` replaces when it sends `notes`. `notes` in an answer is the list of
  notes added one at a time (`lead_notes`, migration `0008`), newest first.
  No money is ever in an answer.
- **Photos.** `photoConsent` is `true` only when a person recorded, in
  Archie, that the customer agreed. `photos` is always empty and the photo
  address always answers `404`, because Archie holds no uploaded photo of its
  own for any job (see "Archie's own jobs").
- **Capabilities.** Each is worked out in `server/sister/capabilities.ts` from
  the switch the feature itself reads, never typed as a fixed answer.
  `jobs.native` and `messages.quiet` are both reported for every company Roof
  Lee made. Roof Lee adds and changes no lead and moves no job until it has
  heard `messages.quiet`, and Archie holds itself to the same rule: adding a
  lead, changing one and moving a job answer `409` for a company that is not
  quiet (moving a job also needs `jobs.native`). Reading and adding a note are
  not held back.

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
- **New code that sends must say which kind it is.** A test
  (`server/sister/__tests__/quiet.test.ts`) lists every file that hands a
  text or an email to a provider. A new file that starts sending fails the
  test until someone decides whether a person presses send, or it asks the
  switch.

## Archie's own jobs

Archie's boards are keyed on a job key (`leads.external_id`). For the original
company that is JobTread's id for the job. A company Roof Lee made has no
JobTread, so its leads had no key and could never sit on a board.

- **An identity Archie makes.** The first time one of such a company's leads
  is put on the production board it is given a key of Archie's own: `archie-`
  and 32 hex characters. The lead keeps it for good. The id Roof Lee uses for
  the record (the row's number) does not change when a lead becomes a job.
- **Only for a company Roof Lee made.** `keepsOwnJobs` in
  `server/production/native-jobs.ts` is the one switch. The `jobs.native`
  capability and the code that makes an identity both read it. No other
  company's lead is ever given one, so nothing changes for it.
- **Nothing goes to JobTread for such a job.** Every place that would tell
  JobTread about a move (the production, sales and claim boards) checks the
  key first and, for one of Archie's own, keeps the status in Archie instead.
  No outside call, and no failed-call line in the company's log.
- **Moving a job from Roof Lee.** `POST .../jobs/{id}/stage` with `stage` (one
  of the board's own stage keys, `approved` to `closed_out`) and `acting`. It
  is the same move a person makes in Archie, made as the person named, so the
  board's rules hold: a stage that is waiting for something (the
  pre-construction checklist, the final walkthrough, a ticked box) answers
  `409` with the reason in plain words, and the same request can be sent again
  later. A lead that is turned down on its very first move is not put on the
  board and gets no identity. An unknown stage answers `400`. Crew cannot move a job this way
  (`403`), the same as they cannot see leads. A job that another system keeps
  answers `409` and is left alone. Each move is written to the company's log
  under the person it was for.
- **A finished job is news.** When one of these jobs reaches the finished
  stage, `job.finished` goes to Roof Lee like any other, including for a lead
  Roof Lee itself added.
- **Consent to use photos** is a yes a person records on the job:
  `POST /api/production/{job key}/photo-consent` with `{ "agreed": true }`,
  signed in to Archie. Nothing sets it by itself, and it is written to the
  company's log. There is no button for it on a screen yet.
- **Photos.** Archie stores no job photos itself. The original company's
  photos live in its JobTread, and a Roof Lee company has no JobTread. So
  there is no uploaded photo to hand over, and the photo address answers
  `404`. Roof Lee is the place a Roof Lee company's job photos are uploaded.
- **New columns on `leads`** (migration `0010`): `job_type` (what Roof Lee
  called the job, also kept in `service_type`), `photo_consent`, and four that
  nothing fills yet because the agreement has no field for them: `lat`, `lng`,
  `lead_source`, `post_ref`.

Not built: a button in Archie for a person to put a lead on the board
themselves. Today a Roof Lee company's lead gets onto the board when Roof Lee
moves it; from there everything on the board works from inside Archie.

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
for them from the last team list. Every refusal is the same page, with one
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
  (migration `0009`) when the thing happens, and is sent right after the
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
- **The team list is the whole truth.** Exactly the people in it have access.
  Anyone else in that company is switched off and their sessions are ended at
  once. Rows are kept, so their history stays.
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
  person must be on this company's team in Archie right now, found by their
  shared sign-in id inside this company, and hold the admin role here (an
  owner or admin in Roof Lee). The role the request states must agree. Anyone
  else is answered `403` and nothing changes. A refusal is not remembered, so
  the same request can be sent again once the team list has caught up. A pause
  that names nobody (a subscription ended) is allowed, as the contract says.
- **A write sent twice is done once.** The key from the `idempotency-key`
  header is claimed per company in `sister_idempotency` before the work
  starts, and the first answer is given again to any repeat.
- **Every failure looks the same from outside.** A wrong secret, an old
  timestamp and an unset secret all answer a bare `401`. A `500` never carries
  detail.

## Role map

| Roof Lee | Archie |
|---|---|
| owner | admin |
| admin | admin |
| office | customer_service |
| crew | production |

## Turning it on (live step, owner only)

The migrations (`0006` to `0010`) are not a step here. They were applied
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
    SESSION_SECRET=test npx vitest run server/sister server/tenant

The database tests skip themselves unless `DATABASE_URL` points at a local
database. Fixtures use the fictional Summit Ridge Roofing in Cedar Falls.
