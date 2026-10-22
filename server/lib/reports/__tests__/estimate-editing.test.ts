import { describe, it, expect } from 'vitest';
import {
  toCustomLine, toCustomLines, sumLines, withCustomLines,
  recommendOption, buildEstimateOptions, MAX_CUSTOM_LINES,
  setEstimateLines, estimateLinesForEditing,
} from '../estimate-editing';
import { generateEstimateFromDamageAnalysis, type RepairEstimate } from '../roof-repair-pricing';

const line = (name: string, qty: number, price: number): RepairEstimate => ({
  repairTypeId: 'x', repairName: name, quantity: qty, unit: 'sq',
  baseCostPerUnit: price, finalCostPerUnit: price,
  totalBaseCost: price * qty, totalFinalCost: price * qty,
} as RepairEstimate);

describe('toCustomLine', () => {
  it('prices a typed line', () => {
    const l = toCustomLine({ name: 'Chimney flashing', quantity: 2, unit: 'ea', unitPrice: 450 })!;
    expect(l.repairName).toBe('Chimney flashing');
    expect(l.totalFinalCost).toBe(900);
    expect(l.unit).toBe('ea');
  });

  it('marks the line as hand-typed', () => {
    // Must stay distinguishable from a priced finding in the document, in
    // JobTread, and in any later audit of how a number was arrived at.
    expect(toCustomLine({ name: 'X', unitPrice: 1 }, 3)!.repairTypeId).toBe('custom_3');
  });

  it('defaults quantity to 1 and unit to ea', () => {
    const l = toCustomLine({ name: 'Service call', unitPrice: 125 })!;
    expect(l.quantity).toBe(1);
    expect(l.unit).toBe('ea');
    expect(l.totalFinalCost).toBe(125);
  });

  it('falls back to price when no cost is given', () => {
    // A rep types what they charge; inventing a margin would be a lie.
    const l = toCustomLine({ name: 'X', unitPrice: 300 })!;
    expect(l.baseCostPerUnit).toBe(300);
  });

  it('rejects anything that would poison the total', () => {
    // A NaN subtotal on a document a customer signs is the failure to avoid.
    for (const bad of [
      { name: '', unitPrice: 100 },
      { name: '   ', unitPrice: 100 },
      { name: 'X', unitPrice: NaN },
      { name: 'X', unitPrice: -5 },
      { name: 'X', unitPrice: 'abc' as any },
    ]) {
      expect(toCustomLine(bad as any), JSON.stringify(bad)).toBeNull();
    }
  });

  it('refuses a zero, negative or non-numeric quantity instead of pricing one unit', () => {
    // These used to become 1, so a line the rep zeroed out was billed anyway.
    expect(toCustomLine({ name: 'X', quantity: 0, unitPrice: 50 })).toBeNull();
    expect(toCustomLine({ name: 'X', quantity: -3, unitPrice: 50 })).toBeNull();
    expect(toCustomLine({ name: 'X', quantity: 'abc' as any, unitPrice: 50 })).toBeNull();
    expect(toCustomLine({ name: 'X', unitPrice: 50 })!.quantity).toBe(1);
  });

  it('allows a zero price for an included item', () => {
    // "No charge" is a real line a rep writes on purpose.
    expect(toCustomLine({ name: 'Haul-away (included)', unitPrice: 0 })!.totalFinalCost).toBe(0);
  });

  it('rounds to cents rather than carrying float noise', () => {
    expect(toCustomLine({ name: 'X', quantity: 3, unitPrice: 33.333 })!.totalFinalCost).toBe(100);
  });
});

describe('toCustomLines', () => {
  it('drops bad lines but keeps the good ones', () => {
    const out = toCustomLines([
      { name: 'Good', unitPrice: 10 },
      { name: '', unitPrice: 10 },
      { name: 'Also good', unitPrice: 20 },
    ]);
    expect(out.map((l) => l.repairName)).toEqual(['Good', 'Also good']);
  });

  it('caps how many lines can be added', () => {
    const many = Array.from({ length: MAX_CUSTOM_LINES + 15 }, (_, i) => ({ name: `L${i}`, unitPrice: 1 }));
    expect(toCustomLines(many)).toHaveLength(MAX_CUSTOM_LINES);
  });

  it('handles nothing at all', () => {
    expect(toCustomLines(undefined)).toEqual([]);
    expect(toCustomLines([])).toEqual([]);
    expect(toCustomLines('nope' as any)).toEqual([]);
  });
});

