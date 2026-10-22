# End-to-end run

A real pass through the built server against a **throwaway local Postgres** — auth
scoping, both inspection checklists, all eight generated documents on their
public share links, the editor, presenting, the final walkthrough, the production
board and contact actions. Nothing here touches production data.

    brew services start postgresql@16   # once
    npm run build
    scripts/e2e/run.sh

Outputs land in `/tmp/e2e` (`results.json`, `server.log`). To browse the app as a
seeded user in Chrome, run `E2E_COOKIE="$(node -e "console.log(require('/tmp/e2e/cookies.json').rep)")" node scripts/e2e/proxy.mjs`
and open http://127.0.0.1:4000 — the proxy injects the session cookie.

How it works: `ddl.ts` emits the schema straight from `shared/schema.ts` (drizzle-kit
cannot run here); `seed.mjs` creates three team members (admin, sales, production),
three jobs, and forges one session per member; `api.mjs` is the check list.

Known: JobTread/GHL clients still call out with blank keys (they get 400/401 back,
harmlessly); report generation needs an address that geocodes; the generate route
is rate-limited per user, so restart between back-to-back runs.

## Commercial reports in a browser

`E2E_UI=1 scripts/e2e/run.sh` also runs `reports-ui.mjs`: a rep on the seeded
commercial job opening the New report form, generating an Inspection with the
photo scan and pricing, then a Proposal; the pinned layer diagram under a real
scroll, a tier tapped on the page, both documents on a 390px phone, and the
editor's Commercial tab saved through to the customer's link. The photo scan
runs against `scan-standin.mjs` (the server is pointed at it with
`COMMERCIAL_SCAN_ENDPOINT`), so no paid vision call is made. It needs `api.mjs`
to have run first, which files the commercial inspection.

    E2E_BASE=http://127.0.0.1:3999 E2E_COOKIES=/tmp/e2e/cookies.json node scripts/e2e/reports-ui.mjs

## Signatures

`run.sh` also runs the signature flow — sending a document out, the customer's
signing page, the location recorded with each signature, declining, reminding,
cancelling, completion and the signed PDF. It brings its own leads, reports and
walkthrough (`signatures-fixtures.mjs`, job ids `e2e-sig-*`), so it neither
needs nor disturbs what `seed.mjs` and `api.mjs` set up, and each piece can be
run on its own:

    E2E_BASE=http://127.0.0.1:3999 E2E_COOKIES=/tmp/e2e/cookies.json node scripts/e2e/signatures.mjs
    DATABASE_URL=postgres://$USER@localhost:5432/bra_e2e npx tsx scripts/e2e/signatures-docs.ts
    E2E_UI=1 scripts/e2e/run.sh     # adds the Chrome pass

`signatures-docs.ts` needs no server: it calls the document builders directly,
which is the only way to cover rendering here — with the integrations blanked no
send can succeed, and a send that reaches nobody is discarded, so nothing
server-rendered survives for the API pass to inspect. `signatures.mjs` writes
already-delivered requests straight to the database for everything downstream of
delivery.

`signatures-ui.mjs` (Chrome, opt-in with `E2E_UI=1`) drives the rep's panel and a
customer signing on a 390px phone, with the location shared and refused, and
leaves screenshots in `/tmp/e2e/shots`. **Look at them.** Three of the four real
bugs the first full signature pass found — raw JSON shown to a rate-limited
customer, the email provider's own error text on the rep's board, and junk draft
rows — were invisible to passing assertions and obvious in one screenshot.

Signing is rate-limited per link, so a run that signs the same token repeatedly
will start getting the "give it a moment" page; restart the server between
back-to-back runs, as above.

## live-check.ts

The one thing a blanked-credential run can never prove: that a link actually
reaches somebody. This talks to **production** — forges a session against the
live app, sends a **real email**, and writes and deletes rows in the live
database. It only ever emails the one address you name, never texts anyone, and
cancels and deletes the request before it exits, but it refuses to start unless
you mean it:

    E2E_LIVE_CONFIRM=yes-send-a-real-email \
    E2E_LIVE_EMAIL=you@bestroofingnow.com \
    E2E_LIVE_SESSION_SECRET="…from npx vercel env pull…" \
    npx tsx scripts/e2e/live-check.ts

The production session secret has its own variable on purpose: the repo's `.env`
is loaded for `DATABASE_URL` and carries the *local* secret, which would satisfy
a plain `SESSION_SECRET` check and then fail to authenticate. Delete the pulled
env file afterwards.
