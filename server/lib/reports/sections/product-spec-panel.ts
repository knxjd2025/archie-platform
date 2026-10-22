/**
 * "What you're buying" — the product going on the house, with the
 * manufacturer's published numbers behind it.
 *
 * Extracted from render-presentation-scrollcraft.ts chProduct so the Estimate
 * and Proposal can show the same thing. Before this, CertainTeed spec data
 * (product-specs.ts) reached exactly one of five documents.
 */
import { esc, usd2 } from '../report-theme.js';
import { specFor } from '../product-specs.js';
import { isServiceProduct, SERVICE_INCLUDES, type RoofingProduct, type AnyProductKey } from '../roofing-products.js';
import type { ServiceTierKey } from '../../../../shared/addon-pricing.js';
import { PRODUCT_IMAGES, GENERIC_ROOF_PHOTO, GENERIC_ROOF_CAPTION } from '../product-images.js';
import { factGrid, type SectionStyle } from './style.js';

/** A product-specific photo if we have one, otherwise the generic roof with the generic caption. */
export function productImage(key: AnyProductKey, _productName?: string): { src: string; caption: string } {
  return PRODUCT_IMAGES[key] ?? { src: GENERIC_ROOF_PHOTO, caption: GENERIC_ROOF_CAPTION };
}

export interface ProductSpecPanelInput {
  product: RoofingProduct;
  /** Sizing line is rendered only when BOTH of these are given. The
   *  Presentation deliberately passes neither: it withholds every number
   *  until its Investment chapter, and a per-square rate leaking seven
   *  chapters early undercuts how that document is built to read. */
  squares?: number;
  ratePerSquare?: number;
  /** false when the caller already headlines the product (a chapter <h2>). */
  ownHeading?: boolean;
  /** false when the surrounding layout supplies its own product figure. */
  ownPhoto?: boolean;
}

/** What a tune-up or cleaning covers, as a list. '' for anything else. */
export function serviceIncludesList(product: Pick<RoofingProduct, 'key' | 'category'>, style: SectionStyle): string {
  if (!isServiceProduct(product)) return '';
  const items = SERVICE_INCLUDES[product.key as ServiceTierKey] ?? [];
  return items.length ? `<ul class="${style.body}" style="line-height:1.8;padding-left:20px;margin:8px 0">${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>` : '';
}

export function productSpecPanel(input: ProductSpecPanelInput, style: SectionStyle): string {
  const { product, squares, ratePerSquare, ownHeading = true } = input;
  // A tune-up or cleaning installs nothing: no installed-roof photo, no spec grid.
  const service = isServiceProduct(product);
  const ownPhoto = service ? false : input.ownPhoto ?? true;
  const spec = specFor(product.key);
  const img = productImage(product.key, product.name);

  // Standing Seam Metal and Custom have no published spec sheet. Keep the
  // description; drop only the grid. factGrid already returns '' for no rows.
  const facts = spec && !service
    ? factGrid([
        ['Wind rating', spec.windRatingText.replace(/&amp;/g, '&')],
        ['Impact resistance', spec.impactClass],
        ['Fire rating', spec.fireRating],
        ['Algae-resistance warranty', `${spec.algaeWarrantyYears} years`],
      ])
    : '';

  const sizing = squares && ratePerSquare
    ? `<p class="${style.note}">${esc(String(squares))} squares at ${usd2(ratePerSquare)} per square.</p>`
    : '';

  const heading = ownHeading ? `<h3>${esc(product.name)}</h3>` : '';
  const photo = ownPhoto
    ? `<figure class="who-photo">
        <img src="${esc(img.src)}" alt="${esc(product.name)}" loading="lazy">
        <figcaption>${img.caption}</figcaption>
      </figure>`
    : '';

  // product.body is authored HTML (&reg;, &rsquo;) — must not be escaped.
  return `
    <div class="product-panel">
      ${heading}
      <p class="${style.tagline}">${esc(product.tagline)}</p>
      <p class="${style.body}">${product.body}</p>
      ${serviceIncludesList(product, style)}
      ${facts}
      ${sizing}
      ${photo}
    </div>`;
}
