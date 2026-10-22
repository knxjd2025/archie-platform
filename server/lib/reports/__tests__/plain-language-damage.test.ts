import { describe, it, expect } from 'vitest';
import { plainLanguageFor, plainSeverity } from '../plain-language-damage';
import { PRICING_DAMAGE_TYPES } from '../damage-type-map';

describe('plainLanguageFor', () => {
  it('has a plain-language entry for every pricing damage type', () => {
    for (const type of PRICING_DAMAGE_TYPES) {
      const d = plainLanguageFor(type);
      expect(d.label.length).toBeGreaterThan(0);
      expect(d.explanation.length).toBeGreaterThan(0);
    }
  });

  it('falls back gracefully for an unknown or missing type', () => {
    expect(plainLanguageFor('not_a_real_type').label).toBe('Roof Damage');
    expect(plainLanguageFor(null).label).toBe('Roof Damage');
    expect(plainLanguageFor(undefined).label).toBe('Roof Damage');
  });
});

describe('plainSeverity', () => {
  it('maps every known severity to a plain phrase', () => {
    expect(plainSeverity('critical')).toBe('Fix Right Away');
    expect(plainSeverity('high')).toBe('Fix Soon');
    expect(plainSeverity('medium')).toBe('Should Be Fixed');
    expect(plainSeverity('low')).toBe('Keep an Eye On It');
    expect(plainSeverity('none')).toBe('No Action Needed');
  });
  it('falls back to "No Action Needed" for anything unrecognized', () => {
    expect(plainSeverity('bogus')).toBe('No Action Needed');
    expect(plainSeverity(undefined)).toBe('No Action Needed');
  });
});
