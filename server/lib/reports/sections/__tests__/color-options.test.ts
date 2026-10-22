import { describe, it, expect } from 'vitest';
import { colorOptions } from '../color-options';
import { SCROLL_STYLE } from '../style';
import { productByKey } from '../../roofing-products';
import { specFor } from '../../product-specs';

describe('colour options', () => {
  it('lists the product colours as chips', () => {
    const html = colorOptions({ product: productByKey('landmark')! }, SCROLL_STYLE);
    expect(html).toContain('Georgetown Gray');
    expect(html).toContain('Weathered Wood');
    expect(html).toContain(SCROLL_STYLE.chip);
  });

  it('surfaces the caveat when the colour list is contested', () => {
    const spec = specFor('landmark')!;
    expect(spec.colorNote).toBeTruthy();   // guard: the fixture must still have one
    const html = colorOptions({ product: productByKey('landmark')! }, SCROLL_STYLE);
    expect(html).toContain('confirm');
  });

  it('shows real roof photos so colour is seen in context', () => {
    const html = colorOptions({ product: productByKey('landmark')! }, SCROLL_STYLE);
    expect(html).toContain('roofstrip');
    expect(html).toContain('reports.bestroofersnow.com');
  });

  it('says nothing for a product with no published colour list', () => {
    // standing_seam_metal has no ProductSpec — a colour section with no
    // colours is worse than no section.
    expect(colorOptions({ product: productByKey('standing_seam_metal')! }, SCROLL_STYLE)).toBe('');
  });

  it('always tells the customer samples come to the house', () => {
    const html = colorOptions({ product: productByKey('landmark')! }, SCROLL_STYLE);
    expect(html.toLowerCase()).toContain('sample');
  });
});
