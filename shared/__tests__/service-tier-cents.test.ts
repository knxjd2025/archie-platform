import { describe, it, expect } from 'vitest';
import { serviceTierRateOk } from '../addon-pricing';

describe('serviceTierRateOk enforces whole cents', () => {
  it('accepts in-band whole-cent rates, including ones float makes awkward', () => {
    for (const ok of [29, 64.5, 64.57, 99, '45.10', 33.33]) expect(serviceTierRateOk(ok)).toBe(true);
  });

  it('refuses fractions of a cent', () => {
    for (const bad of [64.555, 29.001, '50.125']) expect(serviceTierRateOk(bad)).toBe(false);
  });

  it('still refuses out-of-band, blank and non-numeric', () => {
    for (const bad of [28.99, 99.01, '', '  ', null, undefined, 'abc']) expect(serviceTierRateOk(bad)).toBe(false);
  });
});
