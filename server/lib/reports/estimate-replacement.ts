/**
 * Estimate's "replacement" mode: a Good/Better/Best comparison priced against
 * a confirmed roof size, instead of the itemized repair-damage pricing
 * (render-estimate-html.ts's default mode). A rep picks this per job — see
 * shared/inspection-form.ts's "Recommendation" field, which can default it.
 *
 * The three-way comparison is for the customer to see; only ONE tier is ever
 * pushed to JobTread as a priced line item (the one the customer is actually
 * being quoted). Building that as a single repairEstimate.lineItems entry
 * means the existing scope-of-work rendering and to-jobtread.ts pipeline both
 * keep working unchanged — no parallel pricing path.
 */
import { computeTierPricing, replacementLineName, type TierSelection } from './roofing-products.js';
import type { IsoTier } from './commercial-products.js';
import type { ComprehensiveRoofReport } from './comprehensive-roof-report.js';
import type { RepairEstimate } from './roof-repair-pricing.js';

export interface ReplacementInput {
  tierSelection: TierSelection;
  squares: number;
  selectedTier: 'good' | 'better' | 'best';
  /** ISO R-value for any tear-off commercial tier (roofing-products.ts computeTierPricing). */
  isoTier?: IsoTier | null;
  /**
   * Priced specialty scope (skylights, cricket, decking, membrane section…)
   * that rides with the replacement — see scope-items.ts. Appended after the
   * replacement line, so the quote is tier × squares PLUS this, not one or
   * the other.
   */
  scopeLines?: RepairEstimate[];
}

export class ReplacementInputError extends Error {}

/**
 * Returns a NEW report object (the input is never mutated) with a full
 * Good/Better/Best comparison plus a single synthesized line item for the
 * selected tier. Throws ReplacementInputError on bad input — the caller
 * should surface that directly, since it means the customization step was
 * skipped or incomplete.
 */
export function applyReplacementPricing(report: ComprehensiveRoofReport, input: ReplacementInput): ComprehensiveRoofReport {
  if (!(input.squares > 0)) {
    throw new ReplacementInputError('Confirm the roof size (in squares) before generating a replacement estimate.');
  }
  const pricing = computeTierPricing(input.tierSelection, input.squares, { isoTier: input.isoTier });
  if (!pricing) {
    throw new ReplacementInputError('Pick a real product for each of Good, Better and Best before generating a replacement estimate.');
  }
  const selected = pricing[input.selectedTier];
  const scope = input.scopeLines ?? [];
  const scopeTotal = Math.round(scope.reduce((s, l) => s + (Number(l.totalFinalCost) || 0), 0) * 100) / 100;
  const total = Math.round((selected.total + scopeTotal) * 100) / 100;

  return {
    ...report,
    roofDetails: { ...report.roofDetails, squares: input.squares },
    replacementOptions: [pricing.good, pricing.better, pricing.best],
    selectedTier: input.selectedTier,
    repairEstimate: {
      ...report.repairEstimate,
      lineItems: [{
        repairTypeId: `replacement_${input.selectedTier}`,
        repairName: replacementLineName(selected),
        quantity: input.squares,
        unit: 'sq',
        // Replacement is priced flat off the product's retail rate — no
        // separate "our cost" multiplier the way itemized repairs have one.
        baseCostPerUnit: selected.ratePerSquare,
        finalCostPerUnit: selected.ratePerSquare,
        totalBaseCost: selected.total,
        totalFinalCost: selected.total,
      }, ...scope],
      subtotal: total,
      multiplierApplied: 1,
      total,
      notes: report.repairEstimate?.notes ?? [],
    },
  };
}
