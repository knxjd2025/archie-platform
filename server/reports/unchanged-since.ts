/**
 * "This report row has not been saved since I read it" — the guard on a write
 * that did slow work (an AI call) between reading the row and writing it.
 *
 * Not a plain equality on updated_at. Postgres keeps microseconds and a JS
 * Date keeps milliseconds, so a row stamped by the database's own now() never
 * equals the Date it reads back as, and the guard would refuse every save.
 * Both sides are cut to the millisecond. The ISO string is cast rather than the
 * Date passed as-is: node-postgres sends a Date in the process's local zone,
 * and a `timestamp without time zone` would compare it as that wall clock.
 */
import { isNull, sql, type SQL } from 'drizzle-orm';
import { clientReports } from '../../shared/schema';

export function unchangedSince(updatedAt: Date | null): SQL {
  if (!updatedAt) return isNull(clientReports.updatedAt);
  return sql`date_trunc('milliseconds', ${clientReports.updatedAt}) = ${updatedAt.toISOString()}::timestamp`;
}
