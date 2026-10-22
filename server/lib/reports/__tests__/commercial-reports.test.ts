import { describe, it, expect } from 'vitest';
import { renderCommercialInspectionHtml, commercialInspectionSections } from '../render-commercial-inspection-html';
import { renderCommercialProposalHtml, commercialProposalSections } from '../render-commercial-proposal';
import { renderCommercialPresentationHtml, commercialPresentationSectionList } from '../render-commercial-presentation';
import { renderPresentationScrollcraftHtml } from '../render-presentation-scrollcraft';
import { renderEstimateHtml } from '../render-estimate-html';
import { renderInspectionHtml } from '../render-inspection-html';
import { applyReplacementPricing } from '../estimate-replacement';
import { commercialSnapshot, isCommercialReport, commercialContextOf } from '../commercial-context';
import { existingAssembly, conditionMatrix, reroofPath, drainageAndMoisture } from '../sections/commercial-facts';
import { DOCUMENT_STYLE } from '../sections/style';
import { commercialStandardsReviewSheet } from '../commercial-standards';

const answers = (over: Record<string, any> = {}): Record<string, any> => ({
  'Inspection Date': '2026-09-14', 'Inspector Name': 'Sam Rep', 'Inspection Type': 'Condition Assessment', 'How was the roof accessed?': 'Walked the roof',
  'Building type / use': 'Warehouse / Industrial', 'Roof area (sq ft)': 24000, 'Roof slope': '1/4:12', 'Parapet walls': 'Full perimeter, under 42 in',
  'Deck type': 'Steel (metal deck)', 'Deck condition': 'Good', 'Vapor retarder': 'None seen',
  'Insulation type': 'Polyiso', 'Insulation thickness (in)': 2, 'Insulation attachment': 'Mechanically fastened', 'Cover board': 'None',
  'Membrane type': 'TPO', 'Membrane thickness / plies': '45 mil', 'Membrane attachment': 'Mechanically attached', 'Surfacing': 'None (smooth)',
  'Number of roof systems in place': '1', 'Estimated age of current roof (years)': 17, 'Core cut taken': 'Yes',
  'Core cut findings': '45 mil TPO over 2 in polyiso, dry at the cut, steel deck',
  'Membrane field condition': 'Poor', 'Seams and laps': 'Poor', 'Base flashings (walls and curbs)': 'Fair', 'Perimeter edge metal (fascia, gravel stop, drip edge)': 'Poor',
  'Penetrations (pipes, pitch pockets, conduits)': 'Failed', 'Drains and strainers': 'Fair', 'Expansion joints': 'N/A',
  'Condition notes by area': 'North half: seams lifting along every field lap. Pitch pockets at the two gas lines have sunk and cracked.',
  'Ponding observed': 'Moderate — 1/4 to 1 in, or slow to drain', 'Ponding locations and approximate area': 'NE corner near RTU-3, about 300 sq ft',
  'Number of roof drains': 6, 'Overflow / secondary drainage present': 'Yes', 'Drains clear with strainers in place': 'Partially',
  'Moisture survey performed': 'Infrared (IR) scan', 'Estimated wet insulation (% of roof area)': 0, 'Active leaks reported by the owner': 'Yes',
  'Interior evidence': 'Two ceiling stains under RTU-3',
  'Overall condition summary': 'A 17-year-old mechanically attached TPO roof with failing seams and pitch pockets; dry insulation, one system in place.',
  'Fall protection present': 'None', 'Full photo package complete': 'Yes', 'Inspector Signature': 'Sam Rep',
  ...over,
});

const ctx = (over: Record<string, any> = {}, recommendation: string | null = null): any => ({
  submissionId: 1, formKind: 'commercial', commercial: true, inspectionType: 'Condition Assessment', jobType: 'retail',
  recommendation, damageSummary: answers(over)['Overall condition summary'], approxSquares: 240, inspectorName: 'Sam Rep', signedAt: '2026-09-14T15:00:00.000Z',
  answers: answers(over),
});

const report = (): any => ({
  id: 'r-com', generatedAt: '2026-09-14T12:00:00.000Z', version: '2.0',
  property: { address: '400 Warehouse Way', city: 'Charlotte', state: 'NC', latitude: 35.2, longitude: -80.8 },
  stormHistory: { yearsAnalyzed: 3, searchRadiusMiles: 5, totalEvents: 0, hailEvents: 0, windEvents: 0, tornadoEvents: 0, largestHailInches: 0, highestWindMph: 0, riskLevel: 'low', riskScore: 5, claimPotential: 'low', eventsByYear: {}, recommendedDateOfLoss: null },
  damageAnalysis: { totalPhotosAnalyzed: 0, photosWithDamage: 0, overallSeverity: 'none', roofAge: null, damageTypes: [], aiSummary: '', photos: [] },
  repairEstimate: { lineItems: [], subtotal: 0, multiplierApplied: 1, total: 0, notes: [] },
  inspectorNotes: '', dataQuality: 'verified', dataSources: [],
});

