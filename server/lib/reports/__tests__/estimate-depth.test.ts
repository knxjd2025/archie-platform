import { describe, it, expect } from 'vitest';
import { renderEstimateHtml } from '../render-estimate-html';
import { applyReplacementPricing } from '../estimate-replacement';
import { withCustomLines } from '../estimate-editing';
import type { TierSelection } from '../roofing-products';

const report = (extra: any = {}): any => ({
  id: 'r-est', generatedAt: '2026-09-14T12:00:00.000Z', version: '2.0',
  property: { address: '5 Estimate Dr', city: 'Charlotte', state: 'NC', latitude: 35.2, longitude: -80.8 },
  stormHistory: { yearsAnalyzed: 3, searchRadiusMiles: 5, totalEvents: 3, hailEvents: 2, windEvents: 1, tornadoEvents: 0, largestHailInches: 1.25, highestWindMph: 58, riskLevel: 'medium', riskScore: 50, claimPotential: 'medium', eventsByYear: { 2025: { hail: 2, wind: 1, total: 3 } }, recommendedDateOfLoss: { date: '2025-05-20', eventType: 'Hail', magnitude: '1.25" hail', reason: 'largest' } },
  measurements: { documentName: 'EagleView-42.pdf', squares: 28, facets: 9, predominantPitch: '5/12', eavesFt: 120 },
  damageAnalysis: {
    totalPhotosAnalyzed: 2, photosWithDamage: 2, overallSeverity: 'high', roofAge: null, damageTypes: [], aiSummary: 'We found damage in 2 areas.',
    photos: [
      { id: 'p1', url: 'https://example.invalid/1.jpg', overallSeverity: 'high', aiSummary: 'x', analyzedAt: 'now', damages: [{ id: 'd1', type: 'pipe_boot_cracked', label: 'Cracked Pipe Boot', severity: 'medium', confidence: 0.9, description: 'split', location: 'rear' }] },
      { id: 'p2', url: 'https://example.invalid/2.jpg', overallSeverity: 'high', aiSummary: 'y', analyzedAt: 'now', damages: [{ id: 'd2', type: 'pipe_boot_cracked', label: 'Cracked Pipe Boot', severity: 'medium', confidence: 0.8, description: 'split', location: 'front' }, { id: 'd3', type: 'valley_damage', label: 'Valley Damage', severity: 'high', confidence: 0.8, description: 'lifted', location: 'north valley' }] },
    ],
  },
  repairEstimate: { lineItems: [], subtotal: 0, multiplierApplied: 1, total: 0, notes: [] },
  inspectorNotes: '', dataQuality: 'verified', dataSources: [],
  ...extra,
});

const inspection: any = {
  inspectionType: 'Retail / Non-Insurance', recommendation: 'Repair only', damageSummary: 'Two split boots and a lifted valley; rest of the roof sound.', approxSquares: 28,
  answers: { 'Drip edge': 'No', 'Felt or underlayment type': 'Synthetic', 'Ice and water shield': 'Yes - eaves, valleys and penetrations', 'Valley type': 'Roll roofing', 'Starter course present': 'Yes - eaves and rakes' },
};

const tiers = { good: 'landmark', better: 'standing_seam_metal', best: 'landmark_presidential' } as TierSelection;

describe('the Estimate carries the same depth', () => {
  it('a repair estimate explains why each finding matters, groups repeats, and lists what the repair does not fix', () => {
    const repair = withCustomLines(report(), [{ name: 'Pipe boot replacement', quantity: 2, unit: 'ea', unitPrice: 660 }]);
    const html = renderEstimateHtml(repair, { customer: 'T', jobType: 'retail', inspection });
    expect(html).toContain("Your inspector's summary.");
    expect(html).toContain('Two split boots and a lifted valley');
    expect(html).toContain('Why it matters:');
    expect(html).toContain('dries, cracks and splits years before the shingles around it wear out'); // pipe-boot why-it-matters
    expect(html).toContain('2 photos'); // the two boot findings collapse to one row
    expect(html).toContain('Also worth knowing &mdash; not included in this repair:');
    expect(html).toContain('No drip edge found');
    expect(html).toContain('Roll-roofing valleys');
    expect(html).not.toContain('Recommended date of loss'); // retail, no rep storm
    expect(html).not.toContain('R905'); // citations still draft
    expect(html).toContain('Roof Repair Estimate');
  });

  it('a replacement estimate shows the measured roof, the product warranty, and what the new roof corrects', () => {
    const priced = applyReplacementPricing(report(), { tierSelection: tiers, squares: 28, selectedTier: 'better' });
    const html = renderEstimateHtml(priced, { customer: 'T', jobType: 'retail', inspection });
    expect(html).toContain('Measured from EagleView-42.pdf');
    expect(html).toContain('120 ft');
    expect(html).toContain('Backed by:');
    expect(html).toContain('specific metal system quoted'); // standing seam: no borrowed 50-year number
    expect(html).not.toContain('50-year manufacturer warranty');
    expect(html).not.toContain('50-Year Manufacturer Warranty'); // the CertainTeed includes bullet
    expect(html).not.toContain('CertainTeed hip');
    expect(html).toContain('Complete tear-off');
    expect(html).toContain('Corrected as part of this roof &mdash; 2 items');
    expect(html).toContain('Roof Replacement Estimate');

    const shingle = renderEstimateHtml(applyReplacementPricing(report(), { tierSelection: tiers, squares: 28, selectedTier: 'good' }), { customer: 'T', inspection });
    expect(shingle).toContain('50-year manufacturer warranty');
  });

  it('shows the NOAA record on an insurance estimate', () => {
    const priced = applyReplacementPricing(report({ repConfirmedStorm: { date: '2025-05-20', type: 'Hail' } }), { tierSelection: tiers, squares: 28, selectedTier: 'good' });
    const html = renderEstimateHtml(priced, { customer: 'T', jobType: 'insurance', inspection });
    expect(html).toContain('Recommended date of loss');
    expect(html).toContain('May 20, 2025');
  });

  it('still renders with no checklist and no findings', () => {
    const bare = report({ damageAnalysis: { totalPhotosAnalyzed: 0, photosWithDamage: 0, overallSeverity: 'none', roofAge: null, damageTypes: [], aiSummary: '', photos: [] } });
    const html = renderEstimateHtml(withCustomLines(bare, [{ name: 'Tune-up', quantity: 1, unit: 'ea', unitPrice: 200 }]), { customer: 'T' });
    expect(html).toContain('What This Covers');
    expect(html).not.toContain('Why it matters:');
    expect(html).not.toContain('Also worth knowing');
  });
});
