import { describe, it, expect } from 'vitest';
import { resolveScopeItems, scopeLinesOf, scopeTotalOf, isReplacementLine } from '../scope-items';
import { SCOPE_CATALOG, scopeCatalogItem } from '../../../../shared/scope-catalog';
import { applyReplacementPricing } from '../estimate-replacement';
import { linesFromReport } from '../../../reports/to-jobtread';
import { renderProposalScrollcraftHtml } from '../render-proposal-scrollcraft';
import { renderPresentationScrollcraftHtml } from '../render-presentation-scrollcraft';
import { renderEstimateHtml } from '../render-estimate-html';
import type { TierSelection } from '../roofing-products';

const rep = { canOverride: false };
const manager = { canOverride: true };

const baseReport: any = {
  id: 'r-scope', generatedAt: '2026-09-14T00:00:00Z',
  property: { address: '9 Scope Ln', city: 'Springfield', state: 'IL' },
  damageAnalysis: { totalPhotosAnalyzed: 0, photos: [] },
  repairEstimate: { lineItems: [], total: 0, notes: [] },
};
const tiers = { good: 'landmark', better: 'landmark_pro', best: 'landmark_presidential' } as TierSelection;

describe('scope catalog', () => {
  it('every item has a name, description, unit and category; prices are positive or null', () => {
    for (const i of SCOPE_CATALOG) {
      expect(i.name).toBeTruthy();
      expect(i.description.length).toBeGreaterThan(20);
      expect(['ea', 'lf', 'sq', 'sheet']).toContain(i.unit);
      if (i.unitPrice != null) expect(i.unitPrice).toBeGreaterThan(0);
    }
    expect(new Set(SCOPE_CATALOG.map((i) => i.id)).size).toBe(SCOPE_CATALOG.length);
  });

  it('carries the standard 1.65 markup for items that exist in the repair table', () => {
    expect(scopeCatalogItem('skylight_replacement')?.unitPrice).toBeCloseTo(1200 * 1.65, 2);
    expect(scopeCatalogItem('ridge_vent')?.unitPrice).toBeCloseTo(25 * 1.65, 2);
    expect(scopeCatalogItem('decking_replacement')?.unitPrice).toBeCloseTo(75 * 1.65, 2);
  });
});

describe('resolveScopeItems — who may price what', () => {
  it('a rep gets the catalog price, and any price they send is ignored', () => {
    const { lines, errors } = resolveScopeItems([{ catalogId: 'skylight_replacement', quantity: 2, unitPrice: 1 }], rep);
    expect(errors).toEqual([]);
    expect(lines).toHaveLength(1);
    expect(lines[0].finalCostPerUnit).toBe(1980);
    expect(lines[0].totalFinalCost).toBe(3960);
    expect(lines[0].repairTypeId).toBe('scope_skylight_replacement');
    expect(lines[0].scope.description).toContain('curb-mounted');
  });

  it('Perma-Boots are $450 for the first and $200 for each after, as two lines', () => {
    const { lines, errors } = resolveScopeItems([{ catalogId: 'perma_boot', quantity: 12 }], rep);
    expect(errors).toEqual([]);
    expect(lines.map((l) => [l.repairTypeId, l.quantity, l.finalCostPerUnit, l.totalFinalCost])).toEqual([
      ['scope_perma_boot', 1, 450, 450],
      ['scope_perma_boot_additional', 11, 200, 2200],
    ]);
    expect(lines[1].repairName).toMatch(/additional/i);
    const one = resolveScopeItems([{ catalogId: 'perma_boot', quantity: 1 }], rep).lines;
    expect(one.map((l) => [l.quantity, l.totalFinalCost])).toEqual([[1, 450]]);
  });

  it('a manager’s price on Perma-Boots is one flat line at that price', () => {
    const { lines } = resolveScopeItems([{ catalogId: 'perma_boot', quantity: 3, unitPrice: 300 }], manager);
    expect(lines.map((l) => [l.quantity, l.finalCostPerUnit])).toEqual([[3, 300]]);
  });

  it('a water diverter is $250 each', () => {
    const { lines } = resolveScopeItems([{ catalogId: 'water_diverter', quantity: 2 }], rep);
    expect(lines.map((l) => [l.repairTypeId, l.finalCostPerUnit, l.totalFinalCost])).toEqual([['scope_water_diverter', 250, 500]]);
  });

  it('a manager may override the catalog price', () => {
    const { lines } = resolveScopeItems([{ catalogId: 'skylight_replacement', quantity: 1, unitPrice: 1750 }], manager);
    expect(lines[0].finalCostPerUnit).toBe(1750);
  });

  it('an unpriced catalog item is refused for a rep and accepted with a price from a manager', () => {
    const r = resolveScopeItems([{ catalogId: 'chimney_cricket' }], rep);
    expect(r.lines).toEqual([]);
    expect(r.errors[0]).toMatch(/no set price/);
    const m = resolveScopeItems([{ catalogId: 'chimney_cricket', unitPrice: 850 }], manager);
    expect(m.errors).toEqual([]);
    expect(m.lines[0].finalCostPerUnit).toBe(850);
    expect(m.lines[0].scope.requirement).toBe('code');
  });

  it('a custom (off-catalog) item is manager-only and needs a name and a price', () => {
    expect(resolveScopeItems([{ name: 'Copper valley', unitPrice: 900 }], rep).errors[0]).toMatch(/Sales Leader/);
    expect(resolveScopeItems([{ name: '', unitPrice: 900 }], manager).errors[0]).toMatch(/needs a name/);
    expect(resolveScopeItems([{ name: 'Copper valley' }], manager).errors[0]).toMatch(/needs a price/);
    const ok = resolveScopeItems([{ name: 'Copper valley', quantity: 30, unit: 'lf', unitPrice: 30 }], manager);
    expect(ok.lines[0].repairTypeId).toBe('scope_custom_0');
    expect(ok.lines[0].totalFinalCost).toBe(900);
  });

  it('rejects an unknown catalog id', () => {
    expect(resolveScopeItems([{ catalogId: 'nope' }], manager).errors[0]).toMatch(/Unknown scope item/);
  });
});

