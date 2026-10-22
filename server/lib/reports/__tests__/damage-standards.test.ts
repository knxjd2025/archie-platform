import { describe, it, expect } from 'vitest';
import { PRICING_DAMAGE_TYPES } from '../damage-type-map';
import { standardsFor, printableRefs, renderStandardsFootnote, standardsReviewSheet, ALL_STANDARDS_TYPES, type StandardRef } from '../damage-standards';
import { renderInspectionHtml } from '../render-inspection-html';
import { renderProposalScrollcraftHtml } from '../render-proposal-scrollcraft';
import { applyReplacementPricing } from '../estimate-replacement';
import type { TierSelection } from '../roofing-products';

const finding = (type: string, severity = 'high') => ({
  id: `f-${type}`, type, label: type, severity, confidence: 0.9, description: 'x', location: 'north slope',
});

const reportWith = (types: string[]): any => ({
  id: 'r-std', generatedAt: '2026-09-14T12:00:00.000Z', version: '2.0',
  property: { address: '1 Test St', city: 'Springfield', state: 'IL', latitude: 35.2, longitude: -80.8 },
  stormHistory: { yearsAnalyzed: 3, searchRadiusMiles: 5, totalEvents: 0, hailEvents: 0, windEvents: 0, tornadoEvents: 0, riskLevel: 'low', riskScore: 0, claimPotential: 'none', eventsByYear: {} },
  damageAnalysis: {
    totalPhotosAnalyzed: types.length, photosWithDamage: types.length, overallSeverity: 'high', roofAge: null, damageTypes: [],
    aiSummary: 'We found damage.',
    photos: types.map((t, i) => ({ id: `p${i}`, url: `https://example.invalid/${t}.jpg`, damages: [finding(t)], overallSeverity: 'high', aiSummary: 'ok', analyzedAt: 'now' })),
  },
  repairEstimate: { lineItems: [], subtotal: 0, multiplierApplied: 1, total: 0, notes: [] },
  inspectorNotes: '', dataQuality: 'verified', dataSources: [],
});

describe('damage standards', () => {
  it('has a why-it-matters and at least one code reference for every pricing damage type', () => {
    for (const t of PRICING_DAMAGE_TYPES) {
      const s = standardsFor(t);
      expect(s.whyItMatters.length, t).toBeGreaterThan(80);
      expect(s.codeRefs.length, t).toBeGreaterThan(0);
      for (const r of [...s.codeRefs, ...s.manufacturerRefs]) {
        expect(r.cite, t).toBeTruthy();
        expect(r.title, t).toBeTruthy();
        expect(r).toHaveProperty('verifiedOn');
      }
    }
    expect(new Set(ALL_STANDARDS_TYPES)).toEqual(new Set(PRICING_DAMAGE_TYPES));
  });

  it('never claims a general contractor license', () => {
    for (const t of PRICING_DAMAGE_TYPES) {
      expect(standardsFor(t).whyItMatters).not.toMatch(/general contractor|GC licen/i);
    }
  });

  it('a draft citation (verifiedOn null) is not printable; a verified one is', () => {
    const drafted: StandardRef = { cite: 'R905.2.8.5', title: 'Drip edge', verifiedOn: null };
    const verified: StandardRef = { ...drafted, verifiedOn: '2026-09-14' };
    expect(printableRefs([drafted])).toEqual([]);
    expect(printableRefs([verified])).toEqual([verified]);
  });

  it('the review sheet lists every distinct citation with the findings that use it', () => {
    const sheet = standardsReviewSheet();
    expect(sheet.length).toBeGreaterThan(10);
    const dripEdge = sheet.find((r) => r.cite === 'R905.2.8.5');
    expect(dripEdge?.usedBy).toContain('fascia_damage');
  });
});

describe('what a customer document shows', () => {
  const inspection = renderInspectionHtml(reportWith(['chimney_flashing_damage', 'pipe_boot_cracked']) as any, { customer: 'Test' } as any);

  it('the inspection never prints generated finding explanations', () => {
    // "Why it matters" was written for vision findings; the Inspection is the
    // inspector's record and carries no findings the inspector did not enter.
    expect(inspection).not.toContain('Why it matters:');
    expect(inspection).not.toContain('cricket behind any chimney wider than 30 inches');
  });

  it('prints NO code section numbers while every citation is still a draft', () => {
    // Every citation ships unverified. Until a person sets verifiedOn, none
    // of these strings may reach a customer or an adjuster.
    for (const cite of ['R905.2.8.3', 'R903.2.1', 'R905.2.8.5', 'R806.2', 'Shingle Applicator']) {
      expect(inspection).not.toContain(cite);
    }
    expect(renderStandardsFootnote('chimney_flashing_damage', 'muted')).toBe('');
  });

  it('the proposal gains "The Findings, Explained" with one card per condition, and drops it when there are none', () => {
    const tiers = { good: 'landmark', better: 'landmark_pro', best: 'landmark_presidential' } as TierSelection;
    const withFindings = applyReplacementPricing(reportWith(['hail_damage', 'hail_damage', 'valley_damage']) as any, { tierSelection: tiers, squares: 30, selectedTier: 'better' });
    const html = renderProposalScrollcraftHtml(withFindings, { customer: 'Test' });
    expect(html).toContain('id="ch-findings"');
    expect(html).toContain('The Findings, Explained');
    // Two hail findings collapse into one card that says so.
    expect(html.match(/class="fx-card"/g)?.length).toBe(2);
    expect(html).toContain('2 places');
    expect(html).toContain('href="#ch-findings"');
    expect(html).not.toContain('{{CH}}');

    const none = applyReplacementPricing(reportWith([]) as any, { tierSelection: tiers, squares: 30, selectedTier: 'better' });
    const bare = renderProposalScrollcraftHtml(none, { customer: 'Test' });
    expect(bare).not.toContain('id="ch-findings"');
    expect(bare).not.toContain('href="#ch-findings"');
  });
});
