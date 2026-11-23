/**
 * Unit tests for roof repair pricing — hardening against malformed damage data.
 * Focus: generateEstimateFromDamageAnalysis must never throw or produce NaN
 * money figures, while leaving well-formed results unchanged.
 */
import { describe, it, expect } from 'vitest';
import {
  generateEstimateFromDamageAnalysis,
  type RepairEstimateSummary,
} from '../roof-repair-pricing';

/** Assert every money figure in a summary (line totals + subtotals) is finite. */
function expectAllMoneyFinite(summary: RepairEstimateSummary): void {
  expect(Number.isFinite(summary.subtotalBase)).toBe(true);
  expect(Number.isFinite(summary.subtotalFinal)).toBe(true);
  for (const item of summary.lineItems) {
    expect(Number.isFinite(item.quantity)).toBe(true);
    expect(Number.isFinite(item.baseCostPerUnit)).toBe(true);
    expect(Number.isFinite(item.finalCostPerUnit)).toBe(true);
    expect(Number.isFinite(item.totalBaseCost)).toBe(true);
    expect(Number.isFinite(item.totalFinalCost)).toBe(true);
  }
}

describe('generateEstimateFromDamageAnalysis — well-formed input (regression lock)', () => {
  it('produces a finite, non-empty estimate for clean damage data', () => {
    const summary = generateEstimateFromDamageAnalysis([
      { type: 'missing_shingles', severity: 'high', count: 2 },
      { type: 'flashing_damage', severity: 'high', count: 1 },
    ]);

    expect(summary.lineItems.length).toBeGreaterThan(0);
    expect(summary.subtotalFinal).toBeGreaterThan(0);
    expectAllMoneyFinite(summary);
  });

  it('matches exact known totals so hardening does not change clean results', () => {
    // missing_shingles → shingle_replacement_per_sq qty 1 * count 3 = 3 sq @ $350 base
    const summary = generateEstimateFromDamageAnalysis([
      { type: 'missing_shingles', severity: 'high', count: 3 },
    ]);

    expect(summary.lineItems).toHaveLength(1);
    const item = summary.lineItems[0];
    expect(item.repairTypeId).toBe('shingle_replacement_per_sq');
    expect(item.quantity).toBe(3);
    expect(item.totalBaseCost).toBe(1050); // 350 * 3
    expect(item.totalFinalCost).toBe(1732.5); // 350 * 1.65 * 3
    expect(summary.subtotalBase).toBe(1050);
    expect(summary.subtotalFinal).toBe(1732.5);
  });
});

describe('generateEstimateFromDamageAnalysis — malformed input (hardening)', () => {
  it('does not throw and yields finite money for NaN / undefined / missing fields', () => {
    const malformed = [
      { type: 'missing_shingles', severity: 'high', count: NaN },
      { type: 'flashing_damage', count: undefined },
      { type: 'hail_damage' },
      { severity: 'unknown', count: 4 },
      { type: undefined, count: 2 },
      { type: null, severity: null, count: -5 },
      { type: 12345, count: Infinity },
    ] as { type: string; severity?: string; count?: number }[];

    let summary!: RepairEstimateSummary;
    expect(() => {
      summary = generateEstimateFromDamageAnalysis(malformed);
    }).not.toThrow();

    expectAllMoneyFinite(summary);
    expect(summary.subtotalFinal).not.toBeNaN();
    expect(summary.subtotalBase).not.toBeNaN();
  });

  it('treats non-finite counts as a single unit (multiplier 1), not NaN', () => {
    const nanCount = generateEstimateFromDamageAnalysis([
      { type: 'missing_shingles', severity: 'high', count: NaN },
    ]);
    const negCount = generateEstimateFromDamageAnalysis([
      { type: 'missing_shingles', severity: 'high', count: -10 },
    ]);
    const noCount = generateEstimateFromDamageAnalysis([
      { type: 'missing_shingles', severity: 'high' },
    ]);

    // All collapse to multiplier 1 → 1 sq @ $350 base, $577.50 final
    for (const s of [nanCount, negCount, noCount]) {
      expect(s.lineItems).toHaveLength(1);
      expect(s.lineItems[0].quantity).toBe(1);
      expect(s.subtotalFinal).toBe(577.5);
      expectAllMoneyFinite(s);
    }
  });

  it('handles non-string / empty type entries as a finite empty estimate', () => {
    const summary = generateEstimateFromDamageAnalysis(
      // @ts-expect-error — entirely malformed, non-string types
      [{}, { type: null }, { type: undefined, count: NaN }, { type: 42 }],
    );
    expect(summary.lineItems).toHaveLength(0);
    expect(summary.subtotalBase).toBe(0);
    expect(summary.subtotalFinal).toBe(0);
    expectAllMoneyFinite(summary);
  });
});
