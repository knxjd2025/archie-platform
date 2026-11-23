import type { ComprehensiveRoofReport } from '../../comprehensive-roof-report';

/** Minimal valid report fixture shared across report-generator tests. */
export function makeReport(overrides: Partial<ComprehensiveRoofReport> = {}): ComprehensiveRoofReport {
  return {
    id: 'test-001',
    generatedAt: '2026-03-15T12:00:00Z',
    version: '3.1',
    property: {
      address: '12 Elm Street',
      city: 'Cedar Falls',
      state: 'IA',
      zip: '50613',
      latitude: 42.5349,
      longitude: -92.4453,
    },
    stormHistory: {
      yearsAnalyzed: 3,
      searchRadiusMiles: 5,
      totalEvents: 15,
      hailEvents: 8,
      windEvents: 7,
      tornadoEvents: 0,
      largestHailInches: 1.5,
      highestWindMph: 65,
      riskLevel: 'medium',
      riskScore: 55,
      claimPotential: 'medium',
      eventsByYear: {
        2024: { hail: 3, wind: 2, total: 5 },
        2025: { hail: 5, wind: 5, total: 10 },
      },
    },
    damageAnalysis: {
      totalPhotosAnalyzed: 10,
      photosWithDamage: 6,
      overallSeverity: 'medium',
      roofAge: {
        estimatedAgeYears: 12,
        expectedLifespanYears: 25,
        remainingLifeYears: 13,
        confidence: 'medium',
        indicators: ['Granule loss', 'Moderate aging'],
        roofMaterial: 'asphalt_shingle',
        materialCondition: 'fair',
      },
      damageTypes: [
        { type: 'hail_impact', count: 4, severity: 'high' },
        { type: 'wind_lift', count: 2, severity: 'medium' },
      ],
      photos: [],
      aiSummary: 'Moderate storm damage detected across multiple areas.',
    },
    repairEstimate: {
      lineItems: [
        {
          repairTypeId: 'hail_repair',
          repairName: 'Hail Damage Repair',
          quantity: 4,
          unit: 'each',
          baseCostPerUnit: 85,
          finalCostPerUnit: 85,
          totalBaseCost: 340,
          totalFinalCost: 340,
        },
      ],
      subtotal: 340,
      multiplierApplied: 1,
      total: 340,
      notes: ['Pricing estimated.'],
    },
    inspectorNotes: '',
    dataQuality: 'verified',
    dataSources: ['Groq Vision', 'NOAA'],
    ...overrides,
  } as ComprehensiveRoofReport;
}
