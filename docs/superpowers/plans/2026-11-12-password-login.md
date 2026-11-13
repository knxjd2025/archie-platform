# Email and Password Sign-in Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Team members can sign in with email and password (or Google, unchanged), set their password from an emailed one-time link, and reset it with "Forgot password?".

**Architecture:** Password hashes and a failed-try counter live on `team_members`. One-time set-password links reuse the `native_handoffs` pattern: a new company-scoped `password_links` table storing only a SHA-256 of the token, redeemed by one `DELETE ... RETURNING` under `runAsSystem`. New routes in `server/auth/password-routes.ts` run the same roster gate as Google sign-in and finish with the existing `startSignedInSession`. Emails go through Resend, the same way `server/integrations/operator-mail.ts` sends.

**Tech Stack:** Express, express-session, Drizzle + Postgres (row level security), Node `crypto.scrypt`, React + Tailwind, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-12-password-login-design.md`

## Global Constraints

- No new npm dependencies. Hashing is `node:crypto` scrypt.
- Same gate as Google sign-in: not blocklisted, on `LOGIN_ALLOWLIST` when it is set, `findSignInMember` finds them, `memberCanLogin`, `isLiveCompany`.
- Set-password links: one use, expire after 1 hour, only a SHA-256 of the token is stored.
- 5 wrong passwords: the account is locked for 15 minutes.
- "Forgot password?" answers the same way whether or not the email is on a roster.
- Tokens never travel in a URL query string: the link is `${APP_BASE_URL}/set-password#t=<token>`.
- Wrong-password and unknown-email answers are identical: HTTP 401, `{ "error": "Email or password is wrong." }`.
- Do not touch GHL code, Google sign-in behavior, or the Best Roofing AI repo.
- No em dashes in any user-facing text.

## Review Focus

1. Email typed with capitals or spaces (`" James@BestRoofingNow.com "`): should sign in. Test in Task 3.
2. A link opened twice (double click, email preview bots): second use says the link expired, no second session. Test in Task 2 and Task 3.
3. Someone removed from the team (canLogin off) after the link was sent: the link must not sign them in. Test in Task 3.
4. A weak password typed on the set-password page: the error shows and the link still works for the next try (validate before redeeming). Test in Task 3.
5. A member with no password yet (Google-only) typing any password: same 401 as a wrong password, and it still counts toward lockout. Test in Task 3.

---

### Task 1: Database: password columns and password_links table

**Files:**
- Modify: `shared/schema.ts` (team_members, after `googleSub`; new table after `nativeHandoffs`)
- Create: `migrations/0004_password_login.sql`
- Test: `server/auth/__tests__/password-schema.db.test.ts`

**Interfaces:**
- Produces: `teamMembers.passwordHash: text('password_hash')` (nullable), `teamMembers.failedLogins: integer('failed_logins').notNull().default(0)`, `teamMembers.lockedUntil: timestamp('locked_until')` (nullable). Table `passwordLinks = pgTable('password_links', { companyId: companyId(), tokenHash: text('token_hash').primaryKey(), email: text('email').notNull(), purpose: text('purpose').notNull(), expiresAt: timestamp('expires_at').notNull() })`.

