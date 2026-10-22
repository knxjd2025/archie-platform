import { describe, it, expect } from 'vitest';
import { applyReplacementPricing, ReplacementInputError } from '../estimate-replacement';

const baseReport: any = {
  id: 'r1',
  generatedAt: '2026-09-06T00:00:00Z',
  property: { address: '550 Manning Dr', city: 'Springfield', state: 'IL', zip: '28202' },
  damageAnalysis: { totalPhotosAnalyzed: 1, photos: [] },
  repairEstimate: { lineItems: [{ repairName: 'old repair line', quantity: 1, unit: 'each', finalCostPerUnit: 10, totalFinalCost: 10 }], total: 10, notes: [] },
};

const tiers = { good: 'tamko_titan_basic', better: 'landmark_pro', best: 'landmark_presidential' } as const;

describe('applyReplacementPricing', () => {
  it('prices the selected tier against the confirmed roof size', () => {
    const out = applyReplacementPricing(baseReport, { tierSelection: tiers, squares: 30, selectedTier: 'better' });
    expect(out.selectedTier).toBe('better');
    expect(out.repairEstimate.total).toBeCloseTo(509 * 30, 2);
    expect(out.repairEstimate.lineItems).toHaveLength(1);
    expect(out.repairEstimate.lineItems[0].totalFinalCost).toBeCloseTo(509 * 30, 2);
  });

  it('carries all three options for the comparison table', () => {
    const out = applyReplacementPricing(baseReport, { tierSelection: tiers, squares: 30, selectedTier: 'good' });
    expect(out.replacementOptions).toHaveLength(3);
    expect(out.replacementOptions!.map((o: any) => o.tier)).toEqual(['good', 'better', 'best']);
  });

  it('never mutates the source report', () => {
    const before = JSON.stringify(baseReport);
    applyReplacementPricing(baseReport, { tierSelection: tiers, squares: 30, selectedTier: 'good' });
    expect(JSON.stringify(baseReport)).toBe(before);
  });

  it('rejects a missing or zero roof size', () => {
    expect(() => applyReplacementPricing(baseReport, { tierSelection: tiers, squares: 0, selectedTier: 'good' })).toThrow(ReplacementInputError);
  });

  it('prices a commercial tear-off tier with its ISO as one line, named for the work', () => {
    const out = applyReplacementPricing(baseReport, {
      tierSelection: { good: 'dura_last_layover', better: 'dura_last_tpo', best: 'gaf_commercial_tpo' },
      squares: 100, selectedTier: 'better', isoTier: 'r25',
    });
    const line = out.repairEstimate.lineItems[0];
    expect(line.repairName).toBe('Full Roof Replacement — Duro-Last Commercial PVC (tear-off) + R-25 ISO Insulation');
    expect(line.finalCostPerUnit).toBeCloseTo(770 + 499.8, 2); // system + 4.2" × $85 × 1.4
    expect(out.repairEstimate.total).toBeCloseTo((770 + 499.8) * 100, 2);
    expect((out.replacementOptions as any[])[0].iso).toBeUndefined(); // the layover tier
    expect((out.replacementOptions as any[])[1].iso.tier).toBe('r25');
  });

  it('rejects an unresolvable product key', () => {
    const bad = { good: 'not_a_real_product', better: 'landmark_pro', best: 'landmark_presidential' } as any;
    expect(() => applyReplacementPricing(baseReport, { tierSelection: bad, squares: 30, selectedTier: 'good' })).toThrow(ReplacementInputError);
  });
});