describe('withCustomLines', () => {
  const report = {
    repairEstimate: { lineItems: [line('Shingle repair', 2, 500)], subtotal: 1000, total: 1000, multiplierApplied: 1.2, notes: [] },
  };

  it('appends and re-totals', () => {
    const out = withCustomLines(report, [{ name: 'Chimney flashing', unitPrice: 450 }]);
    expect(out.repairEstimate.lineItems).toHaveLength(2);
    expect(out.repairEstimate.subtotal).toBe(1450);
    expect(out.repairEstimate.total).toBe(1450);
  });

  it('does NOT re-apply the markup to a typed price', () => {
    // The rep typed the price they intend to charge. Marking it up again
    // silently changes the number they just wrote down.
    const out = withCustomLines(report, [{ name: 'Flat fee', unitPrice: 1000 }]);
    expect(out.repairEstimate.total).toBe(2000);
  });

  it('leaves the report untouched when there is nothing to add', () => {
    expect(withCustomLines(report, [])).toBe(report);
    expect(withCustomLines(report, undefined)).toBe(report);
  });

  it('works on a report with no estimate yet', () => {
    const out = withCustomLines({} as any, [{ name: 'X', unitPrice: 100 }]);
    expect(out.repairEstimate.total).toBe(100);
  });
});

describe('recommendOption', () => {
  it('recommends replacement when the repair approaches its cost', () => {
    const r = recommendOption(9000, 15000);
    expect(r.recommend).toBe('replacement');
    expect(r.because).toMatch(/60%/);
  });

  it('recommends repair on a young roof with contained damage', () => {
    const r = recommendOption(2000, 20000, 5);
    expect(r.recommend).toBe('repair');
  });

  it('recommends replacement on a roof near end of life', () => {
    // Cheap repair, but the roof is nearly done — saying "repair" would be
    // selling the customer a delay.
    expect(recommendOption(1500, 20000, 22).recommend).toBe('replacement');
  });

  it('never recommends a replacement that has no price', () => {
    expect(recommendOption(5000, 0).recommend).toBe('repair');
  });
});

describe('buildEstimateOptions', () => {
  const repairLines = [line('Shingle repair', 4, 500)];
  const replacementLines = [line('Full replacement', 30, 699.99)];

  it('keeps BOTH scopes on one document', () => {
    // The bug this fixes: replacement pricing overwrote the repair lines, so
    // a customer never saw the two prices side by side.
    const out = buildEstimateOptions({ repairLines, replacementLines });
    expect(out.options.map((o) => o.key)).toEqual(['repair', 'replacement']);
    expect(out.options[0].total).toBe(2000);
    expect(out.options[1].total).toBe(20999.7);
  });

  it('carries a recommendation with a reason', () => {
    const out = buildEstimateOptions({ repairLines, replacementLines, roofAgeYears: 4 });
    expect(out.recommend).toBe('repair');
    expect(out.because.length).toBeGreaterThan(20);
  });

  it('omits an option that has no lines', () => {
    expect(buildEstimateOptions({ repairLines, replacementLines: [] }).options.map((o) => o.key)).toEqual(['repair']);
    expect(buildEstimateOptions({ repairLines: [], replacementLines }).options.map((o) => o.key)).toEqual(['replacement']);
  });
});

describe('sumLines', () => {
  it('sums to cents', () => {
    expect(sumLines([line('a', 3, 33.33), line('b', 1, 0.01)])).toBe(100);
  });
  it('is zero for nothing', () => {
    expect(sumLines([])).toBe(0);
  });
});

