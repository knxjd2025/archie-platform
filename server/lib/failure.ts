/**
 * What a signed-in user is told when a route fails.
 *
 * 146 handlers were written as `catch (error) { res.status(500).json({ error:
 * error.message }) }`. The obvious fix — replace every message with safe copy —
 * is wrong here, because a good share of those messages are **deliberate and
 * user-facing**: "Pick your Good, Better and Best products and confirm the
 * scope", "Unable to geocode address", "That host is not allowed." Hiding those
 * would make the app less usable, not more secure.
 *
 * The messages that should never reach a browser are the ones nobody wrote:
 * Postgres protocol errors carrying table and column names, and Node system
 * errors carrying hostnames and file paths. Those are identifiable by shape
 * rather than by wording, which is what this does — so hand-written copy keeps
 * working and `relation "leads" does not exist` does not.
 */
import type { Response } from 'express';

/**
 * Something that wants to hear about every server-side failure — the bug log
 * (server/bugs). Registered rather than imported, so this file stays free of
 * the database and its tests stay free of a connection.
 */
type FailureObserver = (what: string, error: unknown, res: Response) => void;
let observer: FailureObserver | null = null;
export function onServerFailure(fn: FailureObserver | null): void { observer = fn; }

const GENERIC = "Something went wrong on our end. Try again — if it keeps happening, report it with the bug button.";

/**
 * Did a database driver or the operating system produce this, rather than us?
 *
 * node-postgres errors carry the PostgreSQL protocol fields (`severity`,
 * `routine`); Node system errors carry `syscall`/`errno`. Neither shape is
 * something application code constructs by hand.
 */
export function isInfrastructureError(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false;
  const any = e as Record<string, unknown>;
  if (typeof any.severity === 'string' && typeof any.code === 'string') return true;
  if (typeof any.routine === 'string') return true;
  if (typeof any.syscall === 'string' || typeof any.errno === 'number') return true;
  return false;
}

/**
 * A second net, for messages that are ours in shape but still say too much —
 * a query echoed into an error, a connection string, an absolute path.
 */
function looksLikePlumbing(message: string): boolean {
  return /\b(select|insert into|update .* set|delete from|relation|column .* does not exist|constraint)\b/i.test(message)
    || /postgres(ql)?:\/\//i.test(message)
    || /\/(Users|home|var|opt)\//.test(message)
    || message.length > 300;
}

/** The message that is safe to show, or null when there isn't one. */
export function safeMessage(error: unknown): string | null {
  if (isInfrastructureError(error)) return null;
  const text = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  if (!text.trim()) return null;
  return looksLikePlumbing(text) ? null : text;
}

/** Errors that mean an integration is not connected for the current company. */
const NOT_CONNECTED = new Set(['EnvCredentialsUnavailableError', 'GhlNotConnectedError', 'GoogleWorkspaceUnavailableError']);

/**
 * Answer a failed request. `what` names the route for the log, so a log line
 * identifies where it came from without a stack trace.
 */
export function sendFailure(
  res: Response,
  error: unknown,
  what: string,
  status = 500,
  /**
   * Copy for when the error itself has nothing showable. Several routes already
   * wrote a good one ("Could not count unassigned jobs.") — better than the
   * generic line, so it is kept rather than flattened.
   */
  fallback?: string,
): Response {
  // "Not connected for this company" is an answer, not a bug: 409, not 500.
  if (status === 500 && error instanceof Error && NOT_CONNECTED.has(error.name)) status = 409;
  const detail = error instanceof Error ? (error.stack || error.message) : String(error ?? '');
  console.error(`[api] ${what} failed: ${detail}`);
  // 4xx answers here are the route saying no on purpose; only real failures are bugs.
  if (status >= 500 && observer) {
    try { observer(what, error, res); } catch { /* the observer must never break the answer */ }
  }
  return res.status(status).json({ error: safeMessage(error) ?? fallback ?? GENERIC });
}
