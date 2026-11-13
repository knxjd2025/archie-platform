# Email and password sign-in (plus Google)

Approved by James, Nov 12, 2026.

## Why

Archie will be sold to other roofing companies. Not every roofer's team uses
Google accounts, so Archie needs a normal email and password sign-in. Google
sign-in stays. It also lets James test the live app without Google.

## Goals

- Login page: email box, password box, Sign in button, "Forgot password?" link,
  and the existing "Sign in with Google" button.
- Same gate for both ways in: the person must be on a company's team roster,
  active, with login enabled, and the company must be live. Blocklist and the
  optional allowlist apply too.
- Set-password links: sent when an admin adds a team member (welcome email) and
  from "Forgot password?". One use, expire after 1 hour.
- Passwords stored as salted scrypt hashes (Node's built-in crypto, no new
  dependency, no new cost).
- After 5 wrong passwords, that account waits 15 minutes.
- Emails go through Resend, which the app already uses.
- Tests for wrong password, unknown email, expired or reused link, lockout,
  people not on the roster, paused company.

## Non-goals

- Email codes, magic links, 2-step login (later).
- Any change to GHL. GHL stays the hidden backend for texts, email, calls and
  socials.
- Any change to the Best Roofing AI app or its repo.

## Anti-goals

- Telling a stranger whether an email is on a roster ("Forgot password?" always
  answers the same way).
- A bypass that skips the roster check.

## Approaches considered

1. Email and password plus Google. Picked: what people expect, fast for crews
   in the field.
2. Email code plus Google. No passwords to store, but slower every sign-in.
3. Both. Most to build and test.

## Left to the builder

Table and column names, where the scrypt helpers live, exact copy on the
login page and in the emails, and how the welcome email is triggered from the
team routes.
