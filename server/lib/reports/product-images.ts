/**
 * Per-product photography for the "what you're buying" panel.
 *
 * Residential entries stay EMPTY on purpose: every shingle, metal and
 * synthetic product falls back to the generic installed-roof photo, captioned
 * honestly as a generic photo. Populate only with a picture of the actual
 * product, because the caption changes to name the product when an entry
 * exists here.
 *
 * The commercial systems have their own imagery under
 * client/public/roof-systems/ (roof-systems.ts), so a Duro-Last or GAF quote
 * never shows a CertainTeed shingle roof as its product photo.
 */
import type { AnyProductKey } from './roofing-products.js';
import { COLOR_ASSETS } from './certainteed-data.js';
import { assetUrl } from './roof-systems.js';

export interface ProductImage { src: string; caption: string }

export const PRODUCT_IMAGES: Partial<Record<AnyProductKey, ProductImage>> = {
  dura_last_tpo: { src: assetUrl('duro-last/membrane-installed.jpg'), caption: 'A completed Duro-Last&reg; PVC roof &mdash; manufacturer photo, not your building.' },
  dura_last_layover: { src: assetUrl('duro-last/membrane-installed.jpg'), caption: 'A completed Duro-Last&reg; PVC roof &mdash; manufacturer photo, not your building.' },
  gaf_commercial_tpo: { src: assetUrl('gaf/tpo-installed.jpg'), caption: 'GAF EverGuard&reg; TPO assembly, deck to membrane &mdash; manufacturer illustration.' },
};

export const GENERIC_ROOF_PHOTO = COLOR_ASSETS.roofs[0];
export const GENERIC_ROOF_CAPTION =
  'Real installed CertainTeed roofing &mdash; not a rendering, not your house.';
