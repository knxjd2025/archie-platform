import { describe, it, expect } from 'vitest';
import { applyReplacementPricing } from '../estimate-replacement';
import { ROOFING_PRODUCTS, commercialAsProduct } from '../roofing-products';
import { COMMERCIAL_PRODUCTS } from '../commercial-products';
import { commercialSnapshot } from '../commercial-context';
import { buildSceneFor, buildScenes, roofBuildOpener, surfaceFor } from '../sections/roof-build-opener';
import { renderProposalScrollcraftHtml } from '../render-proposal-scrollcraft';
import { renderPresentationScrollcraftHtml } from '../render-presentation-scrollcraft';
import { renderEstimateHtml } from '../render-estimate-html';
import { renderInspectionHtml } from '../render-inspection-html';
import { renderCommercialProposalHtml } from '../render-commercial-proposal';
import { renderCommercialPresentationHtml } from '../render-commercial-presentation';
import { renderCommercialInspectionHtml } from '../render-commercial-inspection-html';
import { withProfile } from '../../../tenant/context';
import { BARE_PROFILE, CREDENTIALED_PROFILE, FORMER_COMPANY } from './profiles';

const base = (): any => ({
  id: 'r', generatedAt: '2026-09-14T12:00:00.000Z', version: '2.0',
  property: { address: '2 Test Ave', city: 'Springfield', state: 'IL', latitude: 39.8, longitude: -89.6 },
  stormHistory: { yearsAnalyzed: 3, searchRadiusMiles: 5, totalEvents: 0, hailEvents: 0, windEvents: 0, tornadoEvents: 0, largestHailInches: 0, highestWindMph: 0, riskLevel: 'low', riskScore: 5, claimPotential: 'low', eventsByYear: {}, recommendedDateOfLoss: null },
  damageAnalysis: { totalPhotosAnalyzed: 0, photosWithDamage: 0, overallSeverity: 'none', roofAge: null, damageTypes: [], aiSummary: '', photos: [] },
  repairEstimate: { lineItems: [], subtotal: 0, multiplierApplied: 1, total: 0, notes: [] },
  inspectorNotes: '', dataQuality: 'verified', dataSources: [],
});
const ctx: any = {
  submissionId: 1, formKind: 'commercial', commercial: true, inspectionType: 'Condition Assessment', jobType: 'retail', recommendation: null,
  damageSummary: 'An aged roof.', approxSquares: 240, inspectorName: 'Sam Rep', signedAt: '2026-09-14T15:00:00.000Z',
  answers: { 'Membrane type': 'TPO', 'Deck type': 'Steel (metal deck)', 'Roof area (sq ft)': 24000 },
};
const home = (tiers: any, selectedTier: any = 'better') => applyReplacementPricing(base(), { tierSelection: tiers, squares: 30, selectedTier });
const building = (tiers: any, selectedTier: any = 'better') =>
  applyReplacementPricing({ ...base(), commercial: commercialSnapshot(ctx) }, { tierSelection: tiers, squares: 240, selectedTier, isoTier: 'r25' });
const visuals = (s: { steps: Array<{ visual: string }> }) => s.steps.map((x) => x.visual);
const count = (html: string, needle: string) => html.split(needle).length - 1;

