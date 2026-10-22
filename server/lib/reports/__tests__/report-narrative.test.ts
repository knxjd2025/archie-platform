import { describe, it, expect } from 'vitest';
import { digestStoredAnalysis, inspectorTextFrom, narrativeEnabled } from '../report-narrative';
import { narrativeHtml } from '../sections/narrative';
import { SCROLL_STYLE } from '../sections/style';
import { warrantyFor } from '../product-warranty';
import { productByKey } from '../roofing-products';
import { applyDraft } from '../../../reports/draft';
import { renderProposalScrollcraftHtml } from '../render-proposal-scrollcraft';
import { renderPresentationScrollcraftHtml } from '../render-presentation-scrollcraft';
import { applyReplacementPricing } from '../estimate-replacement';
import type { TierSelection } from '../roofing-products';
import { withProfile } from '../../../tenant/context';
import { CREDENTIALED_PROFILE, BARE_PROFILE } from './profiles';

const report = (extra: any = {}): any => ({
  id: 'r-n', generatedAt: '2026-09-14T00:00:00Z',
  property: { address: '4 Narrative Way', city: 'Springfield', state: 'IL' },
  stormHistory: { yearsAnalyzed: 3, searchRadiusMiles: 5, totalEvents: 4, hailEvents: 3, windEvents: 1, tornadoEvents: 0, largestHailInches: 1.5, highestWindMph: 62, riskLevel: 'high', riskScore: 70, claimPotential: 'high', eventsByYear: { 2025: { hail: 2, wind: 1, total: 3 }, 2024: { hail: 1, wind: 0, total: 1 } }, recommendedDateOfLoss: { date: '2025-05-20', eventType: 'Hail', magnitude: '1.5" hail', reason: 'largest' } },
  damageAnalysis: {
    totalPhotosAnalyzed: 2, photosWithDamage: 2, overallSeverity: 'high', roofAge: { estimatedAgeYears: 14, expectedLifespanYears: 25, remainingLifeYears: 11, confidence: 'medium', indicators: [], roofMaterial: 'asphalt_architectural', materialCondition: 'fair' },
    damageTypes: [], aiSummary: 'We found damage in 2 areas.',
    photos: [
      { id: 'p1', url: 'https://example.invalid/1.jpg', overallSeverity: 'high', aiSummary: 'x', analyzedAt: 'now', damages: [{ id: 'd1', type: 'hail_damage', label: 'Hail Damage', severity: 'high', confidence: 0.9, description: 'Round bruises with granule loss', location: 'south slope' }] },
      { id: 'p2', url: 'https://example.invalid/2.jpg', overallSeverity: 'medium', aiSummary: 'y', analyzedAt: 'now', damages: [{ id: 'd2', type: 'pipe_boot_cracked', label: 'Cracked Pipe Boot', severity: 'medium', confidence: 0.8, description: 'Split collar', location: 'rear' }] },
    ],
  },
  repairEstimate: { lineItems: [], subtotal: 0, multiplierApplied: 1, total: 0, notes: [] },
  inspectorNotes: '', dataQuality: 'verified', dataSources: [],
  ...extra,
});

