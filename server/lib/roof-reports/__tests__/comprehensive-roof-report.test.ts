/**
 * Hardening tests for `createComprehensiveReport` — the assembly step that
 * merges optional pipeline outputs (storm data, damage analysis, repair
 * estimate, replacement tiers, measurements, photos) into one
 * `ComprehensiveRoofReport`.
 *
 * Two guarantees are locked in here:
 *  1. A COMPLETE, well-formed input set yields a structurally identical
 *     report to before (no behavior change for the happy path).
 *  2. A MINIMAL / PARTIAL input set (missing storm summary internals,
 *     no photos, no estimate, no measurements, no replacement tiers)
 *     does NOT throw, and the resulting report is structurally complete
 *     with finite/defined aggregate fields (no NaN, no undefined where a
 *     value is expected).
 */
import { describe, it, expect } from 'vitest';
import {
  createComprehensiveReport,
  calculateRoofConditionIndex,
  type ComprehensiveRoofReport,
  type DamageAnalysisSection,
} from '../comprehensive-roof-report';
import type { StormReport, StormEvent } from '../storm-history-service';
import type { RepairEstimateSummary } from '../roof-repair-pricing';

// ─── Fixtures ────────────────────────────────────────────────────────────

const PROPERTY = {
  address: '123 Main St',
  city: 'Dallas',
  state: 'TX',
  zip: '75201',
  latitude: 32.7767,
  longitude: -96.797,
};

const HAIL_EVENT: StormEvent = {
  id: 'evt-1',
  date: '2024-05-12',
  event_type: 'Hail',
  hail_size_inches: 1.75,
  distance_miles: 1.2,
  source: 'SWDI',
} as unknown as StormEvent;

/** A fully-populated, well-formed StormReport. */
function completeStormReport(): StormReport {
  return {
    property_address: PROPERTY.address,
    city: PROPERTY.city,
    state: PROPERTY.state,
    zip: PROPERTY.zip,
    latitude: PROPERTY.latitude,
    longitude: PROPERTY.longitude,
    start_date: '2021-06-01',
    end_date: '2024-06-01',
    years_covered: 3,
    summary: {
      total_events: 4,
      hail_events: 2,
      wind_events: 2,
      tornado_events: 0,
      largest_hail_inches: 1.75,
      highest_wind_mph: 65,
      insurance_claim_potential: 'high',
    },
    events_by_year: { 2024: [HAIL_EVENT] },
    events: [HAIL_EVENT],
    significant_events: [HAIL_EVENT],
    risk_assessment: {
      hail_risk: 'high',
      wind_risk: 'medium',
      overall_risk: 'high',
      risk_factors: ['Recent large hail within 2 miles'],
      recommendations: ['File a claim'],
    },
    risk_score: { hail_score: 80, wind_score: 50, overall_score: 70 },
    recommended_date_of_loss: {
      date: '2024-05-12',
      event_id: 'evt-1',
      event_type: 'Hail',
      magnitude: '1.75" hail',
      distance_miles: 1.2,
      reason: 'Largest hail event in window',
    },
    data_quality: 'verified',
    data_source_details: [],
    generated_at: '2024-06-01T00:00:00.000Z',
    data_sources: ['SWDI', 'IEM'],
    search_radius_miles: 5,
  } as unknown as StormReport;
}

/** A fully-populated repair estimate with a single line item. */
function completeRepairEstimate(): RepairEstimateSummary {
  return {
    lineItems: [
      {
        repairType: 'shingle_replacement',
        description: 'Replace damaged shingles',
        estimatedQuantity: 10,
        unit: 'sq ft',
        unitBaseCost: 5,
        totalBaseCost: 50,
        unitFinalCost: 8.25,
        totalFinalCost: 82.5,
      } as unknown as RepairEstimateSummary['lineItems'][number],
    ],
    subtotalBase: 50,
    subtotalFinal: 82.5,
    multiplier: 1.65,
  } as RepairEstimateSummary;
}