const priced = (over: Record<string, any> = {}) => {
  const c = ctx(over);
  const base = { ...report(), commercial: commercialSnapshot(c) };
  return { report: applyReplacementPricing(base, { tierSelection: { good: 'dura_last_layover', better: 'dura_last_tpo', best: 'gaf_commercial_tpo' }, squares: 240, selectedTier: 'better', isoTier: 'r25' }), ctx: c };
};

describe('the commercial sections', () => {
  it('draw the assembly top to bottom and rate every component worst first', () => {
    const asm = existingAssembly(ctx(), DOCUMENT_STYLE);
    expect(asm.indexOf('cf-layer--mem')).toBeLessThan(asm.indexOf('cf-layer--deck')); // membrane drawn above the deck
    expect(asm).toContain('TPO — 45 mil');
    expect(asm).toContain('Polyiso insulation, 2 in');
    expect(asm).toContain('What the core cut showed');
    const cond = conditionMatrix(ctx(), DOCUMENT_STYLE);
    expect(cond.indexOf('Penetrations')).toBeLessThan(cond.indexOf('Base flashings')); // Failed before Fair
    expect(cond).toContain('cf-rating--failed');
    expect(cond).not.toContain('Expansion joints'); // N/A hidden
    expect(drainageAndMoisture(ctx(), DOCUMENT_STYLE)).toContain('Why ponding matters');
  });

  it('decides the path from the findings and shows what is still open', () => {
    const recover = reroofPath(ctx(), DOCUMENT_STYLE);
    expect(recover.determination!.path).toBe('recover');
    expect(recover.html).toContain('cf-path--recover');
    const replace = reroofPath(ctx({ 'Number of roof systems in place': '2' }, 'Full replacement (tear-off)'), DOCUMENT_STYLE);
    expect(replace.html).toContain('cf-path--replace');
    expect(replace.html).toContain('building code'); // the code-tagged reason
    expect(replace.html).toContain('Reviewed recommendation: Full replacement (tear-off)');
    expect(replace.html).not.toContain('1511'); // citations gated until verified
    expect(commercialStandardsReviewSheet().every((r) => r.verifiedOn === null)).toBe(true);
  });
});

describe('the commercial condition report', () => {
  it('is a different document from the residential inspection', () => {
    const { report: r, ctx: c } = priced();
    const html = renderCommercialInspectionHtml(r, { jobType: 'retail', inspection: c });
    expect(html).toContain('Commercial Roof Condition Report');
    expect(html).toContain('Executive Summary');
    expect(html).toContain('24,000');
    expect(html).toContain('What Is On the Roof');
    expect(html).toContain('Component by Component'.replace('Component by Component', 'Condition Assessment'));
    expect(html).toContain('Where the Water Goes'.replace('Where the Water Goes', 'Drainage &amp; Moisture'));
    expect(html).toContain('Restore, recover, or replace');
    expect(html).toContain('Keeping This Roof');
    expect(html).not.toContain('Attic Ventilation');
    expect(html).not.toContain('Roof Age &amp; Remaining Life');
    expect(html).not.toContain('SureStart');
    const keys = commercialInspectionSections(r, { inspection: c }).map((s) => s.key);
    expect(keys).toContain('assembly');
    expect(keys).toContain('path');
    expect(keys).toContain('safety');
  });

  it('re-renders from the stored snapshot when the live checklist is not passed', () => {
    const { report: r } = priced();
    expect(isCommercialReport(r)).toBe(true);
    expect(commercialContextOf(r)!.answers!['Membrane type']).toBe('TPO');
    const html = renderCommercialInspectionHtml(r, {});
    expect(html).toContain('TPO — 45 mil');
    // and a residential report is untouched
    const res = renderInspectionHtml(report(), { jobType: 'retail' });
    expect(res).not.toContain('cf-stack');
    expect(isCommercialReport(report())).toBe(false);
  });
});