describe('a scene for every product offered', () => {
  it('draws a house for every residential product and a flat-roof building for every commercial one', () => {
    for (const p of ROOFING_PRODUCTS.filter((x) => (x.category as string) !== 'service')) {
      const s = buildSceneFor(p, { commercial: false });
      expect(s.kind, p.name).toBe('house');
      expect(visuals(s).slice(0, 3), p.name).toEqual(['protect', 'tear-off', 'deck']);
      expect(visuals(s), p.name).toContain('field');
    }
    for (const c of COMMERCIAL_PRODUCTS) {
      const s = buildSceneFor(commercialAsProduct(c.key)!, { commercial: true });
      expect(s.kind, c.name).toBe('flat');
      expect(visuals(s).includes('tear-off'), c.name).toBe(c.system === 'tear_off');
      expect(visuals(s).some((v) => v === 'membrane' || v === 'coating'), c.name).toBe(true);
    }
  });

  it('finishes each product in the right material', () => {
    const of = (key: string) => surfaceFor(ROOFING_PRODUCTS.find((p) => p.key === key)!, 'house');
    expect(of('landmark_pro')).toBe('shingle');
    expect(of('standing_seam_metal')).toBe('standing-seam');
    expect(of('stone_coated_steel')).toBe('stone-coated');
    expect(of('cedur_shake')).toBe('shake');
    expect(of('davinci_shake')).toBe('slate');
    expect(surfaceFor(commercialAsProduct('restoration_coating')!, 'flat')).toBe('coating');
  });
});

