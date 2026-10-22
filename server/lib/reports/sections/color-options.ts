/**
 * Colour options for the product being quoted.
 *
 * Extracted from render-presentation-scrollcraft.ts chColors. The copy about
 * bringing physical samples is deliberate and stays: color reads differently
 * in sun and shade, and a customer choosing from a screen is a callback.
 *
 * Customer-facing copy uses US spelling ("color"), verbatim from the live
 * Presentation this was lifted from — these documents go to Charlotte, NC
 * homeowners.
 */
import { esc } from '../report-theme.js';
import { specFor } from '../product-specs.js';
import type { RoofingProduct } from '../roofing-products.js';
import { COLOR_ASSETS } from '../certainteed-data.js';
import type { SectionStyle } from './style.js';

export function colorOptions(input: { product: RoofingProduct }, style: SectionStyle): string {
  const spec = specFor(input.product.key);
  if (!spec?.colors?.length) return '';

  const strip = COLOR_ASSETS.roofs
    .map((r) => `<img src="${esc(r)}" alt="Shingle color shown on a roof" loading="lazy">`)
    .join('');
  const chips = spec.colors
    .map((c) => `<span class="${style.chip}">${esc(c)}</span>`)
    .join('');

  return `
    <p class="${style.body}">Color looks different in sun and shade, so nothing here is the final word &mdash; we bring physical samples to your home and hold them against your siding and trim in daylight before anything is ordered. That's the right way to choose a color, and it costs nothing.</p>
    <div class="roofstrip">${strip}</div>
    <p class="${style.body}"><b>${esc(input.product.name)}</b> is currently available in:</p>
    <div class="spec-colors">${chips}</div>
    ${spec.colorNote ? `<p class="${style.note}">${esc(spec.colorNote)}</p>` : ''}`;
}
