/**
 * Safety net for Task 6: the Presentation is a live customer document, and
 * repointing its chapters at the shared section builders must not change what
 * a homeowner sees.
 *
 * This file is deliberately written to PASS against the pre-refactor renderer
 * so that any failure after the refactor is a real regression, not a moved
 * goalpost. The one intended change is the credential strip, which now reads
 * "CertainTeed ShingleMaster since 2022" instead of the old, wrong
 * "CertainTeed Certified" (brand-facts.ts).
 *
 * NOTE ON THE FIXTURE: renderPresentationScrollcraftHtml takes
 * (report, opts) — the Good/Better/Best pricing is read off the report's own
 * replacementOptions/selectedTier, set by applyReplacementPricing(). It is
 * NOT passed as positional pricing/tier arguments.
 */
import { describe, it, expect } from 'vitest';
import { renderPresentationScrollcraftHtml } from '../render-presentation-scrollcraft';
import { applyReplacementPricing } from '../estimate-replacement';
import { withProfile } from '../../../tenant/context';
import { CREDENTIALED_PROFILE } from './profiles';

const base: any = {
  property: { address: '1 Test St', city: 'Springfield', state: 'IL' },
  roofDetails: { squares: 33 },
  damageAnalysis: { photos: [] },
  generatedAt: '2026-09-11T12:00:00.000Z',
  repairEstimate: { lineItems: [], total: 0, notes: [] },
};

const report = applyReplacementPricing(base, {
  tierSelection: { good: 'landmark', better: 'landmark_pro', best: 'landmark_presidential' },
  squares: 33,
  selectedTier: 'better',
});

describe('the Presentation after extraction', () => {
  const html = withProfile(CREDENTIALED_PROFILE, () => renderPresentationScrollcraftHtml(report, { customer: 'Test Customer' }));

  it('still renders every chapter it did before', () => {
    for (const h of [
      'What We Found On Your Roof', 'The Integrity Roof System', 'Your Color Options',
      'How the Job Runs', 'Questions People Ask', 'Financing Options', 'The Investment',
    ]) {
      expect(html).toContain(h);
    }
  });

  it('still carries the product facts, now from the shared builder', () => {
    expect(html).toContain('CertainTeed Landmark PRO');
    expect(html).toContain('UL Class A');
    expect(html).toContain('30 years');            // landmark_pro algae warranty
  });

  it('still ships the CSS its sections need', () => {
    // Bare class-name substrings (e.g. ".fact-grid") also appear in the
    // placeholder comments left behind in PAGE_CSS ("/* .fact-grid / .fact /
    // .spec-colors / .spec-chip moved to SECTION_CSS_SCROLL ... */"), so they
    // would still pass even if ${SECTION_CSS_SCROLL} were deleted entirely.
    // Assert actual declarations instead.
    for (const decl of ['.roofstrip { margin-top:', '.fact-grid { margin-top:', '.cta-tel a {', '.spec-chip {']) {
      expect(html).toContain(decl);
    }
  });

  it("shows the company's own credential", () => {
    expect(html).toContain('ShingleMaster');
    expect(html).not.toContain('CertainTeed Certified');
  });

  // The chapters repointed at the shared builders keep the copy customers
  // already read: the install sequence, the color-sample promise, and the
  // company's own lender link with no invented APR or monthly payment.
  it('keeps the install sequence and its promises verbatim', () => {
    expect(html).toContain('Most roofs are a single day, start to finish');
    expect(html).toContain('1 &middot; Protect');
    expect(html).toContain('5 &middot; Clean up');
    expect(html).toContain('nothing gets covered up without you seeing it first');
  });

  it('keeps the physical-sample promise and the real color list', () => {
    expect(html).toMatch(/we bring physical samples to your home/);
    expect(html).toContain('Max Def Moir'); // a real landmark_pro color
    expect(html).toContain('spec-colors');
  });

  it('keeps financing free of invented numbers', () => {
    expect(html).toContain('https://lender.test/apply');
    expect(html).not.toMatch(/\d+(\.\d+)?%\s*APR/i);
    expect(html).not.toMatch(/\$\d+\s*\/\s*mo/i);
  });

  it('keeps the product chapter free of a second heading, a second photo, and any price', () => {
    // The Presentation withholds every number until its Investment chapter,
    // and this chapter supplies its own <h2> and its own sticky figure.
    const product = html.match(/<section[^>]*id="ch-product"[\s\S]*?<\/section>/)![0];
    expect(product).not.toContain('<h3');
    // Only one <figure class="who-photo"> lands in this chapter's markup:
    // chProduct's own sticky figure. productSpecPanel is called with
    // ownPhoto: false, so it contributes no second "who-photo" occurrence.
    expect(product.match(/who-photo/g)).toHaveLength(1);
    expect(product).not.toMatch(/per square/);
    expect(product).not.toMatch(/\$\d/);
  });
});