describe('the opener on the page', () => {
  const tiers = { good: 'landmark', better: 'standing_seam_metal', best: 'davinci_shake' };
  const comTiers = { good: 'restoration_coating', better: 'dura_last_layover', best: 'gaf_commercial_tpo' };
  const render = (): Array<[string, string, 'house' | 'flat']> => [
    ['proposal', renderProposalScrollcraftHtml(home(tiers), { customer: 'Pat Jones' }), 'house'],
    ['presentation', renderPresentationScrollcraftHtml(home(tiers), { customer: 'Pat Jones' }), 'house'],
    ['estimate', renderEstimateHtml(home(tiers), { customer: 'Pat Jones' }), 'house'],
    ['inspection', renderInspectionHtml(base(), {}), 'house'],
    ['commercial proposal', renderCommercialProposalHtml(building(comTiers), { customer: 'Acme Holdings', inspection: ctx }), 'flat'],
    ['commercial presentation', renderCommercialPresentationHtml(building(comTiers), { customer: 'Acme Holdings', inspection: ctx }), 'flat'],
    ['commercial inspection', renderCommercialInspectionHtml({ ...base(), commercial: commercialSnapshot(ctx) }, { inspection: ctx }), 'flat'],
  ];

  it('opens every document once, with the right building, as a drawing', () => {
    for (const [name, html, kind] of withProfile(CREDENTIALED_PROFILE, render)) {
      expect(count(html, '<div class="rbo rbo--static" data-rbo'), name).toBe(1);
      expect(html, name).toContain(kind === 'house' ? 'Drawing of a house' : 'Drawing of a flat-roof building');
      const opener = html.slice(html.indexOf('<div class="rbo rbo--static"'), html.indexOf('<div class="rbo__bar"'));
      expect(opener, name).toContain('Illustration only, not to scale.');
      expect(opener, name).not.toContain('<video');
      const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
      for (const ref of opener.matchAll(/url\(#([^)]+)\)/g)) expect(ids, `${name} ${ref[1]}`).toContain(ref[1]);
    }
  });

  it('carries the company\'s own logo, or its name when it has none, and never another company\'s', () => {
    const o = { docLabel: 'Roof Replacement Proposal', mode: 'options' } as const;
    const withLogo = withProfile(CREDENTIALED_PROFILE, () => roofBuildOpener(home(tiers), o));
    expect(withLogo).toContain('src="https://shingle.test/logo.png"');
    const bare = withProfile(BARE_PROFILE, () => roofBuildOpener(home(tiers), o));
    expect(bare).not.toContain('rbo__logo" src');
    expect(bare).toContain('<p class="rbo__co">Bare Roofing</p>');
    expect(bare).not.toMatch(FORMER_COMPANY);
    expect(withLogo).not.toMatch(FORMER_COMPANY);
  });

  it('offers a scene per differing option, one on an estimate, none without a new roof', () => {
    expect(buildScenes(home(tiers, 'good'), 'options').map((s) => s.surface)).toEqual(['shingle', 'standing-seam', 'slate']);
    expect(buildScenes(home(tiers), 'selected').map((s) => s.surface)).toEqual(['standing-seam']);
    expect(withProfile(BARE_PROFILE, () => roofBuildOpener(base(), { docLabel: 'Roof Repair Estimate', mode: 'selected' }))).toBe('');
  });

  it('escapes what a rep typed', () => {
    const html = withProfile(BARE_PROFILE, () => roofBuildOpener(home(tiers), { docLabel: 'Roof Replacement Proposal', customer: '<script>alert(1)</script>', mode: 'options' }));
    expect(html).not.toContain('<script>alert(1)</script>');
  });
});

describe('the details a roofer would look for', () => {
  const pro = ROOFING_PRODUCTS.find((p) => p.key === 'landmark_pro')!;
  const house = roofBuildOpener(applyReplacementPricing(base(), { tierSelection: { good: 'landmark', better: 'landmark_pro', best: 'landmark_premium' }, squares: 30, selectedTier: 'better' }), { docLabel: 'Roof Replacement Estimate', mode: 'selected' });

  it('builds crickets behind the chimney and skylight, after the deck check and before anything covers them', () => {
    const order = visuals(buildSceneFor(pro, { commercial: false }));
    expect(order.indexOf('cricket')).toBe(order.indexOf('deck') + 1);
    expect(order.indexOf('cricket')).toBeLessThan(order.indexOf('underlayment'));
    expect(house).toContain('Crickets behind the chimney and skylight.');
  });

  it('runs the starter up the rakes as well as along the eave', () => {
    expect(house).toContain('-clip-starter"');
    expect(house).toContain('-clip-starter-rake"');
  });

  it('puts the leak barrier around the chimney, skylight and pipe as well as the eave', () => {
    expect(house).toContain('-clip-ice"');
    const around = house.slice(house.indexOf('rbo-l--ice2'), house.indexOf('rbo-l--under'));
    expect(count(around, '<rect')).toBeGreaterThanOrEqual(2);
    expect(around).toContain('<circle');
  });

  it('walks a commercial tear-off from set-up to the final check, in the order the work happens', () => {
    const order = visuals(buildSceneFor(commercialAsProduct('gaf_commercial_tpo')!, { commercial: true }));
    expect(order).toEqual(['setup', 'tear-off', 'deck', 'vapor', 'insulation', 'taper', 'cover-board', 'attachment', 'membrane', 'seams', 'accessories', 'edge-metal', 'walkway', 'final', 'clean-up']);
  });

  it('never slopes boards under a layover or a coating, where no insulation goes down', () => {
    expect(visuals(buildSceneFor(commercialAsProduct('dura_last_layover')!, { commercial: true }))).not.toContain('taper');
    const coating = visuals(buildSceneFor(commercialAsProduct('restoration_coating')!, { commercial: true }));
    expect(coating).toEqual(['setup', 'prep', 'coating', 'final', 'clean-up']);
  });

  it('makes no promise on a roofing company\'s behalf in the new commercial steps', () => {
    const said = buildSceneFor(commercialAsProduct('gaf_commercial_tpo')!, { commercial: true }).steps;
    const text = said.filter((x) => ['setup', 'taper', 'seams', 'final'].includes(x.visual)).map((x) => x.title + ' ' + x.body).join(' ');
    expect(text).not.toMatch(/warrant|guarantee|tenant/i);
  });
});

describe('valleys', () => {
  it('gives the house a dormer so there are valleys, and runs the leak barrier down them', () => {
    const html = roofBuildOpener(applyReplacementPricing(base(), { tierSelection: { good: 'landmark', better: 'landmark_pro', best: 'landmark_premium' }, squares: 30, selectedTier: 'better' }), { docLabel: 'Roof Replacement Estimate', mode: 'selected' });
    const around = html.slice(html.indexOf('rbo-l--ice2'), html.indexOf('rbo-l--under'));
    expect(around).toMatch(/<path d="M[\d. ]+L[\d. ]+L[\d. ]+" fill="none" stroke="#22262b"/);
  });
});
