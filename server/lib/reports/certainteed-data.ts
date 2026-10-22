/**
 * CertainTeed product, color, pricing, and warranty data for BRN proposals.
 *
 * Color palette + lifestyle images are hosted on R2 (extracted from the
 * CertainTeed Landmark / Landmark PRO brochures). Tier pricing defaults are
 * Best Roofing Now's standard per-square retail rates; they can be overridden
 * per job. Reflects James's spec: Good=Landmark, Better=Landmark PRO,
 * Best=Landmark Solaris (cool roof) + full weather package.
 */

import { CREDENTIAL_MARKERS } from './brand-facts.js';

export const ASSET_BASE = 'https://reports.bestroofersnow.com/assets/certainteed';

export const COLOR_ASSETS = {
  landmark1: `${ASSET_BASE}/palette-landmark-1.jpg`,
  landmark2: `${ASSET_BASE}/palette-landmark-2.jpg`,
  pro: `${ASSET_BASE}/palette-landmark-pro.jpg`,
  roofs: [`${ASSET_BASE}/roof-1.jpg`, `${ASSET_BASE}/roof-2.jpg`, `${ASSET_BASE}/roof-3.jpg`, `${ASSET_BASE}/roof-4.jpg`],
} as const;

export type TierKey = 'good' | 'better' | 'best';

export interface ProductTier {
  key: TierKey;
  label: string;            // Good | Better | Best
  shingle: string;          // CertainTeed Landmark ...
  accent: string;
  tagline: string;
  body: string;             // educational paragraph (may contain entities)
  ratePerSquare: number;    // default BRN retail rate
  recommended?: boolean;
}

/** Default per-square rates (James's Carbonaro pricing convention). */
export const DEFAULT_RATES: Record<TierKey, number> = {
  good: 427.99,
  better: 472.99,
  best: 699.99, // Landmark Solaris (2026-09)
};

export const PRODUCT_TIERS: ProductTier[] = [
  {
    key: 'good', label: 'Good', shingle: 'CertainTeed Landmark', accent: '#2E7D52',
    ratePerSquare: DEFAULT_RATES.good,
    tagline: "America's #1-selling architectural shingle",
    body: "The trusted classic. Landmark's dual-layer (two-piece laminated fiberglass) construction gives your roof real depth and dependable, long-lasting protection. It carries StreakFighter&reg; algae resistance with copper granules, the NailTrak&reg; line for an accurate install, and the widest color palette in the industry.",
  },
  {
    key: 'better', label: 'Better', shingle: 'CertainTeed Landmark PRO', accent: '#C8102E',
    ratePerSquare: DEFAULT_RATES.better,
    tagline: "The expert's choice — heavier, richer, tougher",
    body: "Landmark PRO is built to the professional's spec. More weathering asphalt on the industry's toughest fiberglass mat means more protection, and Max Def color blends give the roof a brighter, more vibrant, more dramatic look. It outweighs standard laminates and steps the algae warranty up to 15 years.",
  },
  {
    key: 'best', label: 'Best', shingle: 'CertainTeed Landmark Solaris', accent: '#B8860B', recommended: true,
    ratePerSquare: DEFAULT_RATES.best,
    tagline: 'A cool roof that pays you back — plus our full weather package',
    body: "Landmark Solaris is a solar-reflective cool roof. Its High Index granules bounce the sun's heat away instead of soaking it up, helping keep your attic cooler and trimming summer cooling bills &mdash; the colors meet CRRC and California Title 24 energy standards. You still get Max Def color, Class A fire and Class 3 impact resistance, and StreakFighter algae protection. We pair it with our complete weather package: metal drip edge on every eave and rake, Ice &amp; Water shield carried up the rakes, and extra nailing for maximum wind hold-down.",
  },
];

/** Scope comparison. Value is true (included), false (not), or a string label. */
export const SCOPE_ROWS: Array<[string, boolean | string, boolean | string, boolean | string]> = [
  ['Complete tear-off of existing roof & haul-away', true, true, true],
  ['Synthetic underlayment over the entire deck', true, true, true],
  ['Ice & Water shield in all valleys', true, true, true],
  ['New starter strip, pipe boots, flashings & sealants', true, true, true],
  ['CertainTeed hip & ridge cap shingles', true, true, true],
  ['Ridge / attic ventilation as needed', true, true, true],
  ['Full cleanup + magnetic nail sweep', true, true, true],
  ['50-Year Manufacturer Warranty', true, true, true],
  ['15-Year Workmanship Warranty', true, true, true],
  ['Shingle', 'Landmark', 'Landmark PRO', 'Landmark Solaris'],
  ['Max Def color palette', false, true, true],
  ['Algae-resistance coverage', '10-year', '15-year', '15-year'],
  ['Solar-reflective cool-roof (energy savings)', false, false, true],
  ['Metal drip edge — eaves & rakes', false, false, true],
  ['Ice & Water shield on rakes (added to valleys)', false, false, true],
  ['Extra nailing for high-wind security', false, false, true],
];

