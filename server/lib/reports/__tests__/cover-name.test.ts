import { describe, it, expect } from 'vitest';
import { repairCoverName, COVER_NAME_ATTRS } from '../cover-name';
import { renderProposalScrollcraftHtml } from '../render-proposal-scrollcraft';
import { renderPresentationScrollcraftHtml } from '../render-presentation-scrollcraft';
import { renderCommercialProposalHtml } from '../render-commercial-proposal';
import { renderCommercialPresentationHtml } from '../render-commercial-presentation';
import { applyReplacementPricing } from '../estimate-replacement';
import { commercialSnapshot } from '../commercial-context';

const report = (): any => ({
  id: 'r', generatedAt: '2026-09-14T12:00:00.000Z', version: '2.0',
  property: { address: '1 Test St', city: 'Charlotte', state: 'NC', latitude: 35.2, longitude: -80.8 },
  stormHistory: { yearsAnalyzed: 3, searchRadiusMiles: 5, totalEvents: 0, hailEvents: 0, windEvents: 0, tornadoEvents: 0, largestHailInches: 0, highestWindMph: 0, riskLevel: 'low', riskScore: 5, claimPotential: 'low', eventsByYear: {}, recommendedDateOfLoss: null },
  damageAnalysis: { totalPhotosAnalyzed: 0, photosWithDamage: 0, overallSeverity: 'none', roofAge: null, damageTypes: [], aiSummary: '', photos: [] },
  repairEstimate: { lineItems: [], subtotal: 0, multiplierApplied: 1, total: 0, notes: [] },
  inspectorNotes: '', dataQuality: 'verified', dataSources: [],
});

/**
 * A cue outside an act is never driven, and the engine's stylesheet starts
 * every cue at opacity 0 — so a cover name carrying one is never seen. The
 * cover must enter the way a flow section does.
 */
const coverH1 = (html: string) => html.match(/<h1[^>]*title-name[^>]*>/)?.[0] ?? '';

describe("the customer's name on the cover", () => {
  it('is revealed as a flow element on all four scroll documents, never left waiting on a cue', () => {
    const residential = applyReplacementPricing(report(), { tierSelection: { good: 'landmark', better: 'landmark_pro', best: 'landmark_premium' }, squares: 30, selectedTier: 'better' });
    const ctx: any = { commercial: true, formKind: 'commercial', jobType: 'retail', inspectionType: 'Condition Assessment', recommendation: null, damageSummary: 'x', approxSquares: 240, inspectorName: 'S', signedAt: null, answers: { 'Membrane type': 'TPO', 'Deck type': 'Steel (metal deck)', 'Roof area (sq ft)': 24000 } };
    const commercial = applyReplacementPricing({ ...report(), commercial: commercialSnapshot(ctx) }, { tierSelection: { good: 'dura_last_layover', better: 'dura_last_tpo', best: 'gaf_commercial_tpo' }, squares: 240, selectedTier: 'better' });
    const docs = [
      renderProposalScrollcraftHtml(residential, { customer: 'Pat Jones' }),
      renderPresentationScrollcraftHtml(residential, { customer: 'Pat Jones' }),
      renderCommercialProposalHtml(commercial, { customer: 'Warehouse LLC', inspection: ctx }),
      renderCommercialPresentationHtml(commercial, { customer: 'Warehouse LLC', inspection: ctx }),
    ];
    for (const html of docs) {
      const h1 = coverH1(html);
      expect(h1).toContain(COVER_NAME_ATTRS);
      expect(h1).not.toContain('data-sc-cue');
      // and the cover itself is not an act, which is why a cue could never have worked there
      expect(html.match(/<section[^>]*id="ch-welcome"[^>]*>/)![0]).not.toContain('data-sc-act');
    }
  });

  it('repairs a document stored with the old markup as it is served, and leaves everything else alone', () => {
    const old = '<section class="sc-section ch ch--paper ch--title" id="ch-welcome"><h1 class="sc-display sc-display--xl title-name" data-sc-cue="0 0.85 0" data-sc-kinetic="lines">Pat Jones</h1></section><section data-sc-act="pin"><h2 data-sc-cue="0 1 0">What We Found</h2></section>';
    const fixed = repairCoverName(old);
    expect(fixed).toContain('<h1 class="sc-display sc-display--xl title-name" data-sc-in>Pat Jones</h1>');
    expect(fixed).toContain('<h2 data-sc-cue="0 1 0">What We Found</h2>'); // a cue inside an act still works and is kept
    expect(repairCoverName(fixed)).toBe(fixed);
    const inspection = '<html><body><h1>Roof Inspection</h1></body></html>';
    expect(repairCoverName(inspection)).toBe(inspection);
  });
});
