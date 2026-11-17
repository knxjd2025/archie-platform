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

Deploying this code with neither set changes nothing for any existing company.
Migration `0006_roofli_sister.sql` only adds columns that are null for every
existing company, and one new table.

`SISTERS_ARCHIE_SECRET` is a fresh secret for this pair only. It is never
copied from another product, another repository or an older shared secret.
Archie never reads `SISTERS_SHARED_SECRET` at all.

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

Each address takes exactly one form of signature and never the other. Anything
else under `/api/sister` answers `404` to a signed request and a bare `401` to
an unsigned one.

Still to build (tasks A5 to A9 in Roof Lee's Stage 1 plan): one sign-in
(`/sso`), the read and write endpoints for Lee, events back to Roof Lee,
Archie's own jobs, and the "no messages of its own" gate with the
`messages.quiet` capability.

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
  them. Their only way in will be Roof Lee's hand-off (task A5). Until that is
  built they cannot sign in to Archie at all, which is the safe default.
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

1. Apply migration `0006_roofli_sister.sql` to the database, as the owner role.
2. Generate one fresh secret and set it as `SISTERS_ARCHIE_SECRET` in both
   Archie and Roof Lee.
3. Prove the link with a throwaway test company (Summit Ridge Roofing in Cedar
   Falls): make it, change its team, pause it, close it. Check that the
   contract's worked examples verify against the deployed address, including
   one request with a query in its address.
4. Only then set `SISTERS_ARCHIE_READY=true`.

## Tests

    scripts/test-db.sh
    eval "$(scripts/test-db.sh --env)"
    SESSION_SECRET=test npx vitest run server/sister server/tenant

The database tests skip themselves unless `DATABASE_URL` points at a local
database. Fixtures use the fictional Summit Ridge Roofing in Cedar Falls.
