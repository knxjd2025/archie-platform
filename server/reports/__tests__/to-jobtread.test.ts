import { describe, it, expect } from 'vitest';
import { linesFromReport, costLines } from '../to-jobtread';

describe('report estimate → JobTread lines', () => {
  it('maps priced line items, keeping price and cost apart', () => {
    const lines = linesFromReport({
      repair_estimate: {
        lineItems: [
          { repairName: 'Shingle Replacement', quantity: 12, unit: 'square', finalCostPerUnit: 412.5, baseCostPerUnit: 250 },
          { repairName: 'Ridge Vent', quantity: 40, unit: 'linear foot', finalCostPerUnit: 16.5, baseCostPerUnit: 10 },
        ],
      },
    });
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ name: 'Shingle Replacement', quantity: 12, unitPrice: 412.5, unitCost: 250 });
    expect(lines[1].description).toBe('Per linear foot');
  });

  it('derives per-unit figures from totals when only totals are given', () => {
    const [line] = linesFromReport({
      repair_estimate: { lineItems: [{ repairName: 'Flashing', quantity: 4, totalFinalCost: 400, totalBaseCost: 240 }] },
    });
    expect(line.unitPrice).toBe(100);
    expect(line.unitCost).toBe(60);
  });

  it('falls back to a single line when the report only has a total', () => {
    const lines = linesFromReport({ total_estimate: 18500 });
    expect(lines).toEqual([{ name: 'Roofing work per inspection report', quantity: 1, unitPrice: 18500 }]);
  });

  it('returns nothing when there is no pricing to work from', () => {
    expect(linesFromReport({})).toEqual([]);
    expect(linesFromReport({ total_estimate: 0 })).toEqual([]);
    // Unpriced/zero lines must never become a $0 proposal line.
    expect(linesFromReport({ repair_estimate: { lineItems: [{ repairName: 'TBD', quantity: 1, finalCostPerUnit: 0 }] } })).toEqual([]);
  });

  it('builds vendor-order lines at our cost, skipping lines with no cost', () => {
    const orders = costLines([
      { name: 'Shingles', quantity: 12, unitPrice: 412.5, unitCost: 250 },
      { name: 'Labor only', quantity: 1, unitPrice: 900 },
    ]);
    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({ name: 'Shingles', unitPrice: 250 });
  });
});
