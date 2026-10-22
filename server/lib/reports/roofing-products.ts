/**
 * The real, sellable roofing product catalog and pricing rules.
 *
 * Replaces the old fixed three-tier model in certainteed-data.ts (PRODUCT_TIERS /
 * DEFAULT_RATES / SCOPE_ROWS), which hardcoded exactly Landmark / Landmark PRO /
 * Landmark Solaris as Good/Better/Best. A rep now picks any three of these
 * products to fill Good/Better/Best on a given job — the comparison is built
 * from whichever three they choose, not a fixed set.
 *
 * Product content unrelated to per-product pricing (INTEGRITY_SYSTEM,
 * COLOR_ASSETS) lives in certainteed-data.ts; everything about the company
 * itself comes from its profile (company-brand.ts).
 */

import {
  commercialProductByKey, isoRatePerSquare, ISO_LABELS,
  type CommercialProductKey, type IsoTier,
} from './commercial-products.js';
import {
  SERVICE_TIER_LABELS, isServiceTierKey, serviceTierRateOk, type ServiceTierKey,
} from '../../../shared/addon-pricing.js';
import { companyBrand } from './company-brand.js';

export type ProductKey =
  | 'tamko_titan_basic'
  | 'landmark'
  | 'landmark_pro'
  | 'landmark_premium'
  | 'landmark_belmont'
  | 'landmark_grand_manor'
  | 'landmark_presidential'
  | 'landmark_solaris'
  | 'standing_seam_metal'
  | 'stone_coated_steel'
  | 'cedur_shake'
  | 'davinci_shake'
  | 'custom';

/** A residential catalog key, a commercial low-slope one (commercial-products.ts), or a service tier. */
export type AnyProductKey = ProductKey | CommercialProductKey | ServiceTierKey;

export interface RoofingProduct {
  key: AnyProductKey;
  manufacturer: string;
  name: string;            // full display name, e.g. "CertainTeed Landmark PRO"
  /** 'service' is a tune-up or cleaning on the existing roof — nothing is installed. */
  category: 'shingle' | 'metal' | 'commercial' | 'service';
  /** Commercial only: what the crew does to the existing roof (commercial-products.ts). */
  system?: 'tear_off' | 'layover' | 'coating';
  ratePerSquare: number;   // standard retail rate, per square
  tagline: string;
  body: string;            // educational paragraph, may contain HTML entities
}

/**
 * The 8 products originally specified, plus Landmark Solaris (the
 * existing cool-roof option) kept as a 9th choice rather than dropped, and
 * three specialty additions: Stone-Coated Steel, CeDur synthetic shake, and
 * DaVinci synthetic slate/shake. Those three are priced from public
 * market-rate research (no dealer quote was available at the time) — confirm
 * against an actual supplier cost before relying on the margin on a real job.
 *
 * Kept in ascending price order, because this is the order the rep's
 * Good/Better/Best pickers list them in. The additions were once appended at
 * the end, so the picker ran $2,099 metal, then $699.99 Solaris, then
 * $1,099.99 steel — a rep reading down the list for "the next step up" got a
 * cheaper roof. A test holds the order.
 */