describe('the commercial proposal', () => {
  it('leads with the roof, the condition, the water and the decision, then prices it', () => {
    const { report: r, ctx: c } = priced();
    const html = renderCommercialProposalHtml(r, { customer: 'Warehouse LLC', inspection: c });
    // Chapter headings in body order (the folio nav lists every label first, so search the body only).
    const body = html.slice(html.indexOf('<main'));
    const order = ['The Short Version', 'Your Roof Today', 'Component by Component', 'Where the Water Goes', 'Restore, Recover, or Replace', 'Your Options', 'The Investment', 'How the Job Runs', 'Keeping the New Roof'];
    let last = -1;
    for (const h of order) { const i = body.indexOf(`>${h}</h2>`); expect(i, h).toBeGreaterThan(last); last = i; }
    expect(html).toContain('Duro-Last&reg; PVC Roofing Membrane'); // the selected tier's walkthrough
    expect(html).toContain('includes R-25 ISO Insulation');
    expect(html).not.toContain('Integrity Roof System');
    expect(html).not.toContain('homeowner');
    const keys = commercialProposalSections(r, { inspection: c }).map((s) => s.key);
    expect(keys.slice(0, 6)).toEqual(['welcome', 'summary', 'roof-today', 'condition', 'water', 'fix']);
  });

  it('the estimate carries the existing-roof section on a commercial job only', () => {
    const { report: r, ctx: c } = priced();
    const html = renderEstimateHtml(r, { customer: 'Warehouse LLC', inspection: c });
    expect(html).toContain('The Existing Roof');
    expect(html).toContain('cf-layer--mem');
    const residential = renderEstimateHtml(applyReplacementPricing(report(), { tierSelection: { good: 'landmark', better: 'landmark_pro', best: 'landmark_premium' }, squares: 30, selectedTier: 'better' }), { customer: 'T' });
    expect(residential).not.toContain('The Existing Roof');
  });
});

describe('the commercial presentation', () => {
  it('walks the roof, the condition, the water and the decision before the options, numbered in order', () => {
    const { report: r, ctx: c } = priced();
    const html = renderCommercialPresentationHtml(r, { customer: 'Warehouse LLC', rep: 'Sam Rep', inspection: c });
    const body = html.slice(html.indexOf('<main'));
    const order = ['The Short Version', 'Your Roof Today', 'Component by Component', 'Where the Water Goes', 'Restore, Recover, or Replace', 'What We Found On Your Roof', 'How the Job Runs', 'Your Options', 'The Investment', 'Keeping the New Roof'];
    let last = -1;
    for (const h of order) { const i = body.indexOf(`>${h}</h2>`); expect(i, h).toBeGreaterThan(last); last = i; }
    expect(html).toContain('Presented by Sam Rep');
    expect(html).toContain('cf-layer--mem');
    expect(html).toContain('Duro-Last&reg; PVC Roofing Membrane');
    expect(html).not.toContain('Attic Ventilation');
    expect(html).not.toContain('Integrity Roof System');
    expect(html).not.toContain('homeowner');
    // "Chapter N" labels count up without a gap
    const nums = [...body.matchAll(/<p class="sc-label">Chapter (\d+)/g)].map((m) => Number(m[1]));
    expect(nums.length).toBeGreaterThan(12);
    expect(nums).toEqual(nums.map((_, i) => i + 1));
    const keys = commercialPresentationSectionList(r, { inspection: c }).map((s) => s.key);
    expect(keys.slice(0, 6)).toEqual(['welcome', 'summary', 'roof-today', 'condition', 'water', 'fix']);
    expect(keys).toContain('maintenance');
    // the residential deck is untouched
    const res = renderPresentationScrollcraftHtml(applyReplacementPricing(report(), { tierSelection: { good: 'landmark', better: 'landmark_pro', best: 'landmark_premium' }, squares: 30, selectedTier: 'better' }), { customer: 'T' });
    expect(res).not.toContain('cf-stack');
  });
});