export const COMPANY_VALUES: Array<[string, string]> = [
  ['Integrity First', 'We tell the truth, even when it means losing a sale.'],
  ['Service Before Self', 'A military value Fred carried out of the service and into every project.'],
  ['Excellence in All We Do', 'The highest standards, from the tear-off to the final nail sweep.'],
  ['Family Values', "We treat your home exactly like it's our own family's."],
];

/** The same values addressed to a building owner — commercial documents never say "your home". */
export const COMPANY_VALUES_COMMERCIAL: Array<[string, string]> = COMPANY_VALUES.map(([t, d]) =>
  t === 'Family Values' ? [t, "We treat your building exactly like it's our own family's."] : [t, d],
);

export const OWNERS_STORY = {
  heading: 'A father, a son, and a higher standard',
  paragraphs: [
    'Best Roofing Now was founded by <b>Fred Turner</b>, a military veteran, and his son <b>James Turner</b>. Fred brought the discipline, accountability, and service-before-self mindset of his years in the military; James brought the business side. Together they saw what was wrong with the roofing industry &mdash; the pressure, the cut corners, the half-truths &mdash; and decided to do it differently.',
    "That's why our crews are our own, our work is photo-documented, and our first answer is always the honest one. When we say your roof is built right, it's because a Turner put their name on it.",
  ],
  signature: '&mdash; Fred &amp; James Turner, Best Roofing Now',
};

/** CertainTeed Integrity Roof System components (educational). */
export const INTEGRITY_SYSTEM: Array<[string, string]> = [
  ['WinterGuard&trade; Waterproofing Underlayment', "CertainTeed's self-adhering ice &amp; water membrane goes down first in the valleys, around penetrations, and along vulnerable edges. It seals around each nail, so wind-driven rain and ice-dam backup can't find a way in."],
  ['Water-Resistant Underlayment', "A synthetic underlayment (RoofRunner&trade; / DiamondDeck&reg;) covers the entire deck &mdash; lighter, stronger, and far more water-resistant than old felt paper. It's the secondary barrier that protects the wood if water ever gets past the shingles."],
  ['SwiftStart&reg; Starter Shingles', 'A factory starter course runs along every eave and rake. Its pre-applied adhesive locks down the first row exactly where wind uplift begins, so the edges of your roof stay sealed in a storm.'],
  ['Landmark&reg; Shingles', 'The visible, weather-facing layer &mdash; your choice of Landmark, Landmark PRO, or Landmark Solaris. Dual-layer construction gives the roof its depth, durability, and StreakFighter&reg; algae protection.'],
  ['Cedar Crest&reg; Hip &amp; Ridge Caps', "Heavyweight accessory shingles cap the hips and ridges. They seal the most exposed lines on the roof and give it that finished, high-profile look a ridge of cut shingles can't match."],
  ['Ridge Vent + Intake Ventilation', 'Balanced exhaust and intake venting lets the attic breathe &mdash; cooler in summer, drier in winter. Proper ventilation is also required to keep the manufacturer warranty in force.'],
];

export const WARRANTY = {
  manufacturerYears: 50,
  workmanshipYears: 15, // CertainTeed-backed workmanship (product/manufacturer coverage is the 50-yr figure)
  certificationCopy:
    "Here's something most homeowners don't know: a manufacturer's strongest warranties can only be registered by <b>credentialed contractors</b> who install the full system. Best Roofing Now is a <b>CertainTeed-certified contractor</b>, and because we install the complete Integrity Roof System&trade; with qualifying CertainTeed components, we can register CertainTeed's extended SureStart&trade; PLUS coverage on your roof. That's the reason we can stand behind every roof &mdash; Good, Better, or Best &mdash; with the warranty below. A non-certified roofer simply can't offer it.",
};

/**
 * Re-exported from brand-facts.ts — do NOT re-add a literal list here.
 * This used to be its own array saying "5★ BBB A+" and "CertainTeed
 * Certified", while brn-brand.ts held a different list. Both were wrong and
 * both were on customer documents. brand-facts.test.ts fails if a literal
 * comes back.
 */
export const CRED_MARKERS = CREDENTIAL_MARKERS;