describe('narrative inputs are built from what the report already holds', () => {
  it('the digest lists every distinct finding and fences the storm items', () => {
    const d = digestStoredAnalysis(report());
    expect(d).toContain('Hail Damage; severity high');
    expect(d).toContain('Cracked Pipe Boot; severity medium');
    expect(d).toContain('STORM-CATEGORY observations (the ONLY items permitted');
    expect(d).toContain('Hail Damage (high, south slope)');
    expect(d).not.toContain('Cracked Pipe Boot (medium'); // not a storm item
    expect(d).toContain('NOAA storm records within 5 miles');
  });

  it('with no storm-type finding, the digest tells the writer to omit the storm section', () => {
    const r = report();
    r.damageAnalysis.photos = [r.damageAnalysis.photos[1]];
    expect(digestStoredAnalysis(r)).toContain('STORM-CATEGORY observations: NONE');
  });

  it("the inspector text leads with the rep's own summary and recommendation, then the checklist", () => {
    const t = inspectorTextFrom({ report: report(), damageSummary: 'Hail on all slopes, 12+ hits per square.', recommendation: 'Full replacement', answers: { 'Average pitch across ALL slopes': '6/12', 'Ventilation types, counts, and plan': ['Ridge vent'], 'Inspector Name': 'ignored' }, inspectorNotes: 'Homeowner reports leak at chimney.' });
    expect(t.split('\n')[0]).toContain("Inspector's overall damage summary: Hail on all slopes");
    expect(t).toContain("Inspector's recommendation: Full replacement");
    expect(t).toContain('Average pitch across ALL slopes: 6/12');
    expect(t).toContain('Ventilation types, counts, and plan: Ridge vent');
    expect(t).not.toContain('Inspector Name');
    expect(t).toContain('Rep notes: Homeowner reports leak');
  });

  it('is off without a GROQ key or when REPORT_NARRATIVE=off', () => {
    const key = process.env.GROQ_API_KEY; const flag = process.env.REPORT_NARRATIVE;
    delete process.env.GROQ_API_KEY;
    expect(narrativeEnabled()).toBe(false);
    process.env.GROQ_API_KEY = 'x'; process.env.REPORT_NARRATIVE = 'off';
    expect(narrativeEnabled()).toBe(false);
    delete process.env.REPORT_NARRATIVE;
    expect(narrativeEnabled()).toBe(true);
    if (key) process.env.GROQ_API_KEY = key; else delete process.env.GROQ_API_KEY;
    if (flag) process.env.REPORT_NARRATIVE = flag;
  });
});

describe('narrative rendering', () => {
  it('turns ## headers and - bullets into HTML, escaping text', () => {
    const html = narrativeHtml('## Overview\nThe roof is fair.\n- Hail bruising <south>\n- Split boot\nRecommendation: replace.', SCROLL_STYLE);
    expect(html).toContain('<h3 class="nar-h">Overview</h3>');
    expect(html).toContain('<li>Hail bruising &lt;south&gt;</li>');
    expect(html).toContain('<b>Recommendation:</b> replace.');
    expect(narrativeHtml('', SCROLL_STYLE)).toBe('');
  });

  const tiers = { good: 'landmark', better: 'landmark_pro', best: 'standing_seam_metal' } as TierSelection;

  it('the Proposal shows the chapters only when a narrative exists, and the rep summary and storm record on a claim', () => {
    const priced = applyReplacementPricing(report({ repConfirmedStorm: { date: '2025-05-20', type: 'Hail' } }), { tierSelection: tiers, squares: 30, selectedTier: 'better' });
    const bare = renderProposalScrollcraftHtml(priced, { customer: 'T', damageSummary: 'Hail on all slopes.' });
    expect(bare).not.toContain('id="ch-narrative"');
    expect(bare).toContain("Your inspector's summary.");
    expect(bare).toContain('Recommended date of loss');
    expect(bare).toContain('May 20, 2025');

    const withN = renderProposalScrollcraftHtml({ ...priced, narrative: { findings: '## Overview\nHail bruising across the south slope.', solution: 'We recommend a full replacement because the bruising is field-wide.', generatedAt: 'now' } } as any, { customer: 'T' });
    expect(withN).toContain('id="ch-narrative"');
    expect(withN).toContain('Your Roof, Specifically');
    expect(withN).toContain('Hail bruising across the south slope.');
    expect(withN).toContain('Why this, for this roof');
    expect(withN).toContain('field-wide');
    expect(withN).toContain('href="#ch-narrative"');
    expect(withN).not.toContain('{{CH}}');
  });

  it('a retail proposal with no rep-confirmed storm shows no NOAA record block', () => {
    const priced = applyReplacementPricing(report(), { tierSelection: tiers, squares: 30, selectedTier: 'better' });
    const html = renderProposalScrollcraftHtml(priced, { customer: 'T', jobType: 'retail' });
    expect(html).not.toContain('Recommended date of loss');
  });

  it('the Presentation carries the same chapters', () => {
    const priced = applyReplacementPricing(report(), { tierSelection: tiers, squares: 30, selectedTier: 'better' });
    const html = renderPresentationScrollcraftHtml({ ...priced, narrative: { findings: '## Overview\nField-wide bruising.', solution: 'Replace it.', generatedAt: 'now' } } as any, { customer: 'T' });
    expect(html).toContain('id="ch-narrative"');
    expect(html).toContain('Field-wide bruising.');
    expect(html).toContain('Why this, for this roof');
  });

  it('the measured-roof block prints when a measurement document rode on the report', () => {
    const priced = applyReplacementPricing(report({ measurements: { source: 'eagleview', documentName: 'EagleView-1234.pdf', squares: 31, facets: 14, predominantPitch: '7/12', ridgesHipsFt: 120, valleysFt: 44, eavesFt: 160, rakesFt: 90 } }), { tierSelection: tiers, squares: 31, selectedTier: 'better' });
    const html = renderProposalScrollcraftHtml(priced, { customer: 'T' });
    expect(html).toContain('Measured from EagleView-1234.pdf');
    expect(html).toContain('7/12');
    expect(html).toContain('120 ft');
  });
});

