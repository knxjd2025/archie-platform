import { describe, it, expect } from 'vitest';
import { renderPresentationScrollcraftHtml } from '../render-presentation-scrollcraft';
import { applyReplacementPricing } from '../estimate-replacement';
import { usd } from '../report-theme';
import { withProfile } from '../../../tenant/context';
import { TEST_PROFILE } from '../../../__tests__/helpers/tenant';
import { FORMER_COMPANY } from './profiles';

const baseReport: any = {
  id: 'r1',
  generatedAt: '2026-09-06T00:00:00Z',
  property: { address: '550 Manning Dr', city: 'Springfield', state: 'IL', zip: '62701' },
  damageAnalysis: {
    totalPhotosAnalyzed: 3,
    photos: [
      { id: 'p1', url: 'https://cdn.example/1.jpg', damages: [{ type: 'hail_damage', severity: 'high', location: 'north slope' }] },
      { id: 'p2', url: 'https://cdn.example/clean.jpg', damages: [] },
      { id: 'p3', url: 'https://cdn.example/3.jpg', damages: [{ type: 'missing_shingles', severity: 'critical', location: 'ridge' }] },
    ],
  },
  stormHistory: { totalEvents: 2, hailEvents: 1, windEvents: 1, yearsAnalyzed: 3, searchRadiusMiles: 5 },
  repairEstimate: { lineItems: [], total: 0, notes: [] },
};

const tiers = { good: 'tamko_titan_basic', better: 'landmark_pro', best: 'landmark_presidential' } as const;

function priced(startingTier: 'good' | 'better' | 'best' = 'better') {
  return applyReplacementPricing(baseReport, { tierSelection: tiers, squares: 30, selectedTier: startingTier });
}