/** Every aggregate / numeric field that must never be NaN or non-finite. */
function assertFiniteAggregates(report: ComprehensiveRoofReport): void {
  // Roof condition index aggregates
  expect(Number.isFinite(report.roofConditionIndex!.overallScore)).toBe(true);
  for (const c of report.roofConditionIndex!.components) {
    expect(Number.isFinite(c.score)).toBe(true);
    expect(Number.isFinite(c.weight)).toBe(true);
  }
  // Storm summary aggregates
  const sh = report.stormHistory;
  for (const n of [
    sh.yearsAnalyzed,
    sh.searchRadiusMiles,
    sh.totalEvents,
    sh.hailEvents,
    sh.windEvents,
    sh.tornadoEvents,
    sh.riskScore,
  ]) {
    expect(typeof n).toBe('number');
    expect(Number.isFinite(n)).toBe(true);
  }
  // Damage analysis aggregates
  expect(Number.isFinite(report.damageAnalysis.totalPhotosAnalyzed)).toBe(true);
  expect(Number.isFinite(report.damageAnalysis.photosWithDamage)).toBe(true);
  // Repair estimate aggregates
  expect(Number.isFinite(report.repairEstimate.subtotal)).toBe(true);
  expect(Number.isFinite(report.repairEstimate.total)).toBe(true);
  expect(Number.isFinite(report.repairEstimate.multiplierApplied)).toBe(true);
}

/** Assert the report is structurally complete (all required sections present). */
function assertStructurallyComplete(report: ComprehensiveRoofReport): void {
  expect(report.id).toBeTruthy();
  expect(report.generatedAt).toBeTruthy();
  expect(report.version).toBeTruthy();
  expect(report.property).toBeDefined();
  expect(report.stormHistory).toBeDefined();
  expect(report.damageAnalysis).toBeDefined();
  expect(Array.isArray(report.damageAnalysis.photos)).toBe(true);
  expect(Array.isArray(report.damageAnalysis.damageTypes)).toBe(true);
  expect(report.repairEstimate).toBeDefined();
  expect(Array.isArray(report.repairEstimate.lineItems)).toBe(true);
  expect(Array.isArray(report.repairEstimate.notes)).toBe(true);
  expect(report.roofConditionIndex).toBeDefined();
  expect(typeof report.executiveSummary).toBe('string');
  expect(typeof report.narrativeFindings).toBe('string');
  expect(typeof report.inspectorNotes).toBe('string');
  expect(Array.isArray(report.reportTypes)).toBe(true);
  expect(Array.isArray(report.dataSources)).toBe(true);
  expect(['verified', 'partial', 'degraded']).toContain(report.dataQuality);
}

// ─── Tests ───────────────────────────────────────────────────────────────

describe('createComprehensiveReport — complete well-formed inputs (regression lock)', () => {
  it('produces a structurally complete report with finite aggregates', () => {
    const report = createComprehensiveReport({
      property: PROPERTY,
      stormReport: completeStormReport(),
      analyzedPhotos: [
        {
          id: 'p1',
          url: 'https://example.com/p1.jpg',
          damages: [
            {
              id: 'd1',
              type: 'hail_damage',
              label: 'Hail impact',
              severity: 'high',
              confidence: 90,
              description: 'Hail bruising',
            },
          ],
          overallSeverity: 'high',
          aiSummary: 'Hail damage present',
          analyzedAt: '2024-06-01T00:00:00.000Z',
        },
      ],
      repairEstimate: completeRepairEstimate(),
      roofDetails: { type: 'asphalt shingle', squares: 25, pitch: '6/12' },
      damageCounts: { windDamaged: 0, hailDamaged: 5, generalDamaged: 0 },
    });

    assertStructurallyComplete(report);
    assertFiniteAggregates(report);
    expect(report.stormHistory.totalEvents).toBe(4);
    expect(report.repairEstimate.total).toBe(82.5);
    expect(report.dataQuality).toBe('verified');
  });

  it('is deterministic for the happy path except id/generatedAt', () => {
    const args = {
      property: PROPERTY,
      stormReport: completeStormReport(),
      analyzedPhotos: [],
      repairEstimate: completeRepairEstimate(),
    };
    const a = createComprehensiveReport(args);
    const b = createComprehensiveReport(args);

    const normalize = (r: ComprehensiveRoofReport) => ({
      ...r,
      id: 'X',
      generatedAt: 'X',
    });
    expect(normalize(a)).toEqual(normalize(b));
  });
});

