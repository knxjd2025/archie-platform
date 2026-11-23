/**
 * Report Quality Score
 *
 * Grades how complete and send-ready a roof report is, on a 0-100 scale with a
 * letter grade, and returns actionable next-step suggestions for whatever is
 * missing. Pure function — no DOM, no I/O — so the UI can render a quality
 * meter / checklist and the inspector knows what to improve before sending.
 *
 * Each dimension contributes a weighted 0..1 completeness fraction; the overall
 * score is the weighted average scaled to 0-100.
 */
import type { NarrativeFinding } from './comprehensive-roof-report.js';

export interface ReportQualityInput {
  findings?: NarrativeFinding[];
  photoCount?: number;
  executiveSummary?: string;
  inspectorNotes?: string;
  customerName?: string;
  hasStormData?: boolean;
}

export interface QualityDimension {
  key: string;
  label: string;
  /** 0..1 completeness fraction for this dimension. */
  fraction: number;
  /** Weight (share of the overall score). */
  weight: number;
  /** True when the dimension is "good enough" (fraction ≥ MET_THRESHOLD). */
  met: boolean;
  /** Actionable next step shown when the dimension is not met. */
  suggestion: string;
}

export type ReportGrade = 'A' | 'B' | 'C' | 'D' | 'F';

export interface ReportQualityScore {
  overallScore: number;
  grade: ReportGrade;
  dimensions: QualityDimension[];
  suggestions: string[];
}

/** A dimension counts as "met" once it reaches this completeness fraction. */
const MET_THRESHOLD = 0.8;

/** Targets for full credit. */
const FINDINGS_TARGET = 3;
const PHOTOS_TARGET = 5;
const SUMMARY_WORD_TARGET = 30;

/** Letter-grade cutoffs (inclusive lower bounds). */
const GRADE_A = 90;
const GRADE_B = 80;
const GRADE_C = 70;
const GRADE_D = 60;

const PERCENT = 100;
/** Findings credit split: half for quantity, half for narrative completeness. */
const FINDINGS_COUNT_WEIGHT = 0.5;
const FINDINGS_NARRATIVE_WEIGHT = 0.5;

/** True when a string has non-whitespace content. */
function isFilled(text: string | undefined | null): boolean {
  return !!(text && text.trim().length > 0);
}

/** Count whitespace-delimited words; 0 for empty/nullish input. */
function wordCount(text: string | undefined | null): number {
  if (!text) return 0;
  const trimmed = text.trim();
  return trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length;
}

/** Clamp a number into the [0, 1] range. */
function clamp01(n: number): number {
  if (!Number.isFinite(n) || n < 0) return 0;
  return n > 1 ? 1 : n;
}

/** Completeness fraction for the inspection-findings dimension. */
function findingsFraction(findings: NarrativeFinding[]): number {
  const count = findings.length;
  if (count === 0) return 0;
  const countFraction = clamp01(count / FINDINGS_TARGET);
  const withNarrative = findings.filter((f) => isFilled(f.narrative)).length;
  const narrativeFraction = clamp01(withNarrative / count);
  return FINDINGS_COUNT_WEIGHT * countFraction + FINDINGS_NARRATIVE_WEIGHT * narrativeFraction;
}

/**
 * Map a 0-100 score to a letter grade on standard thresholds.
 *
 * Hardened against bad input: a non-finite score (NaN / ±Infinity / undefined /
 * null) maps to the lowest grade 'F' as a safe default, and finite scores are
 * effectively clamped to [0, 100] so out-of-range values never return undefined
 * or a wrong grade. In-range scores and the boundary thresholds are unchanged.
 */
export function scoreToGrade(score: number): ReportGrade {
  // Coerce non-finite / nullish scores to the safe default lowest grade.
  if (!Number.isFinite(score)) {
    return score === Infinity ? 'A' : 'F';
  }
  // Clamp into [0, 100] so out-of-range values map to the nearest end grade.
  const clamped = score < 0 ? 0 : score > PERCENT ? PERCENT : score;
  if (clamped >= GRADE_A) return 'A';
  if (clamped >= GRADE_B) return 'B';
  if (clamped >= GRADE_C) return 'C';
  if (clamped >= GRADE_D) return 'D';
  return 'F';
}

/**
 * Compute a report's quality score, per-dimension breakdown, and ordered list
 * of actionable suggestions for the dimensions that are not yet "met".
 */
export function calculateReportQualityScore(input: ReportQualityInput): ReportQualityScore {
  const findings = input.findings ?? [];
  const photoCount = input.photoCount ?? 0;

  const dimensions: QualityDimension[] = [
    {
      key: 'findings',
      label: 'Inspection Findings',
      fraction: findingsFraction(findings),
      weight: 30,
      met: false,
      suggestion: 'Add inspection findings with detailed narratives.',
    },
    {
      key: 'photos',
      label: 'Photo Documentation',
      fraction: clamp01(photoCount / PHOTOS_TARGET),
      weight: 25,
      met: false,
      suggestion: 'Attach roof photos to document the inspection.',
    },
    {
      key: 'executiveSummary',
      label: 'Executive Summary',
      fraction: clamp01(wordCount(input.executiveSummary) / SUMMARY_WORD_TARGET),
      weight: 20,
      met: false,
      suggestion: `Write an executive summary (aim for ${SUMMARY_WORD_TARGET}+ words).`,
    },
    {
      key: 'inspectorNotes',
      label: 'Inspector Notes',
      fraction: isFilled(input.inspectorNotes) ? 1 : 0,
      weight: 10,
      met: false,
      suggestion: 'Add inspector notes.',
    },
    {
      key: 'customerInfo',
      label: 'Customer Information',
      fraction: isFilled(input.customerName) ? 1 : 0,
      weight: 10,
      met: false,
      suggestion: 'Add the customer name.',
    },
    {
      key: 'stormData',
      label: 'Storm Data',
      fraction: input.hasStormData ? 1 : 0,
      weight: 5,
      met: false,
      suggestion: 'Include storm / weather history data.',
    },
  ];

  let weightedSum = 0;
  let totalWeight = 0;
  for (const d of dimensions) {
    d.met = d.fraction >= MET_THRESHOLD;
    weightedSum += d.weight * d.fraction;
    totalWeight += d.weight;
  }

  const overallScore = totalWeight === 0 ? 0 : Math.round((weightedSum / totalWeight) * PERCENT);
  const suggestions = dimensions.filter((d) => !d.met).map((d) => d.suggestion);

  return {
    overallScore,
    grade: scoreToGrade(overallScore),
    dimensions,
    suggestions,
  };
}
