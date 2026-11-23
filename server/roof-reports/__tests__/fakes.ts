/**
 * Fakes the roof report tests share: a storm history with nothing in it and a
 * photo analysis that found missing shingles. Fictional address: 12 Elm
 * Street, Cedar Falls. Nothing here reaches the network.
 */
import type { StormReport } from '../../lib/roof-reports/storm-history-service';
import type { RoofAnalysisResult } from '../../lib/roof-reports/groq-vision';

export function fakeStorm(over: Partial<StormReport> = {}): StormReport {
  return {
    property_address: '12 Elm Street', city: 'Cedar Falls', state: 'IA', zip: '50613',
    latitude: 42.5349, longitude: -92.4453,
    start_date: '2023-11-24', end_date: '2026-11-24', years_covered: 3,
    summary: { total_events: 0, hail_events: 0, wind_events: 0, tornado_events: 0, insurance_claim_potential: 'none', hail_size_distribution: {} },
    events_by_year: {}, events: [], significant_events: [],
    risk_assessment: { hail_risk: 'low', wind_risk: 'low', overall_risk: 'low', risk_factors: [], recommendations: [] },
    data_quality: 'verified', data_source_details: [], generated_at: '2026-11-24T12:00:00Z',
    data_sources: ['NOAA'], search_radius_miles: 5,
    ...over,
  } as StormReport;
}

export function analysis(over: Partial<RoofAnalysisResult> = {}): RoofAnalysisResult {
  return {
    success: true, image_quality: 'good',
    roof_material: { type: 'asphalt_shingle', confidence: 90, characteristics: [] },
    damages_detected: [{
      damage_type_id: 'missing_shingles', damage_name: 'Missing shingles', category: 'wind', confidence: 88, severity: 'severe',
      location_description: 'near the ridge', visual_evidence: ['bare underlayment'], haag_compliant: true,
      insurance_claim_worthy: true, repair_recommendation: 'Replace the shingles', estimated_urgency: 'soon',
    }],
    overall_condition: 'fair', overall_severity_score: 65, insurance_claim_recommended: true,
    summary: 'Shingles are missing near the ridge.', detailed_findings: '', recommendations: [],
    model_used: 'fake', processing_time_ms: 5,
    ...over,
  } as RoofAnalysisResult;
}
