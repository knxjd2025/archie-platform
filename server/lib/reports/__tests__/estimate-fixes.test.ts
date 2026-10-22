import { describe, it, expect } from 'vitest';
import { setEstimateLines, estimateLinesForEditing, estimateLinesProblem, quantityProblem } from '../estimate-editing';
import { estimateTotal, toEstimateLine } from '../estimate-lines';
import { resolveScopeItems, scopeLinesOf, scopeTotalOf, isReplacementLine } from '../scope-items';
import { ROOFING_PRODUCTS } from '../roofing-products';
import { SCOPE_CATALOG } from '../../../../shared/scope-catalog';

const priced = SCOPE_CATALOG.find((i) => i.unitPrice != null && i.firstUnitPrice == null)!;

/** A replacement estimate with one scope line, as applyReplacementPricing stores it. */
function replacementReport() {
  const { lines: scope } = resolveScopeItems([{ catalogId: priced.id, quantity: 2 }], { canOverride: false });
  return {
    repairEstimate: {
      lineItems: [
        { repairTypeId: 'replacement_best', repairName: 'Full Roof Replacement — X', quantity: 30, unit: 'sq', baseCostPerUnit: 500, finalCostPerUnit: 500, totalBaseCost: 15000, totalFinalCost: 15000 },
        ...scope,
      ],
      subtotal: 15000 + scope[0].totalFinalCost, total: 15000 + scope[0].totalFinalCost, multiplierApplied: 1, notes: [],
    },
  };
}

describe('editing an estimate keeps replacement and scope lines what they were', () => {
  it('a round trip through the editor keeps ids and scope data', () => {
    const report = replacementReport();
    const before = scopeTotalOf(report);
    expect(before).toBeGreaterThan(0);
    const saved = setEstimateLines(report, estimateLinesForEditing(report));
    expect(saved.repairEstimate.lineItems.map((l: any) => l.repairTypeId)).toEqual(report.repairEstimate.lineItems.map((l) => l.repairTypeId));
    expect(isReplacementLine(saved.repairEstimate.lineItems[0])).toBe(true);
    expect(scopeLinesOf(saved)).toHaveLength(1);
    expect(scopeLinesOf(saved)[0].scope.catalogId).toBe(priced.id);
    expect(scopeTotalOf(saved)).toBe(before);
  });

  it('an edited price on a scope line stays a scope line', () => {
    const report = replacementReport();
    const lines = estimateLinesForEditing(report).map((l, i) => (i === 1 ? { ...l, unitPrice: 10 } : l));
    const saved = setEstimateLines(report, lines);
    expect(scopeTotalOf(saved)).toBe(20);
  });

  it('lines sent back without ids (the chat) recover them by name', () => {
    const report = replacementReport();
    const plain = estimateLinesForEditing(report).map(({ id, scope, ...rest }) => rest);
    const saved = setEstimateLines(report, plain);
    expect(saved.repairEstimate.lineItems[0].repairTypeId).toBe('replacement_best');
    expect(scopeLinesOf(saved)).toHaveLength(1);
  });

  it('a newly typed line is still custom_N', () => {
    const saved = setEstimateLines(replacementReport(), [{ name: 'Satellite dish reset', unitPrice: 150 }]);
    expect(saved.repairEstimate.lineItems[0].repairTypeId).toBe('custom_0');
  });

  it('a client cannot smuggle a custom_ id or junk through as a kept id', () => {
    const saved = setEstimateLines({} as { repairEstimate?: any }, [{ name: 'A', unitPrice: 1, id: 'custom_9' }, { name: 'B', unitPrice: 1, id: '<script>' }]);
    expect(saved.repairEstimate.lineItems.map((l: any) => l.repairTypeId)).toEqual(['custom_0', 'custom_1']);
  });
});

