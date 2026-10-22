/**
 * CertainTeed product, color, pricing, and warranty data for roofing proposals
 * (the roofing trade pack).
 *
 * Color palette + lifestyle images are served from REPORT_ASSET_BASE
 * (extracted from the CertainTeed Landmark / Landmark PRO brochures). Tier
 * pricing defaults are starting per-square retail rates; they can be
 * overridden per job. Good=Landmark, Better=Landmark PRO, Best=Landmark
 * Solaris (cool roof) + full weather package.
 */
import { companyBrand } from './company-brand.js';

/** Where report images (product photos, palettes) are hosted. Set REPORT_ASSET_BASE in production. */
export const REPORT_ASSET_BASE = (process.env.REPORT_ASSET_BASE || '/report-assets').replace(/\/$/, '');
export const ASSET_BASE = `${REPORT_ASSET_BASE}/certainteed`;

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
  ratePerSquare: number;    // default retail rate
  recommended?: boolean;
}

/** Default per-square rates (charm pricing). Starting points until the company sets its own. */
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

/** CertainTeed Integrity Roof System components (educational). */
export const INTEGRITY_SYSTEM: Array<[string, string]> = [
  ['WinterGuard&trade; Waterproofing Underlayment', "CertainTeed's self-adhering ice &amp; water membrane goes down first in the valleys, around penetrations, and along vulnerable edges. It seals around each nail, so wind-driven rain and ice-dam backup can't find a way in."],
  ['Water-Resistant Underlayment', "A synthetic underlayment (RoofRunner&trade; / DiamondDeck&reg;) covers the entire deck &mdash; lighter, stronger, and far more water-resistant than old felt paper. It's the secondary barrier that protects the wood if water ever gets past the shingles."],
  ['SwiftStart&reg; Starter Shingles', 'A factory starter course runs along every eave and rake. Its pre-applied adhesive locks down the first row exactly where wind uplift begins, so the edges of your roof stay sealed in a storm.'],
  ['Landmark&reg; Shingles', 'The visible, weather-facing layer &mdash; your choice of Landmark, Landmark PRO, or Landmark Solaris. Dual-layer construction gives the roof its depth, durability, and StreakFighter&reg; algae protection.'],
  ['Cedar Crest&reg; Hip &amp; Ridge Caps', "Heavyweight accessory shingles cap the hips and ridges. They seal the most exposed lines on the roof and give it that finished, high-profile look a ridge of cut shingles can't match."],
  ['Ridge Vent + Intake Ventilation', 'Balanced exhaust and intake venting lets the attic breathe &mdash; cooler in summer, drier in winter. Proper ventilation is also required to keep the manufacturer warranty in force.'],
];

/** CertainTeed's manufacturer warranty on the full Integrity Roof System, in years. */
export const MANUFACTURER_WARRANTY_YEARS = 50;

/** True when the company has entered a CertainTeed credential (ShingleMaster, SELECT, etc.). */
export function isCertainTeedCredentialed(): boolean {
  const p = companyBrand();
  return [...p.certifications, ...p.credentials].some((c) => /certainteed|shinglemaster/i.test(c));
}

/**
 * The warranty for the current company: the manufacturer's years, the
 * company's own workmanship years (null when it has not entered them), and
 * the extended-coverage copy, which is only true of a credentialed contractor.
 */
export function warranty(): { manufacturerYears: number; workmanshipYears: number | null; certificationCopy: string } {
  const p = companyBrand();
  const name = p.displayName.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return {
    manufacturerYears: MANUFACTURER_WARRANTY_YEARS,
    workmanshipYears: p.workmanshipYears,
    certificationCopy: isCertainTeedCredentialed()
      ? `Here's something most homeowners don't know: a manufacturer's strongest warranties can only be registered by <b>credentialed contractors</b> who install the full system. ${name} is a <b>CertainTeed-credentialed contractor</b>, and because we install the complete Integrity Roof System&trade; with qualifying CertainTeed components, we can register CertainTeed's extended SureStart&trade; PLUS coverage on your roof. That's the reason we can stand behind every roof &mdash; Good, Better, or Best &mdash; with the warranty below.`
      : `Your roof is installed as a complete CertainTeed Integrity Roof System&trade;: every layer comes from one manufacturer and is installed to its instructions, which is what keeps the manufacturer's warranty in force.`,
  };
}
