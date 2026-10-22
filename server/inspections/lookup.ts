/**
 * Read side for report generation: the latest FINISHED field inspection for a
 * job (draft submissions don't count — an in-progress checklist shouldn't
 * silently steer a report). Estimate uses this so a rep doesn't have to
 * re-answer "retail or insurance" and "repair or replace" that the inspector
 * already answered on-site.
 *
 * A submission follows one of two checklists (form_kind): the residential
 * one, or the commercial low-slope one. The commercial kind is what routes
 * a job to the commercial inspection report and proposal.
 */
import { and, desc, eq, inArray } from 'drizzle-orm';
import { db } from '../db';
import { inspectionSubmissions } from '../../shared/schema';

export type EstimateJobType = 'retail' | 'insurance';
export type InspectionFormKind = 'residential' | 'commercial';

export interface InspectionReportContext {
  submissionId: number;
  formKind: InspectionFormKind;
  /** true when the checklist is the commercial low-slope one — the commercial reports render from it. */
  commercial: boolean;
  inspectionType: string | null;
  jobType: EstimateJobType;
  recommendation: string | null;
  damageSummary: string | null;
  /** From the checklist's roof-size field — a field estimate, offered as a prefill default, never trusted blindly. Squares. */
  approxSquares: number | null;
  inspectorName: string | null;
  signedAt: string | null;
  /**
   * The full checklist answer set, keyed by field name exactly as defined in
   * the form schema (shared/inspection-form.ts or
   * shared/commercial-inspection-form.ts). Only the derived fields above were
   * ever pulled out of this before — every other real, on-site-collected
   * fact was read from the DB and then silently discarded. Reports that want
   * more depth read straight from this.
   */
  answers: Record<string, any>;
}

/** Only "Insurance Claim" reads as an insurance job — every other checklist option (retail, storm response, pre-purchase, warranty) uses retail framing. */
export function jobTypeFromInspectionType(inspectionType: string | null | undefined): EstimateJobType {
  return inspectionType === 'Insurance Claim' ? 'insurance' : 'retail';
}

export function asFormKind(v: unknown): InspectionFormKind {
  return v === 'commercial' ? 'commercial' : 'residential';
}

/** The reserved answers key that records which checklist a submission follows. */
export const FORM_KIND_KEY = '__formKind';

/**
 * Which checklist a submission's answers follow. The kind is written into
 * the answers at creation; if a stale client ever drops it, the commercial
 * checklist is still recognisable by fields only it has.
 */
export function inferFormKind(answers: Record<string, any> | null | undefined): InspectionFormKind {
  const a = answers || {};
  if (a[FORM_KIND_KEY] === 'commercial' || a[FORM_KIND_KEY] === 'residential') return a[FORM_KIND_KEY];
  return ('Deck type' in a || 'Membrane type' in a || 'Number of roof systems in place' in a) ? 'commercial' : 'residential';
}

export async function getLatestInspectionContext(jobExternalId: string): Promise<InspectionReportContext | null> {
  const [row] = await db.select().from(inspectionSubmissions)
    .where(and(
      eq(inspectionSubmissions.jobExternalId, jobExternalId),
      inArray(inspectionSubmissions.status, ['submitted', 'reviewed']),
    ))
    .orderBy(desc(inspectionSubmissions.createdAt))
    .limit(1);
  if (!row) return null;

  const answers = (row.answers as Record<string, any>) || {};
  const formKind = inferFormKind(answers);
  const commercial = formKind === 'commercial';
  // Commercial records area in square feet; residential in squares.
  const sqFt = Number(answers['Roof area (sq ft)']);
  const squares = commercial
    ? (Number.isFinite(sqFt) && sqFt > 0 ? Math.round(sqFt / 100) : null)
    : (Number.isFinite(Number(answers['Approximate roof size in squares'])) ? Number(answers['Approximate roof size in squares']) : null);
  return {
    submissionId: row.id,
    formKind,
    commercial,
    inspectionType: row.inspectionType,
    jobType: jobTypeFromInspectionType(row.inspectionType),
    recommendation: row.recommendation,
    damageSummary: (commercial ? answers['Overall condition summary'] : answers['Overall damage summary']) || null,
    approxSquares: squares,
    inspectorName: row.inspectorName ?? null,
    signedAt: row.signedAt ? new Date(row.signedAt).toISOString() : null,
    answers,
  };
}
