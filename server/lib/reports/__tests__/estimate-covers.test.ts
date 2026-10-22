import { describe, it, expect } from 'vitest';
import { estimateCoversSection } from '../render-estimate-html';
import { withProfile } from '../../../tenant/context';
import { CREDENTIALED_PROFILE, BARE_PROFILE } from './profiles';

/**
 * "What This Covers" answers "what am I buying". For a replacement that's the
 * product going on the house; for repairs it's the repair items. It used to
 * list the damage conditions from the photo inspection either way — which
 * describes the PROBLEM, not the work being paid for.
 *
 * `product.key` is what real replacementOptions carry (computeTierPricing
 * stores the whole RoofingProduct), and it is the key the manufacturer spec
 * and colour lists are looked up by — without it the product panel would show
 * a description and nothing else.
 */
const replacement: any = {
  selectedTier: 'better',
  roofDetails: { squares: 33 },
  replacementOptions: [
    { tier: 'good', total: 14189.67, squares: 33, ratePerSquare: 429.99, product: { key: 'tamko_titan_basic', name: 'Tamko Titan Basic', tagline: 'Budget-conscious', body: 'Entry-level.' } },
    { tier: 'better', total: 15839.67, squares: 33, ratePerSquare: 479.99, product: { key: 'landmark', name: 'CertainTeed Landmark', tagline: "America's #1-selling architectural shingle", body: 'The trusted classic, with StreakFighter&reg; algae resistance.' } },
  ],
  repairEstimate: { lineItems: [{ repairName: 'Full Roof Replacement — CertainTeed Landmark', quantity: 33, unit: 'sq', finalCostPerUnit: 479.99, totalFinalCost: 15839.67 }], total: 15839.67 },
  damageAnalysis: { photos: [{ id: 'p1', damages: [{ id: 'd1', label: 'Granule loss', severity: 'medium' }] }] },
};

describe('a replacement quote', () => {
  const html = estimateCoversSection(replacement);

  it('names the product going on the roof, not the damage', () => {
    expect(html).toContain('CertainTeed Landmark');
    expect(html).toContain("America's #1-selling architectural shingle");
  });

  it('picks the SELECTED tier, not just the first option', () => {
    expect(html).not.toContain('Tamko Titan Basic');
  });

  it('says what the crew actually does', () => {
    expect(html).toContain('Complete tear-off');
    expect(html).toContain('Synthetic underlayment');
    expect(withProfile(CREDENTIALED_PROFILE, () => estimateCoversSection(replacement))).toContain('15-Year Workmanship Warranty');
    // A company that has not entered its workmanship years makes no workmanship claim.
    expect(withProfile(BARE_PROFILE, () => estimateCoversSection(replacement))).not.toMatch(/Workmanship Warranty/);
  });

  it('shows the sizing behind the price', () => {
    expect(html).toContain('33 squares');
    expect(html).toContain('$479.99');
  });

  it('leaves authored copy entities intact rather than printing their source', () => {
    // p.body is authored HTML — escaping it would show "&amp;reg;" to a customer.
    expect(html).toContain('StreakFighter&reg;');
    expect(html).not.toContain('&amp;reg;');
  });

  it('does not list the damage conditions here', () => {
    expect(html).not.toContain('Granule loss');
  });
});

describe('a repair quote', () => {
  const repairs: any = {
    repairEstimate: {
      lineItems: [
        { repairName: 'Replace missing shingles', quantity: 2, unit: 'sq', finalCostPerUnit: 577.5, totalFinalCost: 1155 },
        { repairName: 'Re-flash chimney', quantity: 1, unit: 'ea', finalCostPerUnit: 850, totalFinalCost: 850 },
      ],
      total: 2005,
    },
    damageAnalysis: { photos: [{ id: 'p1', damages: [{ id: 'd1', label: 'Granule loss', severity: 'medium' }] }] },
  };
  const html = estimateCoversSection(repairs);

  it('lists the repairs being bought', () => {
    expect(html).toContain('Replace missing shingles');
    expect(html).toContain('Re-flash chimney');
    expect(html).toContain('2 repairs');
  });

  it('does not describe a replacement', () => {
    expect(html).not.toContain('Complete tear-off');
  });
});