describe('commercial documents never talk to a homeowner', () => {
  const residential = /your home|old shingles|need to be home|homeowners|change my color/i;
  it('proposal, presentation, condition report and estimate use building-owner copy', () => {
    const { report: r, ctx: c } = priced();
    const pres = renderCommercialPresentationHtml(r, { customer: 'Warehouse LLC', rep: 'Sam Rep', inspection: c });
    const prop = renderCommercialProposalHtml(r, { customer: 'Warehouse LLC', inspection: c });
    const insp = renderCommercialInspectionHtml(r, { customer: 'Warehouse LLC', inspection: c } as any);
    const est = renderEstimateHtml(r, { customer: 'Warehouse LLC', inspection: c });
    for (const html of [pres, prop, insp, est]) {
      expect(html).not.toMatch(residential);
      expect(html).not.toContain('HFS Financial');
    }
    expect(pres).toContain("We treat your building exactly like it's our own family's.");
    expect(pres).toContain('Questions Building Owners Ask');
    expect(pres).toContain('One decision left, Warehouse LLC.');
    expect(prop).toContain('One decision left, Warehouse LLC.');
    expect(est).not.toContain('<h2>Financing</h2>');
    // the residential documents keep their own voice
    const res = renderPresentationScrollcraftHtml(applyReplacementPricing(report(), { tierSelection: { good: 'landmark', better: 'landmark_pro', best: 'landmark_premium' }, squares: 30, selectedTier: 'better' }), { customer: 'Pat Jones' });
    expect(res).toContain("We treat your home exactly like it's our own family's.");
    expect(res).toContain('One decision left, Pat.');
  });
});

describe('the Investment chapter follows the tapped tier', () => {
  it('marks the number, the lede and the scope table so the page script can rewrite them', () => {
    const { report: r, ctx: c } = priced();
    const withScope: any = { ...r, repairEstimate: { ...r.repairEstimate, lineItems: [
      ...(r.repairEstimate?.lineItems ?? []),
      { repairTypeId: 'scope_custom_0', repairName: 'Replace wet insulation at NE corner', quantity: 3, unit: 'sq', baseCostPerUnit: 400, finalCostPerUnit: 400, totalFinalCost: 1200, scope: { catalogId: null, description: 'Cut out and replace the 300 sq ft the IR scan found wet.', requirement: 'code' } },
    ] } };
    const html = renderCommercialPresentationHtml(withScope, { customer: 'Warehouse LLC', inspection: c });
    expect(html).toContain('data-roof="');
    expect(html).toContain('data-inv-tier-name>Duro-Last Commercial PVC (tear-off)<');
    expect(html).toContain('data-scope-roof-label');
    expect(html).toContain('data-scope-roof-total');
    expect(html).toContain('data-scope-grand-total');
    expect(html).toContain('followTier(card)');
    expect(html).not.toContain('var invTarget = Number(invCount.dataset.tierTotal) || 0;\n    var invIo'); // the static target is gone
    const prop = renderCommercialProposalHtml(withScope, { customer: 'Warehouse LLC', inspection: c });
    expect(prop).toContain('followTier(card)');
    expect(prop).toContain('data-scope-grand-total');
  });
});

describe('Best Roofing Now on every commercial document', () => {
  const LOGO = 'https://reports.bestroofersnow.com/assets/brn/logo.png';
  it('the logo on the cover, the company chapter and the roof words, on all three', () => {
    const { report: r, ctx: c } = priced();
    const docs = {
      inspection: renderCommercialInspectionHtml(r, { jobType: 'retail', inspection: c }),
      proposal: renderCommercialProposalHtml(r, { customer: 'Warehouse LLC', inspection: c }),
      presentation: renderCommercialPresentationHtml(r, { customer: 'Warehouse LLC', rep: 'Sam Rep', inspection: c }),
    };
    for (const [name, html] of Object.entries(docs)) {
      const body = html.slice(html.indexOf('<body'));
      expect(body.indexOf(LOGO), name).toBeGreaterThan(-1);
      expect(body.indexOf(LOGO), `${name}: logo before the first chapter`).toBeLessThan(body.indexOf('<h2'));
      expect(html, name).toContain('>Why Building Owners Choose Us</h2>');
      expect(html, name).toContain('>Roof Words, Made Simple</h2>');
      expect(html, name).toContain('We tell people the truth, even when it is not a sale.');
      expect(html, name).not.toMatch(/your home|homeowner|general contractor/i);
    }
  });
});

describe('the full photo list', () => {
  it('closes the residential and commercial Inspection, just before the footer', async () => {
    const { inspectionSections } = await import('../render-inspection-html');
    const { arrangeSections } = await import('../layout');
    const r = { ...report(), damageAnalysis: { ...report().damageAnalysis, photos: [{ id: 'p1', url: 'https://cdn.example.com/a.jpg', caption: 'North slope', damages: [] }] } };
    for (const sections of [inspectionSections(r, {}), commercialInspectionSections(r, { inspection: ctx() })]) {
      const keys = arrangeSections(sections, { order: ['photos'] }).map((s) => s.key);
      expect(keys.slice(-2)).toEqual(['photos', 'footer']);
    }
  });
});
