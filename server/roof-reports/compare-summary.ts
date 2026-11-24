/**
 * What one report gives a side-by-side comparison, and nothing more: the roof's
 * condition, its findings, its storm events, its repair cost and its roof facts,
 * read from the saved report. A plain function with no database and no network.
 *
 * Never a customer, a note, a photo, a link or a long text. A fact the report
 * does not hold is null ("not known"), never zero, so a comparison cannot say a
 * roof had no storms when the report simply had no storm history.
 */

import type { ReportSummary } from '../../shared/roof-reports';

export interface SummaryRow {
  id: string;
  title: string | null;
  address: string;
  city: string | null;
  createdAt: Date;
  /** The row's own estimate, a decimal as text. */
  totalEstimate: string | null;
  reportJson: unknown;
}

export type { ReportSummary };

export const MAX_COMPARED_FINDINGS = 20;
const MAX_TITLE = 120;

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
/** A count or a measure: a finite number that is not negative. Anything else is "not known". */
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);
const word = (v: unknown, allowed: readonly string[]): string | null => (typeof v === 'string' && allowed.includes(v) ? v : null);
const short = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const t = v.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim();
  return t ? t.slice(0, max) : null;
};

const SEVERITIES = ['none', 'low', 'medium', 'high', 'critical', 'moderate', 'minor', 'advisory', 'cosmetic'] as const;
const GRADES = ['A', 'B', 'C', 'D', 'F'] as const;
const LEVELS = ['none', 'low', 'medium', 'high'] as const;

/** "hail_impact" as "Hail impact". */
const humanise = (type: string): string => {
  const t = type.replace(/[_-]+/g, ' ').trim();
  return t ? t[0].toUpperCase() + t.slice(1) : t;
};

export function summaryOf(row: SummaryRow): ReportSummary {
  const r = obj(row.reportJson);
  const condition = obj(r.roofConditionIndex);
  const damage = obj(r.damageAnalysis);
  const storm = obj(r.stormHistory);
  const estimate = obj(r.repairEstimate);
  const roof = obj(r.roofDetails);
  const measured = obj(r.measurementReport);

  const written = (Array.isArray(r.structuredFindings) ? r.structuredFindings : []).map((f) => {
    const x = obj(f);
    return { title: short(x.title, MAX_TITLE), severity: word(x.severity, SEVERITIES) };
  }).filter((f): f is { title: string; severity: string | null } => f.title !== null);
  const fromTypes = (Array.isArray(damage.damageTypes) ? damage.damageTypes : []).map((d) => {
    const x = obj(d);
    const type = short(x.type, MAX_TITLE);
    return { title: type === null ? null : humanise(type), severity: word(x.severity, SEVERITIES) };
  }).filter((f): f is { title: string; severity: string | null } => f.title !== null);

  const reportCost = num(estimate.total);
  const rowCost = row.totalEstimate === null ? null : num(Number(row.totalEstimate));
  const cost = reportCost !== null && reportCost > 0 ? reportCost : rowCost !== null && rowCost > 0 ? rowCost : null;
  const score = num(condition.overallScore);

  return {
    id: row.id,
    title: row.title,
    address: row.address,
    city: row.city,
    createdAt: row.createdAt.toISOString(),
    condition: { score: score !== null && score <= 100 ? score : null, grade: word(condition.grade, GRADES), severity: word(damage.overallSeverity, SEVERITIES) },
    findings: (written.length ? written : fromTypes).slice(0, MAX_COMPARED_FINDINGS),
    storm: {
      events: num(storm.totalEvents), hail: num(storm.hailEvents), wind: num(storm.windEvents), largestHailInches: num(storm.largestHailInches),
      risk: word(storm.riskLevel, LEVELS), claimPotential: word(storm.claimPotential, LEVELS),
    },
    cost,
    measurements: {
      squares: num(roof.squares) ?? num(measured.totalSquares),
      pitch: short(roof.pitch, 20),
      stories: num(roof.stories),
      material: short(roof.material, 60),
      ageYears: num(roof.age_years),
    },
  };
}
