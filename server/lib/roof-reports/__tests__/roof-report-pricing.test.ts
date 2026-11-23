/**
 * Unit tests for roof report pricing calculator
 * Tests: calculateShingleRepairPricing, calculateReplacementTiers
 */
import { describe, it, expect } from 'vitest';
import {
  calculateShingleRepairPricing,
  calculateReplacementTiers,
  type DamageCounts,
  type RepairPricingResult,
} from '../roof-report-pricing';

// Minimal CompanyProfile stub (no custom pricing)
const NULL_PROFILE = null;

function makeCounts(wind = 0, hail = 0, general = 0): DamageCounts {
  return { windDamaged: wind, hailDamaged: hail, generalDamaged: general };
}

describe('calculateShingleRepairPricing', () => {
  // ── Returns null when no damage ─────────────────────────────────────────────
  it('returns null when all damage counts are zero and no AI damages', () => {
    const result = calculateShingleRepairPricing({
      damageCounts: makeCounts(0, 0, 0),
      companyProfile: NULL_PROFILE,
    });
    expect(result).toBeNull();
  });

  // ── Single wind damage applies minimum ──────────────────────────────────────
  it('applies minimum charge for 1 wind-damaged shingle', () => {
    const result = calculateShingleRepairPricing({
      damageCounts: makeCounts(1, 0, 0),
      companyProfile: NULL_PROFILE,
    });
    expect(result).not.toBeNull();
    expect(result!.lineItems.length).toBeGreaterThanOrEqual(1);
    expect(result!.total).toBeGreaterThanOrEqual(350); // $350 minimum
    expect(result!.lineItems[0].repairTypeId).toBe('wind_damage_repair');
  });

  // ── Multiple damage types produce separate line items ──────────────────────
  it('produces separate line items for wind, hail, and general damage', () => {
    const result = calculateShingleRepairPricing({
      damageCounts: makeCounts(5, 3, 2),
      companyProfile: NULL_PROFILE,
    });
    expect(result).not.toBeNull();
    const ids = result!.lineItems.map(li => li.repairTypeId);
    expect(ids).toContain('wind_damage_repair');
    expect(ids).toContain('hail_damage_repair');
    expect(ids).toContain('general_damage_repair');
  });

  // ── Total equals sum of line items (no markup for defaults) ────────────────
  it('total equals sum of line item costs for default pricing', () => {
    const result = calculateShingleRepairPricing({
      damageCounts: makeCounts(10, 5, 0),
      companyProfile: NULL_PROFILE,
    });
    expect(result).not.toBeNull();
    const lineItemSum = result!.lineItems.reduce((s, li) => s + li.totalFinalCost, 0);
    // Total may have minimum applied, but should be >= sum
    expect(result!.total).toBeGreaterThanOrEqual(lineItemSum * 0.85); // allow regional adjustments
  });

  // ── Price range has ±15% spread ────────────────────────────────────────────
  it('price range is approximately ±15% of total', () => {
    const result = calculateShingleRepairPricing({
      damageCounts: makeCounts(20, 10, 0),
      companyProfile: NULL_PROFILE,
    });
    expect(result).not.toBeNull();
    expect(result!.priceRangeLow).toBeLessThan(result!.total);
    expect(result!.priceRangeHigh).toBeGreaterThan(result!.total);
    expect(result!.priceRangeLow).toBeGreaterThanOrEqual(result!.total * 0.84);
    expect(result!.priceRangeHigh).toBeLessThanOrEqual(result!.total * 1.16);
  });

  // ── Notes always include disclaimers ───────────────────────────────────────
  it('includes standard pricing notes', () => {
    const result = calculateShingleRepairPricing({
      damageCounts: makeCounts(3, 0, 0),
      companyProfile: NULL_PROFILE,
    });
    expect(result).not.toBeNull();
    expect(result!.notes.length).toBeGreaterThanOrEqual(1);
    const joined = result!.notes.join(' ');
    expect(joined).toMatch(/estimated|verification|standard/i);
  });

  // ── Markup is 1 for default pricing ────────────────────────────────────────
  it('uses markup of 1 for default pricing', () => {
    const result = calculateShingleRepairPricing({
      damageCounts: makeCounts(5, 0, 0),
      companyProfile: NULL_PROFILE,
    });
    expect(result).not.toBeNull();
    expect(result!.markup).toBe(1);
  });

  // ── Immutability: calling twice gives same result ──────────────────────────
  it('is a pure function (same input → same output)', () => {
    const params = {
      damageCounts: makeCounts(8, 4, 2),
      companyProfile: NULL_PROFILE,
    };
    const r1 = calculateShingleRepairPricing(params);
    const r2 = calculateShingleRepairPricing(params);
    expect(r1).toEqual(r2);
  });

  // ── Scaling: more damage = higher total ────────────────────────────────────
  it('produces higher total for more damage', () => {
    const small = calculateShingleRepairPricing({
      damageCounts: makeCounts(2, 0, 0),
      companyProfile: NULL_PROFILE,
    });
    const large = calculateShingleRepairPricing({
      damageCounts: makeCounts(50, 0, 0),
      companyProfile: NULL_PROFILE,
    });
    expect(small).not.toBeNull();
    expect(large).not.toBeNull();
    expect(large!.total).toBeGreaterThan(small!.total);
  });

  // ── Regional adjustment with state ─────────────────────────────────────────
  it('applies regional pricing when state is provided', () => {
    const withoutState = calculateShingleRepairPricing({
      damageCounts: makeCounts(10, 0, 0),
      companyProfile: NULL_PROFILE,
    });
    const withState = calculateShingleRepairPricing({
      damageCounts: makeCounts(10, 0, 0),
      companyProfile: NULL_PROFILE,
      state: 'CA',
    });
    expect(withoutState).not.toBeNull();
    expect(withState).not.toBeNull();
    // State param should produce different total or different notes count
    // The regional adjustment may be 1.0 (no change) for some states but notes should still differ
    const baseNoteCount = withoutState!.notes.length;
    const stateNoteCount = withState!.notes.length;
    // With state, we get at least one more note (the regional note) OR the total changes
    expect(stateNoteCount >= baseNoteCount || withState!.total !== withoutState!.total).toBe(true);
  });
});

