/**
 * Two things a rep needs an estimate to do that it could not:
 *
 *   1. TYPE IN A LINE. The estimate was whatever the vision pass priced and
 *      nothing else — no way to add the thing you saw on the roof and the
 *      model didn't, and no way to correct a quantity. A rep who cannot edit
 *      the number they have to defend will not use the document.
 *
 *   2. SHOW REPAIR AND REPLACEMENT TOGETHER. applyReplacementPricing REPLACES
 *      the repair lines with a single replacement line, so the two were
 *      mutually exclusive and the customer never saw the choice side by side.
 *      Presenting both is how a homeowner decides, and how a repair that is
 *      false economy becomes obvious.
 *
 * Both are pure transforms over the report so the renderers, the JobTread
 * push and the pricing totals all stay in step automatically.
 */
import type { RepairEstimate } from './roof-repair-pricing';

/** A line typed by a rep, before it becomes a priced estimate line. */
export interface CustomLineInput {
  name: string;
  quantity?: number;
  unit?: string;
  /** Customer price per unit. */
  unitPrice: number;
  /** Our cost per unit, when the rep knows it. Optional. */
  unitCost?: number;
  notes?: string;
  /**
   * The line's repairTypeId when it came from the report rather than the
   * rep's keyboard — `replacement_best`, `scope_drip_edge`. Carried through an
   * edit so the line stays what it was; absent on a newly typed line.
   */
  id?: string;
  /** What a scope line prints on the customer document (scope-items.ts ScopeLine). */
  scope?: { catalogId: string | null; description: string; requirement?: 'code' | 'manufacturer' | 'recommended' };
}

/** A repairTypeId worth keeping: a priced line's own id, never a typed line's custom_ slot. */
const KEEPABLE_ID = /^[a-z0-9][a-z0-9_]{0,79}$/i;
const REQUIREMENTS = new Set(['code', 'manufacturer', 'recommended']);

function keptId(id: unknown): string | null {
  return typeof id === 'string' && KEEPABLE_ID.test(id) && !id.startsWith('custom_') ? id : null;
}

function keptScope(scope: unknown): CustomLineInput['scope'] | null {
  if (!scope || typeof scope !== 'object') return null;
  const s = scope as Record<string, unknown>;
  const requirement = typeof s.requirement === 'string' && REQUIREMENTS.has(s.requirement) ? s.requirement as 'code' | 'manufacturer' | 'recommended' : undefined;
  return {
    catalogId: typeof s.catalogId === 'string' ? s.catalogId.slice(0, 80) : null,
    description: String(s.description ?? '').slice(0, 500),
    ...(requirement ? { requirement } : {}),
  };
}

/**
 * Why a typed quantity can't be priced, or null when it can. Only a missing
 * quantity means one; 0, a negative or something that isn't a number is a
 * mistake to show the rep, not a 1 to put on a document the customer signs.
 */
export function quantityProblem(quantity: unknown): string | null {
  if (quantity == null) return null;
  const q = Number(quantity);
  if (typeof quantity === 'string' && !quantity.trim()) return 'needs a quantity';
  if (!Number.isFinite(q)) return 'has a quantity that is not a number';
  if (q <= 0) return 'needs a quantity above 0';
  return null;
}

/**
 * The first line a save would have to drop, said so the rep can fix it, or
 * null when every named line prices. A line with no name is the editor's
 * empty "Add line" row and is dropped without complaint, as it always was.
 */
export function estimateLinesProblem(lines: unknown): string | null {
  if (!Array.isArray(lines)) return null;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i] as CustomLineInput | null;
    const name = String(l?.name ?? '').trim();
    if (!name) continue;
    const why = quantityProblem(l?.quantity);
    if (why) return `Line ${i + 1} ("${name.slice(0, 60)}") ${why}.`;
  }
  return null;
}

export const MAX_CUSTOM_LINES = 40;

const money = (n: number) => Math.round(n * 100) / 100;

/**
 * Validate and normalise a typed line.
 * Returns null for anything that would poison a total — a blank name, a
 * non-numeric price, a negative quantity. A silently-dropped bad line is
 * better than a NaN subtotal on a document a customer signs.
 */
