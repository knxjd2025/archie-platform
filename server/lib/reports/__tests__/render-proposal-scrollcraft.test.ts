import { describe, it, expect } from 'vitest';
import { renderProposalScrollcraftHtml } from '../render-proposal-scrollcraft';
import { applyReplacementPricing } from '../estimate-replacement';
import { usd } from '../report-theme';
import { withProfile } from '../../../tenant/context';
import { resolveCompanyProfile } from '../../../../shared/company';
import { TEST_PROFILE } from '../../../__tests__/helpers/tenant';
import { FORMER_COMPANY } from './profiles';

const baseReport: any = {
  id: 'r1',
  generatedAt: '2026-09-06T00:00:00Z',
  property: { address: '550 Manning Dr', city: 'Springfield', state: 'IL', zip: '62701' },
  damageAnalysis: {
    totalPhotosAnalyzed: 2,
    photos: [
      { id: 'p1', url: 'https://cdn.example/1.jpg', damages: [{ type: 'hail_damage', severity: 'high' }] },
      { id: 'p2', url: 'https://cdn.example/2.jpg', damages: [] },
    ],
  },
  stormHistory: { totalEvents: 2, hailEvents: 1, windEvents: 1, yearsAnalyzed: 3, searchRadiusMiles: 5 },
  repairEstimate: { lineItems: [], total: 0, notes: [] },
};

const tiers = { good: 'tamko_titan_basic', better: 'landmark_pro', best: 'landmark_presidential' } as const;

function priced(startingTier: 'good' | 'better' | 'best' = 'better') {
  return applyReplacementPricing(baseReport, { tierSelection: tiers, squares: 30, selectedTier: startingTier });
}

describe('renderProposalScrollcraftHtml', () => {
  it('requires the report to already carry priced replacementOptions', () => {
    expect(() => renderProposalScrollcraftHtml(baseReport, {})).toThrow(/Good, Better and Best/);
  });

  it('renders all seven chapters with the customer name and real pricing', () => {
    const html = renderProposalScrollcraftHtml(priced(), { customer: 'Jane Doe' });
    expect(html).toContain('Jane Doe');
    expect(html).toContain('550 Manning Dr');
    expect(html).toContain('Tamko Titan Basic');
    expect(html).toContain('CertainTeed Landmark PRO');
    expect(html).toContain('CertainTeed Landmark Presidential');
    expect(html).toContain(usd(509 * 30)); // better tier total: real rate × real squares
  });

  it('marks the correct tier as pre-selected', () => {
    const html = renderProposalScrollcraftHtml(priced('best'), {});
    expect(html).toMatch(/data-tier="best"[^>]*aria-selected="true"/);
  });

  it('puts data-price on the clickable opt-card itself, not a nested span — the tab-click handler reads card.dataset.price directly', () => {
    const html = renderProposalScrollcraftHtml(priced('best'), {});
    const bestButton = html.match(/<button[^>]*data-tier="best"[^>]*>/)?.[0];
    expect(bestButton).toContain(`data-price="${1359.99 * 30}"`);
  });

  it("never renders a fake/generated founders photo — only the company's own, when it has one", () => {
    const withPhoto = resolveCompanyProfile({
      id: TEST_PROFILE.id, name: 'Photo Co',
      settings: { story: { heading: 'Our story', paragraphs: ['We started small.'], photoUrl: 'https://photo.test/owners.jpg', photoCaption: 'The owners' } },
    });
    const html = withProfile(withPhoto, () => renderProposalScrollcraftHtml(priced(), {}));
    expect(html).toContain('https://photo.test/owners.jpg');
    expect(html).toContain('We started small.');
    const none = withProfile(TEST_PROFILE, () => renderProposalScrollcraftHtml(priced(), {}));
    expect(none).toContain('Acme started in a garage.');
    expect(none).not.toContain('alt="The team at Acme Roofing"');
  });

  it('is the current company\'s document, with no other company in it', () => {
    const html = withProfile(TEST_PROFILE, () => renderProposalScrollcraftHtml(priced(), {}));
    expect(html).toContain('Acme Roofing');
    expect(html).not.toMatch(FORMER_COMPANY);
    expect(renderProposalScrollcraftHtml(priced(), {})).not.toMatch(FORMER_COMPANY);
  });

  it('escapes customer-controlled text', () => {
    const html = renderProposalScrollcraftHtml(priced(), { customer: '<script>alert(1)</script>' });
    expect(html).not.toContain('<script>alert(1)</script>');
  });

  it('includes the real ScrollCraft engine, not a stub', () => {
    const html = renderProposalScrollcraftHtml(priced(), {});
    expect(html).toContain('ScrollCraft.mount(document.body)');
    expect(html.length).toBeGreaterThan(50000); // engine + page CSS/JS are substantial
  });

  it('leaves out the "Our Work" map until the company has a project feed', () => {
    const html = withProfile(TEST_PROFILE, () => renderProposalScrollcraftHtml(priced(), {}));
    expect(html).not.toContain('id="ch-our-work"');
    expect(html).not.toMatch(/<div class="work-map-wrap"/);
  });

  it('shows no storm timeline node when the rep never confirmed a storm date/type', () => {
    const html = renderProposalScrollcraftHtml(priced(), {});
    expect(html).not.toContain('Hail event');
    expect(html).not.toContain('Wind event');
    expect(html).not.toContain('Storm history reviewed');
    expect(html).toContain('What our inspection found, photo by photo.');
  });

  it('shows the storm timeline node only when the rep set BOTH Storm Date and Storm Type', () => {
    const withStorm = { ...baseReport, repConfirmedStorm: { date: '2024-05-15', type: 'Hail' } };
    const html = renderProposalScrollcraftHtml(applyReplacementPricing(withStorm, { tierSelection: tiers, squares: 30, selectedTier: 'better' }), {});
    expect(html).toContain('class="timeline"');
    expect(html).toContain('Hail event');
    expect(html).toContain('May 15, 2024');
    expect(html).toContain('From the storm that caused it to the damage it left.');
  });
});
