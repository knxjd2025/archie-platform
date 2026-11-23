/** The roof age estimate the generation makes from what the photos showed. */
import { describe, it, expect } from 'vitest';
import { estimateRoofAge, materialLifespan } from '../roof-age';

const base = {
  roof_material: { type: 'asphalt_shingle', confidence: 90, characteristics: ['granule loss near the ridge'] },
  overall_condition: 'fair',
  summary: '',
  detailed_findings: '',
  damages_detected: [],
};

describe('estimateRoofAge', () => {
  it('uses the age the photo analysis gave when it gave one', () => {
    const age = estimateRoofAge({ ...base, raw_analysis: '```json\n{"estimated_age":{"years":14,"confidence":"high","indicators":["worn tabs"]}}\n```' });
    expect(age).toMatchObject({ estimatedAgeYears: 14, expectedLifespanYears: 20, remainingLifeYears: 6, confidence: 'high', indicators: ['worn tabs'], roofMaterial: 'asphalt_shingle', materialCondition: 'fair' });
  });

  it('reads wear signs in the words when no age was given', () => {
    const age = estimateRoofAge({ ...base, raw_analysis: 'not json' });
    expect(age.estimatedAgeYears).toBe(16);
    expect(age.indicators).toContain('Granule loss detected');
    expect(age.confidence).toBe('medium');
  });

  it('falls back to the overall condition when nothing else says', () => {
    const age = estimateRoofAge({ roof_material: null, overall_condition: 'poor', summary: '', detailed_findings: '', damages_detected: [] });
    expect(age).toMatchObject({ estimatedAgeYears: 22, expectedLifespanYears: 25, remainingLifeYears: 3, confidence: 'low', roofMaterial: null, materialCondition: 'poor' });
  });

  it('never goes below zero years of life left, and never throws on odd input', () => {
    expect(estimateRoofAge({ ...base, raw_analysis: '{"estimated_age":{"years":40}}' }).remainingLifeYears).toBe(0);
    expect(() => estimateRoofAge({} as never)).not.toThrow();
    expect(() => estimateRoofAge(null as never)).not.toThrow();
  });
});

describe('materialLifespan', () => {
  it('knows the common roofs, and is cautious about the rest', () => {
    expect(materialLifespan('metal')).toBe(50);
    expect(materialLifespan('Clay Tile')).toBe(75);
    expect(materialLifespan('some architectural shingle')).toBe(30);
    expect(materialLifespan('mystery')).toBe(25);
    expect(materialLifespan(null)).toBe(25);
  });
});
