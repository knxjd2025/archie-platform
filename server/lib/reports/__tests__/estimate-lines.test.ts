import { describe, it, expect } from 'vitest';
import { toEstimateLine, toEstimateLines, estimateTotal } from '../estimate-lines';
import { generateEstimateFromDamageAnalysis } from '../roof-repair-pricing';

describe('toEstimateLine', () => {
  it('reads the real RepairEstimate field names', () => {
    // The exact shape the pricing table emits. Renderers previously read
    // label/unitPrice/total and printed blank names and $0 in every row.
    const line = toEstimateLine({
      repairTypeId: 'missing_shingles', repairName: 'Replace missing shingles',
      quantity: 3, unit: 'each', baseCostPerUnit: 100, finalCostPerUnit: 165,
      totalBaseCost: 300, totalFinalCost: 495,
    });
    expect(line.label).toBe('Replace missing shingles');
    expect(line.unitPrice).toBe(165);
    expect(line.total).toBe(495);
    expect(line.quantityLabel).toContain('3');
  });

  it('still reads older stored shapes', () => {
    const line = toEstimateLine({ label: 'Old item', quantity: 2, unitPrice: 50, total: 100 });
    expect(line.label).toBe('Old item');
    expect(line.total).toBe(100);
  });

  it('never renders an unnamed or NaN line', () => {
    const line = toEstimateLine({});
    expect(line.label).toBe('Repair item');
    expect(line.unitPrice).toBe(0);
    expect(line.quantity).toBe(1);
  });
});

describe('real pipeline output', () => {
  // Guards the actual path: damage types -> pricing -> report -> renderer input.
  const summary = generateEstimateFromDamageAnalysis([
    { type: 'missing_shingles', count: 1 },
    { type: 'gutter_damage', count: 1 },
  ]);

  it('produces named, priced lines end to end', () => {
    const lines = toEstimateLines(summary.lineItems);
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) {
      expect(l.label).not.toBe('Repair item');
      expect(l.total, `${l.label} priced at 0`).toBeGreaterThan(0);
      expect(l.unitPrice).toBeGreaterThan(0);
    }
  });

  it('the grand total equals the sum of the rendered rows', () => {
    // The live bug was exactly this mismatch: a correct $6,197 heading sitting
    // above rows that every rendered as $0.
    const lines = toEstimateLines(summary.lineItems);
    const summed = lines.reduce((s, l) => s + l.total, 0);
    expect(summed).toBeCloseTo(summary.subtotalFinal, 0);
    expect(estimateTotal(summary)).toBeCloseTo(summed, 0);
  });
});

describe('estimateTotal', () => {
  it('falls back to summing lines rather than showing $0 over priced work', () => {
    const est = { lineItems: [{ repairName: 'A', totalFinalCost: 100 }, { repairName: 'B', totalFinalCost: 250 }] };
    expect(estimateTotal(est)).toBe(350);
  });

  it('is zero for an empty estimate', () => {
    expect(estimateTotal({ lineItems: [] })).toBe(0);
    expect(estimateTotal(null)).toBe(0);
  });
});

// A report that calls a roof "minor / low severity" must not also bill an
// emergency tarp. The damage->repair mappings carry a fixed severity
// (active_leak is always "critical"), so the severity actually observed in the
// photo has to override it.
describe('severity gates emergency work', () => {
  it('drops emergency line items for a minor finding', () => {
    const minor = generateEstimateFromDamageAnalysis([{ type: 'active_leak', severity: 'low', count: 1 }]);
    const names = toEstimateLines(minor.lineItems).map((l) => l.label.toLowerCase());
    expect(names.some((n) => n.includes('emergency'))).toBe(false);
  });

  it('keeps them when the damage really is severe', () => {
    const severe = generateEstimateFromDamageAnalysis([{ type: 'active_leak', severity: 'critical', count: 1 }]);
    const names = toEstimateLines(severe.lineItems).map((l) => l.label.toLowerCase());
    expect(names.some((n) => n.includes('emergency'))).toBe(true);
  });

  it('defaults to including them when severity is unknown', () => {
    // Silently under-scoping a real leak is the worse failure of the two.
    const unknown = generateEstimateFromDamageAnalysis([{ type: 'active_leak', count: 1 }]);
    expect(toEstimateLines(unknown.lineItems).length).toBeGreaterThan(0);
  });
});