describe('warranty follows the product', () => {
  it('CertainTeed keeps the 50-year claim for a credentialed company; metal and synthetics get no invented number', () => {
    const ct = withProfile(CREDENTIALED_PROFILE, () => warrantyFor(productByKey('landmark_pro')!));
    expect(ct.manufacturerYears).toBe(50);
    expect(ct.workmanshipYears).toBe(15);
    expect(ct.certainteed).toBe(true);
    // A company without the credential cannot register the extended coverage, so no figure.
    expect(withProfile(BARE_PROFILE, () => warrantyFor(productByKey('landmark_pro')!)).manufacturerYears).toBeNull();
    const metal = warrantyFor(productByKey('standing_seam_metal')!);
    expect(metal.manufacturerYears).toBeNull();
    expect(metal.certainteed).toBe(false);
    expect(metal.manufacturerLine).toMatch(/confirmed in writing at signing/);
    expect(warrantyFor(productByKey('davinci_shake')!).manufacturerLine).toMatch(/DaVinci/);
    expect(warrantyFor(productByKey('tamko_titan_basic')!).manufacturerLine).toMatch(/Tamko limited lifetime/);
  });

  it('a metal proposal does not print the 50-year CertainTeed seal or the Integrity System copy', () => {
    const tiers = { good: 'landmark', better: 'standing_seam_metal', best: 'landmark_presidential' } as TierSelection;
    const html = withProfile(CREDENTIALED_PROFILE, () => renderProposalScrollcraftHtml(applyReplacementPricing(report(), { tierSelection: tiers, squares: 30, selectedTier: 'better' }), { customer: 'T' }));
    expect(html).not.toContain('data-sc-count="0 50"');
    expect(html).toContain('What Stands Behind It');
    expect(html).toContain('data-sc-count="0 15"');
    expect(html).not.toContain('SureStart');
    const shingle = withProfile(CREDENTIALED_PROFILE, () => renderProposalScrollcraftHtml(applyReplacementPricing(report(), { tierSelection: tiers, squares: 30, selectedTier: 'good' }), { customer: 'T' }));
    expect(shingle).toContain('data-sc-count="0 50"');
    expect(shingle).toContain('The Integrity Roof System');
  });
});

describe('the narrative is editable through the draft', () => {
  it('edits, records the change, and removes the chapters when both are cleared', () => {
    const data = { narrative: { findings: 'old', solution: 'sol', generatedAt: 'x' } };
    const a = applyDraft(data, { narrativeFindings: '## New\n- bullet  \n' });
    expect(a.data.narrative.findings).toBe('## New\n- bullet');
    expect(a.data.narrative.solution).toBe('sol');
    expect(a.changes).toEqual(['roof narrative']);
    const none = applyDraft(data, { narrativeFindings: '', narrativeSolution: '' });
    expect(none.data.narrative).toBeNull();
    expect(applyDraft(data, { narrativeFindings: 'old' }).changes).toEqual([]);
  });
});