describe('nothing priced', () => {
  it('renders nothing rather than passing findings off as the scope', () => {
    // The evidence has its own "What We Found" section; this one is the WORK,
    // and with nothing priced there is no work to describe.
    const html = estimateCoversSection({
      repairEstimate: { lineItems: [], total: 0 },
      damageAnalysis: { photos: [{ id: 'p1', damages: [{ id: 'd1', label: 'Granule loss', severity: 'medium' }] }] },
    } as any);
    expect(html).toBe('');
  });
});

describe('the whole estimate document', () => {
  it('keeps the evidence tie: the work AND what was seen', async () => {
    const { renderEstimateHtml } = await import('../render-estimate-html');
    const html = renderEstimateHtml(replacement, { customer: 'Greg Baker' });
    expect(html).toContain('What This Covers');
    expect(html).toContain('CertainTeed Landmark');
    expect(html).toContain('What We Found');
    expect(html).toContain('Granule loss');
  });
});

/** The repair fixture the title/product tests below reuse. */
const repairOnly: any = {
  repairEstimate: {
    lineItems: [{ repairName: 'Re-flash chimney', quantity: 1, unit: 'ea', finalCostPerUnit: 850, totalFinalCost: 850 }],
    total: 850,
  },
};

describe('the estimate document title', () => {
  it('says Replacement when a replacement is quoted', async () => {
    const { renderEstimateHtml } = await import('../render-estimate-html');
    const html = renderEstimateHtml(replacement, { customer: 'Greg Baker' });
    expect(html).toContain('Roof Replacement Estimate');
    expect(html).not.toContain('<h1>Roof Repair Estimate</h1>');
    expect(html).toContain('<h1>Roof Replacement Estimate</h1>');
    // The <title> is the tab, the PDF name and the link preview — it went out
    // wrong on a real $15,839 replacement for Greg Baker.
    expect(html).toContain('<title>Roof Replacement Estimate');
  });

  it('still says Repair when repairs are quoted', async () => {
    const { renderEstimateHtml } = await import('../render-estimate-html');
    const html = renderEstimateHtml(repairOnly, { customer: 'Test' });
    expect(html).toContain('Roof Repair Estimate');
  });
});

describe('the estimate gains product depth', () => {
  it('shows the manufacturer facts for a replacement', async () => {
    const { renderEstimateHtml } = await import('../render-estimate-html');
    const html = withProfile(CREDENTIALED_PROFILE, () => renderEstimateHtml(replacement, { customer: 'Greg Baker' }));
    expect(html).toContain('UL Class A');
    expect(html).toContain('Your Color Options');
    expect(html).toContain('ShingleMaster'); // the company's own credential
    expect(html).toContain('Test Lender'); // the company's own lender
  });

  it('gives a repair quote no product or colour section', async () => {
    const { renderEstimateHtml } = await import('../render-estimate-html');
    const html = withProfile(CREDENTIALED_PROFILE, () => renderEstimateHtml(repairOnly, { customer: 'Test' }));
    expect(html).not.toContain('Your Color Options');
    expect(html).toContain('ShingleMaster');   // credentials still appear
    expect(html).not.toContain('class="product-panel"');
    expect(html).not.toContain('UL Class A');
    expect(html).toContain('Test Lender');   // financing is offered on repairs too
  });

  it('renders document classes, not scrollcraft ones', async () => {
    // premiumShell defines no --sc-* variables and no sc-body/opt-tagline
    // rules; passing SCROLL_STYLE here strips the styling off taglines and
    // caveats on a customer's estimate with every test still green.
    const { renderEstimateHtml } = await import('../render-estimate-html');
    const html = renderEstimateHtml(replacement, { customer: 'Greg Baker' });
    expect(html).not.toContain('class="sc-body"');
    expect(html).not.toContain('class="sc-body tiny"');
    expect(html).not.toContain('opt-tagline');
  });

  it('ships the CSS the new sections need', async () => {
    const { renderEstimateHtml } = await import('../render-estimate-html');
    const html = renderEstimateHtml(replacement, { customer: 'Greg Baker' });
    expect(html).toContain('.spec-chip');
    // The DOCUMENT bundle, not the scroll one: the scroll bundle is written
    // against --sc-* custom properties premiumShell never defines, so it
    // would render every chip and fact card with no background, border or
    // padding. (project-map-widget.ts's single --sc-r-lg use carries a
    // literal fallback, so this checks the bare ones the section CSS uses.)
    expect(html).toContain('.spec-chip { font-size: 11px');
    expect(html).not.toContain('var(--sc-surface)');
    expect(html).not.toContain('var(--sc-hairline)');
  });
});
