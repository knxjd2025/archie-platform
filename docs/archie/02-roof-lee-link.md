# The Roof Lee link

Roof Lee is the front door of a three-product family (Roof Lee, RoofN, Archie).
When a roofing company signs up in Roof Lee, Roof Lee asks Archie to make the
matching company, keeps its team up to date, and can pause or close it.

The agreement between the two products is written in the Roof Lee repository:
`docs/sisters/contract-v2.md` (version 2), which builds on
`docs/sisters/provisioning-contract.md` (version 1). That document is the
authority. This page says how Archie's half is built.

## It is off until the owner turns it on

Two settings, both unset by default:

| Setting | Unset means |
|---|---|
| `SISTERS_ARCHIE_SECRET` | Every request under `/api/sister` is refused with a bare `401`. Nothing about the link runs. |
| `SISTERS_ARCHIE_READY` | Archie answers "not ready", so Roof Lee shows no Archie button and uses no Archie tool for anyone. |

Once migration `0006_roofli_sister.sql` is in the database, deploying this
code with neither setting changes nothing for any existing company. The
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

The later migrations for this link (`0007_roofli_sso.sql` onwards) only add
new tables that nothing touches until the link is switched on. Apply them in
the same step, before deploying: a link switched on without them answers
every sign-in and every request from Roof Lee with a refusal.

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

Each address takes exactly one form of signature and never the other. Anything
else under `/api/sister` answers `404` to a signed request and a bare `401` to
an unsigned one.

Still to build (tasks A6 to A9 in Roof Lee's Stage 1 plan): the read and
write endpoints for Lee, events back to Roof Lee, Archie's own jobs, and the
"no messages of its own" gate with the `messages.quiet` capability.

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

Migration `0006_roofli_sister.sql` is not a step here. It was applied before
this code was deployed ("Before deploying this code" above).

1. Generate one fresh secret and set it as `SISTERS_ARCHIE_SECRET` in both
   Archie and Roof Lee.
2. Prove the link with a throwaway test company (Summit Ridge Roofing in Cedar
   Falls): make it, change its team, pause it, close it. Check that the
   contract's worked examples verify against the deployed address, including
   one request with a query in its address.
3. Only then set `SISTERS_ARCHIE_READY=true`.

## Tests

    scripts/test-db.sh
    eval "$(scripts/test-db.sh --env)"
    SESSION_SECRET=test npx vitest run server/sister server/tenant

The database tests skip themselves unless `DATABASE_URL` points at a local
database. Fixtures use the fictional Summit Ridge Roofing in Cedar Falls.