- [ ] **Step 1: Write the failing test** `password_links is company-isolated`: with `makeTestCompany` twice, insert a row as company A via `asCompany`, assert selecting as company B returns 0 rows and as A returns 1. Second test `team_members has password columns`: insert a member as A, assert `failedLogins === 0`, `passwordHash === null`, `lockedUntil === null`. Use `describe.skipIf(!local)` like `native-handoff.db.test.ts`.
- [ ] **Step 2: Run** `scripts/test-db.sh && eval "$(scripts/test-db.sh --env)" && SESSION_SECRET=test npx vitest run server/auth/__tests__/password-schema.db.test.ts`. Expected: FAIL (column/table does not exist).
- [ ] **Step 3: Add the schema fields above and write `0004_password_login.sql`:** `ALTER TABLE team_members ADD COLUMN` for the three columns; `CREATE TABLE password_links` with the FK to `companies(id)` and `company_id` defaulting the same way `native_handoffs` does in `0001_archie_baseline.sql`; `CHECK (purpose IN ('welcome','reset'))`; then enable + force RLS and create the `company_isolation` policy and `password_links_company_id_idx` exactly as the loop in `0002_archie_rls.sql` does (that loop already ran, so it will not pick up the new table). Grant the same privileges `archie_app` has on `native_handoffs`. Separate statements with `--> statement-breakpoint`. Add the journal entry `0004_password_login` to `migrations/meta/_journal.json`.
- [ ] **Step 4: Run** the same command. Expected: PASS. Also run the full `npx vitest run` to make sure existing isolation tests still pass.
- [ ] **Step 5: Commit** `git commit -m "Password sign-in: columns on team_members and a company-scoped password_links table"`

### Task 2: Hashing and one-time links

**Files:**
- Create: `server/auth/password.ts`, `server/auth/password-links.ts`
- Test: `server/auth/__tests__/password.test.ts`, `server/auth/__tests__/password-links.db.test.ts`

**Interfaces:**
- Consumes: `passwordLinks` (Task 1), `requireCompanyId`, `runAsSystem` from `server/tenant/context`.
- Produces:
  - `hashPassword(plain: string): Promise<string>`: format `scrypt$16384$8$1$<salt b64>$<hash b64>`, 16-byte random salt, 64-byte key.
  - `verifyPassword(plain: string, stored: string | null | undefined): Promise<boolean>`: `crypto.timingSafeEqual`; returns false for null/garbled stored values. When stored is null it still runs one scrypt against a fixed dummy hash so timing does not reveal "no password".
  - `passwordProblem(plain: unknown): string | null`: `null` when OK; `"Use at least 10 characters."` when shorter than 10; `"That password is too long."` over 200.
  - `PASSWORD_LINK_TTL_MS = 60 * 60 * 1000`
  - `mintPasswordLink(email: string, purpose: 'welcome' | 'reset'): Promise<string>`: runs in the current company; stores lowercased email.
  - `redeemPasswordLink(token: string): Promise<{ email: string; companyId: string; purpose: 'welcome' | 'reset' } | null>`
  - `passwordLinkUrl(token: string): string`: `${process.env.APP_BASE_URL}/set-password#t=${encodeURIComponent(token)}` (strip a trailing slash from the base).

- [ ] **Step 1: Write failing unit tests** in `password.test.ts`: `verifies the right password and rejects a wrong one`; `two hashes of the same password differ`; `rejects null, empty and garbled stored values without throwing`; `passwordProblem` returns the two exact messages above for `'short'` and `'x'.repeat(201)`, and `null` for `'roofs-are-cool-99'`.
- [ ] **Step 2: Write failing DB tests** in `password-links.db.test.ts` (mirror `native-handoff.db.test.ts`): `one of eight simultaneous redeemers wins`; `a spent link stays spent`; `an expired link returns null` (insert a row with `expiresAt` in the past via `asCompany`); `the grant names the minting company and purpose`; `junk tokens ('', 'x', 500 chars) return null`.
- [ ] **Step 3: Run** `SESSION_SECRET=test npx vitest run server/auth/__tests__/password` Expected: FAIL (modules missing).
- [ ] **Step 4: Implement** both files. `redeemPasswordLink` copies `redeemHandoff`: length guard 20..200, one `DELETE ... RETURNING` under `runAsSystem('redeem password link', ...)`, then the expiry check.
- [ ] **Step 5: Run** the same command. Expected: PASS.
- [ ] **Step 6: Commit** `git commit -m "Password sign-in: scrypt hashing and one-time set-password links"`

### Task 3: Sign-in, forgot and set-password routes

