import { describe, it, expect } from 'vitest';
import { calculateCommission, OVERHEAD_RATES } from '../commission';

describe('calculateCommission', () => {
  it('applies the standard self-generated retail rate (10%)', () => {
    const r = calculateCommission({ leadSource: 'self', jobType: 'retail', revenue: 10000, material: 3000, labor: 2000 });
    expect(r.overheadPct).toBe(10);
    expect(r.overheadAmount).toBe(1000);
    expect(r.profit).toBe(4000); // 10000 - 1000 - 3000 - 2000
    expect(r.commission).toBe(2000); // 50% of profit
  });

  it('applies the standard rate for each lead-source/job-type combination', () => {
    expect(calculateCommission({ leadSource: 'self', jobType: 'insurance', revenue: 1000 }).overheadPct).toBe(OVERHEAD_RATES['self-insurance']);
    expect(calculateCommission({ leadSource: 'company', jobType: 'retail', revenue: 1000 }).overheadPct).toBe(OVERHEAD_RATES['company-retail']);
    expect(calculateCommission({ leadSource: 'company', jobType: 'insurance', revenue: 1000 }).overheadPct).toBe(OVERHEAD_RATES['company-insurance']);
  });

  it('never pays a negative commission on a loss-making job', () => {
    const r = calculateCommission({ leadSource: 'self', jobType: 'retail', revenue: 1000, material: 900, labor: 500 });
    expect(r.profit).toBeLessThan(0);
    expect(r.commission).toBe(0);
  });

  it('honors a manual overhead override over the standard rate table', () => {
    const r = calculateCommission({ leadSource: 'self', jobType: 'retail', revenue: 10000, manualOverheadPct: 25 });
    expect(r.overheadPct).toBe(25);
    expect(r.overheadAmount).toBe(2500);
  });

  it('treats missing cost fields as zero', () => {
    const r = calculateCommission({ leadSource: 'self', jobType: 'retail', revenue: 1000 });
    expect(r.profit).toBe(900); // 1000 - 10% overhead, no other costs
  });
});