export function toCustomLine(input: CustomLineInput, index = 0): RepairEstimate | null {
  const name = String(input?.name ?? '').trim();
  if (!name) return null;

  const unitPrice = Number(input.unitPrice);
  if (!Number.isFinite(unitPrice) || unitPrice < 0) return null;

  // A quantity of 0 or "abc" used to become 1 here, so a line the rep zeroed
  // out was billed as one unit. Missing means one; anything else invalid
  // drops the line, and estimateLinesProblem tells the rep before a save.
  if (quantityProblem(input.quantity)) return null;
  const quantity = input.quantity == null ? 1 : Number(input.quantity);

  const costRaw = input.unitCost == null ? null : Number(input.unitCost);
  const unitCost = costRaw != null && Number.isFinite(costRaw) && costRaw >= 0 ? costRaw : unitPrice;

  // A line that came off the report keeps its id and scope. Renaming every
  // line custom_N on save made the replacement line and every scope_ line
  // look hand-typed, so the Scope of Work section and its total vanished from
  // the document after the first edit.
  const id = keptId(input.id);
  const scope = id?.startsWith('scope_') ? keptScope(input.scope) : null;

  return {
    // Prefixed so a hand-typed line is always distinguishable from a priced
    // finding — in the document, in JobTread, and in any later audit.
    repairTypeId: id ?? `custom_${index}`,
    repairName: name.slice(0, 250),
    quantity,
    unit: String(input.unit || 'ea').trim().slice(0, 24) || 'ea',
    baseCostPerUnit: money(unitCost),
    finalCostPerUnit: money(unitPrice),
    totalBaseCost: money(unitCost * quantity),
    totalFinalCost: money(unitPrice * quantity),
    ...(input.notes ? { notes: String(input.notes).slice(0, 500) } : {}),
    ...(scope ? { scope } : {}),
  } as RepairEstimate;
}

export function toCustomLines(inputs: CustomLineInput[] | undefined): RepairEstimate[] {
  if (!Array.isArray(inputs)) return [];
  return inputs
    .slice(0, MAX_CUSTOM_LINES)
    .map((l, i) => toCustomLine(l, i))
    .filter((l): l is RepairEstimate => !!l);
}

/** Sum a set of lines the way the renderers and JobTread push both read them. */
export function sumLines(lines: RepairEstimate[]): number {
  return money(lines.reduce((s, l) => s + (Number(l.totalFinalCost) || 0), 0));
}

/**
 * Add typed lines to a report's repair estimate and re-total it.
 *
 * The multiplier is deliberately NOT re-applied: a rep types the price they
 * intend to charge, so marking it up again would silently inflate the number
 * they just wrote down.
 */
export function withCustomLines<T extends { repairEstimate?: any }>(
  report: T,
  inputs: CustomLineInput[] | undefined,
): T {
  const custom = toCustomLines(inputs);
  if (!custom.length) return report;

  const existing: RepairEstimate[] = report.repairEstimate?.lineItems ?? [];
  const lineItems = [...existing, ...custom];
  const subtotal = sumLines(lineItems);

  return {
    ...report,
    repairEstimate: {
      ...(report.repairEstimate ?? { notes: [], multiplierApplied: 1 }),
      lineItems,
      subtotal,
      // Total tracks the lines; a stale total on a signed document is the
      // worst possible outcome here.
      total: subtotal,
    },
  };
}

// ---------------------------------------------------------------------------
// Repair AND replacement on one document
// ---------------------------------------------------------------------------

export interface EstimateOption {
  key: 'repair' | 'replacement';
  label: string;
  total: number;
  lineItems: RepairEstimate[];
  /** Why a customer would pick this one. */
  summary: string;
}

export interface OptionsInput {
  /** The itemised repair scope, as priced from the findings. */
  repairLines: RepairEstimate[];
  /** The replacement line, as produced by applyReplacementPricing. */
  replacementLines: RepairEstimate[];
  /** Roof age in years, when known — drives the honest recommendation. */
  roofAgeYears?: number | null;
}

/**
 * The recommendation shown beside the two prices.
 *
 * Deliberately not "always replace": on a young roof with contained damage a
 * repair is the right answer, and a document that always says replace is one
 * a homeowner stops trusting. Replacement is recommended when the repair is
 * a large fraction of it, or the roof is near end of life anyway.
 */
export function recommendOption(
  repairTotal: number,
  replacementTotal: number,
  roofAgeYears?: number | null,
): { recommend: 'repair' | 'replacement'; because: string } {
  if (replacementTotal <= 0) {
    return { recommend: 'repair', because: 'No replacement price was configured for this roof.' };
  }
  const ratio = repairTotal / replacementTotal;
  if (ratio >= 0.5) {
    return {
      recommend: 'replacement',
      because: `The repair is ${Math.round(ratio * 100)}% of the cost of a new roof, on a roof that keeps ageing. Replacing is the better value.`,
    };
  }
  if ((roofAgeYears ?? 0) >= 18) {
    return {
      recommend: 'replacement',
      because: `The roof is around ${roofAgeYears} years old, so a repair buys time on a system already near the end of its life.`,
    };
  }
  return {
    recommend: 'repair',
    because: 'The damage is contained and the roof has service life left — repairing is the sensible spend.',
  };
}

/**
 * Build both options for one document. The repair scope stays intact instead
 * of being overwritten, which is the whole point.
 */