**Files:**
- Create: `server/auth/password-routes.ts`, `server/auth/password-mail.ts`
- Modify: `server/storage/team.ts` (three helpers), `server/routes.ts` (register right after `registerAuthRoutes(app)`)
- Test: `server/auth/__tests__/password-routes.test.ts`

**Interfaces:**
- Consumes: Task 2 functions; `findSignInMember`, `touchLogin` (storage/team); `isBlockedLoginEmail`, `isAllowedLoginEmail`, `memberCanLogin` (allowlist); `isLiveCompany`; `runAsCompany`; `startSignedInSession` (auth/routes); `rateLimit` (lib/rate-limit).
- Produces:
  - storage/team.ts: `setPasswordHash(email: string, hash: string): Promise<void>` (also zeroes `failedLogins`, clears `lockedUntil`); `recordFailedLogin(email: string): Promise<void>` (increments; on reaching 5 sets `lockedUntil = now + 15 min` and resets the count to 0); `clearFailedLogins(email: string): Promise<void>`. All run in the current company.
  - password-mail.ts: `sendPasswordLinkEmail(input: { to: string; name: string; companyName: string; purpose: 'welcome' | 'reset'; url: string }): Promise<boolean>`. Returns false (and logs) when `RESEND_API_KEY` or `ARCHIE_MAIL_FROM` is unset. Subjects: welcome `"Set up your Archie login for {companyName}"`, reset `"Reset your Archie password"`. Body: greeting by first name, one sentence, a button to `url`, `"This link works once and expires in 1 hour."`. Escape `name` and `companyName` in HTML.
  - password-routes.ts: `registerPasswordRoutes(app: Express): void` with:
    - `POST /api/auth/login/password` `{ email, password }` → 200 `{ ok: true }` and a new session; 401 `{ error: "Email or password is wrong." }`; 429 `{ error: "Too many tries. Wait 15 minutes and try again." }` while `lockedUntil` is in the future (checked before verifying, and a correct password does not get through). Rate limit 20 per 10 minutes per IP.
    - `POST /api/auth/password/forgot` `{ email }` → always 200 `{ ok: true }`. Only when the full gate passes: mint a `'reset'` link as that company and send. Rate limit 5 per hour per IP.
    - `POST /api/auth/password/set` `{ token, password }` → check `passwordProblem` first (400 `{ error }`, token not spent); redeem (null → 400 `{ error: "This link has expired. Ask for a new one." }`); re-run the full gate for the grant's email and require `found.company.id === grant.companyId` (else the same expired-link 400); `setPasswordHash`; `touchLogin`; `startSignedInSession`; 200 `{ ok: true }`.
  - Normalize email with `.trim().toLowerCase()` everywhere.

- [ ] **Step 1: Write failing route tests**, following `routes-signin.test.ts` (mock `../../storage/team`, `../../tenant/companies`, `../password-mail`; real session). Cases:
  - `signs in with the right password` (cookie set, `/api/auth/me` returns the user)
  - `email with capitals and spaces still signs in`
  - `wrong password and unknown email get the same 401 body`
  - `member with no password gets 401 and it counts as a failed try`
  - `fifth wrong try locks; the right password then gets 429`
  - `blocked, canLogin false, inactive and paused-company members get 401`
  - `forgot always returns 200 and only sends mail for a member who passes the gate`
  - `set-password with a weak password returns 400 and does not spend the link` (assert redeem not called)
  - `set-password with a spent link returns the expired message`
  - `set-password for a member removed after the link was sent returns the expired message and no session`
  - `set-password success starts a session on a new session id` (compare cookie before and after)
- [ ] **Step 2: Run** `SESSION_SECRET=test npx vitest run server/auth/__tests__/password-routes.test.ts` Expected: FAIL.
- [ ] **Step 3: Implement** the storage helpers, `password-mail.ts`, `password-routes.ts`, and register the routes.
- [ ] **Step 4: Run** the same command, then `npx vitest run` and `npm run check`. Expected: all PASS, no type errors.
- [ ] **Step 5: Commit** `git commit -m "Password sign-in: login, forgot and set-password routes with lockout"`