describe('setEstimateLines (editing without regenerating)', () => {
  const report = {
    repairEstimate: {
      lineItems: [line('Shingle repair', 2, 500), line('Ridge vent', 1, 300)],
      subtotal: 1300, total: 1300, multiplierApplied: 1.25, notes: ['keep me'],
    },
  };

  it('replaces the lines and re-totals', () => {
    const out = setEstimateLines(report, [
      { name: 'Shingle repair', quantity: 3, unit: 'sq', unitPrice: 500 },
      { name: 'New line', quantity: 1, unit: 'ea', unitPrice: 250 },
    ]);
    expect(out.repairEstimate.lineItems).toHaveLength(2);
    expect(out.repairEstimate.total).toBe(1750);
  });

  it('can remove a line by omitting it', () => {
    const out = setEstimateLines(report, [{ name: 'Shingle repair', quantity: 2, unit: 'sq', unitPrice: 500 }]);
    expect(out.repairEstimate.lineItems).toHaveLength(1);
    expect(out.repairEstimate.total).toBe(1000);
  });

  it('can empty the estimate entirely', () => {
    const out = setEstimateLines(report, []);
    expect(out.repairEstimate.lineItems).toEqual([]);
    expect(out.repairEstimate.total).toBe(0);
  });

  it('keeps the rest of the estimate section intact', () => {
    expect(setEstimateLines(report, [{ name: 'X', unitPrice: 1 }]).repairEstimate.notes).toEqual(['keep me']);
  });

  it('drops junk rather than producing a NaN total', () => {
    const out = setEstimateLines(report, [
      { name: 'Good', unitPrice: 100 },
      { name: '', unitPrice: 50 },
      { name: 'Bad price', unitPrice: 'x' as any },
    ]);
    expect(out.repairEstimate.lineItems).toHaveLength(1);
    expect(out.repairEstimate.total).toBe(100);
  });
});

describe('estimateLinesForEditing', () => {
  it('round-trips through the editor without changing the total', () => {
    // The form loads these, the rep saves them back untouched, and the price
    // the customer sees must not move.
    const report = { repairEstimate: { lineItems: [line('A', 3, 425.5), line('B', 1, 99.99)], subtotal: 1376.49, total: 1376.49 } };
    const out = setEstimateLines(report, estimateLinesForEditing(report));
    expect(out.repairEstimate.total).toBe(1376.49);
  });

  it('is empty for a report with no estimate', () => {
    expect(estimateLinesForEditing({})).toEqual([]);
  });
});

describe('estimate lines carry why they exist', () => {
  it('names the findings that put a line on the estimate', () => {
    // "Ridge Cap Repair, 40 lf, $792" tells a homeowner nothing. The finding
    // that caused it is the difference between a price and an argument.
    const out = generateEstimateFromDamageAnalysis([
      { type: 'missing_shingles', severity: 'high', count: 1, label: 'Missing shingles near the ridge' },
    ]);
    const line: any = out.lineItems[0];
    expect(line.because).toContain('Missing shingles near the ridge');
  });

  it('lists several causes but does not run on', () => {
    const out = generateEstimateFromDamageAnalysis(
      ['a', 'b', 'c', 'd', 'e'].map((n) => ({ type: 'missing_shingles', severity: 'high', count: 1, label: `Finding ${n}` })),
    );
    expect(((out.lineItems[0] as any).because || []).length).toBeLessThanOrEqual(3);
  });

  it('omits the reason rather than inventing one', () => {
    const out = generateEstimateFromDamageAnalysis([{ type: 'missing_shingles', severity: 'high', count: 1 }]);
    expect((out.lineItems[0] as any).because).toBeUndefined();
  });

  it('does not repeat the same cause twice', () => {
    const out = generateEstimateFromDamageAnalysis([
      { type: 'missing_shingles', severity: 'high', count: 1, label: 'Missing shingles' },
      { type: 'missing_shingles', severity: 'high', count: 1, label: 'Missing shingles' },
    ]);
    expect((out.lineItems[0] as any).because).toEqual(['Missing shingles']);
  });
});