export function buildEstimateOptions(input: OptionsInput): {
  options: EstimateOption[];
  recommend: 'repair' | 'replacement';
  because: string;
} {
  const repairTotal = sumLines(input.repairLines);
  const replacementTotal = sumLines(input.replacementLines);
  const { recommend, because } = recommendOption(repairTotal, replacementTotal, input.roofAgeYears);

  const options: EstimateOption[] = [];
  if (input.repairLines.length) {
    options.push({
      key: 'repair',
      label: 'Repair the damage',
      total: repairTotal,
      lineItems: input.repairLines,
      summary: 'Fix what is damaged now and keep the existing roof in service.',
    });
  }
  if (input.replacementLines.length) {
    options.push({
      key: 'replacement',
      label: 'Replace the roof',
      total: replacementTotal,
      lineItems: input.replacementLines,
      summary: 'A complete new roof system, with a fresh manufacturer warranty.',
    });
  }
  return { options, recommend, because };
}

// ---------------------------------------------------------------------------
// Editing an EXISTING report's estimate, without regenerating it
// ---------------------------------------------------------------------------

/**
 * Replace a report's estimate lines wholesale and re-total.
 *
 * Replace semantics rather than add/update/remove operations: the rep is
 * looking at a list, editing it, and saving it. Sending the resulting list is
 * exactly what both the form and the chat produce, and it cannot drift out of
 * sync with what is on screen the way id-matched patches can.
 *
 * Re-analysing photos is the slow, expensive part of a report. Pricing is not,
 * so a price change has no business triggering one.
 */
export function setEstimateLines<T extends { repairEstimate?: any }>(
  report: T,
  lines: CustomLineInput[],
): T {
  const priced = withKnownIds(report, lines.slice(0, MAX_CUSTOM_LINES * 4))
    .map((l, i) => toCustomLine(l, i))
    .filter((l): l is RepairEstimate => !!l);
  const subtotal = sumLines(priced);
  return {
    ...report,
    repairEstimate: {
      ...(report.repairEstimate ?? { notes: [], multiplierApplied: 1 }),
      lineItems: priced,
      subtotal,
      total: subtotal,
    },
  };
}

/**
 * Give a line sent back without its id the id of the stored line it came
 * from, matched by name. The chat edits return plain name/quantity/price
 * lines, so without this every line the model kept would still come back as
 * custom_N and take the scope section with it. Each stored line is claimed
 * once, in order, so two lines of the same name keep two ids.
 */
function withKnownIds(report: { repairEstimate?: any }, lines: CustomLineInput[]): CustomLineInput[] {
  const stored: any[] = Array.isArray(report?.repairEstimate?.lineItems) ? report.repairEstimate.lineItems : [];
  const byName = new Map<string, any[]>();
  for (const l of stored) {
    if (!keptId(l?.repairTypeId)) continue;
    const key = String(l?.repairName ?? '').trim().toLowerCase();
    byName.set(key, [...(byName.get(key) ?? []), l]);
  }
  // Stored lines already spoken for by a line that kept its own id.
  const claimed = new Set<any>();
  for (const l of lines) {
    const id = keptId(l?.id);
    const owner = id ? stored.find((x) => x?.repairTypeId === id && !claimed.has(x)) : undefined;
    if (owner) claimed.add(owner);
  }
  return lines.map((l) => {
    if (!l || keptId(l.id)) return l;
    const queue = byName.get(String(l.name ?? '').trim().toLowerCase()) ?? [];
    const match = queue.find((x) => !claimed.has(x));
    if (!match) return l;
    claimed.add(match);
    return { ...l, id: match.repairTypeId, ...(match.scope && !l.scope ? { scope: match.scope } : {}) };
  });
}

/** The estimate lines as the editor shows them — the form's initial state. */
export function estimateLinesForEditing(report: any): CustomLineInput[] {
  const lines: RepairEstimate[] = report?.repairEstimate?.lineItems ?? [];
  return lines.map((l) => {
    const anyLine = l as RepairEstimate & { scope?: unknown };
    const id = keptId(l.repairTypeId);
    const scope = id?.startsWith('scope_') ? keptScope(anyLine.scope) : null;
    const qty = l.quantity == null ? 1 : Number(l.quantity);
    const cost = l.baseCostPerUnit == null ? NaN : Number(l.baseCostPerUnit);
    return {
      name: l.repairName,
      // A stored 0 shows as 0, so the rep sees the line that needs fixing
      // instead of a 1 that was never on the document.
      quantity: Number.isFinite(qty) ? qty : 1,
      unit: l.unit || 'ea',
      unitPrice: Number(l.finalCostPerUnit) || 0,
      // A real $0 cost stays $0. `|| undefined` dropped it, and toCustomLine
      // then took the cost to be the price, so a zero-cost line showed a cost
      // equal to what the customer pays.
      unitCost: Number.isFinite(cost) && cost >= 0 ? cost : undefined,
      ...(id ? { id } : {}),
      ...(scope ? { scope } : {}),
    };
  });
}
