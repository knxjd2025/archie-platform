/**
 * Saving a roof report, and the states it can be in.
 *
 *   generating  a row exists and a run is making it
 *   ready       finished; `report_json` holds the whole report
 *   failed      the run could not finish; `problem` is a plain sentence; it can be tried again
 *   archived    put away by a person; nothing is deleted
 *
 * A report is `ready` only through `saveGenerated`, which writes the report,
 * its summary columns and the status in ONE statement, so there is never a
 * half-written ready report. A run that dies midway leaves `generating`,
 * which reads as `failed` after eight minutes (`effectiveState`); a run that
 * fails cleanly is `failed` at once (`markFailed`). Either can be tried
 * again (`beginRetry`). Every function here runs as the company in context,
 * so another company's report is simply not there, and each only moves a
 * report from the state it expects, so a late run cannot undo a newer one.
 */
import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gte, isNull, lt, or, sql, type SQL } from 'drizzle-orm';
import { db } from '../db';
import { roofReports, type RoofReport } from '../../shared/schema';
import { GENERATE_FAILED, MAX_REPORTS_PER_DAY } from '../../shared/roof-reports';
import { requireCompanyId } from '../tenant/context';
import type { ComprehensiveRoofReport } from '../lib/roof-reports/comprehensive-roof-report.js';
import { GenerateInputError, GeocodeFailedError, RanOutOfTimeError, type GenerateRequest } from './generate';
import { cleanText } from './inputs';

/** A report still generating after this long was left behind by a run that died. The same limit Archie's own documents use. */
export const STALE_AFTER_MS = 8 * 60 * 1000;

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** A 32-byte random token that names the report in a share link. Unique across every company. */
export const newShareToken = (): string => randomBytes(32).toString('hex');

/**
 * Takes the lock that makes "count the starts, then add one" a single step for
 * this company. Held until the transaction ends, so two requests for the same
 * company can never both read the count before either has written.
 */