describe('renderPresentationScrollcraftHtml', () => {
  it('requires the report to already carry priced replacementOptions', () => {
    expect(() => renderPresentationScrollcraftHtml(baseReport, {})).toThrow(/Good, Better and Best/);
  });

  it('shows every photo with a finding, and skips clean photos', () => {
    const html = renderPresentationScrollcraftHtml(priced(), {});
    expect(html).toContain('cdn.example/1.jpg');
    expect(html).toContain('cdn.example/3.jpg');
    expect(html).not.toContain('cdn.example/clean.jpg');
  });

  it('gives every photo a plain-language label and location', () => {
    const html = renderPresentationScrollcraftHtml(priced(), {});
    expect(html).toContain('Missing Shingles');
    expect(html).toContain('ridge');
  });

  it('carries real Good/Better/Best pricing and marks the starting tier', () => {
    const html = renderPresentationScrollcraftHtml(priced('best'), {});
    expect(html).toContain(usd(1359.99 * 30));
    expect(html).toMatch(/data-tier="best"[^>]*aria-selected="true"/);
  });

  it('puts data-price on the clickable opt-card itself, not a nested span — the tab-click handler reads card.dataset.price directly', () => {
    const html = renderPresentationScrollcraftHtml(priced('best'), {});
    const bestButton = html.match(/<button[^>]*data-tier="best"[^>]*>/)?.[0];
    expect(bestButton).toContain(`data-price="${1359.99 * 30}"`);
  });

  it('includes a folio nav entry for every chapter, with a real jump target', () => {
    const html = renderPresentationScrollcraftHtml(priced(), {});
    expect(html).toContain('href="#ch-welcome"');
    expect(html).toContain('href="#ch-options"');
    expect(html).toContain('id="ch-options"');
  });

  it('escapes customer-controlled text', () => {
    const html = renderPresentationScrollcraftHtml(priced(), { customer: '<script>alert(1)</script>' });
    expect(html).not.toContain('<script>alert(1)</script>');
  });

  it('includes the real ScrollCraft engine, not a stub', () => {
    const html = renderPresentationScrollcraftHtml(priced(), {});
    expect(html).toContain('ScrollCraft.mount(document.body)');
    expect(html.length).toBeGreaterThan(50000);
  });

  it('deep-dives on the recommended tier product by name', () => {
    const html = renderPresentationScrollcraftHtml(priced('best'), {});
    expect(html).toContain('id="ch-product"');
    expect(html).toContain('CertainTeed Landmark Presidential');
  });

  it('renders real, sourced wind/impact/fire/algae specs for the recommended product and every tier option', () => {
    const html = renderPresentationScrollcraftHtml(priced('better'), {}); // better = landmark_pro
    expect(html).toContain('id="ch-product"');
    expect(html).toContain('160 mph'); // Landmark PRO's real CertainTeed-sourced wind upgrade figure
    expect(html).toContain('UL 2218 Class 3');
    expect(html).toContain('30 years'); // algae-resistance warranty
    // Every tier's comparison panel gets its own real spec facts, not just the recommended one.
    expect(html).toContain('id="panel-good"'); // tamko_titan_basic
    expect(html).toContain('10 years'); // Titan XT's real algae-cleaning warranty
  });

  it('never fabricates a spec for a product with no sourced data sheet (standing-seam metal)', () => {
    // All three tiers set to the one product with no manufacturer data sheet,
    // so nothing else in the catalog can supply a real spec to leak into the output.
    const noSpecTiers = { good: 'standing_seam_metal', better: 'standing_seam_metal', best: 'standing_seam_metal' } as const;
    const html = renderPresentationScrollcraftHtml(applyReplacementPricing(baseReport, { tierSelection: noSpecTiers, squares: 30, selectedTier: 'good' }), {});
    expect(html).not.toMatch(/UL 2218/);
    expect(html).not.toMatch(/algae-resistance warranty/i);
  });

  it('includes real chapter content: process, ventilation, colors, and FAQ', () => {
    const html = renderPresentationScrollcraftHtml(priced(), {});
    expect(html).toContain('id="ch-process"');
    expect(html).toContain('id="ch-ventilation"');
    expect(html).toContain('id="ch-colors"');
    expect(html).toContain('id="ch-faq"');
  });

  it('skips every inspection-detail chapter when no field inspection was submitted', () => {
    const html = renderPresentationScrollcraftHtml(priced(), {});
    // "Your Roof, Measured" still renders — Presentation always carries a
    // priced square count from the tier selection itself, independent of
    // whether a field inspection was ever submitted.
    expect(html).toContain('id="ch-measured"');
    expect(html).not.toContain('id="ch-exterior"');
    expect(html).not.toContain('id="ch-assembly"');
    expect(html).not.toContain('id="ch-attic"');
    expect(html).not.toContain('id="ch-damage-detail"');
  });

  it('renders real field-inspection answers into the detail chapters, and skips ones with no answers', () => {
    const inspection: any = {
      submissionId: 1,
      inspectionType: 'Insurance Claim',
      jobType: 'insurance',
      recommendation: 'Full replacement',
      damageSummary: 'Hail damage across all slopes',
      approxSquares: 32,
      answers: {
        'Number of Stories': '2 Story',
        'Roof Covering Type': 'Asphalt Shingle - Architectural',
        'Average pitch across ALL slopes': '6/12',
        'Gutters and downspouts': '6 inch, aluminum, hail dents on north run',
        'Drip edge': 'Yes - painted',
        'Valley type': 'Metal',
        'Hail hits per test square by slope': 'North: 14, South: 9, East: 6, West: 11 (10x10 test square)',
        'Wind damage found': 'Yes',
        'Leaks or water damage in the attic or interior': 'No',
        'Ventilation types, counts, and plan': 'Ridge vent + 6 soffit vents, install new ridge vent',
      },
    };
    const html = renderPresentationScrollcraftHtml(priced(), { jobType: 'insurance', inspection });
    // Present — real answers render.
    expect(html).toContain('id="ch-measured"');
    expect(html).toContain('32');
    expect(html).toContain('id="ch-exterior"');
    expect(html).toContain('hail dents on north run');
    expect(html).toContain('id="ch-assembly"');
    expect(html).toContain('Metal');
    expect(html).toContain('id="ch-damage-detail"');
    expect(html).toContain('North: 14');
    expect(html).toContain('The Claim Evidence'); // insurance-flavored heading
    // "No leaks found" is real, reassuring content — it renders, it isn't hidden.
    expect(html).toContain('id="ch-attic"');
    // Chimney/skylights/solar were never answered at all — genuinely absent,
    // so "What Is Already There" only shows the fields that were.
    expect(html).not.toContain('>Chimney<');
  });

  it("carries the company's own financing link, and leaves out the map and financing a company does not have", () => {
    const html = withProfile(TEST_PROFILE, () => renderPresentationScrollcraftHtml(priced(), {}));
    expect(html).toContain('id="ch-financing"');
    expect(html).toContain('https://lender.test/apply');
    expect(html).not.toMatch(/\d+(\.\d+)?%\s*APR/i);
    expect(html).not.toMatch(/\$\d+\s*\/\s*mo/i);
    // No per-company project feed yet, so no "Our Work" map for anyone.
    expect(html).not.toContain('id="ch-our-work"');
    const bare = renderPresentationScrollcraftHtml(priced(), {});
    expect(bare).not.toContain('id="ch-financing"');
    expect(bare).not.toContain('id="ch-our-work"');
  });

  it('is the current company\'s document, with no other company in it', () => {
    const html = withProfile(TEST_PROFILE, () => renderPresentationScrollcraftHtml(priced(), {}));
    expect(html).toContain('Acme Roofing');
    expect(html).toContain('--brand:#225588');
    expect(html).not.toMatch(FORMER_COMPANY);
    const bare = renderPresentationScrollcraftHtml(priced(), {});
    expect(bare).not.toMatch(FORMER_COMPANY);
  });

  // Caught by an actual narrow-viewport render (390px, iframe-isolated so
  // @media queries respond to a real reduced width): the fixed 3-column "At
  // a Glance" stat grid pushed the third card 33px past the viewport edge —
  // documentElement.scrollWidth (423) exceeded innerWidth (390) — because
  // every other grid in this file had a mobile breakpoint and this one never
  // got one. Vitest can't lay out CSS grid, so this only asserts the
  // breakpoint rule exists; the real regression was confirmed visually.
  it('stacks the At a Glance stat grid to one column on narrow viewports', () => {
    const html = renderPresentationScrollcraftHtml(priced(), {});
    expect(html).toMatch(/@media \(max-width: 480px\) \{ \.obj-stats \{ grid-template-columns: 1fr; \} \}/);
  });
});