describe('estimateLinesForEditing', () => {
  it('keeps a real $0 cost instead of treating it as the price', () => {
    const report = { repairEstimate: { lineItems: [{ repairTypeId: 'custom_0', repairName: 'Included', quantity: 1, unit: 'ea', baseCostPerUnit: 0, finalCostPerUnit: 80, totalBaseCost: 0, totalFinalCost: 80 }] } };
    const [l] = estimateLinesForEditing(report);
    expect(l.unitCost).toBe(0);
    const saved = setEstimateLines(report, [l]);
    expect(saved.repairEstimate.lineItems[0].baseCostPerUnit).toBe(0);
    expect(saved.repairEstimate.lineItems[0].finalCostPerUnit).toBe(80);
  });

  it('shows a stored quantity of 0 as 0', () => {
    const report = { repairEstimate: { lineItems: [{ repairTypeId: 'custom_0', repairName: 'X', quantity: 0, unit: 'ea', baseCostPerUnit: 5, finalCostPerUnit: 5, totalBaseCost: 0, totalFinalCost: 0 }] } };
    expect(estimateLinesForEditing(report)[0].quantity).toBe(0);
  });
});

describe('quantity validation', () => {
  it('only a missing quantity defaults', () => {
    expect(quantityProblem(undefined)).toBeNull();
    expect(quantityProblem(null)).toBeNull();
    expect(quantityProblem(2.5)).toBeNull();
    expect(quantityProblem(0)).toMatch(/above 0/);
    expect(quantityProblem(-1)).toMatch(/above 0/);
    expect(quantityProblem('abc')).toMatch(/not a number/);
    expect(quantityProblem('')).toMatch(/needs a quantity/);
  });

  it('estimateLinesProblem names the line, and ignores the empty Add-line row', () => {
    expect(estimateLinesProblem([{ name: 'Ridge vent', quantity: 2, unitPrice: 5 }])).toBeNull();
    expect(estimateLinesProblem([{ name: '', quantity: 0, unitPrice: 0 }])).toBeNull();
    expect(estimateLinesProblem([{ name: 'A', unitPrice: 1 }, { name: 'Ridge vent', quantity: 0, unitPrice: 5 }])).toBe('Line 2 ("Ridge vent") needs a quantity above 0.');
    expect(estimateLinesProblem(undefined)).toBeNull();
  });

  it('scope items refuse a bad quantity with a reason instead of pricing one', () => {
    for (const quantity of [0, -2, 'abc' as any]) {
      const r = resolveScopeItems([{ catalogId: priced.id, quantity }], { canOverride: false });
      expect(r.lines).toHaveLength(0);
      expect(r.errors[0]).toBe(`"${priced.name}" needs a quantity above 0.`);
    }
    expect(resolveScopeItems([{ catalogId: priced.id }], { canOverride: false }).lines[0].quantity).toBe(1);
  });

  it('a rendered line shows a stored 0 as 0 and a missing quantity as 1', () => {
    expect(toEstimateLine({ repairName: 'X', quantity: 0, totalFinalCost: 0 }).quantity).toBe(0);
    expect(toEstimateLine({ repairName: 'X', totalFinalCost: 10 }).quantity).toBe(1);
  });
});

describe('estimateTotal', () => {
  it('sums the lines over a stale stored total', () => {
    expect(estimateTotal({ total: 999, lineItems: [{ totalFinalCost: 100.1 }, { totalFinalCost: 200.2 }] })).toBe(300.3);
  });
  it('uses the stored total only with no lines, or lines that carry no totals', () => {
    expect(estimateTotal({ total: 450, lineItems: [] })).toBe(450);
    expect(estimateTotal({ total: 450, lineItems: [{ repairName: 'old shape' }] })).toBe(450);
    expect(estimateTotal({ total: 0, lineItems: [] })).toBe(0);
  });
});

describe('ROOFING_PRODUCTS', () => {
  it('is in ascending price order, as its pickers list it', () => {
    const rates = ROOFING_PRODUCTS.map((p) => p.ratePerSquare);
    expect(rates).toEqual([...rates].sort((a, b) => a - b));
  });
});
