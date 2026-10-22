// Single source of truth for the commission formula — ported from
// BRN_Commission_Calculator.html. Used by the commission page (live preview),
// server/commission/routes.ts (the number that actually gets stored), and the
// calculate_commission agent tool, so all three can never disagree.

import { roundCents } from './num';

export type LeadSource = 'self' | 'company';
export type JobType = 'retail' | 'insurance';

export const OVERHEAD_RATES: Record<`${LeadSource}-${JobType}`, number> = {
  'self-retail': 10,
  'self-insurance': 12,
  'company-retail': 15,
  'company-insurance': 17,
};

export interface CommissionInput {
  leadSource: LeadSource;
  jobType: JobType;
  revenue: number;
  material?: number;
  labor?: number;
  other?: number;
  /** Manager-only special case — bypasses the standard rate table. */
  manualOverheadPct?: number | null;
}

export interface CommissionResult {
  overheadPct: number;
  overheadAmount: number;
  profit: number;
  /** 50% of profit, floored at 0 — a negative-profit job never owes a payout. */
  commission: number;
}

export function calculateCommission(input: CommissionInput): CommissionResult {
  const key = `${input.leadSource}-${input.jobType}` as keyof typeof OVERHEAD_RATES;
  const overheadPct = input.manualOverheadPct ?? OVERHEAD_RATES[key];
  const revenue = input.revenue || 0;
  const overheadAmount = revenue * (overheadPct / 100);
  const profit = revenue - overheadAmount - (input.material || 0) - (input.labor || 0) - (input.other || 0);
  const commission = Math.max(profit, 0) * 0.5;
  // Cents, once, here. The route stored String(raw), so a commission row could
  // hold 1234.5650000000001, and the page's toFixed(2) showed $1,234.56 for a
  // figure that rounds to $1,234.57. Every caller reads the same rounded number.
  return {
    overheadPct,
    overheadAmount: roundCents(overheadAmount),
    profit: roundCents(profit),
    commission: roundCents(commission),
  };
}
