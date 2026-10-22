import { describe, it, expect } from 'vitest';
import { ROOFING_PRODUCTS, productByKey, resolveTierSelection, computeTierPricing, replacementLineName } from '../roofing-products';

describe('ROOFING_PRODUCTS', () => {
  it('has all 12 real products with the specified per-square rates', () => {
    const rates: Record<string, number> = {
      tamko_titan_basic: 429.99,
      landmark: 479.99,
      landmark_pro: 509,
      landmark_premium: 619,
      landmark_belmont: 919.99,
      landmark_grand_manor: 989.99,
      landmark_presidential: 1359.99,
      standing_seam_metal: 2099,
      stone_coated_steel: 1099.99,
      cedur_shake: 1749.99,
      davinci_shake: 2149.99,
    };
    for (const [key, rate] of Object.entries(rates)) {
      expect(productByKey(key as any)?.ratePerSquare).toBe(rate);
    }
    expect(ROOFING_PRODUCTS.length).toBe(12); // 8 specified + Solaris + Stone-Coated Steel + CeDur + DaVinci
  });

  it('every product has a unique key', () => {
    const keys = ROOFING_PRODUCTS.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('resolveTierSelection', () => {
  it('resolves three valid catalog keys to their products', () => {
    const r = resolveTierSelection({ good: 'tamko_titan_basic', better: 'landmark_pro', best: 'standing_seam_metal' });
    expect(r?.good.name).toBe('Tamko Titan Basic');
    expect(r?.better.name).toBe('CertainTeed Landmark PRO');
    expect(r?.best.name).toBe('Standing Seam Metal Roof');
  });

  it('returns null if any key is invalid', () => {
    expect(resolveTierSelection({ good: 'nope' as any, better: 'landmark', best: 'landmark_pro' })).toBeNull();
  });

  it('resolves a rep-typed custom product for any tier', () => {
    const r = resolveTierSelection({
      good: 'landmark',
      better: { name: 'Owens Corning Duration', ratePerSquare: 550 },
      best: 'landmark_pro',
    });
    expect(r?.better.name).toBe('Owens Corning Duration');
    expect(r?.better.ratePerSquare).toBe(550);
    expect(r?.better.key).toBe('custom');
  });

  it('rejects a custom product with a blank name or a non-positive rate', () => {
    expect(resolveTierSelection({ good: { name: '', ratePerSquare: 500 }, better: 'landmark', best: 'landmark_pro' })).toBeNull();
    expect(resolveTierSelection({ good: { name: 'X', ratePerSquare: 0 }, better: 'landmark', best: 'landmark_pro' })).toBeNull();
    expect(resolveTierSelection({ good: { name: 'X', ratePerSquare: -5 }, better: 'landmark', best: 'landmark_pro' })).toBeNull();
  });
});

describe('commercial systems as tiers', () => {
  it('resolves a commercial key into the same product shape, carrying its system', () => {
    const r = resolveTierSelection({ good: 'dura_last_layover', better: 'dura_last_tpo', best: 'gaf_commercial_tpo' });
    expect(r?.good.name).toBe('Duro-Last Commercial PVC (layover)');
    expect(r?.good.category).toBe('commercial');
    expect(r?.good.system).toBe('layover');
    expect(r?.better.system).toBe('tear_off');
    expect(r?.best.manufacturer).toBe('GAF');
    expect(r?.best.ratePerSquare).toBe(910); // 650 × 1.4
  });

  it('folds the ISO R-value into tear-off tiers only', () => {
    const pricing = computeTierPricing(
      { good: 'dura_last_layover', better: 'dura_last_tpo', best: 'gaf_commercial_tpo' }, 100, { isoTier: 'r30' },
    )!;
    expect(pricing.good.iso).toBeUndefined();
    expect(pricing.good.ratePerSquare).toBe(770);
    expect(pricing.good.total).toBe(77000);
    expect(pricing.better.iso?.label).toBe('R-30 ISO Insulation');
    expect(pricing.better.iso?.ratePerSquare).toBe(618.8); // 5.2" × $85 × 1.4
    expect(pricing.better.ratePerSquare).toBe(770 + 618.8);
    expect(pricing.better.total).toBeCloseTo((770 + 618.8) * 100, 2);
    expect(pricing.best.iso?.tier).toBe('r30');
    // No ISO asked for: rates are the bare system rates.
    const bare = computeTierPricing({ good: 'dura_last_layover', better: 'dura_last_tpo', best: 'gaf_commercial_tpo' }, 100)!;
    expect(bare.better.iso).toBeUndefined();
    expect(bare.better.ratePerSquare).toBe(770);
    // A residential tier never carries ISO even when it is asked for.
    expect(computeTierPricing({ good: 'landmark', better: 'landmark_pro', best: 'dura_last_tpo' }, 30, { isoTier: 'r25' })!.good.iso).toBeUndefined();
  });

  it('names the line item for what happens to the old roof', () => {
    const p = computeTierPricing({ good: 'dura_last_layover', better: 'dura_last_tpo', best: 'restoration_coating' }, 50, { isoTier: 'r25' })!;
    expect(replacementLineName(p.good)).toBe('Roof Recover (layover) — Duro-Last Commercial PVC (layover)');
    expect(replacementLineName(p.better)).toBe('Full Roof Replacement — Duro-Last Commercial PVC (tear-off) + R-25 ISO Insulation');
    expect(replacementLineName(p.best)).toBe('Roof Restoration Coating — Silicone / TPO Restoration Coating');
    expect(replacementLineName(computeTierPricing({ good: 'landmark', better: 'landmark', best: 'landmark' }, 1)!.good)).toBe('Full Roof Replacement — CertainTeed Landmark');
  });
});

describe('computeTierPricing with a custom product', () => {
  it('prices a custom-product tier off the rep-typed rate, same as a catalog tier', () => {
    const pricing = computeTierPricing(
      { good: 'landmark', better: { name: 'Custom Metal', ratePerSquare: 1000 }, best: 'landmark_presidential' },
      30,
    );
    expect(pricing?.better.total).toBe(30000);
    expect(pricing?.better.product.name).toBe('Custom Metal');
  });
});
