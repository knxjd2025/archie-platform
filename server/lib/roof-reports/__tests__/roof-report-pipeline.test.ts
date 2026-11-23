/**
 * Unit tests for comprehensive roof report pipeline
 * Tests: calculateRoofConditionIndex, report structure, types
 */
import { describe, it, expect } from 'vitest';
import {
  calculateRoofConditionIndex,
  type DamageAnalysisSection,
  type RoofAgeEstimation,
  type RoofConditionIndex,
  type AnalyzedPhoto,
  type DamageDetection,
} from '../comprehensive-roof-report';

// ── Test Helpers ──────────────────────────────────────────────────────────────

function makeDamage(overrides: Partial<DamageDetection> = {}): DamageDetection {
  return {
    id: 'dmg-1',
    type: 'hail_damage',
    label: 'Hail Impact',
    severity: 'medium',
    confidence: 85,
    description: 'Hail impact detected on shingle surface',
    ...overrides,
  };
}

function makePhoto(damages: DamageDetection[] = [], overrides: Partial<AnalyzedPhoto> = {}): AnalyzedPhoto {
  return {
    id: 'photo-1',
    url: 'https://example.com/photo.jpg',
    damages,
    overallSeverity: damages.length > 0 ? damages[0].severity as any : 'none',
    aiSummary: 'Test photo analysis',
    analyzedAt: '2026-03-15T12:00:00Z',
    ...overrides,
  };
}

function makeDamageAnalysis(
  photos: AnalyzedPhoto[] = [],
  overrides: Partial<DamageAnalysisSection> = {},
): DamageAnalysisSection {
  const allDamages = photos.flatMap(p => p.damages);
  const damageTypes = [...new Set(allDamages.map(d => d.type))].map(type => {
    const matching = allDamages.filter(d => d.type === type);
    return { type, count: matching.length, severity: matching[0]?.severity || 'low' };
  });

  return {
    totalPhotosAnalyzed: photos.length,
    photosWithDamage: photos.filter(p => p.damages.length > 0).length,
    overallSeverity: allDamages.length === 0 ? 'none' : 'medium',
    roofAge: null,
    damageTypes,
    photos,
    aiSummary: 'Test analysis summary',
    ...overrides,
  };
}

