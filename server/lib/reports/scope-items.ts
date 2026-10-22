/**
 * Turn the rep's chosen scope items into priced estimate lines, and pick
 * them back out of a report for rendering.
 *
 * Pricing rule (decided with James, 2026-09-14): a rep gets the catalog
 * price; a Sales Leader or above may override a price or add an item the
 * catalog does not have. Enforced here, with the caller's role, never by
 * what the client chose to send.
 *
 * Scope lines live in `repairEstimate.lineItems` alongside the replacement
 * line, distinguished by their `scope_` repairTypeId prefix. That is
 * deliberate: the estimate editor, the JobTread push and the totals all read
 * lineItems already, so scope needs no parallel pipeline and cannot drift
 * from what the customer signs.
 */
import { SCOPE_CATALOG, MAX_SCOPE_ITEMS, scopeCatalogItem, type ScopeItemInput } from '../../../shared/scope-catalog.js';
import type { RepairEstimate } from './roof-repair-pricing.js';

/** A scope line as stored: a RepairEstimate plus what the customer document prints. */
export interface ScopeLine extends RepairEstimate {
  scope: {
    catalogId: string | null;
    description: string;
    requirement?: 'code' | 'manufacturer' | 'recommended';
  };
}

const money = (n: number) => Math.round(n * 100) / 100;
const isFinitePositive = (v: unknown) => Number.isFinite(Number(v)) && Number(v) > 0;

export function resolveScopeItems(
  inputs: ScopeItemInput[] | undefined,
  opts: { canOverride: boolean },
): { lines: ScopeLine[]; errors: string[] } {
  const lines: ScopeLine[] = [];
  const errors: string[] = [];
  if (!Array.isArray(inputs)) return { lines, errors };

  inputs.slice(0, MAX_SCOPE_ITEMS).forEach((raw, i) => {
    // Missing means one. A 0, a negative or a non-number used to become 1
    // too, so a scope item the rep zeroed out still went on the quote at one
    // unit; now it is refused with the reason, like every other bad item here.
    const qtyRaw = raw?.quantity == null ? 1 : Number(raw.quantity);
    const q: unknown = raw?.quantity;
    const blank = typeof q === 'string' && !q.trim();
    if (blank || !Number.isFinite(qtyRaw) || qtyRaw <= 0) {
      const what = raw?.catalogId ? scopeCatalogItem(String(raw.catalogId))?.name ?? String(raw.catalogId) : String(raw?.name ?? '').trim() || `Scope item ${i + 1}`;
      errors.push(`"${what}" needs a quantity above 0.`);
      return;
    }
    const quantity = qtyRaw;
    const override = raw?.unitPrice != null && isFinitePositive(raw.unitPrice) ? money(Number(raw.unitPrice)) : null;
    const unitCost = raw?.unitCost != null && Number.isFinite(Number(raw.unitCost)) && Number(raw.unitCost) >= 0 ? money(Number(raw.unitCost)) : null;

    if (raw?.catalogId) {
      const item = scopeCatalogItem(String(raw.catalogId));
      if (!item) { errors.push(`Unknown scope item "${raw.catalogId}".`); return; }
      // A rep's price is ignored, not rejected: the picker never shows them one.
      const unitPrice = opts.canOverride && override != null ? override : item.unitPrice;
      if (unitPrice == null) {
        errors.push(`"${item.name}" has no set price yet — a Sales Leader has to price it before it can go on a quote.`);
        return;
      }
      // A first unit priced above the rest (a Perma-Boot: $450, then $200 each)
      // prints as two lines so the quote shows exactly how the total is made.
      // A manager's own price replaces both with one flat line.
      if (item.firstUnitPrice != null && !(opts.canOverride && override != null)) {
        const scope = { catalogId: item.id, description: item.description, requirement: item.requirement };
        const unit = item.unit as RepairEstimate['unit'];
        const more = quantity > 1 ? quantity - 1 : 0;
        lines.push({
          repairTypeId: `scope_${item.id}`,
          repairName: more > 0 ? `${item.name} (first)` : item.name,
          quantity: 1, unit,
          baseCostPerUnit: unitCost ?? item.firstUnitPrice,
          finalCostPerUnit: item.firstUnitPrice,
          totalBaseCost: money(unitCost ?? item.firstUnitPrice),
          totalFinalCost: money(item.firstUnitPrice),
          scope,
        });
        if (more > 0) {
          lines.push({
            repairTypeId: `scope_${item.id}_additional`,
            repairName: `${item.name} (additional)`,
            quantity: more, unit,
            baseCostPerUnit: unitCost ?? unitPrice,
            finalCostPerUnit: unitPrice,
            totalBaseCost: money((unitCost ?? unitPrice) * more),
            totalFinalCost: money(unitPrice * more),
            scope,
          });
        }
        return;
      }
      lines.push({
        repairTypeId: `scope_${item.id}`,
        repairName: item.name,
        quantity,
        unit: item.unit as RepairEstimate['unit'],
        baseCostPerUnit: unitCost ?? unitPrice,
        finalCostPerUnit: unitPrice,
        totalBaseCost: money((unitCost ?? unitPrice) * quantity),
        totalFinalCost: money(unitPrice * quantity),
        scope: { catalogId: item.id, description: item.description, requirement: item.requirement },
      });
      return;
    }

    // Custom item: manager only, and it needs a name and a price.
    if (!opts.canOverride) { errors.push('Only a Sales Leader can add an item that is not in the scope catalog.'); return; }
    const name = String(raw?.name ?? '').trim().slice(0, 250);
    if (!name) { errors.push(`Scope item ${i + 1} needs a name.`); return; }
    if (override == null) { errors.push(`"${name}" needs a price.`); return; }
    lines.push({
      repairTypeId: `scope_custom_${i}`,
      repairName: name,
      quantity,
      unit: (String(raw?.unit || 'ea').trim().slice(0, 24) || 'ea') as RepairEstimate['unit'],
      baseCostPerUnit: unitCost ?? override,
      finalCostPerUnit: override,
      totalBaseCost: money((unitCost ?? override) * quantity),
      totalFinalCost: money(override * quantity),
      scope: { catalogId: null, description: String(raw?.note ?? '').trim().slice(0, 500) },
    });
  });

  return { lines, errors };
}

export const isReplacementLine = (l: any): boolean => String(l?.repairTypeId ?? '').startsWith('replacement_');
export const isScopeLine = (l: any): l is ScopeLine => String(l?.repairTypeId ?? '').startsWith('scope_');

/** The scope lines on a report — read from lineItems so an edited estimate stays the source of truth. */
export function scopeLinesOf(report: any): ScopeLine[] {
  const items: any[] = report?.repairEstimate?.lineItems ?? [];
  return items.filter(isScopeLine);
}

export function scopeTotalOf(report: any): number {
  return money(scopeLinesOf(report).reduce((s, l) => s + (Number(l.totalFinalCost) || 0), 0));
}

export { SCOPE_CATALOG };
