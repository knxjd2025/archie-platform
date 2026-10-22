/**
 * The commercial inspection a commercial report renders from.
 *
 * At generation time it is the live checklist (server/inspections/lookup.ts).
 * A snapshot of it is stored ON the report data as `report.commercial`, so
 * the editor's re-render and the public /r/:token page can rebuild the same
 * document later without the checklist being looked up again — and so the
 * routes can tell a commercial document from a residential one by its data.
 */
import type { InspectionReportContext } from '../../inspections/lookup.js';
import type { CommercialContext } from './sections/commercial-facts.js';

export interface CommercialSnapshot {
  answers: Record<string, any>;
  inspectorName: string | null;
  signedAt: string | null;
  inspectionType: string | null;
  jobType: 'retail' | 'insurance';
  recommendation: string | null;
  damageSummary: string | null;
  approxSquares: number | null;
}

export function commercialSnapshot(ctx: InspectionReportContext | null | undefined): CommercialSnapshot | null {
  if (!ctx?.commercial) return null;
  return {
    answers: ctx.answers,
    inspectorName: ctx.inspectorName,
    signedAt: ctx.signedAt,
    inspectionType: ctx.inspectionType,
    jobType: ctx.jobType,
    recommendation: ctx.recommendation,
    damageSummary: ctx.damageSummary,
    approxSquares: ctx.approxSquares,
  };
}

/** true when this report was generated from a commercial inspection. */
export function isCommercialReport(report: any): boolean {
  return !!report?.commercial?.answers;
}

/** The context the sections read — the live one when it is commercial, else the stored snapshot. */
export function commercialContextOf(report: any, live?: InspectionReportContext | null): CommercialContext | null {
  if (live?.commercial) return live;
  const snap = report?.commercial as CommercialSnapshot | undefined;
  if (!snap?.answers) return null;
  return { inspectionType: snap.inspectionType, recommendation: snap.recommendation, damageSummary: snap.damageSummary, approxSquares: snap.approxSquares, answers: snap.answers };
}

/**
 * The summary a commercial Proposal or Presentation leads with: the rep's
 * edited wording when they have changed it in the editor, otherwise the
 * inspector's own "Overall condition summary". The condition report always
 * prints the inspector's — that document is the record.
 */
export function commercialSummary(report: any, ctx: CommercialContext | null | undefined): string {
  const edited = typeof report?.commercialEdits?.summary === 'string' ? report.commercialEdits.summary.trim() : '';
  return edited || String(ctx?.damageSummary ?? '').trim();
}
