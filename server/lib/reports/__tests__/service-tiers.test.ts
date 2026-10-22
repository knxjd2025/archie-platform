/**
 * Tune-up and cleaning as a Good/Better/Best option, at a rate the rep sets
 * between $29 and $99 a square — and standing seam at $2,099 a square.
 */
import { describe, it, expect } from 'vitest';
import { computeTierPricing, productByKey, replacementLineName, isServiceProduct, type TierSelection } from '../roofing-products';
import { warrantyFor } from '../product-warranty';
import { applyReplacementPricing } from '../estimate-replacement';
import { renderProposalScrollcraftHtml } from '../render-proposal-scrollcraft';
import { renderPresentationScrollcraftHtml } from '../render-presentation-scrollcraft';
import { renderEstimateHtml } from '../render-estimate-html';
import { applyDraft } from '../../../reports/draft';
import { serviceTierRateOk, SERVICE_TIER_RATE_MIN, SERVICE_TIER_RATE_MAX } from '../../../../shared/addon-pricing';

const base: any = {
  id: 'svc', generatedAt: '2026-10-05T12:00:00.000Z',
  property: { address: '9 Test Ln', city: 'Springfield', state: 'IL' },
  damageAnalysis: { totalPhotosAnalyzed: 0, photos: [] },
  repairEstimate: { lineItems: [], total: 0, notes: [] },
};
const SEL = (good: any, better: any, best: any) => ({ good, better, best }) as TierSelection;
const tune = (r: number) => ({ service: 'tune_up', ratePerSquare: r });
const clean = (r: number) => ({ service: 'cleaning', ratePerSquare: r });

describe('the rates', () => {
  it('standing seam metal is $2,099 a square', () => {
    expect(productByKey('standing_seam_metal')!.ratePerSquare).toBe(2099);
  });
  it('a service rate has to sit between $29 and $99', () => {
    expect([SERVICE_TIER_RATE_MIN, SERVICE_TIER_RATE_MAX]).toEqual([29, 99]);
    for (const ok of [29, 64.5, 99]) expect(serviceTierRateOk(ok)).toBe(true);
    for (const bad of [28.99, 99.01, 0, -5, 'abc', null]) expect(serviceTierRateOk(bad)).toBe(false);
  });
});

describe('a tune-up or cleaning in a tier', () => {
  it('prices at the rep\'s rate and names the line plainly', () => {
    const p = computeTierPricing(SEL(clean(39), tune(79), 'landmark'), 20)!;
    expect(p.good.total).toBe(780);
    expect(p.better.total).toBe(1580);
    expect(p.better.product.name).toBe('Roof Tune-Up');
    expect(isServiceProduct(p.better.product)).toBe(true);
    expect(replacementLineName(p.better)).toBe('Roof Tune-Up'); // not "Full Roof Replacement — …"
    expect(replacementLineName(p.best)).toContain('Full Roof Replacement');
  });
  it('refuses a rate outside the band', () => {
    expect(computeTierPricing(SEL(tune(120), 'landmark_pro', 'landmark'), 20)).toBeNull();
    expect(computeTierPricing(SEL(clean(10), 'landmark_pro', 'landmark'), 20)).toBeNull();
  });
  it('claims no warranty', () => {
    const w = warrantyFor(computeTierPricing(SEL(tune(50), 'landmark_pro', 'landmark'), 20)!.good.product);
    expect(w.service).toBe(true);
    expect(w.manufacturerYears).toBeNull();
    expect(w.manufacturerLine).toMatch(/no manufacturer warranty/);
  });
});

describe('the documents, when the quoted option is a tune-up', () => {
  const report = applyReplacementPricing(base, { tierSelection: SEL(clean(39), tune(79), 'landmark_pro'), squares: 20, selectedTier: 'better' });

  it('Proposal: what the visit covers, no warranty years, no shingle colours', () => {
    const html = renderProposalScrollcraftHtml(report, { customer: 'Pat Doe' });
    const w = html.slice(html.indexOf('id="ch-warranty"'));
    expect(w).toContain('What This Visit Covers');
    expect(w).toContain('Reseal tired flashings and pipe boots');
    expect(w.slice(0, w.indexOf('</section>'))).not.toContain('Yr Workmanship');
    expect(html).not.toContain('id="ch-colors"');
    expect(html).not.toContain('id="ch-system"'); // no layer-by-layer of a roof nobody is installing
    expect(html).toContain('from caring for the roof you have to putting on a new one');
  });
  it('Presentation: no installed-roof photo for a tune-up, and its own covers chapter', () => {
    const html = renderPresentationScrollcraftHtml(report, { customer: 'Pat Doe' });
    const product = html.slice(html.indexOf('id="ch-product"'), html.indexOf('</section>', html.indexOf('id="ch-product"')));
    expect(product).not.toContain('who-photo');
    expect(product).not.toContain('same tear-off');
    const system = html.slice(html.indexOf('id="ch-system"'), html.indexOf('</section>', html.indexOf('id="ch-system"')));
    expect(system).toContain('What This Visit Covers');
    expect(system).not.toContain('Yr Workmanship');
  });
  it('Estimate: covers the roof as it is, not "your new roof"', () => {
    const est = applyReplacementPricing(base, { tierSelection: SEL(clean(39), tune(79), 'landmark_pro'), squares: 20, selectedTier: 'better' });
    const html = renderEstimateHtml({ ...est, estimateMode: 'replacement' } as any, { customer: 'Pat Doe' });
    expect(html).toContain('your roof as it is');
    expect(html).not.toContain('Every replacement we install includes');
  });
  it('a new-roof quote keeps its tear-off wording', () => {
    const roof = applyReplacementPricing(base, { tierSelection: SEL('landmark', 'landmark_pro', 'landmark_premium'), squares: 20, selectedTier: 'better' });
    expect(renderPresentationScrollcraftHtml(roof, { customer: 'Pat Doe' })).toContain('the same crew, the same tear-off');
  });
});

describe('the report editor', () => {
  it('keeps a tune-up\'s rate inside the band when the rep edits it', () => {
    const report = applyReplacementPricing(base, { tierSelection: SEL(clean(39), tune(79), 'landmark_pro'), squares: 20, selectedTier: 'better' });
    const tooHigh = applyDraft(report, { tiers: { rates: { better: { ratePerSquare: 150 } } } } as any).data;
    expect(tooHigh.replacementOptions[1].ratePerSquare).toBe(79);
    const ok = applyDraft(report, { tiers: { rates: { better: { ratePerSquare: 95 } } } } as any).data;
    expect(ok.replacementOptions[1].ratePerSquare).toBe(95);
    expect(ok.replacementOptions[1].total).toBe(1900);
  });
});
