/**
 * Make `timestamp without time zone` columns read back as the instant they were
 * written, on every path that reaches pg's global type parsers.
 *
 * Every timestamp Drizzle writes through a column goes out as
 * `value.toISOString()` — a UTC wall clock — and Postgres stores it naively,
 * dropping the `Z`. Reading it back, pg's default parser for OID 1114 builds
 * the Date in the *Node process's* local zone, so anything read straight off
 * the pool (pool.query, a pg client) came back shifted by the process offset.
 *
 * Which paths that is, measured against drizzle-orm 0.45 node-postgres:
 * - Query builder selects and `.returning()`: Drizzle overrides the type parser
 *   per query to keep the raw text and appends '+0000' itself, so they were
 *   already right and this parser never runs for them.
 * - `db.execute(sql...)`: the same per-query override, but no column to map
 *   through, so the row holds the bare text ('2026-10-16 02:10:29.765'). Convert
 *   it with parseNaiveTimestampAsUtc, never `new Date(text)`, which reads it as
 *   local time — and never send it to the browser as-is.
 * - `pool.query` and pg clients: this parser.
 *
 * Writes have their own zone dependencies, neither of which this touches: a
 * Date passed as a raw `sql` parameter is serialised by pg in process-local
 * time, and `defaultNow()` / `NOW()` store the session TimeZone's wall clock.
 * Production runs both in UTC (Vercel, Supabase), so they agree there; the
 * test config pins both to UTC so a developer machine agrees too.
 *
 * Registering the parser is global to the `pg` module, so importing this once
 * — from server/db.ts, which everything else imports — covers every pool.
 */
import pg from 'pg';

/** `timestamp without time zone`. */
const TIMESTAMP_OID = 1114;

/**
 * Pure: '2026-09-18 23:00:43.44' → the same instant in UTC. Postgres uses a
 * space where ISO-8601 wants a T, and V8's lenient parser is not something to
 * depend on, so the separator is normalised before the Z is appended.
 */
export function parseNaiveTimestampAsUtc(value: string): Date {
  const iso = value.includes('T') ? value : value.replace(' ', 'T');
  return new Date(`${iso}Z`);
}

let registered = false;

/** Idempotent: both entrypoints import server/db.ts, and pg's registry is global. */
export function registerUtcTimestampParser(): void {
  if (registered) return;
  pg.types.setTypeParser(TIMESTAMP_OID, parseNaiveTimestampAsUtc);
  registered = true;
}
