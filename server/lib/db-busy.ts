/**
 * "The database is busy" as an answer, not a bug.
 *
 * Thrown by the pool (server/db.ts) when no connection frees up in time, or
 * when the server or the Supabase pooler refuses a new connection because it
 * is full. Kept free of the database so the error handlers (error-response.ts,
 * failure.ts) can recognise it without importing a connection.
 *
 * Drizzle wraps driver errors ("Failed query: ..." with the original as
 * `cause`), so code that classifies an error must look through the cause
 * chain: findDatabaseBusy does.
 */

/** Seconds a client is told to wait before trying again. */
export const BUSY_RETRY_AFTER_SECONDS = 5;

/** What a person (or a webhook sender) is told. */
export const BUSY_MESSAGE = 'The database is busy right now. Try again in a few seconds.';

export class DatabaseBusyError extends Error {
  readonly status = 503;
  constructor(detail: string, cause: unknown) {
    super(`Database busy: ${detail}`, { cause });
    this.name = 'DatabaseBusyError';
  }
}

/** The DatabaseBusyError this error is or wraps (through `cause`), or null. */
export function findDatabaseBusy(err: unknown): DatabaseBusyError | null {
  let e: unknown = err;
  for (let depth = 0; depth < 10 && e && typeof e === 'object'; depth++) {
    if (e instanceof DatabaseBusyError || (e as { name?: unknown }).name === 'DatabaseBusyError') return e as DatabaseBusyError;
    e = (e as { cause?: unknown }).cause;
  }
  return null;
}

/**
 * Did getting a connection fail because the database side is full, rather
 * than broken? pg-pool's acquire timeout; Postgres's own limit (SQLSTATE
 * 53300: "sorry, too many clients already", "remaining connection slots are
 * reserved"); Supavisor's "Max client connections reached"; PgBouncer's
 * "no more connections allowed (max_client_conn)".
 */
export function isConnectionCapacityError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if ((err as { code?: unknown }).code === '53300') return true;
  return /timeout exceeded when trying to connect|terminated due to connection timeout|max client connections|max_client_conn|no more connections allowed|too many clients|remaining connection slots/i
    .test(err.message);
}