function makeRoofAge(overrides: Partial<RoofAgeEstimation> = {}): RoofAgeEstimation {
  return {
    estimatedAgeYears: 12,
    expectedLifespanYears: 25,
    remainingLifeYears: 13,
    confidence: 'medium',
    indicators: ['Granule loss', 'Moderate aging'],
    roofMaterial: 'asphalt_shingle',
    materialCondition: 'fair',
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('calculateRoofConditionIndex', () => {
  it('returns a valid RCI with all required fields', () => {
    const rci = calculateRoofConditionIndex(makeDamageAnalysis(), null);
    expect(rci).toHaveProperty('overallScore');
    expect(rci).toHaveProperty('components');
    expect(rci).toHaveProperty('grade');
    expect(typeof rci.overallScore).toBe('number');
    expect(rci.overallScore).toBeGreaterThanOrEqual(0);
    expect(rci.overallScore).toBeLessThanOrEqual(100);
  });

  it('has 6 components with proper weights summing to ~1.0', () => {
    const rci = calculateRoofConditionIndex(makeDamageAnalysis(), null);
    expect(rci.components.length).toBe(6);
    const totalWeight = rci.components.reduce((sum, c) => sum + c.weight, 0);
    expect(totalWeight).toBeCloseTo(1.0, 2);
  });

  it('assigns grade A for no damage and young roof', () => {
    const rci = calculateRoofConditionIndex(
      makeDamageAnalysis(),
      makeRoofAge({ estimatedAgeYears: 3 }),
    );
    expect(rci.grade).toBe('A');
    expect(rci.overallScore).toBeGreaterThanOrEqual(90);
  });

  it('assigns lower grade for older roof with damage', () => {
    const hailDmg = makeDamage({ type: 'hail_damage', severity: 'high' });
    const windDmg = makeDamage({ type: 'wind_damage', severity: 'high', id: 'dmg-2' });
    const photo = makePhoto([hailDmg, windDmg]);

    const rci = calculateRoofConditionIndex(
      makeDamageAnalysis([photo]),
      makeRoofAge({ estimatedAgeYears: 18, materialCondition: 'poor' }),
      { windDamaged: 10, hailDamaged: 15, generalDamaged: 5 },
    );
    expect(rci.overallScore).toBeLessThan(60);
    expect(['D', 'F']).toContain(rci.grade);
  });

  it('more damage produces lower score', () => {
    const noDamage = calculateRoofConditionIndex(makeDamageAnalysis(), null);

    const heavyDamage = calculateRoofConditionIndex(
      makeDamageAnalysis([
        makePhoto([
          makeDamage({ type: 'hail_damage', severity: 'critical', id: '1' }),
          makeDamage({ type: 'wind_damage', severity: 'high', id: '2' }),
          makeDamage({ type: 'flashing_damage', severity: 'high', id: '3' }),
        ]),
      ]),
      makeRoofAge({ estimatedAgeYears: 15 }),
      { windDamaged: 20, hailDamaged: 30, generalDamaged: 10 },
    );

    expect(heavyDamage.overallScore).toBeLessThan(noDamage.overallScore);
  });

  it('user-reported damage counts reduce score even without AI photos', () => {
    const noManual = calculateRoofConditionIndex(
      makeDamageAnalysis(),
      makeRoofAge(),
    );
    const withManual = calculateRoofConditionIndex(
      makeDamageAnalysis(),
      makeRoofAge(),
      { windDamaged: 20, hailDamaged: 15, generalDamaged: 0 },
    );
    expect(withManual.overallScore).toBeLessThan(noManual.overallScore);
  });

  it('each component has valid condition label', () => {
    const rci = calculateRoofConditionIndex(makeDamageAnalysis(), makeRoofAge());
    const validConditions = ['excellent', 'good', 'fair', 'poor', 'critical'];
    for (const c of rci.components) {
      expect(validConditions).toContain(c.condition);
    }
  });

  it('grade mapping is consistent with score', () => {
    // Score >= 90 = A, >= 75 = B, >= 60 = C, >= 40 = D, < 40 = F
    const highScore = calculateRoofConditionIndex(
      makeDamageAnalysis(),
      makeRoofAge({ estimatedAgeYears: 2 }),
    );
    if (highScore.overallScore >= 90) expect(highScore.grade).toBe('A');
    else if (highScore.overallScore >= 75) expect(highScore.grade).toBe('B');
    else if (highScore.overallScore >= 60) expect(highScore.grade).toBe('C');
    else if (highScore.overallScore >= 40) expect(highScore.grade).toBe('D');
    else expect(highScore.grade).toBe('F');
  });

  it('scores are clamped between 0 and 99', () => {
    // Even extreme damage shouldn't go below 0
    const extreme = calculateRoofConditionIndex(
      makeDamageAnalysis([
        makePhoto(Array.from({ length: 20 }, (_, i) =>
          makeDamage({ id: `d-${i}`, type: 'hail_damage', severity: 'critical' })
        )),
      ]),
      makeRoofAge({ estimatedAgeYears: 25, materialCondition: 'critical' }),
      { windDamaged: 100, hailDamaged: 100, generalDamaged: 50 },
    );
    for (const c of extreme.components) {
      expect(c.score).toBeGreaterThanOrEqual(0);
      expect(c.score).toBeLessThanOrEqual(99);
    }
  });

  it('is a pure function (no mutation)', () => {
    const analysis = makeDamageAnalysis();
    const age = makeRoofAge();
    const counts = { windDamaged: 5, hailDamaged: 3, generalDamaged: 1 };

    const r1 = calculateRoofConditionIndex(analysis, age, counts);
    const r2 = calculateRoofConditionIndex(analysis, age, counts);
    expect(r1).toEqual(r2);
  });

  it('old roof (>20 years) caps starting score at 60', () => {
    const rci = calculateRoofConditionIndex(
      makeDamageAnalysis(),
      makeRoofAge({ estimatedAgeYears: 25 }),
    );
    // No damage, but age caps score — overall should be ~60
    expect(rci.overallScore).toBeLessThanOrEqual(65);
  });

  it('component names cover all roof areas', () => {
    const rci = calculateRoofConditionIndex(makeDamageAnalysis(), null);
    const names = rci.components.map(c => c.name);
    expect(names).toContain('Shingles/Covering');
    expect(names).toContain('Flashing');
    expect(names).toContain('Ventilation');
    expect(names).toContain('Gutters');
    expect(names).toContain('Structure');
    expect(names).toContain('Penetrations');
  });
});