describe('createComprehensiveReport — missing / partial pipeline sections (hardening)', () => {
  it('does not throw and returns a complete report when analyzedPhotos is omitted', () => {
    const run = () =>
      createComprehensiveReport({
        property: PROPERTY,
        stormReport: completeStormReport(),
        // analyzedPhotos omitted (no inspection / no photos)
        analyzedPhotos: undefined as unknown as never,
        repairEstimate: completeRepairEstimate(),
      });

    expect(run).not.toThrow();
    const report = run();
    assertStructurallyComplete(report);
    assertFiniteAggregates(report);
    expect(report.damageAnalysis.totalPhotosAnalyzed).toBe(0);
    expect(report.damageAnalysis.photos).toEqual([]);
  });

  it('does not throw and returns a complete report when repairEstimate is omitted', () => {
    const run = () =>
      createComprehensiveReport({
        property: PROPERTY,
        stormReport: completeStormReport(),
        analyzedPhotos: [],
        repairEstimate: undefined as unknown as never,
      });

    expect(run).not.toThrow();
    const report = run();
    assertStructurallyComplete(report);
    assertFiniteAggregates(report);
    expect(report.repairEstimate.lineItems).toEqual([]);
    expect(report.repairEstimate.total).toBe(0);
    expect(report.repairEstimate.subtotal).toBe(0);
  });

  it('does not throw and returns a complete report when the storm report is a bare shell', () => {
    // Simulates a storm-only-failure / geocode-only path where the storm
    // service returned a minimal object missing summary/risk/data internals.
    const bareStorm = {
      property_address: PROPERTY.address,
      city: PROPERTY.city,
      state: PROPERTY.state,
      latitude: PROPERTY.latitude,
      longitude: PROPERTY.longitude,
    } as unknown as StormReport;

    const run = () =>
      createComprehensiveReport({
        property: PROPERTY,
        stormReport: bareStorm,
        analyzedPhotos: [],
        repairEstimate: completeRepairEstimate(),
      });

    expect(run).not.toThrow();
    const report = run();
    assertStructurallyComplete(report);
    assertFiniteAggregates(report);
    // Storm aggregates default to 0 rather than NaN/undefined
    expect(report.stormHistory.totalEvents).toBe(0);
    expect(report.stormHistory.hailEvents).toBe(0);
    expect(report.stormHistory.windEvents).toBe(0);
    expect(report.stormHistory.eventsByYear).toEqual({});
    expect(report.stormHistory.claimPotential).toBeDefined();
    expect(report.stormHistory.riskLevel).toBeDefined();
  });

  it('does not throw with the most minimal possible input set (all optional sections absent)', () => {
    const bareStorm = {
      property_address: PROPERTY.address,
      city: PROPERTY.city,
      state: PROPERTY.state,
      latitude: PROPERTY.latitude,
      longitude: PROPERTY.longitude,
    } as unknown as StormReport;

    const run = () =>
      createComprehensiveReport({
        property: PROPERTY,
        stormReport: bareStorm,
        analyzedPhotos: undefined as unknown as never,
        repairEstimate: undefined as unknown as never,
        // no roofDetails, no damageCounts, no replacementOptions,
        // no measurements, no measurementReport, no reportTypes
      });

    expect(run).not.toThrow();
    const report = run();
    assertStructurallyComplete(report);
    assertFiniteAggregates(report);
    // The executive summary and narrative must still be plain strings
    expect(report.executiveSummary).toBeTypeOf('string');
    expect(report.executiveSummary).not.toContain('NaN');
    expect(report.executiveSummary).not.toContain('undefined');
    expect(report.narrativeFindings).toBeTypeOf('string');
    // dataSources must be an array even when the storm report omitted it
    expect(report.dataSources).toEqual([]);
  });
});

describe('calculateRoofConditionIndex — undefined d.type (hardening)', () => {
  it('does not throw when a photo damage has an undefined type and damageCounts are provided', () => {
    // Construct a DamageAnalysisSection where the first damage has type=undefined.
    // This mirrors a partial AI result where the type field was omitted.
    const damageAnalysis = {
      totalPhotosAnalyzed: 1,
      photosWithDamage: 1,
      overallSeverity: 'moderate' as unknown as DamageAnalysisSection['overallSeverity'],
      damageTypes: [],
      photos: [
        {
          id: 'p1',
          url: 'https://example.com/p1.jpg',
          damages: [
            {
              id: 'd1',
              type: undefined as unknown as string,
              label: 'Unknown damage',
              severity: 'medium',
              confidence: 60,
              description: 'Unclear damage type',
            },
          ],
          overallSeverity: 'moderate' as unknown as DamageAnalysisSection['overallSeverity'],
          aiSummary: 'Some damage detected',
          analyzedAt: '2024-06-01T00:00:00.000Z',
        },
      ],
    } as unknown as DamageAnalysisSection;

    const run = () =>
      calculateRoofConditionIndex(
        damageAnalysis,
        null,
        { windDamaged: 1, hailDamaged: 0, generalDamaged: 0 },
        'asphalt shingle',
      );

    // Must not throw — before the fix this throws
    // "Cannot read properties of undefined (reading 'includes')"
    expect(run).not.toThrow();

    const rci = run();
    expect(rci).toBeDefined();
    expect(Number.isFinite(rci.overallScore)).toBe(true);
    expect(Array.isArray(rci.components)).toBe(true);
  });
});