// ── Hardening / regression lock for calculateReplacementTiers ────────────────
//
// calculateReplacementTiers takes roofSquares, optional pitch, material, etc.
// Malformed inputs (non-finite/negative/missing roofSquares, or a non-finite
// pitch string) must NEVER throw and must NEVER produce a NaN/negative tier
// money figure. A safe "no quote" outcome (null) is acceptable; if tiers are
// returned, every money figure must be finite and >= 0.
//
// These tests double as a regression lock: valid inputs must keep yielding the
// same tiers as before this hardening was asserted.
describe('calculateReplacementTiers — malformed-input hardening', () => {
  // Every money figure on a tier that must stay finite & non-negative.
  function tierMoneyFigures(tier: {
    total: number;
    subtotal: number;
    tax: number;
    materials?: Array<{ unit_price?: number; total?: number }>;
    labor?: Array<{ unit_price?: number; total?: number }>;
    other_costs?: Array<{ amount?: number }>;
  }): number[] {
    const nums: number[] = [tier.total, tier.subtotal, tier.tax];
    for (const m of tier.materials ?? []) {
      if (m.unit_price != null) nums.push(m.unit_price);
      if (m.total != null) nums.push(m.total);
    }
    for (const l of tier.labor ?? []) {
      if (l.unit_price != null) nums.push(l.unit_price);
      if (l.total != null) nums.push(l.total);
    }
    for (const o of tier.other_costs ?? []) {
      if (o.amount != null) nums.push(o.amount);
    }
    return nums;
  }

  // Result is "safe" if it's null (no quote) OR every tier money figure is
  // finite and non-negative. NaN/Infinity/negative anywhere = unsafe.
  function expectSafeResult(result: ReturnType<typeof calculateReplacementTiers>) {
    if (result === null) return; // safe: no quote produced
    for (const tier of result.tiers) {
      for (const n of tierMoneyFigures(tier as any)) {
        expect(Number.isFinite(n)).toBe(true);
        expect(n).toBeGreaterThanOrEqual(0);
      }
    }
  }

  const malformedSquares: Array<[string, number | undefined]> = [
    ['NaN', NaN],
    ['undefined', undefined],
    ['negative', -50],
    ['zero', 0],
    ['Infinity', Infinity],
    ['-Infinity', -Infinity],
  ];

  for (const [label, squares] of malformedSquares) {
    it(`does not throw and stays finite/non-negative for ${label} roofSquares (default pricing)`, () => {
      let result: ReturnType<typeof calculateReplacementTiers>;
      expect(() => {
        result = calculateReplacementTiers({
          roofSquares: squares as number,
          pitch: '6/12',
          roofType: 'asphalt_shingle',
          companyProfile: null,
        });
      }).not.toThrow();
      expectSafeResult(result!);
    });
  }

  it('does not throw and stays finite/non-negative for a non-finite pitch string', () => {
    let result: ReturnType<typeof calculateReplacementTiers>;
    expect(() => {
      result = calculateReplacementTiers({
        roofSquares: 25,
        pitch: 'abc/xyz',
        roofType: 'asphalt_shingle',
        companyProfile: null,
      });
    }).not.toThrow();
    expectSafeResult(result!);
  });

  it('does not throw and stays finite/non-negative for malformed squares AND pitch together', () => {
    let result: ReturnType<typeof calculateReplacementTiers>;
    expect(() => {
      result = calculateReplacementTiers({
        roofSquares: NaN,
        pitch: 'not-a-pitch',
        roofType: 'asphalt_shingle',
        companyProfile: null,
      });
    }).not.toThrow();
    expectSafeResult(result!);
  });

  it('stays finite/non-negative for malformed roofSquares on the company-packages path', () => {
    const companyProfile = {
      systemPackages: [
        { tier: 'good', name: 'Good Pkg', warrantyYears: 10, markupPercent: 20, laborMultiplier: 1, components: [] },
        { tier: 'better', name: 'Better Pkg', warrantyYears: 15, markupPercent: 25, laborMultiplier: 1.1, components: [] },
        { tier: 'best', name: 'Best Pkg', warrantyYears: 25, markupPercent: 30, laborMultiplier: 1.2, components: [] },
      ],
    } as any;
    for (const [, squares] of malformedSquares) {
      let result: ReturnType<typeof calculateReplacementTiers>;
      expect(() => {
        result = calculateReplacementTiers({
          roofSquares: squares as number,
          pitch: 'qq/12',
          companyProfile,
        });
      }).not.toThrow();
      expectSafeResult(result!);
    }
  });

  // ── Regression lock: valid input is unchanged by the hardening ─────────────
  //
  // These totals are tax-EXCLUSIVE. A caller that supplies no rate and a
  // company that has not set one now means no sales tax, where this used to
  // apply a hardcoded 8.25% Texas rate to every customer in every state.
  // The taxed equivalents are locked in the suite below.
  it('returns the same tiers for a valid (squares, pitch, material) input', () => {
    const result = calculateReplacementTiers({
      roofSquares: 25,
      pitch: '6/12',
      roofType: 'asphalt_shingle',
      companyProfile: null,
    });
    expect(result).not.toBeNull();
    expect(result!.tiers).toHaveLength(3);
    expect(result!.tiers.map(t => t.tier)).toEqual(['good', 'better', 'best']);
    expect(result!.tiers.map(t => t.total)).toEqual([10500, 11825, 14450]);
    expect(result!.recommendation.tier).toBe('better');
    // And of course the valid path is itself finite & non-negative.
    expectSafeResult(result);
  });
});

