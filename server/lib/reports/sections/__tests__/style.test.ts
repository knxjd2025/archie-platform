import { describe, it, expect } from 'vitest';
import { DOCUMENT_STYLE, SCROLL_STYLE, factGrid, SECTION_CSS_SCROLL, SECTION_CSS_DOCUMENT } from '../style';

describe('the two style maps', () => {
  it('define the same keys, so a builder works under either', () => {
    expect(Object.keys(DOCUMENT_STYLE).sort()).toEqual(Object.keys(SCROLL_STYLE).sort());
  });

  it('are actually different, or there was no reason to have two', () => {
    expect(DOCUMENT_STYLE.body).not.toBe(SCROLL_STYLE.body);
  });
});

describe('factGrid', () => {
  it('keeps the exact markup the existing .fact CSS targets', () => {
    // render-presentation-scrollcraft.ts:79-83 emitted this shape and the
    // `.fact b` / `.fact span` rules depend on it. Changing to dl/dt/dd
    // silently unstyles every fact grid in the live Presentation.
    const html = factGrid([['Wind rating', '130 mph']]);
    expect(html).toContain('<div class="fact-grid">');
    expect(html).toContain('<div class="fact"><b>Wind rating</b><span>130 mph</span></div>');
  });

  it('drops rows with no value rather than printing an empty cell', () => {
    const html = factGrid([['Wind rating', '130 mph'], ['Impact', null]]);
    expect(html).toContain('Wind rating');
    expect(html).not.toContain('Impact');
  });

  it('returns nothing when every row is empty', () => {
    expect(factGrid([['Impact', null]])).toBe('');
  });

  it('escapes values, which can come from product data', () => {
    const html = factGrid([['X', '<script>alert(1)</script>']]);
    expect(html).not.toContain('<script>');
  });
});

describe('the two CSS bundles', () => {
  it('both define the classes neither shell already provides', () => {
    // Moving a chapter without its CSS renders unstyled content to a customer.
    for (const css of [SECTION_CSS_SCROLL, SECTION_CSS_DOCUMENT]) {
      for (const cls of ['spec-colors', 'spec-chip', 'cta-tel', 'fact-grid', 'fact', 'award-strip']) {
        expect(css).toContain(`.${cls}`);
      }
    }
    // roofstrip is scrollcraft-only here: report-theme.ts already ships it to
    // premiumShell pages, so redeclaring it would collide at equal specificity.
    expect(SECTION_CSS_SCROLL).toContain('.roofstrip');
    expect(SECTION_CSS_DOCUMENT).not.toContain('.roofstrip {');
    expect(SECTION_CSS_DOCUMENT).not.toContain('.roofstrip img');
  });

  it('keeps the CTA a button, the way the live page renders it', () => {
    // render-presentation-scrollcraft.ts:660-661 styles .cta-tel a as a solid
    // pill. Downgrading it to a text link would quietly demote the HFS Financial
    // and phone CTAs on a document already going to customers.
    for (const css of [SECTION_CSS_SCROLL, SECTION_CSS_DOCUMENT]) {
      expect(css).toContain('border-radius');
      expect(css).toMatch(/\.cta-tel a \{[^}]*display: inline-block/);
      expect(css).toMatch(/\.cta-tel a \{[^}]*background:/);
    }
  });

  it('the document bundle references no scrollcraft variables', () => {
    // premiumShell defines --card/--fire/--gold/--green/--ink/--line/--muted/
    // --paper/--red and NO --sc-* at all. A --sc-* reference here renders as
    // no background, no border, no padding on a customer's estimate.
    expect(SECTION_CSS_DOCUMENT).not.toContain('--sc-');
  });

  it('the scroll bundle is the existing rules, which do use them', () => {
    expect(SECTION_CSS_SCROLL).toContain('--sc-');
  });

  it('keeps the stack rhythm inside the product panel', () => {
    // .sc-stack > * + * (assets/scrollcraft.css:169) matches direct children
    // only; the panel nests tagline+body a level deeper, so the spacing has
    // to be restored or the paragraphs collide on the live Presentation.
    expect(SECTION_CSS_SCROLL).toContain('.product-panel > * + *');
  });

  it('keeps the fact grid at its own wider gap inside the panel', () => {
    // .product-panel > * + * ties with .fact-grid at (0,1,0) and would win by
    // source order, shrinking the grid gap from --sc-5 to --sc-4.
    expect(SECTION_CSS_SCROLL).toContain('.product-panel > .fact-grid');
  });

  it('styles every class the shared sections actually emit', () => {
    // productSpecPanel emits .product-panel and .who-photo. Each bundle needs
    // exactly the ones its shell does not already provide — no more (that
    // collides), no fewer (that renders an unstyled photo to a customer).
    expect(SECTION_CSS_SCROLL).toContain('.product-panel');   // in neither scrollcraft PAGE_CSS
    expect(SECTION_CSS_SCROLL).not.toContain('.who-photo');   // both scrollcraft pages define it
    expect(SECTION_CSS_DOCUMENT).toContain('.product-panel');
    expect(SECTION_CSS_DOCUMENT).toContain('.who-photo');     // report-theme.ts does NOT define it
  });

  it('styles the credential chips on both shells without colliding', () => {
    expect(SECTION_CSS_SCROLL).toContain('.cred');       // no scrollcraft PAGE_CSS defines it
    expect(SECTION_CSS_DOCUMENT).not.toContain('.cred'); // report-theme.ts:96-97 already does
  });

  it('pins the panel top margin against collapse', () => {
    // .product-panel's own margin-top collapses with .opt-tagline's and wins,
    // leaving the chapter heading gap 8px wider than before the panel existed.
    expect(SECTION_CSS_SCROLL).toContain('.sc-stack > .product-panel');
  });
});