export const ROOFING_PRODUCTS: RoofingProduct[] = [
  {
    key: 'tamko_titan_basic', manufacturer: 'Tamko', name: 'Tamko Titan Basic', category: 'shingle',
    ratePerSquare: 429.99,
    tagline: 'A solid, budget-conscious architectural shingle',
    body: 'A dependable entry-level architectural shingle backed by a limited lifetime manufacturer warranty. The right call when the roof needs to be sound and code-compliant without the premium features of the CertainTeed lineup.',
  },
  {
    key: 'landmark', manufacturer: 'CertainTeed', name: 'CertainTeed Landmark', category: 'shingle',
    ratePerSquare: 479.99,
    tagline: "America's #1-selling architectural shingle",
    body: "The trusted classic. Landmark's dual-layer (two-piece laminated fiberglass) construction gives your roof real depth and dependable, long-lasting protection. It carries StreakFighter&reg; algae resistance with copper granules, the NailTrak&reg; line for an accurate install, and the widest color palette in the industry.",
  },
  {
    key: 'landmark_pro', manufacturer: 'CertainTeed', name: 'CertainTeed Landmark PRO', category: 'shingle',
    ratePerSquare: 509,
    tagline: "The expert's choice — heavier, richer, tougher",
    body: 'Landmark PRO is built to the professional&rsquo;s spec. More weathering asphalt on the industry&rsquo;s toughest fiberglass mat means more protection, and Max Def color blends give the roof a brighter, more vibrant, more dramatic look. It outweighs standard laminates and steps the algae warranty up from the base Landmark.',
  },
  {
    key: 'landmark_premium', manufacturer: 'CertainTeed', name: 'CertainTeed Landmark Premium', category: 'shingle',
    ratePerSquare: 619,
    tagline: 'Premium weight and color depth beyond Landmark PRO',
    body: 'Landmark Premium steps up the mat weight and color depth again, for homeowners who want the heaviest standard laminate CertainTeed makes before moving into the designer Landmark collections.',
  },
  {
    key: 'landmark_solaris', manufacturer: 'CertainTeed', name: 'CertainTeed Landmark Solaris', category: 'shingle',
    ratePerSquare: 699.99,
    tagline: 'A cool roof that pays you back',
    body: "Landmark Solaris is a solar-reflective cool roof. Its High Index granules bounce the sun's heat away instead of soaking it up, helping keep the attic cooler and trimming summer cooling bills — the colors meet CRRC and California Title 24 energy standards.",
  },
  {
    key: 'landmark_belmont', manufacturer: 'CertainTeed', name: 'CertainTeed Landmark Belmont', category: 'shingle',
    ratePerSquare: 919.99,
    tagline: 'A designer shingle with genuine dimensional character',
    body: "Belmont is one of CertainTeed's designer profiles — a bolder, more dimensional shingle silhouette that reads as a true architectural upgrade from the street, not just a heavier version of a standard laminate.",
  },
  {
    key: 'landmark_grand_manor', manufacturer: 'CertainTeed', name: 'CertainTeed Landmark Grand Manor', category: 'shingle',
    ratePerSquare: 989.99,
    tagline: 'The look of natural slate, without the cost or weight',
    body: 'Grand Manor is styled after luxury slate roofing, with a deep shadow line and heavyweight construction, at a fraction of real slate&rsquo;s cost and structural demands.',
  },
  {
    key: 'stone_coated_steel', manufacturer: '', name: 'Stone-Coated Steel Shingles', category: 'metal',
    ratePerSquare: 1099.99,
    tagline: 'A steel roof styled like a shingle',
    body: 'Stone-coated steel combines the impact and wind resistance of a steel roofing system with a stone-granule finish styled after a traditional shingle or shake — a lifetime metal roof that reads as a shingle roof from the street.',
  },
  {
    key: 'landmark_presidential', manufacturer: 'CertainTeed', name: 'CertainTeed Landmark Presidential', category: 'shingle',
    ratePerSquare: 1359.99,
    tagline: "CertainTeed's flagship shingle — the top of the shingle lineup",
    body: 'Presidential Shake is CertainTeed&rsquo;s premier designer shingle, styled after natural wood shake with the deepest dimension and heaviest build in the lineup — the top choice for a homeowner who wants the best shingle roof available, full stop.',
  },
  {
    key: 'cedur_shake', manufacturer: 'CeDur', name: 'CeDur Synthetic Shake', category: 'shingle',
    ratePerSquare: 1749.99,
    tagline: 'The look of cedar shake, built to never rot, split, or burn',
    body: "CeDur's synthetic shake is a polyurethane shake styled after natural cedar, at a fraction of the weight — roughly 170 lbs. per square, about a quarter of real wood shake. It carries a Class A fire rating and resists the rot, splitting, and insect damage that eventually come for real cedar.",
  },
  {
    key: 'standing_seam_metal', manufacturer: '', name: 'Standing Seam Metal Roof', category: 'metal',
    ratePerSquare: 2099,
    tagline: 'A lifetime metal roof system',
    body: 'Standing seam metal is a fully different roofing system from asphalt shingles — concealed fasteners, raised interlocking seams, and a service life measured in decades rather than years. The right recommendation when a homeowner wants to stop thinking about their roof.',
  },
  {
    key: 'davinci_shake', manufacturer: 'DaVinci', name: 'DaVinci Synthetic Slate/Shake', category: 'shingle',
    ratePerSquare: 2149.99,
    tagline: 'Designer synthetic slate and shake, without the cost or weight of the real thing',
    body: "DaVinci's composite slate and shake profiles are molded from natural stone and cedar to capture the same texture, shadow line, and color depth, at a fraction of the weight and typically 20-30% below the cost of the real material — backed by a manufacturer warranty real slate and cedar can't match.",
  },
];

