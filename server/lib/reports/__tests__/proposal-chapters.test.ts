/**
 * Task 8 — the Proposal's four new chapters, its trust stats, and the
 * numbering scheme that has to survive a chapter legitimately not rendering.
 *
 * The fixture signature in the plan (renderProposalScrollcraftHtml(report,
 * pricing, tier, opts)) does not exist: the real signature is (report, opts)
 * and pricing is read off report.replacementOptions, so the report is built
 * with applyReplacementPricing the same way render-proposal-scrollcraft's own
 * test does.
 */
import { describe, it, expect } from 'vitest';
import { renderProposalScrollcraftHtml } from '../render-proposal-scrollcraft';
import { applyReplacementPricing } from '../estimate-replacement';
import type { TierSelection } from '../roofing-products';

const baseReport: any = {
  id: 'r8',
  generatedAt: '2026-09-11T12:00:00.000Z',
  property: { address: '2 Test Ave', city: 'Charlotte', state: 'NC' },
  damageAnalysis: { totalPhotosAnalyzed: 0, photos: [] },
  repairEstimate: { lineItems: [], total: 0, notes: [] },
};

const SHINGLE_TIERS = { good: 'landmark', better: 'landmark_pro', best: 'landmark_presidential' } as TierSelection;
/** Standing seam has no published spec sheet and therefore no colour list. */
const METAL_TIERS = { good: 'landmark', better: 'standing_seam_metal', best: 'landmark_presidential' } as TierSelection;

function priced(tierSelection: TierSelection, selectedTier: 'good' | 'better' | 'best' = 'better') {
  return applyReplacementPricing(baseReport, { tierSelection, squares: 30, selectedTier });
}

/** Everything inside one chapter's <section>, so a claim can be scoped to it. */
function section(html: string, id: string): string {
  const start = html.indexOf(`id="${id}"`);
  expect(start, `section #${id} is missing`).toBeGreaterThan(-1);
  const from = html.lastIndexOf('<section', start);
  const end = html.indexOf('</section>', start);
  return html.slice(from, end);
}

const NUMBER_WORDS = ['One', 'Two', 'Three', 'Four', 'Five', 'Six',
  'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve'];

function chapterWords(html: string): string[] {
  return [...html.matchAll(/Chapter ([A-Z][a-z]+)\b/g)].map((m) => m[1]);
}

describe('the Proposal', () => {
  const html = renderProposalScrollcraftHtml(priced(SHINGLE_TIERS), { customer: 'Test Customer' });

  it('gained the four new chapters', () => {
    expect(html).toContain('id="ch-product"');
    expect(html).toContain('id="ch-colors"');
    expect(html).toContain('id="ch-process"');
    expect(html).toContain('id="ch-financing"');
    expect(html).toContain('Your Color Options');
    expect(html).toContain('How the Job Runs');
    expect(html).toContain('Financing Options');
    expect(html).toContain('CertainTeed Landmark PRO');
  });

  it('shows the manufacturer facts it never had before', () => {
    expect(html).toContain('UL Class A');
    expect(html).toContain('30 years');
  });

  it('names the product once in its chapter, not twice', () => {
    // productSpecPanel emits its own <h3>{product name}</h3> unless the
    // caller says it already has a heading. This chapter has an <h2>.
    const product = section(html, 'ch-product');
    expect(product).not.toContain('<h3>');
    // Attributes (the product photo's alt=) are not visible copy.
    const visible = product.replace(/\s\w+="[^"]*"/g, '');
    expect(visible.match(/CertainTeed Landmark PRO/g)?.length).toBe(1);
  });

  it('renders authored copy raw — never double-escaped', () => {
    expect(html).toContain('professional&rsquo;s spec');
    expect(html).not.toContain('&amp;rsquo;');
    expect(html).not.toContain('&amp;mdash;');
    expect(html).not.toContain('&amp;trade;');
  });

  it('ships the CSS those chapters need', () => {
    // The Proposal's PAGE_CSS had none of these — moving chapters without
    // their styles renders unstyled content to a customer.
    for (const cls of ['roofstrip', 'spec-colors', 'spec-chip', 'cta-tel', 'fact-grid',
      'product-panel', 'cred', 'award-strip', 'tiny']) {
      expect(html, `.${cls}`).toContain(`.${cls}`);
    }
  });

  it('keeps the light/dark rhythm alternating across the new chapters', () => {
    expect(section(html, 'ch-product')).toContain('ch--dark');
    expect(section(html, 'ch-colors')).toContain('ch--paper');
    expect(section(html, 'ch-process')).toContain('ch--dark');
    expect(section(html, 'ch-financing')).toContain('ch--paper');
  });

  it('renumbers the chapters with no duplicates and no gaps', () => {
    // The cover (#ch-welcome) is deliberately unlabelled, so twelve numbers
    // cover thirteen sections (the System walkthrough joined after Product).
    const words = chapterWords(html);
    expect(words).toEqual(NUMBER_WORDS.slice(0, 12));
    expect(html).not.toContain('Chapter Thirteen');
    expect(section(html, 'ch-welcome')).not.toContain('Chapter ');
    expect(html).not.toContain('{{CH}}');
  });

  it('puts the new chapters in the order the document reads', () => {
    const order = ['ch-welcome', 'ch-found', 'ch-who', 'ch-options', 'ch-investment',
      'ch-product', 'ch-system', 'ch-colors', 'ch-process', 'ch-financing', 'ch-warranty',
      'ch-our-work', 'ch-next'];
    const at = order.map((id) => html.indexOf(`id="${id}"`));
    expect(at).toEqual([...at].sort((a, b) => a - b));
  });

  it('keeps every chapter in the folio nav, in body order', () => {
    const nav = html.slice(html.indexOf('<nav class="folio-nav"'), html.indexOf('</nav>'));
    for (const label of ['Color Options', 'Financing', 'Product', 'Process']) {
      expect(nav).toContain(label);
    }
    // PAGE_JS pairs folio links with sections BY INDEX, so a nav entry with
    // no section (or the wrong order) lights up the wrong chapter.
    const hrefs = [...nav.matchAll(/href="#([a-z-]+)"/g)].map((m) => m[1]);
    const at = hrefs.map((id) => html.indexOf(`id="${id}"`));
    expect(at.every((i) => i > -1)).toBe(true);
    expect(at).toEqual([...at].sort((a, b) => a - b));
  });

  it('shows the trust stats somewhere — they appear on no other document', () => {
    // The Estimate only gets whyBRN's compact (credentials-only) mode, so if
    // this chapter drops them, James's stats reach no customer at all.
    expect(html).toContain('$100,000');
    expect(html).toContain('Angi');
    expect(html).toContain('500+');
    expect(html).toContain('5.0★');
    expect(section(html, 'ch-who')).toContain('award-strip');
  });

  it('closes the gap when a product has no colour list', () => {
    const metal = renderProposalScrollcraftHtml(priced(METAL_TIERS), { customer: 'Test' });
    expect(metal).not.toContain('Your Color Options');
    expect(metal).not.toContain('id="ch-colors"');
    expect(metal).not.toContain('href="#ch-colors"');
    // Eleven numbers, not twelve — and no skipped word.
    expect(chapterWords(metal)).toEqual(NUMBER_WORDS.slice(0, 11));
    expect(metal).not.toContain('Chapter Twelve');
    expect(metal).not.toContain('{{CH}}');
  });
});
