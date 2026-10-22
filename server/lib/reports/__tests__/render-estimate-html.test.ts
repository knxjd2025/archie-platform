import { describe, it, expect } from 'vitest';
import { renderEstimateHtml } from '../render-estimate-html';
import { generateEstimateFromDamageAnalysis } from '../roof-repair-pricing';

const summary = generateEstimateFromDamageAnalysis([{ type: 'missing_shingles', count: 1 }]);

const report: any = {
  id: 'r1',
  generatedAt: '2026-09-06T00:00:00Z',
  property: { address: '550 Manning Dr', city: 'Springfield', state: 'IL', zip: '62701' },
  damageAnalysis: { totalPhotosAnalyzed: 1, photos: [] },
  repairEstimate: { lineItems: summary.lineItems, total: summary.subtotalFinal, notes: [] },
};

describe('renderEstimateHtml — inspection-form wiring', () => {
  it('shows the adjuster line and an Insurance Claim eyebrow for an insurance job', () => {
    const html = renderEstimateHtml(report, { jobType: 'insurance' });
    expect(html).toContain('Insurance Claim');
    expect(html).toContain('adjuster');
  });

  it('omits the adjuster line for a retail job', () => {
    const html = renderEstimateHtml(report, { jobType: 'retail' });
    expect(html).not.toContain('adjuster');
  });

  it('omits both when jobType is unknown (no submitted inspection yet)', () => {
    const html = renderEstimateHtml(report, {});
    expect(html).not.toContain('adjuster');
  });

  it('flags a "Full replacement" field recommendation against this repair-only document', () => {
    const html = renderEstimateHtml(report, { recommendation: 'Full replacement' });
    expect(html).toContain('full replacement');
    expect(html).toContain('Proposal or Presentation');
  });

  it('says nothing when the recommendation is anything else', () => {
    const html = renderEstimateHtml(report, { recommendation: 'Repair only' });
    expect(html).not.toContain('Proposal or Presentation');
  });

  it('leaves out the "Our Work" map until the company has a project feed', () => {
    const html = renderEstimateHtml(report, {});
    expect(html).not.toContain('See Our Work Near You');
    expect(html).not.toMatch(/<div class="work-map-wrap"/);
  });

  // Caught on the real production link at a real 390px viewport: the Scope
  // of Work / What This Covers tables have no responsive handling, so their
  // natural content width (4 columns) pushed the whole page 8px past the
  // phone's viewport edge — documentElement.scrollWidth (398) exceeded
  // innerWidth (390). Fixed in report-theme.ts's shared `table` rule
  // (display:block + overflow-x:auto turns the table itself into a
  // horizontal-scroll container instead of widening the page), so this only
  // asserts the rule is present — the real regression was confirmed
  // visually against a live-fetched copy of the actual served HTML.
  it('makes wide tables horizontally scrollable instead of widening the page on narrow viewports', () => {
    const html = renderEstimateHtml(report, {});
    expect(html).toMatch(/table\{[^}]*display:block;overflow-x:auto/);
  });
});

describe('the printed numbers reconcile', () => {
  // A homeowner or an adjuster adds the Total column up by hand. Rounding each
  // line and the footer independently let them disagree: $577.50 and $742.50
  // printed as $578 + $743 = $1,321 under a stated total of $1,320.
  const twoLines: any = {
    ...report,
    repairEstimate: {
      lineItems: [
        { repairName: 'Shingle replacement', quantity: 1, unit: 'sq', finalCostPerUnit: 577.5, totalFinalCost: 577.5 },
        { repairName: 'Full roof replacement', quantity: 1, unit: 'sq', finalCostPerUnit: 742.5, totalFinalCost: 742.5 },
      ],
      total: 1320,
      notes: [],
    },
  };

  it('prints line amounts that sum to the printed total', () => {
    const html = renderEstimateHtml(twoLines, {});
    expect(html).toContain('$577.50');
    expect(html).toContain('$742.50');
    expect(html).toContain('$1,320.00');
    // The half-dollar amounts must not be rounded away into a mismatch.
    expect(html).not.toContain('$578<');
    expect(html).not.toContain('$743<');
  });
});
