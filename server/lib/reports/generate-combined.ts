/**
 * Combined INSPECTION + PROPOSAL generator. Runs the inspection pipeline
 * (storm + AI damage + estimate), pulls replacement measurements, and renders
 * one combined document.
 */
import { generateInspectionReport, type GenerateInspectionParams } from './generate-inspection.js';
import { fetchRoofMeasurements, fetchSatelliteDataUri } from './solar-measurements.js';
import { renderCombinedHtml } from './render-combined-html.js';
import type { ProposalInput } from './render-proposal-html.js';
import type { ComprehensiveRoofReport } from './comprehensive-roof-report.js';
import type { TierKey } from './certainteed-data.js';

export interface GenerateCombinedParams extends GenerateInspectionParams {
  customer?: string;
  jobNumber?: string;
  rep?: string;
  rates?: Partial<Record<TierKey, number>>;
  /** Gemini "new roof on YOUR home" color renders (see roof-color-renders.ts). */
  colorRenders?: Array<{ name: string; blurb?: string; url: string }>;
}

export interface GenerateCombinedResult {
  html: string;
  report: ComprehensiveRoofReport;
  /** The proposal inputs the document was rendered from — stored with the report so an edit can re-render it. */
  proposal: ProposalInput;
}

export async function generateCombinedReport(params: GenerateCombinedParams): Promise<GenerateCombinedResult> {
  const { report } = await generateInspectionReport(params);

  const lat = report.property.latitude;
  const lng = report.property.longitude;
  let measurements = null;
  try {
    const addr = [params.address, params.city, [params.state, params.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
    measurements = await fetchRoofMeasurements(addr, lat != null && lng != null ? { lat, lng } : undefined);
  } catch { /* non-fatal */ }

  let satelliteDataUri: string | null = null;
  if (lat != null && lng != null) {
    try { satelliteDataUri = await fetchSatelliteDataUri(lat, lng); } catch { /* non-fatal */ }
  }

  const proposal: ProposalInput = {
    customer: params.customer || report.property.address,
    address: params.address,
    cityStateZip: [params.city, [params.state, params.zip].filter(Boolean).join(' ')].filter(Boolean).join(', '),
    jobNumber: params.jobNumber,
    date: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
    rep: params.rep,
    satelliteDataUri,
    measuredSquares: measurements?.measuredSquares,
    billableSquares: measurements?.billableSquares,
    roofAreaSqFt: measurements?.roofAreaSqFt,
    averagePitch: measurements?.averagePitch,
    segments: measurements?.segments,
    imageryDate: measurements?.imageryDate,
    wastePct: measurements?.wastePct,
    rates: params.rates,
    colorRenders: params.colorRenders,
  };

  return { html: renderCombinedHtml({ report, proposal }), report, proposal };
}
