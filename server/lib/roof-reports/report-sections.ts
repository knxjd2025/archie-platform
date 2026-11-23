/**
 * Shared report section definition. Both the HTML generator
 * (lib/roof-analysis-report-html.ts) and the React-PDF template
 * (lib/pdf-templates/RoofReportPDF.tsx) consume this list so they can never
 * drift on which sections render for a given report + template combination.
 */
import type { ComprehensiveRoofReport, ReportType } from './comprehensive-roof-report.js';
import { getTemplateConfig } from './report-templates.js';

export type ReportSectionId =
  | 'cover'
  | 'propertyInfo'
  | 'executiveSummary'
  | 'roofDetails'
  | 'measurements'
  | 'roofAge'
  | 'rci'
  | 'stormHistory'
  | 'stormEnhanced'
  | 'insuranceClaim'
  | 'damageAnalysis'
  | 'inspectorNotes'
  | 'repairEstimate'
  | 'replacementOptions'
  | 'credentials'
  | 'cta';

export interface ReportSection {
  id: ReportSectionId;
  title: string;
  /** True if this section should render given the report data + template config. */
  visible: boolean;
}

const SECTION_TITLES: Record<ReportSectionId, string> = {
  cover: 'Cover',
  propertyInfo: 'Property Information',
  executiveSummary: 'Executive Summary',
  roofDetails: 'Roof Details',
  measurements: 'Roof Measurements',
  roofAge: 'Roof Age Assessment',
  rci: 'Roof Condition Index',
  stormHistory: 'Storm History',
  stormEnhanced: 'Enhanced Storm Detail',
  insuranceClaim: 'Insurance Claim Guidance',
  damageAnalysis: 'Damage Analysis',
  inspectorNotes: 'Inspector Notes',
  repairEstimate: 'Repair Estimate',
  replacementOptions: 'Replacement Options',
  credentials: 'Why Choose Us',
  cta: 'Next Steps',
};

/**
 * Compute the canonical section list for a report. HTML and PDF both call this
 * so they always agree on what renders.
 */
export function getReportSections(report: ComprehensiveRoofReport): ReportSection[] {
  const reportTypes: ReportType[] = report.reportTypes || ['inspection', 'measurement', 'storm'];
  const hasInspection = reportTypes.includes('inspection');
  const hasMeasurement = reportTypes.includes('measurement');
  const hasStorm = reportTypes.includes('storm');
  const tmpl = getTemplateConfig(report.reportTemplate);

  // Note: typed as the upper-bound (`{ id: ReportSectionId; visible: boolean }`)
  // upfront so the subsequent `.map(...)` lookup of SECTION_TITLES[s.id]
  // type-checks (s.id is a `ReportSectionId`, not a generic `string`).
  const base: ReadonlyArray<{ id: ReportSectionId; visible: boolean }> = [
    { id: 'cover', visible: true },
    { id: 'propertyInfo', visible: !!tmpl.sections.propertyInfo },
    { id: 'executiveSummary', visible: !!tmpl.sections.executiveSummary },
    { id: 'roofDetails', visible: !!tmpl.sections.roofDetails && (hasMeasurement || hasInspection) },
    { id: 'measurements', visible: !!tmpl.sections.measurements && hasMeasurement },
    { id: 'roofAge', visible: !!tmpl.sections.roofAge && hasInspection },
    { id: 'rci', visible: !!tmpl.sections.rci && !!report.roofConditionIndex },
    { id: 'stormHistory', visible: !!tmpl.sections.stormHistory && hasStorm },
    { id: 'stormEnhanced', visible: !!tmpl.sections.stormEnhanced && hasStorm && !!report.stormEnhanced },
    { id: 'insuranceClaim', visible: !!tmpl.sections.insuranceClaim },
    { id: 'damageAnalysis', visible: !!tmpl.sections.damageAnalysis && hasInspection },
    { id: 'inspectorNotes', visible: !!tmpl.sections.inspectorNotes },
    { id: 'repairEstimate', visible: !!tmpl.sections.repairEstimate && hasInspection },
    { id: 'replacementOptions', visible: !!tmpl.sections.replacementOptions && hasInspection },
    { id: 'credentials', visible: !!tmpl.sections.credentials },
    { id: 'cta', visible: !!tmpl.sections.cta },
  ];

  return base.map((s) => ({ ...s, title: SECTION_TITLES[s.id] }));
}

/** Convenience helper: just the visible section ids in canonical order. */
export function getVisibleSectionIds(report: ComprehensiveRoofReport): ReportSectionId[] {
  return getReportSections(report).filter(s => s.visible).map(s => s.id);
}
