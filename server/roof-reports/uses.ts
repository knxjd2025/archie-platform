/**
 * The record of each Send and each Rewrite (migration 0024), and the two things
 * it makes possible: a daily limit that holds when requests arrive together, and
 * a double click that does the work once.
 *
 * `reserveUse` does everything in ONE transaction that first takes a lock on the
 * company (`pg_advisory_xact_lock`), the same approach as the daily cap on
 * starting a report: it finds an earlier use with the same request key, counts
 * the day's uses for the report and for the company, and adds this one. Two
 * requests for the same company can never both read the count before either has
 * written it. The row is added as `reserved`, so the next request counts it
 * before the work (a slow email, a model call) has finished; the work is then
 * done outside the transaction, and `finishUse` closes the row.
 *
 * What counts toward the day: a send counts while it is reserved or done (a send
 * that was not delivered gives its place back); a rewrite counts in every state
 * but `unused`, because a rewrite that reached a model may have cost money even
 * if it did not work. A satellite look-up counts like a rewrite: it spends money (the picture and the model) even when the answer is no use.
 *
 * A row holds no address, name or text. Every function runs as the company in
 * context, so another company's rows are simply not there.
 */
import { and, eq, lt, sql } from 'drizzle-orm';
import { db } from '../db';
import { roofReportUses, roofReports, type RoofReportUse } from '../../shared/schema';
import { requireCompanyId } from '../tenant/context';

export type UseKind = 'send' | 'rewrite' | 'satellite';

/** A use still `reserved` after this long was left behind by a request that died; it lets go of its key. */
export const STALE_USE_MS = 10 * 60 * 1000;
/**
 * A rewrite still `reserved` this long is taken to have died: it no longer keeps another rewrite of the same report
 * waiting. Longer than the rewrite's own deadline (a minute), so a live one is never let go of.
 */
export const BUSY_USE_MS = 2 * 60 * 1000;
const DAY_MS = 24 * 3600_000;

export type Reserved =
  | { kind: 'reserved'; id: string }
  /** The same request key, asking for the same thing: the earlier use. Nothing is started. */
  | { kind: 'repeat'; use: RoofReportUse }
  | { kind: 'key_reused' }
  /** `exclusive`: another use of this kind for this report is still in flight. Nothing is added and nothing is counted. */
  | { kind: 'busy' }
  | { kind: 'report_capped' }
  | { kind: 'company_capped' };

const countedStatuses = (kind: UseKind): string[] => (kind === 'send' ? ['reserved', 'done'] : ['reserved', 'done', 'failed']);

export async function reserveUse(args: {
  kind: UseKind;
  reportId: string;
  memberId: number | null;
  key?: string | null;
  hash?: string | null;
  perReport: number;
  perCompany: number;
  /**
   * Only one use of this kind may be in flight for the report at a time. Decided inside the same company lock as the
   * counts, so two requests that arrive together can never both be let in, whichever copy of the app each reaches.
   */
  exclusive?: boolean;
  now?: Date;
}): Promise<Reserved> {
  const now = args.now ?? new Date();
  const key = args.key ?? null;
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`roof_report_uses:${requireCompanyId()}`}, 0))`);
    // A request that died while it held a place lets go of it.
    await tx.update(roofReportUses).set({ status: 'failed', finishedAt: now })
      .where(and(eq(roofReportUses.kind, args.kind), eq(roofReportUses.status, 'reserved'), lt(roofReportUses.createdAt, new Date(now.getTime() - STALE_USE_MS))));
    if (key) {
      const [earlier] = await tx.select().from(roofReportUses).where(and(
        eq(roofReportUses.reportId, args.reportId), eq(roofReportUses.kind, args.kind), eq(roofReportUses.idempotencyKey, key),
        sql`${roofReportUses.status} IN ('reserved','done')`,
      )).limit(1);
      if (earlier) return earlier.requestHash === (args.hash ?? null) ? { kind: 'repeat', use: earlier } as const : { kind: 'key_reused' } as const;
    }
    if (args.exclusive) {
      const [running] = await tx.select({ id: roofReportUses.id }).from(roofReportUses).where(and(
        eq(roofReportUses.reportId, args.reportId), eq(roofReportUses.kind, args.kind), eq(roofReportUses.status, 'reserved'),
        sql`${roofReportUses.createdAt} > ${new Date(now.getTime() - BUSY_USE_MS)}`,
      )).limit(1);
      if (running) return { kind: 'busy' } as const;
    }
    const since = new Date(now.getTime() - DAY_MS);
    const counted = sql`${roofReportUses.kind} = ${args.kind} AND ${roofReportUses.createdAt} >= ${since} AND ${roofReportUses.status} IN (${sql.join(countedStatuses(args.kind).map((s) => sql`${s}`), sql`, `)})`;
    const [{ n: forReport }] = await tx.select({ n: sql<number>`count(*)::int` }).from(roofReportUses).where(and(counted, eq(roofReportUses.reportId, args.reportId)));
    if (Number(forReport) >= args.perReport) return { kind: 'report_capped' } as const;
    const [{ n: forCompany }] = await tx.select({ n: sql<number>`count(*)::int` }).from(roofReportUses).where(counted);
    if (Number(forCompany) >= args.perCompany) return { kind: 'company_capped' } as const;
    const [row] = await tx.insert(roofReportUses).values({
      reportId: args.reportId, kind: args.kind, memberId: args.memberId, idempotencyKey: key, requestHash: key ? (args.hash ?? null) : null, status: 'reserved', createdAt: now,
    }).returning({ id: roofReportUses.id });
    return { kind: 'reserved', id: row.id } as const;
  });
}

/** Closes a use that is still reserved. Only from `reserved`, so a late answer cannot undo a newer one. */
export async function finishUse(id: string, status: 'done' | 'failed' | 'unused'): Promise<void> {
  await db.update(roofReportUses).set({ status, finishedAt: new Date() }).where(and(eq(roofReportUses.id, id), eq(roofReportUses.status, 'reserved')));
}

/**
 * A send that was delivered: the use is done AND the report's counters move, in
 * one transaction. Called only after the sender handed back an id.
 */
export async function finishSend(useId: string, reportId: string, now: Date = new Date()): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.update(roofReportUses).set({ status: 'done', finishedAt: now }).where(and(eq(roofReportUses.id, useId), eq(roofReportUses.status, 'reserved')));
    await tx.update(roofReports).set({ emailSentAt: now, emailSentCount: sql`${roofReports.emailSentCount} + 1` }).where(eq(roofReports.id, reportId));
  });
}

