import { describe, it, expect } from 'vitest';
import { productSpecPanel, productImage } from '../product-spec-panel';
import { SCROLL_STYLE, DOCUMENT_STYLE } from '../style';
import { productByKey } from '../../roofing-products';

const landmark = productByKey('landmark')!;
const metal = productByKey('standing_seam_metal')!;

describe('a product with published specs', () => {
  const html = productSpecPanel({ product: landmark, squares: 33, ratePerSquare: 479.99 }, SCROLL_STYLE);

  it('names the product and its manufacturer facts', () => {
    expect(html).toContain('CertainTeed Landmark');
    expect(html).toContain('UL 2218 Class 3');   // impact
    expect(html).toContain('UL Class A');        // fire
    expect(html).toContain('25 years');          // algae warranty
    expect(html).toMatch(/Class F|Class H/);     // wind
  });

  it('keeps authored entities intact instead of printing their source', () => {
    // product.body contains &reg; / &rsquo; — escaping shows "&amp;reg;".
    expect(html).not.toContain('&amp;reg;');
  });

  it('shows the sizing behind the price when it has one', () => {
    expect(html).toContain('33');
    expect(html).toContain('479.99');
  });

  it('renders under the document style too', () => {
    const doc = productSpecPanel({ product: landmark }, DOCUMENT_STYLE);
    expect(doc).toContain('CertainTeed Landmark');
    expect(doc).toContain('fact-grid');
    // Tagline gets its own class (full-brightness selling line, not a
    // caveat) — verify the document shell's mapping is actually used.
    expect(doc).toContain(`class="${DOCUMENT_STYLE.tagline}"`);
  });
});

describe('a product with no published spec', () => {
  // specFor() returns null for standing_seam_metal and custom. The Presentation
  // silently drops the entire block today; a quote must still say what it sells.
  const html = productSpecPanel({ product: metal, squares: 20 }, SCROLL_STYLE);

  it('still describes the product', () => {
    expect(html).toContain('Standing Seam Metal Roof');
    expect(html).toContain('concealed fasteners');
  });

  it('omits the fact grid rather than rendering an empty one', () => {
    expect(html).not.toContain('fact-grid');
  });
});

describe('product imagery', () => {
  it('falls back to the generic roof photo with an honest caption', () => {
    // PRODUCT_IMAGES ships empty. A stock roof must never be captioned as a
    // specific shingle.
    const img = productImage('landmark');
    expect(img.src).toMatch(/\/certainteed\/roof-\d\.jpg$/);
    expect(img.caption).not.toContain('Landmark');
    expect(img.caption.toLowerCase()).toContain('not your house');
  });
});

describe('the panel opt-outs', () => {
  it('omits its own heading and figure when the caller supplies them', () => {
    const html = productSpecPanel({ product: landmark, ownHeading: false, ownPhoto: false }, SCROLL_STYLE);
    expect(html).not.toContain('<h3>');
    expect(html).not.toContain('who-photo');
    expect(html).toContain('UL Class A');           // facts still render
  });

  it('prints no rate unless both squares and rate are given', () => {
    // The Presentation withholds every number until its Investment chapter.
    const neither = productSpecPanel({ product: landmark, ownHeading: false, ownPhoto: false }, SCROLL_STYLE);
    expect(neither).not.toMatch(/per square/);
    expect(neither).not.toMatch(/\$\d/);

    const squaresOnly = productSpecPanel({ product: landmark, squares: 33, ownHeading: false, ownPhoto: false }, SCROLL_STYLE);
    expect(squaresOnly).not.toMatch(/per square/);
    expect(squaresOnly).not.toMatch(/\$\d/);

    const rateOnly = productSpecPanel({ product: landmark, ratePerSquare: 479.99, ownHeading: false, ownPhoto: false }, SCROLL_STYLE);
    expect(rateOnly).not.toMatch(/per square/);
    expect(rateOnly).not.toMatch(/\$\d/);
  });

  it('still defaults to a self-contained panel', () => {
    const html = productSpecPanel({ product: landmark }, SCROLL_STYLE);
    expect(html).toContain('<h3>');
    expect(html).toContain('who-photo');
  });
});
