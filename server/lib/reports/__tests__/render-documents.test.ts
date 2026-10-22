import { describe, it, expect } from 'vitest';
import { renderEstimateHtml } from '../render-estimate-html';
import { generateEstimateFromDamageAnalysis } from '../roof-repair-pricing';

const summary = generateEstimateFromDamageAnalysis([
  { type: 'missing_shingles', count: 1 },
  { type: 'gutter_damage', count: 1 },
]);

const report = (over: any = {}): any => ({
  generatedAt: '2026-09-06T00:00:00Z',
  property: { address: '550 Manning Dr', city: 'Charlotte', state: 'NC' },
  damageAnalysis: {
    totalPhotosAnalyzed: 8,
    aiSummary: 'We reviewed 8 photos.',
    photos: [{
      id: 'photo-0', url: 'https://cdn.example/1.jpg', caption: 'South slope',
      damages: [{ id: 'd0', label: 'Missing shingles', severity: 'high', description: 'Two tabs gone.', location: 'ridge' }],
    }],
  },
  stormHistory: { totalEvents: 20, hailEvents: 1, windEvents: 19, yearsAnalyzed: 3, searchRadiusMiles: 5 },
  repairEstimate: { lineItems: summary.lineItems, total: summary.subtotalFinal, notes: ['Includes markup.'] },
  ...over,
});

describe('renderEstimateHtml', () => {
  const html = renderEstimateHtml(report(), { customer: 'Linda McMillan' });

  it('prices every line — no blank names or $0 rows', () => {
    // The exact defect this replaced: named rows with $0 under a correct total.
    expect(html).toContain('Linda McMillan');
    for (const li of summary.lineItems) {
      expect(html).toContain(li.repairName);
    }
    // Line amounts print with cents so the column sums to the stated total.
    const rowTotals = [...html.matchAll(/<b>\$([\d,]+(?:\.\d{2})?)<\/b>/g)].map((m) => Number(m[1].replace(/,/g, '')));
    expect(rowTotals.length).toBeGreaterThan(0);
    expect(rowTotals.every((n) => n > 0)).toBe(true);
  });

  it('ties the price back to what was seen', () => {
    expect(html).toContain('What This Covers');
    expect(html).toContain('Missing shingles');
  });

  it('says so plainly when there is nothing to price', () => {
    const empty = renderEstimateHtml(report({ repairEstimate: { lineItems: [], total: 0 } }));
    expect(empty).toContain('No repair items were identified');
    expect(empty).not.toContain('Estimated Total');
  });

  it('escapes customer-controlled text', () => {
    const evil = renderEstimateHtml(report(), { customer: '<script>alert(1)</script>' });
    expect(evil).not.toContain('<script>alert(1)</script>');
  });
});

// renderPresentationHtml (the fixed-slide deck) was replaced by the
// scroll-craft rebuild — see render-presentation-scrollcraft.test.ts.
