/**
 * Manufacturer-published specs (wind, impact, fire, algae warranty, colors)
 * for every product in ROOFING_PRODUCTS (roofing-products.ts), sourced
 * directly from CertainTeed/Tamko technical data sheets, summary brochures,
 * and CertainTeed's Roofing Selection Guide (Code No. 00-00-258-US-EN,
 * printed 01/26 — the newest CertainTeed document found; used as the
 * tie-breaker wherever an older brochure disagrees with it).
 *
 * Two things confirmed with the owner before this was written rather than
 * guessed:
 *  - The catalog's "Tamko Titan Basic" isn't a real Tamko product name —
 *    their only current Titan line is the premium Titan XT. The owner confirmed
 *    that's the intended product, so specs below are Titan XT's real ones.
 *  - CertainTeed's own documents disagree with each other on a few color
 *    lists across print dates/regions (Landmark, Landmark PRO, Landmark
 *    Premium, Presidential Shake) — colorNote flags this per-product rather
 *    than silently picking one list and presenting it as uncontested.
 *
 * Standing Seam Metal has no manufacturer spec here on purpose — it's a
 * generic system description (roofing-products.ts), not one named
 * manufacturer's published product, so there's no data sheet to cite.
 */
import type { ProductKey } from './roofing-products.js';

export interface ProductSpec {
  windRatingText: string;
  impactClass: string;
  fireRating: string;
  algaeWarrantyYears: number;
  colors: string[];
  colorNote?: string;
}

export const PRODUCT_SPECS: Partial<Record<ProductKey, ProductSpec>> = {
  tamko_titan_basic: {
    windRatingText: 'ASTM D3161 Class F, ASTM D7158 Class H — 15-year warranty for winds up to 160 mph with Tamko starter strip + hip &amp; ridge',
    impactClass: 'UL 2218 Class 3',
    fireRating: 'UL Class A',
    algaeWarrantyYears: 10,
    colors: ['Autumn Brown', 'Black Walnut', 'Mountain Slate', 'Natural Timber', 'Painted Desert', 'Thunderstorm Grey', 'Antique Slate', 'Desert Sand', 'Glacier White', 'Olde English Pewter', 'Oxford Grey', 'Rustic Black', 'Rustic Cedar', 'Rustic Evergreen', 'Rustic Hickory', 'Rustic Redwood', 'Rustic Slate', 'Shadow Grey', 'Virginia Slate', 'Weathered Wood'],
  },
  landmark: {
    windRatingText: 'ASTM D3161 Class F, ASTM D7158 Class H — 15-year 110 mph wind warranty, upgradeable to 160 mph with CertainTeed starter strip + hip &amp; ridge',
    impactClass: 'UL 2218 Class 3',
    fireRating: 'UL Class A',
    algaeWarrantyYears: 25,
    colors: ['Georgetown Gray', 'Weathered Wood', 'Moiré Black', 'Thunderstorm Gray', 'Terra Cotta', 'Burnt Sienna', 'Heather Blend', 'Painted Desert', 'Sunrise Cedar'],
    colorNote: 'CertainTeed’s current (01/26) color lineup for this product; an older brochure lists several different names (Silver Birch, Cobblestone Gray, Resawn Shake, Hunter Green, Colonial Slate). Availability is plant/region-dependent — confirm the exact local-market lineup before a customer picks.',
  },
  landmark_pro: {
    windRatingText: 'ASTM D3161 Class F, ASTM D7158 Class H — 15-year 110 mph wind warranty, upgradeable to 160 mph with CertainTeed starter strip + hip &amp; ridge',
    impactClass: 'UL 2218 Class 3',
    fireRating: 'UL Class A',
    algaeWarrantyYears: 30,
    colors: ['Max Def Burnt Sienna', 'Max Def Georgetown Gray', 'Max Def Heather Blend', 'Max Def Moiré Black', 'Max Def Weathered Wood'],
    colorNote: 'Additional Max Def names appear in some CertainTeed marketing pages but not in the current Selection Guide — confirm current availability before a customer picks a color outside this list.',
  },
  landmark_premium: {
    windRatingText: 'ASTM D3161 Class F, ASTM D7158 Class H — 15-year 110 mph wind warranty, upgradeable to 160 mph with CertainTeed starter strip + hip &amp; ridge',
    impactClass: 'UL 2218 Class 4',
    fireRating: 'UL Class A',
    algaeWarrantyYears: 30,
    colors: ['Max Def Burnt Sienna', 'Max Def Heather Blend', 'Max Def Moiré Black', 'Max Def Weathered Wood'],
  },
  landmark_belmont: {
    windRatingText: 'ASTM D3018 Type 1, ASTM D3161 Class F — 15-year 110 mph wind warranty, upgradeable to 130 mph with CertainTeed starter strip + hip &amp; ridge',
    impactClass: 'UL 2218 Class 4',
    fireRating: 'UL Class A',
    algaeWarrantyYears: 30,
    colors: ['Black Granite', 'Colonial Slate', 'Shenandoah', 'Stonegate Gray', 'Weathered Wood'],
    colorNote: 'CertainTeed’s brochure shows a larger color wheel with a few additional blends that didn’t extract cleanly from the source PDF — confirm the full current lineup on certainteed.com before a customer picks outside this list.',
  },
  landmark_grand_manor: {
    windRatingText: 'ASTM D3161 Class F — designed for 110 mph normal / 130 mph special installation; 15-year 110 mph wind warranty, upgradeable to 130 mph with CertainTeed starter strip + hip &amp; ridge',
    impactClass: 'UL 2218 Class 4',
    fireRating: 'UL Class A',
    algaeWarrantyYears: 30,
    colors: ['Black Pearl', 'Chestnut', 'Brownstone', 'Colonial Slate', 'Gatehouse Slate', 'Georgian Brick', 'Sherwood Forest', 'Stonegate Gray', 'Weathered Wood'],
  },
  landmark_presidential: {
    windRatingText: 'ASTM D3161 Class F, ASTM D3018 Type 1 — designed for 110 mph normal / 130 mph special installation; 15-year 110 mph wind warranty, upgradeable to 130 mph with CertainTeed starter strip + hip &amp; ridge',
    impactClass: 'UL 2218 Class 3 (Class 4 available in select colors, regional)',
    fireRating: 'UL Class A',
    algaeWarrantyYears: 30,
    colors: ['Aged Bark', 'Autumn Blend', 'Charcoal Black', 'Country Gray', 'Shadow Gray', 'Weathered Wood'],
    colorNote: 'CertainTeed’s brochure and Selection Guide (both current) disagree slightly on this list — shown here combined; confirm the exact current lineup before a customer picks.',
  },
  landmark_solaris: {
    windRatingText: 'ASTM D3161 Class F, ASTM D7158 Class H — 15-year 110 mph wind warranty, upgradeable to 130 mph with CertainTeed starter strip + hip &amp; ridge',
    impactClass: 'UL 2218 Class 3',
    fireRating: 'UL Class A',
    algaeWarrantyYears: 25,
    colors: ['Silver Birch', 'Mist White', 'Birchwood', 'Georgetown Gray', 'Weathered Wood', 'Graphite', 'Moiré Black', 'Burnt Sienna', 'Heather Blend', 'Resawn Shake', 'Mojave Tan', 'High Index Moonstone', 'High Index Redwood Canyon', 'High Index Sand Dune'],
  },
};

export function specFor(key: ProductKey | string): ProductSpec | null {
  return (PRODUCT_SPECS as Partial<Record<string, ProductSpec>>)[key] ?? null;
}
