import { eq, sql } from 'drizzle-orm';
import { db } from '../db';
import { syncRuns } from '../../shared/schema';

export type SyncResult = { source: string; status: 'ok' | 'error'; counts: Record<string, number>; error?: string };

/** What a run row says until it finishes. sync_status has no 'running' value
 *  (adding one is a migration), so a run starts as 'error' with this note. */
export const UNFINISHED_NOTE = 'started, no result recorded yet';
/** An unfinished row older than this was killed (Vercel stops the function at 300s). */
export const STALE_RUN_MS = 6 * 60_000;

export type RunView = 'running' | 'ok' | 'partial' | 'error';

/**
 * How a sync_runs row should read. A row with no finishedAt is running while
 * it is young, and failed once it is older than any run can live — a killed
 * run never gets to write its own result.
 */
export function effectiveRunStatus(
  run: { status: string; startedAt: Date; finishedAt: Date | null; error: string | null },
  now: Date,
): { status: RunView; error: string | null } {
  if (run.finishedAt) return { status: run.status as RunView, error: run.error };
  if (now.getTime() - new Date(run.startedAt).getTime() <= STALE_RUN_MS) return { status: 'running', error: null };
  return { status: 'error', error: 'never finished — killed by the 300s function limit?' };
}

export async function runSync(source: string, fn: () => Promise<Record<string, number>>): Promise<SyncResult> {
  // Not 'ok' up front: a run inserted as ok and then killed (the hourly sync
  // hitting Vercel's 300s limit) stayed ok forever, so a dead sync looked green.
  const [run] = await db.insert(syncRuns).values({ source, status: 'error', error: UNFINISHED_NOTE }).returning();
  try {
    const counts = await fn();
    await db.update(syncRuns).set({ status: 'ok', counts, error: null, finishedAt: new Date() }).where(eq(syncRuns.id, run.id));
    return { source, status: 'ok', counts };
  } catch (err: any) {
    const message = err?.message ?? String(err);
    await db.update(syncRuns).set({ status: 'error', error: message, finishedAt: new Date() }).where(eq(syncRuns.id, run.id));
    return { source, status: 'error', counts: {}, error: message };
  }
}

// Idempotent bulk upsert keyed on source_id. `table` must have a unique `sourceId` column.
export async function upsertBySourceId(table: any, rows: Record<string, any>[]): Promise<number> {
  if (rows.length === 0) return 0;
  const updateCols: Record<string, any> = {};
  for (const key of Object.keys(rows[0])) {
    if (key === 'sourceId') continue;
    updateCols[key] = sql.raw(`excluded.${camelToSnake(key)}`);
  }
  updateCols['syncedAt'] = sql`now()`;
  await db.insert(table).values(rows).onConflictDoUpdate({ target: [table.companyId, table.sourceId], set: updateCols });
  return rows.length;
}

function camelToSnake(s: string): string {
  return s.replace(/[A-Z]/g, (m) => '_' + m.toLowerCase());
}
