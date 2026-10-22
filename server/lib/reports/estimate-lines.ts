/**
 * One normalized view of a priced repair line.
 *
 * The pricing table emits `RepairEstimate` (repairName / finalCostPerUnit /
 * totalFinalCost), but renderers were reading label / unitPrice / total. Every
 * field missed, so the customer-facing estimate table printed blank item names
 * and $0 in every row beneath a correct grand total. Every renderer goes through
 * here so that mismatch can only ever exist in one place.
 */
import { formatUnit, type RepairEstimate, type RepairUnit } from './roof-repair-pricing.js';

export interface EstimateLine {
  /** Findings that justify this line, for a homeowner reading the price. */
  because?: string[];
  label: string;
  quantity: number;
  /** e.g. "40 sq ft", "3 each" — quantity with its unit spelled out. */
  quantityLabel: string;
  unitPrice: number;
  total: number;
}

/** Accepts a RepairEstimate, tolerating older/looser shapes already in stored reports. */
export function toEstimateLine(li: any): EstimateLine {
  // Missing means one; a stored 0 prints as 0. `|| 1` printed "1 sq" over a
  // $0 line total, so the row contradicted itself.
  const qtyRaw = li?.quantity == null ? 1 : Number(li.quantity);
  const quantity = Number.isFinite(qtyRaw) ? qtyRaw : 0;
  const unit = (li?.unit ?? 'each') as RepairUnit;
  return {
    label: String(li?.repairName || li?.label || li?.name || li?.repairTypeId || 'Repair item'),
    quantity,
    quantityLabel: safeUnit(unit, quantity),
    unitPrice: Number(li?.finalCostPerUnit ?? li?.unitPrice ?? li?.basePrice ?? 0) || 0,
    total: Number(li?.totalFinalCost ?? li?.total ?? li?.finalPrice ?? 0) || 0,
    // The findings that put this line on the estimate, when known.
    ...(Array.isArray(li?.because) && li.because.length ? { because: li.because as string[] } : {}),
  };
}

// formatUnit returns only the unit word ("units", "sq"), not the amount.
function safeUnit(unit: RepairUnit, quantity: number): string {
  try { return `${quantity} ${formatUnit(unit, quantity)}`.trim(); } catch { return String(quantity); }
}

export function toEstimateLines(lineItems: unknown): EstimateLine[] {
  return Array.isArray(lineItems) ? lineItems.map(toEstimateLine) : [];
}

/**
 * The estimate total: the lines, summed, whenever there are lines. Every
 * writer of a stored total (the pricing summary, replacement pricing, the
 * editor) sets it to exactly that sum — there are no discounts or fees that
 * live outside the lines — so the stored figure only ever adds a way to be
 * stale. Preferring it let a hand-edited report print rows that summed to one
 * number under a total of another. The stored total is used only when there
 * are no lines, or when old loose-shaped lines carry no totals at all.
 */
export function estimateTotal(estimate: any): number {
  const stored = Number(estimate?.total ?? estimate?.subtotalFinal ?? 0) || 0;
  const lines = toEstimateLines(estimate?.lineItems);
  if (!lines.length) return stored;
  const summed = Math.round(lines.reduce((sum, l) => sum + l.total, 0) * 100) / 100;
  return summed === 0 && stored > 0 ? stored : summed;
}
