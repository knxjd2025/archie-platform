/**
 * Unit tests for narrative-output pluralization in the comprehensive roof report.
 *
 * Covers:
 *  - pluralizeCount() pure helper
 *  - generateNarrativeFindings() damage-types summary line, which must read
 *    "1 instance" / "3 instances" rather than the placeholder "instance(s)".
 */
import { describe, it, expect } from 'vitest';
import {
  pluralizeCount,
  generateNarrativeFindings,
  buildDamageAnalysisSection,
} from '../comprehensive-roof-report';
import type { AnalyzedPhoto, DamageAnalysisSection } from '../comprehensive-roof-report';

function makePhoto(overrides: Partial<AnalyzedPhoto> = {}): AnalyzedPhoto {
  return {
    id: 'p1',
    url: 'https://example.com/p1.jpg',
    damages: [],
    overallSeverity: 'none',
    aiSummary: '',
    analyzedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function damagedPhoto(id: string, type: string): AnalyzedPhoto {
  return makePhoto({
    id,
    overallSeverity: 'high',
    damages: [
      { id: `${id}-d`, type, label: type, severity: 'high', confidence: 90, description: '' },
    ],
  });
}

function makeDamageAnalysis(
  damageTypes: DamageAnalysisSection['damageTypes'],
): DamageAnalysisSection {
  return {
    totalPhotosAnalyzed: 4,
    photosWithDamage: 2,
    overallSeverity: 'high',
    roofAge: null,
    damageTypes,
    photos: [],
    aiSummary: '',
  };
}

describe('pluralizeCount', () => {
  it('renders the singular noun for a count of 1', () => {
    expect(pluralizeCount(1, 'instance')).toBe('1 instance');
  });

  it('renders the auto-pluralized noun for a count greater than 1', () => {
    expect(pluralizeCount(3, 'instance')).toBe('3 instances');
  });

  it('renders the plural noun for a count of 0', () => {
    expect(pluralizeCount(0, 'instance')).toBe('0 instances');
  });

  it('uses an explicit irregular plural when provided', () => {
    expect(pluralizeCount(1, 'foot', 'feet')).toBe('1 foot');
    expect(pluralizeCount(2, 'foot', 'feet')).toBe('2 feet');
  });
});

describe('generateNarrativeFindings damage-types summary pluralization', () => {
  it('writes "1 instance" (singular) and "3 instances" (plural), never "instance(s)"', () => {
    const narrative = generateNarrativeFindings(
      makeDamageAnalysis([
        { type: 'granule_loss', count: 1, severity: 'high' },
        { type: 'hail_damage', count: 3, severity: 'medium' },
      ]),
    );

    expect(narrative).toContain('1 instance,');
    expect(narrative).toContain('3 instances,');
    expect(narrative).not.toContain('instance(s)');
  });
});

describe('buildDamageAnalysisSection AI summary pluralization', () => {
  it('uses singular "1 photo" / "1 type of damage" for single counts', () => {
    const { aiSummary } = buildDamageAnalysisSection([damagedPhoto('p1', 'hail_damage')]);

    expect(aiSummary).toContain('Analyzed 1 photo.');
    expect(aiSummary).toContain('1 type of damage');
    expect(aiSummary).not.toContain('photo(s)');
    expect(aiSummary).not.toContain('type(s)');
  });

  it('uses plural "photos" / "types of damage" for multiple counts', () => {
    const { aiSummary } = buildDamageAnalysisSection([
      damagedPhoto('p1', 'hail_damage'),
      damagedPhoto('p2', 'wind_damage'),
      makePhoto({ id: 'p3' }),
    ]);

    expect(aiSummary).toContain('Analyzed 3 photos.');
    expect(aiSummary).toContain('2 types of damage');
    expect(aiSummary).not.toContain('(s)');
  });

  it('pluralizes correctly in the no-damage summary', () => {
    expect(buildDamageAnalysisSection([makePhoto({ id: 'a' })]).aiSummary)
      .toContain('Analyzed 1 photo.');
    expect(
      buildDamageAnalysisSection([makePhoto({ id: 'a' }), makePhoto({ id: 'b' })]).aiSummary,
    ).toContain('Analyzed 2 photos.');
  });
});