async function lockCompanyStarts(tx: Pick<typeof db, 'execute'>): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`roof_report_starts:${requireCompanyId()}`}, 0))`);
}

/** How many generations this company began in the day before `now`: new reports and retries alike. */
async function startsInLastDay(tx: Pick<typeof db, 'select'>, now: Date): Promise<number> {
  const since = new Date(now.getTime() - 24 * 3600_000);
  const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(roofReports).where(sql`${roofReports.startedAt} >= ${since}`);
  return Number(n);
}

/** A fingerprint of what a generate request asked for: the same words in any key order give the same answer. */
export function requestFingerprint(value: unknown): string {
  const canonical = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(canonical);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)).map(([k, x]) => [k, canonical(x)]));
    return v;
  };
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

export type StartOutcome =
  | { kind: 'started'; row: RoofReport }
  /** The same person sent the same key with the same request before: the first report, nothing started. */
  | { kind: 'repeat'; row: RoofReport }
  /** The same key was used for a different request. */
  | { kind: 'key_reused' }
  /** The company has started its day's worth. */
  | { kind: 'capped' };

/**
 * Starts a report: the row, `generating`, made by this person. The caller then
 * claims the photos and runs the generation.
 *
 * The cap check and the insert are ONE transaction that first takes a lock on
 * the company, so parallel requests cannot overrun the daily cap. A repeated
 * submit (same person, same key, same request) is answered with the first
 * report and starts nothing; the same key with another request is refused.
 */
export async function startReport(args: {
  req: GenerateRequest;
  memberId: number | null;
  jobExternalId: string | null;
  idempotencyKey?: string | null;
  requestHash?: string | null;
  now?: Date;
  cap?: number;
}): Promise<StartOutcome> {
  const { req } = args;
  const now = args.now ?? new Date();
  const cap = args.cap ?? MAX_REPORTS_PER_DAY;
  const address = cleanText(req.address, 200);
  const key = args.idempotencyKey ?? null;
  return db.transaction(async (tx) => {
    await lockCompanyStarts(tx);
    if (key) {
      const [earlier] = await tx.select().from(roofReports).where(and(
        eq(roofReports.idempotencyKey, key),
        args.memberId === null ? isNull(roofReports.createdByMemberId) : eq(roofReports.createdByMemberId, args.memberId),
      )).limit(1);
      if (earlier) return earlier.requestHash === (args.requestHash ?? null) ? { kind: 'repeat', row: earlier } as const : { kind: 'key_reused' } as const;
    }
    if ((await startsInLastDay(tx, now)) >= cap) return { kind: 'capped' } as const;
    const [row] = await tx.insert(roofReports).values({
      jobExternalId: args.jobExternalId,
      createdByMemberId: args.memberId,
      status: 'generating',
      reportTypes: req.reportTypes,
      template: req.template,
      title: `Roof report, ${address}`.slice(0, 200),
      address,
      city: cleanText(req.city, 100) || null,
      state: cleanText(req.state, 50) || null,
      zip: cleanText(req.zip, 20) || null,
      customerName: cleanText(req.customer?.name, 200) || null,
      customerEmail: cleanText(req.customer?.email, 254) || null,
      customerPhone: cleanText(req.customer?.phone, 40) || null,
      inspectorNotes: cleanText(req.inspectorNotes, 20_000) || null,
      // What a retry needs and the row has no column for. Gone as soon as the report is saved.
      reportJson: { retryInput: { roofDetails: req.roofDetails ?? null, damageCounts: req.damageCounts ?? null, measurements: req.measurements ?? null } },
      shareToken: newShareToken(),
      startedAt: now,
      idempotencyKey: key,
      requestHash: key ? (args.requestHash ?? null) : null,
    }).returning();
    return { kind: 'started', row } as const;
  });
}

/**
 * Saves a finished report: its whole JSON, the summary columns and `ready`, in
 * one statement. A warning (part of it missing) is kept in `problem`. Only a
 * report that is still `generating` is written; false means it was not.
 */
export async function saveGenerated(reportId: string, report: ComprehensiveRoofReport, warning: string | null): Promise<boolean> {
  const lat = num(report.property?.latitude);
  const lon = num(report.property?.longitude);
  const total = num(report.repairEstimate?.total);
  const done = await db.update(roofReports).set({
    reportJson: report as unknown as Record<string, unknown>,
    status: 'ready',
    problem: warning,
    totalEstimate: total === null ? null : total.toFixed(2),
    damageSeverity: typeof report.damageAnalysis?.overallSeverity === 'string' ? report.damageAnalysis.overallSeverity : null,
    stormEventsCount: num(report.stormHistory?.totalEvents),
    dataQuality: typeof report.dataQuality === 'string' ? report.dataQuality : null,
    latitude: lat === null ? null : lat.toFixed(7),
    longitude: lon === null ? null : lon.toFixed(7),
    updatedAt: new Date(),
  }).where(and(eq(roofReports.id, reportId), eq(roofReports.status, 'generating'))).returning({ id: roofReports.id });
  return done.length > 0;
}

/** Marks a report that could not be finished `failed`, with a plain sentence. Only from `generating`. */
export async function markFailed(reportId: string, sentence: string): Promise<boolean> {
  const done = await db.update(roofReports).set({ status: 'failed', problem: sentence, updatedAt: new Date() })
    .where(and(eq(roofReports.id, reportId), eq(roofReports.status, 'generating'))).returning({ id: roofReports.id });
  return done.length > 0;
}

/**
 * The sentence to keep for a failure. Only the sentences this service wrote
 * itself are passed on; anything else (a database error, a provider's reply, a
 * path) becomes the one plain sentence.
 */
export function failureSentence(error: unknown): string {
  if (error instanceof GeocodeFailedError || error instanceof RanOutOfTimeError || error instanceof GenerateInputError) return error.message;
  return GENERATE_FAILED;
}

/** What a person is told a report's state is: a report still generating long after it could be running reads as failed. */
export function effectiveState(row: Pick<RoofReport, 'status' | 'problem' | 'updatedAt'>, now: Date = new Date()): { status: string; problem: string | null } {
  if (row.status === 'generating' && now.getTime() - row.updatedAt.getTime() > STALE_AFTER_MS) return { status: 'failed', problem: GENERATE_FAILED };
  return { status: row.status, problem: row.problem ?? null };
}

/**
 * The filter for one status as a list SHOWS it, in SQL: the same rule as
 * `effectiveState`. A report still `generating` after eight minutes is shown as
 * failed, so `failed` includes it and `generating` leaves it out. `archived` is
 * not here: it is a state a person put it in, handled with who may see archived
 * reports. Any other word matches nothing but its own stored status.
 */
export function statusFilter(status: string, now: Date = new Date()): SQL {
  const cutoff = new Date(now.getTime() - STALE_AFTER_MS);
  const dead = and(eq(roofReports.status, 'generating'), lt(roofReports.updatedAt, cutoff)) as SQL;
  if (status === 'failed') return or(eq(roofReports.status, 'failed'), dead) as SQL;
  if (status === 'generating') return and(eq(roofReports.status, 'generating'), gte(roofReports.updatedAt, cutoff)) as SQL;
  return eq(roofReports.status, status);
}

/**
 * Takes a failed report (or one left generating for over eight minutes) back
 * to `generating` so it can be run again. A retry is a start: it sets
 * `started_at`, and it is counted against the company's daily cap in the same
 * locked step as a new report. One statement does the move, so two requests
 * cannot both start it; null when it is not in a state that can be retried,
 * and 'capped' when the day is full (the report is left as it was).
 */
export async function beginRetry(reportId: string, now: Date = new Date(), cap: number = MAX_REPORTS_PER_DAY): Promise<RoofReport | null | 'capped'> {
  const cutoff = new Date(now.getTime() - STALE_AFTER_MS);
  return db.transaction(async (tx) => {
    await lockCompanyStarts(tx);
    const retryable = and(eq(roofReports.id, reportId), or(eq(roofReports.status, 'failed'), and(eq(roofReports.status, 'generating'), lt(roofReports.updatedAt, cutoff))));
    const [due] = await tx.select({ id: roofReports.id }).from(roofReports).where(retryable).limit(1);
    if (!due) return null;
    if ((await startsInLastDay(tx, now)) >= cap) return 'capped' as const;
    const [row] = await tx.update(roofReports).set({ status: 'generating', problem: null, updatedAt: now, startedAt: now }).where(retryable).returning();
    return row ?? null;
  });
}


// ---------------------------------------------------------------- the share link

/**
 * The share token of a finished report, making one if there is none: ONE
 * statement that sets it only where it is empty, so two people pressing at the
 * same moment get the same link. Null when the report is not finished (or not
 * there). Runs as the company in context.
 */
export async function ensureShareToken(reportId: string): Promise<string | null> {
  const [made] = await db.update(roofReports).set({ shareToken: newShareToken() })
    .where(and(eq(roofReports.id, reportId), isNull(roofReports.shareToken), eq(roofReports.status, 'ready')))
    .returning({ token: roofReports.shareToken });
  if (made?.token) return made.token;
  const [row] = await db.select({ token: roofReports.shareToken }).from(roofReports).where(and(eq(roofReports.id, reportId), eq(roofReports.status, 'ready'))).limit(1);
  return row?.token ?? null;
}

/** Turns a report's link off: the token is gone for good, and a link made later is a different one. Fine to ask twice. */
export async function clearShareToken(reportId: string): Promise<void> {
  await db.update(roofReports).set({ shareToken: null }).where(eq(roofReports.id, reportId));
}
