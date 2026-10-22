import { describe, it, expect } from 'vitest';
import { toPricingDamageType, PRICING_DAMAGE_TYPES } from '../damage-type-map';
import { generateEstimateFromDamageAnalysis } from '../roof-repair-pricing';

describe('toPricingDamageType', () => {
  it('passes through an id that already prices', () => {
    expect(toPricingDamageType({ typeId: 'missing_shingles' })).toBe('missing_shingles');
    expect(toPricingDamageType({ typeId: 'HAIL_DAMAGE' })).toBe('hail_damage');
  });

  it('translates knowledge-base ids', () => {
    expect(toPricingDamageType({ typeId: 'wind_missing_shingle' })).toBe('missing_shingles');
    expect(toPricingDamageType({ typeId: 'hail_bruise' })).toBe('hail_damage');
    expect(toPricingDamageType({ typeId: 'age_curling' })).toBe('curled_shingles');
  });

  it('reads the prose when the model invents an id', () => {
    // This is the real-world case: the prompt asked for a "descriptive_id", so
    // models return things like "shingle_granule_loss_south_slope".
    expect(toPricingDamageType({ typeId: 'granule_loss_south_slope', name: 'Granule loss' })).toBe('granule_loss');
    expect(toPricingDamageType({ typeId: 'x1', name: 'Missing shingles near the ridge' })).toBe('missing_shingles');
    expect(toPricingDamageType({ typeId: 'x2', name: 'Cracked pipe boot' })).toBe('pipe_boot_cracked');
  });

  it('prefers the more specific match', () => {
    expect(toPricingDamageType({ name: 'Damaged chimney flashing' })).toBe('chimney_flashing_damage');
    expect(toPricingDamageType({ name: 'Rusted step flashing' })).toBe('flashing_damage');
  });

  it('falls back to the category only as a last resort', () => {
    expect(toPricingDamageType({ typeId: 'unknown', category: 'hail' })).toBe('hail_damage');
    expect(toPricingDamageType({ typeId: 'unknown', category: 'water' })).toBe('active_leak');
  });

  it('returns null rather than inventing a repair', () => {
    // Moss is real but has no repair line item — reporting it is fine, billing
    // for a guessed repair is not.
    expect(toPricingDamageType({ typeId: 'bio_moss_algae', name: 'Moss growth', category: 'biological' })).toBeNull();
    expect(toPricingDamageType({})).toBeNull();
  });

  it('every mapped id actually produces a priced line item', () => {
    // The whole point is money: an id that maps but prices at $0 is still a bug.
    for (const id of PRICING_DAMAGE_TYPES) {
      const est = generateEstimateFromDamageAnalysis([{ type: id, count: 1 }]);
      expect(est.lineItems.length, `${id} produced no line items`).toBeGreaterThan(0);
      expect(est.subtotalFinal, `${id} priced at 0`).toBeGreaterThan(0);
    }
  });
});