describe('a replacement quote with scope', () => {
  const { lines } = resolveScopeItems([
    { catalogId: 'skylight_replacement', quantity: 1 },
    { catalogId: 'ridge_vent', quantity: 40 },
  ], rep);
  const report = applyReplacementPricing(baseReport, { tierSelection: tiers, squares: 30, selectedTier: 'better', scopeLines: lines });

  it('is tier × squares PLUS the scope, replacement line first', () => {
    expect(report.repairEstimate.lineItems).toHaveLength(3);
    expect(isReplacementLine(report.repairEstimate.lineItems[0])).toBe(true);
    expect(scopeLinesOf(report)).toHaveLength(2);
    expect(scopeTotalOf(report)).toBeCloseTo(1980 + 40 * 41.25, 2);
    expect(report.repairEstimate.total).toBeCloseTo(509 * 30 + 1980 + 40 * 41.25, 2);
  });

  it('flows into the JobTread push as ordinary priced lines', () => {
    const jt = linesFromReport(report);
    expect(jt.map((l) => l.name)).toEqual(['Full Roof Replacement — CertainTeed Landmark PRO', 'Skylight replacement', 'Ridge vent']);
    expect(jt[2].quantity).toBe(40);
  });

  it('shows on the Proposal: cards carry the whole-job price, Investment itemises the scope', () => {
    const html = renderProposalScrollcraftHtml(report, { customer: 'Test' });
    const wholeJob = Math.round((509 * 30 + 1980 + 40 * 41.25) * 100) / 100;
    expect(html).toContain(`data-price="${wholeJob}"`);
    expect(html).toContain(`data-tier-total="${wholeJob}"`);
    expect(html).toContain('additional scope');
    expect(html).toContain('Skylight replacement');
    expect(html).toContain('Roof system — CertainTeed Landmark PRO');
    expect(html).toContain('Total investment');
  });

  it('shows on the Presentation the same way', () => {
    const html = renderPresentationScrollcraftHtml(report, { customer: 'Test' });
    expect(html).toContain('Skylight replacement');
    expect(html).toContain('Total investment');
    expect(html).toContain('additional scope');
  });

  it('shows on a replacement Estimate under Scope of Work, with the options note', () => {
    const html = renderEstimateHtml(report, { customer: 'Test' } as any);
    expect(html).toContain('Skylight replacement');
    expect(html).toContain('additional scope, itemised under Scope of Work');
  });

  it('a quote with no scope renders no scope table and no "additional scope" note', () => {
    const plain = applyReplacementPricing(baseReport, { tierSelection: tiers, squares: 30, selectedTier: 'better' });
    const html = renderProposalScrollcraftHtml(plain, { customer: 'Test' });
    expect(html).not.toContain('additional scope');
    // The stylesheet always carries .scope-table; the TABLE itself must not.
    expect(html).not.toContain('class="scope-table"');
    expect(html).toContain(`data-tier-total="${509 * 30}"`);
  });
});