### Task 4: Welcome email when an admin adds a team member

**Files:**
- Modify: `server/auth/team-routes.ts:45-65` (`POST /api/team`)
- Test: add to the existing team routes test file if one exists, otherwise `server/auth/__tests__/team-welcome.test.ts`

**Interfaces:**
- Consumes: `mintPasswordLink`, `passwordLinkUrl`, `sendPasswordLinkEmail`, `getCurrentCompany`.
- Produces: `POST /api/team` response gains `welcomeEmailSent: boolean`.

- [ ] **Step 1: Write failing tests:** `adding a member with canLogin sends a welcome link` (mail mock called once with `purpose: 'welcome'` and the new member's email); `adding a member without canLogin sends nothing`; `a mail failure still returns 201 with welcomeEmailSent false`.
- [ ] **Step 2: Run** the test file. Expected: FAIL.
- [ ] **Step 3: Implement:** after `createTeamMember` succeeds and `created.canLogin` is true, mint and send inside a try/catch; log failures, never fail the request.
- [ ] **Step 4: Run** the test file and `npx vitest run`. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Team: new members with login get a set-password email"`

### Task 5: Login page, Forgot password and Set password screens

**Files:**
- Modify: `client/src/pages/Login.tsx`, `client/src/App.tsx:176`
- Create: `client/src/pages/SetPassword.tsx`

**Interfaces:**
- Consumes: the three routes from Task 3. After a 200, reload to `/` so `useAuth` picks up the session.

- [ ] **Step 1: Login.tsx:** above the Google button add an email input (`type="email"`, `autoComplete="username"`), a password input (`autoComplete="current-password"`), and a "Sign in" button (same `bg-ink` style). Show the server's `error` text in the existing red error spot. Under it a "Forgot password?" text button that switches the card to an email-only form; on submit show `"If that email is on a team, we sent a link. Check your inbox."`. Then a divider reading `or`, then the existing Google button unchanged.
- [ ] **Step 2: SetPassword.tsx:** read the token from `window.location.hash` (`#t=`), then clear the hash with `history.replaceState`. Two password inputs (`autoComplete="new-password"`), heading `"Set your password"`, note `"At least 10 characters."`, button `"Save and sign in"`. Mismatch shows `"The passwords don't match."` without calling the server. Show server errors as returned. No token: show `"This link is missing its code. Ask for a new one from the sign-in page."` with a link to `/`.
- [ ] **Step 3: App.tsx:** `if (!user) return window.location.pathname === '/set-password' ? <SetPassword /> : <Login />;`
- [ ] **Step 4: Verify:** `npm run check` and `npx vite build` succeed. Run `npm run dev` with the test database, seed a member with a password, and check in the browser: sign in, wrong password message, forgot form message, set-password flow from a minted link, mismatch message.
- [ ] **Step 5: Commit** `git commit -m "Login page: email and password, forgot password, and set-password screen"`

### Task 6: Ship

- [ ] **Step 1:** Full suite: `SESSION_SECRET=test npx vitest run` and `npm run check`. Expected: PASS.
- [ ] **Step 2:** Push to `main` (Vercel deploys `archie-roof-with`). Confirm the deployment is READY.
- [ ] **Step 3:** Confirm `RESEND_API_KEY`, `ARCHIE_MAIL_FROM` and `APP_BASE_URL` are set on the Vercel project. List any that are missing for James.
- [ ] **Step 4:** Run `0004_password_login.sql` on the live database with `scripts/migrate.ts` against the owner connection. Ask James before running it.
- [ ] **Step 5:** Mint a reset link for james@bestroofingnow.com and send it, so James can set his password and sign in.