export function productByKey(key: ProductKey): RoofingProduct | undefined {
  return ROOFING_PRODUCTS.find((p) => p.key === key);
}

/** A one-off product and price a rep types in for a job, instead of picking from the catalog. */
export interface CustomProductInput {
  name: string;
  ratePerSquare: number;
}

export function isCustomProductInput(v: unknown): v is CustomProductInput {
  return !!v && typeof v === 'object' && typeof (v as any).name === 'string';
}

/** Turn a rep-typed custom product into the same shape as a catalog RoofingProduct. */
function resolveCustomProduct(input: CustomProductInput): RoofingProduct | null {
  const name = input.name.trim();
  const rate = Number(input.ratePerSquare);
  if (!name || !Number.isFinite(rate) || rate <= 0) return null;
  return {
    key: 'custom',
    manufacturer: 'Custom',
    name: name.slice(0, 120),
    category: 'shingle',
    ratePerSquare: Math.round(rate * 100) / 100,
    tagline: 'Custom product and pricing for this job',
    body: 'A custom product and price entered by your rep for this specific job — ask them for material and warranty details.',
  };
}

/** A tune-up or cleaning in a Good/Better/Best slot, at the rate the rep set for this job ($29–$99/sq). */
export interface ServiceTierInput {
  service: ServiceTierKey;
  ratePerSquare: number;
}

export function isServiceTierInput(v: unknown): v is ServiceTierInput {
  return !!v && typeof v === 'object' && isServiceTierKey((v as any).service);
}

const SERVICE_COPY: Record<ServiceTierKey, { tagline: string; body: string }> = {
  tune_up: {
    tagline: 'Care for the roof you have, to buy time before a new one',
    body: 'A tune-up is maintenance for the roof you already have. Our crew reseals and re-secures the small things that let water in first &mdash; loose shingles, exposed nails, and tired flashings and pipe boots. It does not reset your roof&rsquo;s age or promise against future leaks. It takes care of the weak spots we can see today.',
  },
  cleaning: {
    tagline: 'A clean roof that sheds water the way it should',
    body: 'A cleaning takes off the dark streaks, moss and algae that hold water against the shingles, and clears the debris that blocks water from running off. It makes the roof look better and helps it last. It is maintenance, not a repair or a warranty.',
  },
};

/** What the price of each service covers, in plain words. Shown in place of a new roof's list. */
export const SERVICE_INCLUDES: Record<ServiceTierKey, string[]> = {
  tune_up: [
    'Reseal and re-secure loose or lifted shingles',
    'Seal exposed nail heads',
    'Reseal tired flashings and pipe boots',
    'Photos of the work when we are done',
  ],
  cleaning: [
    'Clean off the dark streaks, moss and algae',
    'Clear leaves and debris off the roof and out of the valleys',
    'Photos of the roof when we are done',
  ],
};

/** A tune-up or cleaning, in the same shape as a catalog product. null when the rate is outside $29–$99. */
function resolveServiceProduct(input: ServiceTierInput): RoofingProduct | null {
  if (!serviceTierRateOk(input.ratePerSquare)) return null;
  return {
    key: input.service,
    manufacturer: companyBrand().displayName,
    name: SERVICE_TIER_LABELS[input.service],
    category: 'service',
    ratePerSquare: Math.round(Number(input.ratePerSquare) * 100) / 100,
    ...SERVICE_COPY[input.service],
  };
}

/** True for a tune-up or cleaning tier — work on the existing roof, nothing installed. */
export function isServiceProduct(p: Pick<RoofingProduct, 'category'> | null | undefined): boolean {
  return p?.category === 'service';
}

/**
 * A commercial low-slope system in the same shape as a residential product,
 * so a tier can hold either and everything downstream (pricing, the option
 * cards, the walkthrough, the JobTread line) treats them alike. `system`
 * rides along because the ISO add-on and the "what's included" list depend
 * on whether the old roof comes off.
 */
