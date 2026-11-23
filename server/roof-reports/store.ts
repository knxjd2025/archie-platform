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
import { randomBytes } from 'node:crypto';
import { and, eq, lt, or, sql } from 'drizzle-orm';
import { db } from '../db';
import { roofReports, type RoofReport } from '../../shared/schema';
import { GENERATE_FAILED } from '../../shared/roof-reports';
import type { ComprehensiveRoofReport } from '../lib/roof-reports/comprehensive-roof-report.js';
import { GenerateInputError, GeocodeFailedError, RanOutOfTimeError, type GenerateRequest } from './generate';
import { cleanText } from './inputs';

/** A report still generating after this long was left behind by a run that died. The same limit Archie's own documents use. */
export const STALE_AFTER_MS = 8 * 60 * 1000;

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** A 32-byte random token that names the report in a share link. Unique across every company. */
export const newShareToken = (): string => randomBytes(32).toString('hex');

/** Starts a report: the row, `generating`, made by this person. The caller then claims the photos and runs the generation. */
export async function insertGenerating(args: { req: GenerateRequest; memberId: number | null; jobExternalId: string | null }): Promise<RoofReport> {
  const { req } = args;
  const address = cleanText(req.address, 200);
  const [row] = await db.insert(roofReports).values({
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
    shareToken: newShareToken(),
  }).returning();
  return row;
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
 * Takes a failed report (or one left generating for over eight minutes) back
 * to `generating` so it can be run again. One statement, so two requests
 * cannot both start it; null when it is not in a state that can be retried.
 */
export async function beginRetry(reportId: string, now: Date = new Date()): Promise<RoofReport | null> {
  const cutoff = new Date(now.getTime() - STALE_AFTER_MS);
  const [row] = await db.update(roofReports).set({ status: 'generating', problem: null, updatedAt: now })
    .where(and(eq(roofReports.id, reportId), or(eq(roofReports.status, 'failed'), and(eq(roofReports.status, 'generating'), lt(roofReports.updatedAt, cutoff)))))
    .returning();
  return row ?? null;
}

/** How many reports this company started in the last day. */
export async function reportsStartedToday(now: Date = new Date()): Promise<number> {
  const since = new Date(now.getTime() - 24 * 3600_000);
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(roofReports).where(sql`${roofReports.createdAt} >= ${since}`);
  return Number(n);
}
