import { describe, it, expect } from 'vitest';
import { MOBILE_CSS, MOBILE_JS } from '../mobile';
import { premiumShell } from '../../report-theme';
import { renderPresentationScrollcraftHtml } from '../../render-presentation-scrollcraft';
import { renderProposalScrollcraftHtml } from '../../render-proposal-scrollcraft';
import { renderCommercialPresentationHtml } from '../../render-commercial-presentation';
import { renderCommercialProposalHtml } from '../../render-commercial-proposal';
import { applyReplacementPricing } from '../../estimate-replacement';

const report: any = {
  id: 'r1', generatedAt: '2026-09-06T00:00:00Z',
  property: { address: '550 Manning Dr', city: 'Charlotte', state: 'NC', zip: '28202' },
  damageAnalysis: { totalPhotosAnalyzed: 1, photos: [{ id: 'p1', url: 'https://cdn.example/1.jpg', damages: [{ type: 'hail_damage', severity: 'high', location: 'north slope' }] }] },
  stormHistory: { totalEvents: 0, hailEvents: 0, windEvents: 0, yearsAnalyzed: 3, searchRadiusMiles: 5 },
  repairEstimate: { lineItems: [], total: 0, notes: [] },
};
const residential = applyReplacementPricing(report, { tierSelection: { good: 'tamko_titan_basic', better: 'landmark_pro', best: 'landmark_presidential' }, squares: 30, selectedTier: 'better' });
const commercial = applyReplacementPricing(report, { tierSelection: { good: 'dura_last_layover', better: 'dura_last_tpo', best: 'gaf_commercial_tpo' }, squares: 240, selectedTier: 'better', isoTier: 'r25' });

describe('the phone layer', () => {
  it('rides on every report shell, after the report’s own styles', () => {
    const pages = {
      document: premiumShell({ title: 'T', hero: '<header></header>', body: '<section></section>' }),
      presentation: renderPresentationScrollcraftHtml(residential, {}),
      proposal: renderProposalScrollcraftHtml(residential, {}),
      commercialPresentation: renderCommercialPresentationHtml(commercial, {}),
      commercialProposal: renderCommercialProposalHtml(commercial, {}),
    };
    for (const [name, html] of Object.entries(pages)) {
      expect(html, name).toContain(MOBILE_CSS);
      expect(html, name).toContain(MOBILE_JS);
      // Last stylesheet in <head>, so it wins over the report's own rules at equal specificity.
      expect(html.indexOf(MOBILE_CSS), name).toBeGreaterThan(html.lastIndexOf('<style>', html.indexOf(MOBILE_CSS)) - 1);
      expect(html.slice(html.indexOf(MOBILE_CSS)), name).not.toMatch(/<style>[\s\S]*<\/head>/);
    }
  });

  it('only changes the screen at phone width — print and desktop are untouched', () => {
    const outside = MOBILE_CSS.replace(/@media screen and \(max-width: 640px\) \{[\s\S]*\}\s*$/, '').trim();
    expect(outside).toBe('');
    expect(MOBILE_CSS).not.toContain('@media print');
  });

  it('is a script the browser will run', () => {
    expect(() => new Function(MOBILE_JS)).not.toThrow();
  });
});
