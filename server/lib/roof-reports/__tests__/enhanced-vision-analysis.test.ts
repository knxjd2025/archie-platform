/**
 * Unit tests for the PURE merge/normalize helper in enhanced-vision-analysis.
 *
 * `buildCombinedReport` rolls up an array of per-image DetailedImageAnalysis
 * objects into the `combined_report` shape: averaged damage percentage,
 * documentation-completeness score, critical-issue list, claim factors, etc.
 *
 * Hardening goal: malformed input (null/partial sub-results, non-finite
 * numeric fields, empty arrays) must NOT throw and must produce finite
 * numeric outputs — while well-formed input is unchanged.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  buildCombinedReport,
  type DetailedImageAnalysis,
} from '../enhanced-vision-analysis';
import type { RoofAnalysisResult } from '../groq-vision';

// These tests must never reach a real model provider.
vi.stubGlobal('fetch', vi.fn(() => { throw new Error('no network in tests'); }));

// ─── Fixtures ────────────────────────────────────────────────────────────

function makeVision(overrides: Partial<RoofAnalysisResult> = {}): RoofAnalysisResult {
  return {
    success: true,
    image_quality: 'good',
    roof_material: { type: 'asphalt_shingle', confidence: 90, characteristics: [] },
    damages_detected: [],
    overall_condition: 'fair',
    overall_severity_score: 30,
    insurance_claim_recommended: false,
    summary: 'summary',
    detailed_findings: 'findings',
    recommendations: [],
    ...overrides,
  } as RoofAnalysisResult;
}

function makeAnalysis(
  overrides: Partial<DetailedImageAnalysis> = {}
): DetailedImageAnalysis {
  const vision = (overrides.vision_analysis as RoofAnalysisResult) ?? makeVision();
  return {
    vision_analysis: vision,
    detailed_measurements: {
      estimated_affected_area_sqft: 100,
      estimated_damage_percentage: 30,
      number_of_damage_points: 2,
    },
    component_assessment: [
      {
        component: 'shingles',
        condition: 'fair',
        damage_present: true,
        damage_types: ['hail'],
        notes: '2 issues found',
        replacement_recommended: false,
      },
    ],
    age_assessment: {
      estimated_roof_age_years: 15,
      remaining_lifespan_years: 10,
      wear_pattern: 'uniform',
      maintenance_history_indicator: 'average',
    },
    weather_patterns: {
      hail_pattern_detected: false,
      wind_pattern_detected: false,
      water_intrusion_signs: false,
      ice_dam_indicators: false,
    },
    insurance_documentation: {
      claim_worthiness_score: 50,
      documentation_quality: 'good',
      recommended_additional_photos: [],
      haag_compliance_notes: [],
      claim_support_factors: [],
    },
    repair_replace_analysis: {
      repair_viable: true,
      repair_percentage_threshold: 30,
      current_damage_percentage: 30,
      recommendation: 'repair',
      reasoning: 'localized',
    },
    analysis_quality: {
      overall_confidence: 80,
      image_clarity_score: 80,
      coverage_completeness: 70,
      lighting_quality: 'acceptable',
      angle_assessment: 'acceptable',
      recommendations_for_better_analysis: [],
    },
    ...overrides,
  };
}

// ─── Well-formed baseline (must be unchanged by hardening) ───────────────

describe('buildCombinedReport — well-formed input', () => {
  it('produces a coherent combined report for valid analyses', () => {
    const analyses = [
      makeAnalysis({
        vision_analysis: makeVision({
          overall_severity_score: 50,
          damages_detected: [
            {
              damage_type_id: 'hail_1',
              damage_name: 'Hail bruising',
              category: 'hail',
              confidence: 90,
              severity: 'critical',
              location_description: 'south slope',
              visual_evidence: [],
              haag_compliant: true,
              insurance_claim_worthy: true,
              repair_recommendation: 'replace',
              estimated_urgency: 'immediate',
            },
          ],
        }),
        detailed_measurements: {
          estimated_affected_area_sqft: 200,
          estimated_damage_percentage: 50,
          number_of_damage_points: 4,
        },
      }),
      makeAnalysis({
        detailed_measurements: {
          estimated_affected_area_sqft: 100,
          estimated_damage_percentage: 30,
          number_of_damage_points: 2,
        },
      }),
    ];

    const report = buildCombinedReport(analyses);

    expect(report.total_damages_found).toBe(1);
    expect(report.unique_damage_types).toEqual(['Hail bruising']);
    expect(report.most_critical_issues).toHaveLength(1);
    // avg = (50 + 30) / 2 = 40
    expect(report.coverage_assessment.documentation_completeness).toBeGreaterThan(0);
    expect(report.coverage_assessment.documentation_completeness).toBeLessThanOrEqual(100);
    expect(report.insurance_summary.total_claim_worthy_damages).toBe(1);
    expect(Number.isFinite(report.coverage_assessment.documentation_completeness)).toBe(true);
    // A claim-worthy critical hail damage => full or partial replacement action.
    expect(['full_replacement', 'partial_replacement', 'repair']).toContain(
      report.final_recommendation.action
    );
  });
});

// ─── Hardening: malformed input must not throw / must stay finite ────────

describe('buildCombinedReport — malformed input hardening', () => {
  it('does not throw and stays finite for an empty analyses array', () => {
    let report: ReturnType<typeof buildCombinedReport> | undefined;
    expect(() => {
      report = buildCombinedReport([]);
    }).not.toThrow();
    expect(report).toBeDefined();
    expect(
      Number.isFinite(report!.coverage_assessment.documentation_completeness)
    ).toBe(true);
    expect(report!.total_damages_found).toBe(0);
  });

  it('skips null / undefined sub-results without throwing', () => {
    const analyses = [
      null as unknown as DetailedImageAnalysis,
      undefined as unknown as DetailedImageAnalysis,
      makeAnalysis(),
    ];
    let report: ReturnType<typeof buildCombinedReport> | undefined;
    expect(() => {
      report = buildCombinedReport(analyses);
    }).not.toThrow();
    expect(report).toBeDefined();
    expect(
      Number.isFinite(report!.coverage_assessment.documentation_completeness)
    ).toBe(true);
    expect(
      Number.isFinite(report!.final_recommendation.action.length)
    ).toBe(true);
  });

  it('coerces non-finite damage percentages to finite output', () => {
    const analyses = [
      makeAnalysis({
        detailed_measurements: {
          estimated_affected_area_sqft: 100,
          estimated_damage_percentage: NaN,
          number_of_damage_points: 2,
        },
      }),
      makeAnalysis({
        detailed_measurements: {
          estimated_affected_area_sqft: 100,
          estimated_damage_percentage: Infinity,
          number_of_damage_points: 2,
        },
      }),
    ];
    let report: ReturnType<typeof buildCombinedReport> | undefined;
    expect(() => {
      report = buildCombinedReport(analyses);
    }).not.toThrow();
    expect(report).toBeDefined();
    expect(
      Number.isFinite(report!.coverage_assessment.documentation_completeness)
    ).toBe(true);
    // The reasoning string interpolates a rounded percentage; it must not
    // contain NaN / Infinity.
    expect(report!.final_recommendation.reasoning).not.toMatch(/NaN|Infinity/);
  });

  it('tolerates partial sub-results missing nested fields', () => {
    const analyses = [
      // Missing vision_analysis / component_assessment / detailed_measurements
      {} as unknown as DetailedImageAnalysis,
      // vision_analysis present but damages_detected missing
      {
        vision_analysis: makeVision({ damages_detected: undefined as any }),
      } as unknown as DetailedImageAnalysis,
      makeAnalysis(),
    ];
    let report: ReturnType<typeof buildCombinedReport> | undefined;
    expect(() => {
      report = buildCombinedReport(analyses);
    }).not.toThrow();
    expect(report).toBeDefined();
    expect(Array.isArray(report!.unique_damage_types)).toBe(true);
    expect(
      Number.isFinite(report!.coverage_assessment.documentation_completeness)
    ).toBe(true);
    expect(Number.isFinite(report!.total_damages_found)).toBe(true);
  });
});