export function commercialAsProduct(key: CommercialProductKey): RoofingProduct | null {
  const c = commercialProductByKey(key);
  if (!c) return null;
  return {
    key: c.key, manufacturer: c.manufacturer, name: c.name, category: 'commercial', system: c.system,
    ratePerSquare: c.ratePerSquare, tagline: c.tagline, body: c.body,
  };
}

/** A catalog key (residential or commercial), a rep-typed custom product+rate, or a tune-up/cleaning at the rep's rate. */
export type TierProductInput = ProductKey | CommercialProductKey | CustomProductInput | ServiceTierInput;

/** Good/Better/Best is three rep-chosen products (catalog or custom), not a fixed set. */
export interface TierSelection {
  good: TierProductInput;
  better: TierProductInput;
  best: TierProductInput;
}

function resolveProduct(input: TierProductInput): RoofingProduct | null {
  if (isServiceTierInput(input)) return resolveServiceProduct(input);
  if (isCustomProductInput(input)) return resolveCustomProduct(input);
  return productByKey(input as ProductKey) ?? commercialAsProduct(input as CommercialProductKey);
}

export function resolveTierSelection(sel: TierSelection): { good: RoofingProduct; better: RoofingProduct; best: RoofingProduct } | null {
  const good = resolveProduct(sel.good);
  const better = resolveProduct(sel.better);
  const best = resolveProduct(sel.best);
  if (!good || !better || !best) return null;
  return { good, better, best };
}

export interface TierPricing {
  tier: 'good' | 'better' | 'best';
  product: RoofingProduct;
  squares: number;
  /** Per square, INCLUDING the ISO when this tier carries it — so rate × squares is the total the card shows. */
  ratePerSquare: number;
  total: number;
  /**
   * ISO insulation folded into this tier. Only a tear-off commercial system
   * carries it: a layover keeps the existing insulation and a coating never
   * touches it, so the same job-level ISO choice prices only the tiers that
   * actually strip to the deck — the comparison stays honest tier by tier.
   */
  iso?: { tier: IsoTier; label: string; ratePerSquare: number; total: number };
}

export interface TierPricingOptions {
  /** ISO R-value for any tear-off commercial tier in the selection; ignored elsewhere. */
  isoTier?: IsoTier | null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Good/Better/Best priced against a confirmed roof size — the comparison an Estimate/Proposal/Presentation shows for a full replacement. */
export function computeTierPricing(selection: TierSelection, squares: number, opts: TierPricingOptions = {}): { good: TierPricing; better: TierPricing; best: TierPricing } | null {
  const resolved = resolveTierSelection(selection);
  if (!resolved || !(squares > 0)) return null;
  const priced = (tier: 'good' | 'better' | 'best', product: RoofingProduct): TierPricing => {
    const iso = opts.isoTier && product.system === 'tear_off'
      ? { tier: opts.isoTier, label: ISO_LABELS[opts.isoTier], ratePerSquare: isoRatePerSquare(opts.isoTier), total: round2(isoRatePerSquare(opts.isoTier) * squares) }
      : undefined;
    const ratePerSquare = round2(product.ratePerSquare + (iso?.ratePerSquare ?? 0));
    return { tier, product, squares, ratePerSquare, total: round2(ratePerSquare * squares), ...(iso ? { iso } : {}) };
  };
  return { good: priced('good', resolved.good), better: priced('better', resolved.better), best: priced('best', resolved.best) };
}

/** The line-item name for the tier being sold: what happens to the old roof, then the product. */
export function replacementLineName(t: Pick<TierPricing, 'product' | 'iso'>): string {
  if (isServiceProduct(t.product)) return t.product.name;
  const what = t.product.system === 'layover' ? 'Roof Recover (layover)'
    : t.product.system === 'coating' ? 'Roof Restoration Coating'
    : 'Full Roof Replacement';
  return `${what} — ${t.product.name}${t.iso ? ` + ${t.iso.label}` : ''}`;
}

// Tune-Up and Perma-Boot add-on pricing lives in shared/addon-pricing.ts —
// shared with the client so a rep's "quick add" buttons price them the same
// way the server would.
