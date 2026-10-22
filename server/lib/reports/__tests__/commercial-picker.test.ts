import { describe, it, expect } from 'vitest';
import { renderProposalScrollcraftHtml } from '../render-proposal-scrollcraft';
import { renderPresentationScrollcraftHtml } from '../render-presentation-scrollcraft';
import { renderEstimateHtml } from '../render-estimate-html';
import { applyReplacementPricing } from '../estimate-replacement';
import { roofSystemFor } from '../roof-systems';
import { warrantyFor } from '../product-warranty';
import { commercialAsProduct } from '../roofing-products';
import { productImage } from '../sections/product-spec-panel';

const report = (): any => ({
  id: 'r-com', generatedAt: '2026-09-14T12:00:00.000Z', version: '2.0',
  property: { address: '400 Warehouse Way', city: 'Springfield', state: 'IL', latitude: 35.2, longitude: -80.8 },
  stormHistory: { yearsAnalyzed: 3, searchRadiusMiles: 5, totalEvents: 0, hailEvents: 0, windEvents: 0, tornadoEvents: 0, largestHailInches: 0, highestWindMph: 0, riskLevel: 'low', riskScore: 5, claimPotential: 'low', eventsByYear: {}, recommendedDateOfLoss: null },
  damageAnalysis: { totalPhotosAnalyzed: 0, photosWithDamage: 0, overallSeverity: 'none', roofAge: null, damageTypes: [], aiSummary: '', photos: [] },
  repairEstimate: { lineItems: [], subtotal: 0, multiplierApplied: 1, total: 0, notes: [] },
  inspectorNotes: '', dataQuality: 'verified', dataSources: [],
});

const COMMERCIAL = { good: 'dura_last_layover', better: 'dura_last_tpo', best: 'gaf_commercial_tpo' } as const;
const priced = (selected: 'good' | 'better' | 'best' = 'better', isoTier: 'r25' | 'r30' | undefined = 'r30') =>
  applyReplacementPricing(report(), { tierSelection: COMMERCIAL, squares: 120, selectedTier: selected, isoTier });

describe('a commercial quote reads as a commercial quote', () => {
  it('a commercial tier resolves to a walkthrough, a product photo and a named system warranty', () => {
    const duro = commercialAsProduct('dura_last_tpo')!;
    expect(roofSystemFor(duro)!.maker).toBe('Duro-Last');
    expect(roofSystemFor('gaf_commercial_tpo')!.systemName).toContain('EverGuard');
    expect(roofSystemFor('restoration_coating')).toBeNull();
    expect(productImage('dura_last_tpo').src).toContain('/roof-systems/duro-last/membrane-installed.jpg');
    expect(productImage('gaf_commercial_tpo').caption).toContain('manufacturer illustration');
    expect(productImage('landmark').caption).toContain('CertainTeed'); // residential still generic
    expect(warrantyFor(duro).manufacturer).toBe('Duro-Last');
    expect(warrantyFor(duro).manufacturerYears).toBeNull();
    expect(warrantyFor(commercialAsProduct('gaf_commercial_tpo')!).manufacturerLine).toContain('Diamond Pledge');
  });

  it('Estimate: commercial includes, the ISO line, the Duro-Last walkthrough — and nothing about shingles', () => {
    const html = renderEstimateHtml(priced('better'), { customer: 'Warehouse LLC' });
    expect(html).toContain('Full Roof Replacement');
    expect(html).toContain('Complete tear-off of the existing roof to the deck');
    expect(html).toContain('Includes <b>R-30 ISO Insulation</b>');
    expect(html).toContain('Duro-Last&reg; PVC Roofing Membrane');
    expect(html).toContain('Duro-Guard&reg; ISO II Insulation');
    expect(html).not.toContain('starter strip');
    expect(html).not.toContain('hip &amp; ridge');
    expect(html).not.toContain('attic ventilation');
    expect(html).not.toContain('50-Year');
    expect(html).not.toContain('SureStart');

    const layover = renderEstimateHtml(priced('good'), { customer: 'Warehouse LLC' });
    expect(layover).toContain('Roof Recover (layover)');
    expect(layover).toContain('core-sampled for trapped moisture');
    expect(layover).not.toContain('Includes <b>R-30');
    expect(layover).toContain('Existing roof surveyed, repaired and separated');
  });

  it('Proposal and Presentation: the option cards say which tiers carry ISO, and the product photo is the membrane', () => {
    const proposal = renderProposalScrollcraftHtml(priced('better'), { customer: 'Warehouse LLC' });
    expect(proposal).toContain('How Your Roof Goes Together');
    expect(proposal).toContain('Duro-Last&reg; PVC Roofing Membrane'); // the selected (better) tier's system
    expect(proposal).toContain('Duro-Last Commercial PVC (tear-off)');
    expect(proposal).toContain('GAF Commercial TPO'); // the other tiers still sit in the comparison
    expect((proposal.match(/includes R-30 ISO Insulation/g) || []).length).toBe(2); // the two tear-off tiers, not the layover
    expect(proposal).not.toContain('Integrity Roof System');
    expect(proposal).not.toContain('SureStart');

    const presentation = renderPresentationScrollcraftHtml(priced('best'), { customer: 'Warehouse LLC' });
    expect(presentation).toContain('gaf/tpo-installed.jpg');
    expect(presentation).toContain('manufacturer illustration');
    expect(presentation).not.toContain('Real installed CertainTeed roofing');
    expect(presentation).toContain('GAF EverGuard&reg; system guarantee');
  });

  it('a residential quote is untouched by the commercial plumbing', () => {
    const res = applyReplacementPricing(report(), { tierSelection: { good: 'landmark', better: 'landmark_pro', best: 'landmark_premium' }, squares: 30, selectedTier: 'better', isoTier: 'r30' });
    expect((res.replacementOptions as any[]).every((o) => !o.iso)).toBe(true);
    const html = renderPresentationScrollcraftHtml(res, { customer: 'T' });
    expect(html).toContain('Real installed CertainTeed roofing');
    expect(html).not.toContain('includes R-30');
  });
});
