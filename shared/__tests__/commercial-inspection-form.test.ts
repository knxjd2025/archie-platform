import { describe, it, expect } from 'vitest';
import {
  COMMERCIAL_INSPECTION_FIELDS, COMMERCIAL_INSPECTION_SECTIONS, missingRequiredCommercialFields,
  existingAssemblyLayers, conditionItems, reroofDetermination,
} from '../commercial-inspection-form';

const base = (): Record<string, any> => ({
  'Deck type': 'Steel (metal deck)', 'Deck condition': 'Good',
  'Vapor retarder': 'None seen',
  'Insulation type': 'Polyiso', 'Insulation thickness (in)': 2.5, 'Insulation attachment': 'Mechanically fastened',
  'Cover board': 'None',
  'Membrane type': 'TPO', 'Membrane thickness / plies': '45 mil', 'Membrane attachment': 'Mechanically attached',
  'Surfacing': 'None (smooth)',
  'Number of roof systems in place': '1',
  'Core cut taken': 'Yes',
  'Moisture survey performed': 'Infrared (IR) scan',
  'Estimated wet insulation (% of roof area)': 0,
  'Membrane field condition': 'Fair', 'Seams and laps': 'Good', 'Drains and strainers': 'Good',
  'Ponding observed': 'None', 'Active leaks reported by the owner': 'No',
});

describe('the commercial inspection form', () => {
  it('walks the assembly, the condition, the water, the claim, and the site', () => {
    expect(COMMERCIAL_INSPECTION_SECTIONS).toEqual(['Basics', 'Existing Roof System', 'Condition Assessment', 'Drainage & Moisture', 'Damage & Claims', 'Safety & Access', 'Sign-Off', 'Review']);
    const names = COMMERCIAL_INSPECTION_FIELDS.map((f) => f.name);
    expect(new Set(names).size).toBe(names.length);
    for (const must of ['Deck type', 'Membrane type', 'Number of roof systems in place', 'Core cut taken', 'Moisture survey performed', 'Ponding observed', 'Overall condition summary', 'Inspector Signature']) {
      expect(COMMERCIAL_INSPECTION_FIELDS.find((f) => f.name === must)!.isRequired, must).toBe(true);
    }
    expect(missingRequiredCommercialFields({})).toContain('Membrane type');
    expect(missingRequiredCommercialFields({})).not.toContain('Recommendation'); // reviewer field
  });

  it('stacks the existing assembly bottom to top and flags what was not determined', () => {
    const layers = existingAssemblyLayers(base());
    expect(layers.map((l) => l.role)).toEqual(['deck', 'insulation', 'membrane']);
    expect(layers[1].label).toBe('Polyiso insulation, 2.5 in');
    expect(layers[2].label).toBe('TPO — 45 mil');
    expect(layers[2].detail).toBe('Mechanically attached');

    const two = existingAssemblyLayers({ ...base(), 'Number of roof systems in place': '2', 'Cover board': 'Gypsum (DensDeck / Securock type)', 'Surfacing': 'Gravel / ballast', 'Membrane type': 'Unknown' });
    expect(two.map((l) => l.role)).toEqual(['deck', 'insulation', 'cover', 'older-roof', 'membrane', 'surfacing']);
    expect(two.find((l) => l.role === 'membrane')!.unknown).toBe(true);
  });

  it('sorts the condition items worst first', () => {
    const items = conditionItems({ 'Membrane field condition': 'Fair', 'Seams and laps': 'Failed', 'Drains and strainers': 'Good', 'Expansion joints': 'N/A' });
    expect(items.map((i) => i.rating)).toEqual(['Failed', 'Fair', 'Good', 'N/A']);
  });

  describe('restore / recover / replace', () => {
    it('two roofs already in place is a tear-off, by code', () => {
      const d = reroofDetermination({ ...base(), 'Number of roof systems in place': '2' });
      expect(d.path).toBe('replace');
      expect(d.reasons[0].code).toBe(true);
      expect(d.reasons[0].text).toContain('two roof systems');
    });
    it('a quarter or more of the insulation wet is a tear-off; less is cut out and replaced first', () => {
      const d = reroofDetermination({ ...base(), 'Estimated wet insulation (% of roof area)': 30 });
      expect(d.path).toBe('replace');
      expect(d.reasons[0].text).toContain('30% of the insulation is wet');
      const partial = reroofDetermination({ ...base(), 'Estimated wet insulation (% of roof area)': 12 });
      expect(partial.path).toBe('restore');
      expect(partial.reasons[0].text).toContain('We cut out those spots and replace them');
    });
    it('a dry, sound membrane with one system is a restoration candidate', () => {
      const d = reroofDetermination(base());
      expect(d.path).toBe('restore');
      expect(d.openQuestions).toEqual([]);
    });
    it('a poor membrane on a dry single roof is a recover, and ponding gets called out', () => {
      const d = reroofDetermination({ ...base(), 'Membrane field condition': 'Poor', 'Ponding observed': 'Moderate — 1/4 to 1 in, or slow to drain' });
      expect(d.path).toBe('recover');
      expect(d.reasons.some((r) => r.text.includes('sloped insulation'))).toBe(true);
    });
    it('withholds the call until the core cut and moisture survey are done', () => {
      const d = reroofDetermination({ ...base(), 'Core cut taken': 'No — recommended', 'Moisture survey performed': 'None', 'Estimated wet insulation (% of roof area)': undefined });
      expect(d.path).toBe('undetermined');
      expect(d.openQuestions.length).toBe(2);
    });
  });
});