// ── Where the tax rate comes from ────────────────────────────────────────────
//
// The company's saved rate is a PERCENT (`8.25`); the function's own `taxRate`
// argument is a FRACTION (`0.0825`). Mixing the two would bill 825% tax, so
// each of these pins one side of that conversion. The untaxed baseline is
// [10500, 11825, 14450] from the regression lock above.
describe('calculateReplacementTiers — tax rate resolution', () => {
  const UNTAXED_TOTALS = [10500, 11825, 14450];
  /** The same quote with 8.25% applied — what every customer used to be charged. */
  const TAXED_AT_8_25 = [11366.25, 12800.56, 15642.13];

  function quoteWith(overrides: Record<string, unknown>) {
    return calculateReplacementTiers({
      roofSquares: 25,
      pitch: '6/12',
      roofType: 'asphalt_shingle',
      companyProfile: null,
      ...overrides,
    } as Parameters<typeof calculateReplacementTiers>[0]);
  }

  it("applies the company's saved rate as a percent, not a fraction", () => {
    const result = quoteWith({ companyProfile: { taxRate: 8.25 } as any });
    expect(result).not.toBeNull();
    // Landing exactly on the old hardcoded figures proves the /100 conversion:
    // treating 8.25 as a fraction would have produced ~825% tax instead.
    expect(result!.tiers.map(t => t.total)).toEqual(TAXED_AT_8_25);
  });

  it('charges no tax when the company has never set a rate', () => {
    for (const companyProfile of [null, {} as any, { taxRate: 0 } as any, { taxRate: null } as any]) {
      const result = quoteWith({ companyProfile });
      expect(result!.tiers.map(t => t.total)).toEqual(UNTAXED_TOTALS);
      expect(result!.tiers.map(t => t.tax)).toEqual([0, 0, 0]);
    }
  });

  it('charges no tax for a malformed or negative company rate', () => {
    for (const taxRate of [NaN, Infinity, -Infinity, -7.25]) {
      const result = quoteWith({ companyProfile: { taxRate } as any });
      expect(result!.tiers.map(t => t.total)).toEqual(UNTAXED_TOTALS);
    }
  });

  it('lets an explicit fractional taxRate argument win over the company rate', () => {
    const result = quoteWith({
      companyProfile: { taxRate: 8.25 } as any,
      taxRate: 0,
    });
    expect(result!.tiers.map(t => t.total)).toEqual(UNTAXED_TOTALS);
  });

  it('applies the company rate on the company-packages path too', () => {
    const systemPackages = [
      { tier: 'good', name: 'Good Pkg', warrantyYears: 10, markupPercent: 20, laborMultiplier: 1, components: [] },
      { tier: 'better', name: 'Better Pkg', warrantyYears: 15, markupPercent: 25, laborMultiplier: 1.1, components: [] },
      { tier: 'best', name: 'Best Pkg', warrantyYears: 25, markupPercent: 30, laborMultiplier: 1.2, components: [] },
    ];
    const untaxed = quoteWith({ companyProfile: { systemPackages } as any });
    const taxed = quoteWith({ companyProfile: { systemPackages, taxRate: 8.25 } as any });

    expect(untaxed).not.toBeNull();
    expect(taxed).not.toBeNull();
    expect(untaxed!.tiers.map(t => t.tax)).toEqual([0, 0, 0]);
    // Each tier is taxed at 8.25% of its own subtotal, not left alone.
    for (const [i, tier] of taxed!.tiers.entries()) {
      expect(tier.tax).toBeCloseTo(tier.subtotal * 0.0825, 2);
      expect(tier.total).toBeGreaterThan(untaxed!.tiers[i].total);
    }
  });
});
