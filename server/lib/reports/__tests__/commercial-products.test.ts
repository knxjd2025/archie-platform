import { describe, it, expect } from 'vitest';
import {
  COMMERCIAL_PRODUCTS, commercialProductByKey, COMMERCIAL_MARKUP,
  isoRatePerSquare, isoLineItem, ISO_COST_PER_INCH, ISO_THICKNESS_INCHES,
} from '../commercial-products';

describe('COMMERCIAL_PRODUCTS', () => {
  it('applies the 40% markup to the stated cost for every product', () => {
    expect(COMMERCIAL_MARKUP).toBe(1.4);
    const rates: Record<string, number> = {
      dura_last_tpo: 770,
      dura_last_layover: 770,
      gaf_commercial_tpo: 910,
      restoration_coating: 840,
    };
    for (const [key, rate] of Object.entries(rates)) {
      expect(commercialProductByKey(key as any)?.ratePerSquare).toBe(rate);
    }
  });

  it('every product has a unique key', () => {
    const keys = COMMERCIAL_PRODUCTS.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('ISO insulation pricing', () => {
  it('is priced at $85/inch cost with the same 40% markup', () => {
    expect(ISO_COST_PER_INCH).toBe(85);
    expect(ISO_THICKNESS_INCHES).toEqual({ r25: 4.2, r30: 5.2 });
    expect(isoRatePerSquare('r25')).toBeCloseTo(4.2 * 85 * 1.4, 2); // 499.80
    expect(isoRatePerSquare('r30')).toBeCloseTo(5.2 * 85 * 1.4, 2); // 618.80
  });

  it('builds one priced line item off the roof size', () => {
    expect(isoLineItem('r30', 20)).toEqual({ name: 'R-30 ISO Insulation', quantity: 20, unit: 'sq', unitPrice: 618.8 });
  });
});
