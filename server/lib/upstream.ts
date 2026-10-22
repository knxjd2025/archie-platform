/**
 * What the browser is told when an integration we depend on says no.
 *
 * Every integration route was written the same way — `catch (error) {
 * res.status(500).json({ error: error.message }) }` — which has three problems
 * at once:
 *
 *   1. **It is the wrong status.** QuickBooks not being connected is not a bug
 *      in this app; neither is GoHighLevel rejecting an expired token. A 500
 *      says "we broke", so every uptime check, retry policy and error budget
 *      counts a provider's bad day as ours.
 *   2. **It leaks.** `Twilio API Error (404): {"code":20404,"message":"The
 *      requested resource /2010-04-01/Accounts//Messages.json was not found"}`
 *      goes straight to the browser — account paths, provider internals and
 *      whatever a vendor decided to put in an error body.
 *   3. **It tells the user nothing they can act on.** Nobody standing in a
 *      driveway knows what `No key or keyFile set.` means.
 *
 * This maps the failure to a status that means what it says and a sentence the
 * person reading it can act on, and keeps the provider's own words in the
 * server log where they belong.
 */
import type { Response } from 'express';

export type UpstreamKind = 'not-configured' | 'rejected' | 'upstream-bad-request' | 'upstream-down' | 'unknown';

export interface Classified {
  kind: UpstreamKind;
  /** What we answer with. Never 500 for someone else's outage. */
  status: number;
  /** Safe to show a user. Names the provider, says who can fix it. */
  message: string;
}

/** The provider's own status code, when it put one in the message. */
function upstreamStatus(text: string): number | null {
  const m = /API Error \((\d{3})\)/.exec(text);
  return m ? Number(m[1]) : null;
}

/**
 * Classify by the message, because that is what the integration clients throw.
 * Giving each client a typed error would be tidier, but they are called from
 * dozens of places that read `.message`, and changing all of those to fix the
 * HTTP status of twenty routes is the wrong trade.
 */
export function classifyUpstream(error: unknown, provider: string): Classified {
  const text = error instanceof Error ? error.message : String(error ?? '');

  // Never set up, or set up and then unset. Not an error in the app.
  if (/not configured|not connected|is not set|not available|No key or keyFile|complete OAuth|no .*provider configured/i.test(text)) {
    return {
      kind: 'not-configured',
      status: 503,
      message: `${provider} isn't connected. Ask James to add the credentials, then try again.`,
    };
  }

  const status = upstreamStatus(text);

  if (status === 401 || status === 403 || /invalid or expired|token .*not valid|unauthorized/i.test(text)) {
    return {
      kind: 'rejected',
      status: 502,
      message: `${provider} rejected our credentials — the key is expired or was revoked. Nothing is wrong with your data; this needs reconnecting.`,
    };
  }

  if (status !== null && status >= 500) {
    return { kind: 'upstream-down', status: 503, message: `${provider} is having trouble right now. Try again in a few minutes.` };
  }

  if (status !== null) {
    return {
      kind: 'upstream-bad-request',
      status: 502,
      message: `${provider} couldn't answer that request. It's been logged — tell James if you keep seeing it.`,
    };
  }

  if (/fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|aborted|timeout/i.test(text)) {
    return { kind: 'upstream-down', status: 503, message: `Couldn't reach ${provider}. Check your signal, then try again.` };
  }

  return {
    kind: 'unknown',
    status: 500,
    message: `Something went wrong talking to ${provider}. It's been logged — tell James what you were doing if it keeps happening.`,
  };
}

/**
 * Answer an integration failure. `what` names the call for the log — "GHL
 * contacts", "JobTread jobs" — so a log line identifies the route without a
 * stack trace.
 */
export function sendUpstreamFailure(res: Response, error: unknown, provider: string, what: string): Response {
  const { kind, status, message } = classifyUpstream(error, provider);
  const detail = error instanceof Error ? error.message : String(error ?? '');
  // The provider's own words, kept out of the response and put where they are
  // useful. `not-configured` is an expected state, not a fault, so it logs
  // quietly rather than as an error.
  const log = kind === 'not-configured' ? console.warn : console.error;
  log(`[upstream] ${what} — ${provider} ${kind} (→ ${status}): ${detail}`);
  return res.status(status).json({ error: message, provider, reason: kind });
}
