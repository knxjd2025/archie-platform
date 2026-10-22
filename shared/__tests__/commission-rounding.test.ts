import { describe, it, expect } from 'vitest';
import { calculateCommission } from '../commission';
import { splitAmounts, splitCommission, computeCommissionSplit, payoutTotal, payoutsByRep } from '../job-commission';

const isCents = (v: number) => Math.round(v * 100) / 100 === v;

describe('calculateCommission rounds to cents once', () => {
  it('returns whole-cent figures', () => {
    const r = calculateCommission({ leadSource: 'company', jobType: 'insurance', revenue: 12345.67, material: 1000.01, labor: 333.33 });
    for (const v of [r.overheadAmount, r.profit, r.commission]) expect(isCents(v)).toBe(true);
    // 12345.67 * 17% = 2098.7639; profit 8913.5661; commission 4456.78305.
    expect(r.overheadAmount).toBe(2098.76);
    expect(r.profit).toBe(8913.57);
    expect(r.commission).toBe(4456.78);
  });

  it('rounds a half cent up', () => {
    // Profit 2.01 at no overhead → commission exactly 1.005, which Math.round(x*100)/100 made 1.00.
    const h = calculateCommission({ leadSource: 'self', jobType: 'retail', revenue: 2.01, manualOverheadPct: 0 });
    expect(h.commission).toBe(1.01);
  });
});

describe('splitAmounts — the reps add up to the pool', () => {
  it('a $100.01 pool split three ways sums to $100.01', () => {
    const splits = [{ sharePct: 33.34 }, { sharePct: 33.33 }, { sharePct: 33.33 }];
    // Rounding each rep on their own loses the cent.
    expect(Math.round(splits.reduce((t, s) => t + splitCommission(100.01, s), 0) * 100)).toBe(10000);
    const amounts = splitAmounts(100.01, splits);
    expect(amounts).toEqual([33.35, 33.33, 33.33]);
    expect(Math.round(amounts.reduce((t, a) => t + a, 0) * 100)).toBe(10001);
  });

  it('gives a tie to the earlier rep and keeps every amount in whole cents', () => {
    expect(splitAmounts(0.03, [{ sharePct: 50 }, { sharePct: 50 }])).toEqual([0.02, 0.01]);
    const many = splitAmounts(1000, [{ sharePct: 33.333 }, { sharePct: 33.333 }, { sharePct: 33.334 }]);
    expect(Math.round(many.reduce((t, a) => t + a, 0) * 100)).toBe(100000);
    for (const a of many) expect(isCents(a)).toBe(true);
  });

  it('leaves a rep on a figure of their own alone', () => {
    expect(splitAmounts(500, [{ sharePct: 0, manualAmount: 120.555 }, { sharePct: 100 }])).toEqual([120.56, 500]);
  });

  it('computeCommissionSplit uses the allocated amount when given', () => {
    const r = computeCommissionSplit(100.01, { sharePct: 33.34 }, [{ amount: 10, kind: 'draw' }], 33.35);
    expect(r.commission).toBe(33.35);
    expect(r.balanceDue).toBe(23.35);
    // Without it, the per-rep figure as before.
    expect(computeCommissionSplit(100.01, { sharePct: 33.34 }, []).commission).toBe(33.34);
  });
});

describe('payout totals are whole cents', () => {
  const rows = [
    { repName: 'A', teamMemberId: 1, status: 'approved' as const, commissionAmount: '0.10' },
    { repName: 'A', teamMemberId: 1, status: 'approved' as const, commissionAmount: '0.20' },
  ];
  it('payoutTotal', () => {
    expect(payoutTotal(rows)).toBe(0.3);
  });
  it('payoutsByRep group totals', () => {
    expect(payoutsByRep(rows)[0].total).toBe(0.3);
  });
});
