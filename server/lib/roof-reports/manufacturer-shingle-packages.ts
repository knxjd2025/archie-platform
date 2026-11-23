/**
 * Premade Manufacturer Shingle Packages
 * 5 major manufacturers with 5+ product lines each, mapped to Good/Better/Best tiers.
 * Companies can select these as presets in Settings for their System Packages.
 */

/** Pricing-tier name used across the report estimator. */
export type ShingleTier = 'good' | 'better' | 'best';

/** Physical/aesthetic shingle category. Influences `getDefaultTierSet` preferences. */
export type ShingleType = '3-tab' | 'architectural' | 'designer' | 'luxury';

/** UL-2218 impact rating (also accepts `'N/A'` for non-rated products). */
export type ImpactRating = 'Class 1' | 'Class 2' | 'Class 3' | 'Class 4' | 'N/A';

/** Preferred shingle type for the Good tier in `getDefaultTierSet`. */
const PREFERRED_GOOD_TYPE: ShingleType = 'architectural';

/** Preferred shingle type for the Best tier in `getDefaultTierSet`. */
const PREFERRED_BEST_TYPE: ShingleType = 'designer';

export interface ShingleProduct {
  id: string;
  manufacturer: string;
  productLine: string;
  tier: ShingleTier;
  pricePerSq: number;
  warrantyYears: number;
  windRatingMph: number;
  impactRating: ImpactRating;
  type: ShingleType;
  description: string;
  features: string[];
  ridgeCapProduct: string;
  underlaymentRecommendation: string;
}

export interface ManufacturerPackage {
  id: string;
  manufacturer: string;
  logoUrl?: string;
  products: ShingleProduct[];
}

// ─── CertainTeed ──────────────────────────────────────────────────────────────

const certainteedProducts: ShingleProduct[] = [
  {
    id: 'ct-landmark',
    manufacturer: 'CertainTeed',
    productLine: 'Landmark',
    tier: 'good',
    pricePerSq: 95,
    warrantyYears: 30,
    windRatingMph: 110,
    impactRating: 'Class 1',
    type: 'architectural',
    description: 'Dual-layered dimensional shingle with Max Def colors for rich contrast',
    features: ['30-year limited warranty', 'StreakFighter algae resistance', '110 mph wind rating', 'Max Def color technology'],
    ridgeCapProduct: 'Shadow Ridge',
    underlaymentRecommendation: 'DiamondDeck synthetic',
  },
  {
    id: 'ct-landmark-pro',
    manufacturer: 'CertainTeed',
    productLine: 'Landmark Pro',
    tier: 'good',
    pricePerSq: 115,
    warrantyYears: 50,
    windRatingMph: 110,
    impactRating: 'Class 2',
    type: 'architectural',
    description: 'Premium architectural with heavier weight and deeper shadow lines',
    features: ['Lifetime limited warranty', 'StreakFighter algae resistance', '110 mph wind rating', 'Thicker profile for enhanced curb appeal'],
    ridgeCapProduct: 'Shadow Ridge',
    underlaymentRecommendation: 'DiamondDeck synthetic',
  },
  {
    id: 'ct-landmark-solaris',
    manufacturer: 'CertainTeed',
    productLine: 'Landmark Solaris',
    tier: 'better',
    pricePerSq: 135,
    warrantyYears: 50,
    windRatingMph: 110,
    impactRating: 'Class 2',
    type: 'architectural',
    description: 'Energy Star rated with solar-reflective granules to reduce cooling costs',
    features: ['Lifetime warranty', 'Energy Star certified', 'Cool roof technology', 'StreakFighter algae resistance'],
    ridgeCapProduct: 'Shadow Ridge',
    underlaymentRecommendation: 'DiamondDeck synthetic',
  },
  {
    id: 'ct-landmark-tl',
    manufacturer: 'CertainTeed',
    productLine: 'Landmark TL',
    tier: 'better',
    pricePerSq: 150,
    warrantyYears: 50,
    windRatingMph: 130,
    impactRating: 'Class 3',
    type: 'architectural',
    description: 'Triple-layer heavyweight architectural for maximum wind and impact resistance',
    features: ['Lifetime warranty', '130 mph wind rating', 'Triple-layer construction', 'SureNail technology'],
    ridgeCapProduct: 'Mountain Ridge',
    underlaymentRecommendation: 'WinterGuard ice & water',
  },
  {
    id: 'ct-presidential-shake',
    manufacturer: 'CertainTeed',
    productLine: 'Presidential Shake',
    tier: 'best',
    pricePerSq: 195,
    warrantyYears: 50,
    windRatingMph: 130,
    impactRating: 'Class 4',
    type: 'luxury',
    description: 'Luxury shake-look shingle with multi-layered dimensional design',
    features: ['Lifetime warranty', 'Class 4 impact rating', 'Wood shake appearance', '130 mph wind rating'],
    ridgeCapProduct: 'Mountain Ridge',
    underlaymentRecommendation: 'WinterGuard HT ice & water',
  },
  {
    id: 'ct-belmont',
    manufacturer: 'CertainTeed',
    productLine: 'Belmont',
    tier: 'best',
    pricePerSq: 225,
    warrantyYears: 50,
    windRatingMph: 130,
    impactRating: 'Class 4',
    type: 'designer',
    description: 'Designer luxury with a natural slate appearance and heavyweight construction',
    features: ['Lifetime warranty', 'Natural slate look', 'Class 4 impact', 'Premium color blends'],
    ridgeCapProduct: 'Mountain Ridge',
    underlaymentRecommendation: 'WinterGuard HT ice & water',
  },
  {
    id: 'ct-grand-manor',
    manufacturer: 'CertainTeed',
    productLine: 'Grand Manor',
    tier: 'best',
    pricePerSq: 280,
    warrantyYears: 50,
    windRatingMph: 130,
    impactRating: 'Class 4',
    type: 'luxury',
    description: 'Ultra-premium luxury shingle replicating hand-cut European shingles',
    features: ['Lifetime warranty', 'Handcrafted look', 'Class 4 impact', 'Industry heaviest weight'],
    ridgeCapProduct: 'Mountain Ridge',
    underlaymentRecommendation: 'WinterGuard HT ice & water',
  },
];

// ─── GAF ──────────────────────────────────────────────────────────────────────

const gafProducts: ShingleProduct[] = [
  {
    id: 'gaf-royal-sovereign',
    manufacturer: 'GAF',
    productLine: 'Royal Sovereign',
    tier: 'good',
    pricePerSq: 75,
    warrantyYears: 25,
    windRatingMph: 60,
    impactRating: 'N/A',
    type: '3-tab',
    description: 'Classic 3-tab with ColorMax ceramic-fired granules for reliable color',
    features: ['25-year limited warranty', 'ColorMax granules', 'Clean lines design', 'Affordable protection'],
    ridgeCapProduct: 'Seal-A-Ridge',
    underlaymentRecommendation: 'FeltBuster synthetic',
  },
  {
    id: 'gaf-timberline-hdz',
    manufacturer: 'GAF',
    productLine: 'Timberline HDZ',
    tier: 'good',
    pricePerSq: 105,
    warrantyYears: 50,
    windRatingMph: 130,
    impactRating: 'Class 1',
    type: 'architectural',
    description: "America's #1 selling shingle with StrikeZone nailing area and LayerLock technology",
    features: ['Lifetime limited warranty', '130 mph WindProven wind rating', 'LayerLock technology', 'StainGuard Plus algae protection'],
    ridgeCapProduct: 'TimberTex',
    underlaymentRecommendation: 'Deck-Armor synthetic',
  },
  {
    id: 'gaf-timberline-asii',
    manufacturer: 'GAF',
    productLine: 'Timberline AS II',
    tier: 'better',
    pricePerSq: 125,
    warrantyYears: 50,
    windRatingMph: 130,
    impactRating: 'Class 2',
    type: 'architectural',
    description: 'Advanced protection with ArmorShield technology for superior impact resistance',
    features: ['Lifetime warranty', 'ArmorShield impact resistance', 'StainGuard Plus', 'LayerLock technology'],
    ridgeCapProduct: 'TimberTex',
    underlaymentRecommendation: 'Deck-Armor premium',
  },
  {
    id: 'gaf-timberline-uhdz',
    manufacturer: 'GAF',
    productLine: 'Timberline UHDZ',
    tier: 'better',
    pricePerSq: 155,
    warrantyYears: 50,
    windRatingMph: 130,
    impactRating: 'Class 3',
    type: 'architectural',
    description: 'Ultra-high-definition with deeper shadow lines and color contrast',
    features: ['Lifetime warranty', 'Ultra HD color technology', '130 mph wind rating', 'Dual shadow line'],
    ridgeCapProduct: 'Ridglass',
    underlaymentRecommendation: 'Tiger Paw premium',
  },
  {
    id: 'gaf-grand-canyon',
    manufacturer: 'GAF',
    productLine: 'Grand Canyon',
    tier: 'best',
    pricePerSq: 200,
    warrantyYears: 50,
    windRatingMph: 130,
    impactRating: 'Class 4',
    type: 'designer',
    description: 'Designer shake look with rugged texture and deep shadow depth',
    features: ['Lifetime warranty', 'Wood shake appearance', 'Class 4 impact', '130 mph wind'],
    ridgeCapProduct: 'Ridglass',
    underlaymentRecommendation: 'WeatherWatch ice & water',
  },
  {
    id: 'gaf-camelot-ii',
    manufacturer: 'GAF',
    productLine: 'Camelot II',
    tier: 'best',
    pricePerSq: 235,
    warrantyYears: 50,
    windRatingMph: 130,
    impactRating: 'Class 4',
    type: 'luxury',
    description: 'Artisan-crafted luxury with antique slate appearance and premium protection',
    features: ['Lifetime warranty', 'Antique slate look', 'Class 4 impact', 'Triple-layer design'],
    ridgeCapProduct: 'Ridglass',
    underlaymentRecommendation: 'WeatherWatch ice & water',
  },
];

// ─── Owens Corning ────────────────────────────────────────────────────────────

const owensCorningProducts: ShingleProduct[] = [
  {
    id: 'oc-supreme',
    manufacturer: 'Owens Corning',
    productLine: 'Supreme',
    tier: 'good',
    pricePerSq: 70,
    warrantyYears: 25,
    windRatingMph: 60,
    impactRating: 'N/A',
    type: '3-tab',
    description: 'Traditional 3-tab with dependable protection at an affordable price',
    features: ['25-year limited warranty', 'Fiberglass mat construction', 'StreakGuard algae resistance', 'Multiple color options'],
    ridgeCapProduct: 'DecoRidge',
    underlaymentRecommendation: 'ProArmor synthetic',
  },
  {
    id: 'oc-duration',
    manufacturer: 'Owens Corning',
    productLine: 'Duration',
    tier: 'good',
    pricePerSq: 110,
    warrantyYears: 50,
    windRatingMph: 130,
    impactRating: 'Class 1',
    type: 'architectural',
    description: 'Patented SureNail Technology for superior wind resistance and fast install',
    features: ['Lifetime limited warranty', 'SureNail Technology', '130 mph wind rating', 'TruDefinition color platform'],
    ridgeCapProduct: 'DecoRidge',
    underlaymentRecommendation: 'ProArmor synthetic',
  },
  {
    id: 'oc-duration-storm',
    manufacturer: 'Owens Corning',
    productLine: 'Duration STORM',
    tier: 'better',
    pricePerSq: 140,
    warrantyYears: 50,
    windRatingMph: 130,
    impactRating: 'Class 4',
    type: 'architectural',
    description: 'Class 4 impact-rated for maximum protection against hail and severe weather',
    features: ['Lifetime warranty', 'Class 4 impact rating', 'SureNail Technology', '130 mph wind', 'Insurance discount eligible'],
    ridgeCapProduct: 'DecoRidge',
    underlaymentRecommendation: 'WeatherLock ice & water',
  },
  {
    id: 'oc-duration-flex',
    manufacturer: 'Owens Corning',
    productLine: 'Duration FLEX',
    tier: 'better',
    pricePerSq: 155,
    warrantyYears: 50,
    windRatingMph: 130,
    impactRating: 'Class 4',
    type: 'architectural',
    description: 'SBS rubberized asphalt for superior flexibility and impact resistance',
    features: ['Lifetime warranty', 'SBS polymer modified', 'Class 4 impact', 'Extreme cold flexibility'],
    ridgeCapProduct: 'DecoRidge',
    underlaymentRecommendation: 'WeatherLock ice & water',
  },
  {
    id: 'oc-woodcrest',
    manufacturer: 'Owens Corning',
    productLine: 'Woodcrest',
    tier: 'best',
    pricePerSq: 195,
    warrantyYears: 50,
    windRatingMph: 130,
    impactRating: 'Class 4',
    type: 'designer',
    description: 'Designer shake look with rustic wood-grain texture and premium color blends',
    features: ['Lifetime warranty', 'Wood shake appearance', 'SureNail Technology', 'Class 4 impact'],
    ridgeCapProduct: 'DecoRidge',
    underlaymentRecommendation: 'WeatherLock ice & water',
  },
  {
    id: 'oc-berkshire',
    manufacturer: 'Owens Corning',
    productLine: 'Berkshire',
    tier: 'best',
    pricePerSq: 210,
    warrantyYears: 50,
    windRatingMph: 130,
    impactRating: 'Class 4',
    type: 'luxury',
    description: 'Premium slate-look luxury shingle with oversized dimensions for maximum curb appeal',
    features: ['Lifetime warranty', 'Natural slate appearance', 'Oversized 18" exposure', 'Class 4 impact'],
    ridgeCapProduct: 'DecoRidge',
    underlaymentRecommendation: 'WeatherLock ice & water',
  },
];

// ─── IKO ──────────────────────────────────────────────────────────────────────

const ikoProducts: ShingleProduct[] = [
  {
    id: 'iko-marathon-plus',
    manufacturer: 'IKO',
    productLine: 'Marathon Plus AR',
    tier: 'good',
    pricePerSq: 65,
    warrantyYears: 25,
    windRatingMph: 60,
    impactRating: 'N/A',
    type: '3-tab',
    description: 'Reliable 3-tab with algae resistance for clean, long-lasting appearance',
    features: ['25-year limited warranty', 'Algae resistance', 'Fiberglass reinforced', 'Self-sealing strips'],
    ridgeCapProduct: 'IKO Hip & Ridge 12',
    underlaymentRecommendation: 'RoofGard-Cool Grey',
  },
  {
    id: 'iko-cambridge',
    manufacturer: 'IKO',
    productLine: 'Cambridge',
    tier: 'good',
    pricePerSq: 95,
    warrantyYears: 50,
    windRatingMph: 130,
    impactRating: 'Class 1',
    type: 'architectural',
    description: 'Best-selling architectural with dual-layer construction and vivid color bands',
    features: ['Lifetime limited warranty', '130 mph wind resistance', 'ArmourZone nailing area', 'Algae resistant granules'],
    ridgeCapProduct: 'IKO Ultra HP',
    underlaymentRecommendation: 'RoofGard-Cool Grey',
  },
  {
    id: 'iko-dynasty',
    manufacturer: 'IKO',
    productLine: 'Dynasty',
    tier: 'better',
    pricePerSq: 120,
    warrantyYears: 50,
    windRatingMph: 130,
    impactRating: 'Class 3',
    type: 'architectural',
    description: 'High-performance architectural with superior granule adhesion and wind resistance',
    features: ['Lifetime warranty', 'ArmourZone reinforced nailing', '130 mph wind', 'Performance class shingle'],
    ridgeCapProduct: 'IKO Ultra HP',
    underlaymentRecommendation: 'GoldShield ice & water',
  },
  {
    id: 'iko-nordic',
    manufacturer: 'IKO',
    productLine: 'Nordic',
    tier: 'better',
    pricePerSq: 145,
    warrantyYears: 50,
    windRatingMph: 130,
    impactRating: 'Class 4',
    type: 'architectural',
    description: 'Class 4 impact-rated performance shingle for severe weather zones',
    features: ['Lifetime warranty', 'Class 4 impact rating', '130 mph wind', 'Insurance discount eligible'],
    ridgeCapProduct: 'IKO Ultra HP',
    underlaymentRecommendation: 'GoldShield ice & water',
  },
  {
    id: 'iko-armourshake',
    manufacturer: 'IKO',
    productLine: 'Armourshake',
    tier: 'best',
    pricePerSq: 175,
    warrantyYears: 50,
    windRatingMph: 130,
    impactRating: 'Class 4',
    type: 'designer',
    description: 'Designer shake-look with deep shadow lines and bold texture',
    features: ['Lifetime warranty', 'Wood shake appearance', 'Class 4 impact', 'Multi-layer construction'],
    ridgeCapProduct: 'IKO Ultra HP',
    underlaymentRecommendation: 'GoldShield ice & water',
  },
  {
    id: 'iko-crowne-slate',
    manufacturer: 'IKO',
    productLine: 'Crowne Slate',
    tier: 'best',
    pricePerSq: 185,
    warrantyYears: 50,
    windRatingMph: 130,
    impactRating: 'Class 4',
    type: 'luxury',
    description: 'Premium slate-look luxury shingle with old-world European charm',
    features: ['Lifetime warranty', 'Natural slate appearance', 'Class 4 impact', 'Oversized dimensions'],
    ridgeCapProduct: 'IKO Ultra HP',
    underlaymentRecommendation: 'GoldShield ice & water',
  },
];

// ─── Tamko ────────────────────────────────────────────────────────────────────

const tamkoProducts: ShingleProduct[] = [
  {
    id: 'tamko-elite-glass-seal',
    manufacturer: 'Tamko',
    productLine: 'Elite Glass-Seal',
    tier: 'good',
    pricePerSq: 65,
    warrantyYears: 25,
    windRatingMph: 60,
    impactRating: 'N/A',
    type: '3-tab',
    description: 'Dependable 3-tab with fiberglass mat and self-sealing adhesive',
    features: ['25-year limited warranty', 'Self-sealing adhesive', 'Fiberglass reinforced', 'Affordable protection'],
    ridgeCapProduct: 'Tam-Pro Ridge',
    underlaymentRecommendation: 'Tamko MetalSeal',
  },
  {
    id: 'tamko-heritage',
    manufacturer: 'Tamko',
    productLine: 'Heritage',
    tier: 'good',
    pricePerSq: 90,
    warrantyYears: 30,
    windRatingMph: 110,
    impactRating: 'Class 1',
    type: 'architectural',
    description: 'Classic architectural with vibrant color blends and reliable performance',
    features: ['30-year limited warranty', '110 mph wind rating', 'Algae resistance', 'Dimensional depth'],
    ridgeCapProduct: 'Tam-Pro Ridge',
    underlaymentRecommendation: 'Tamko MetalSeal',
  },
  {
    id: 'tamko-heritage-vintage',
    manufacturer: 'Tamko',
    productLine: 'Heritage Vintage',
    tier: 'better',
    pricePerSq: 115,
    warrantyYears: 50,
    windRatingMph: 110,
    impactRating: 'Class 2',
    type: 'architectural',
    description: 'Premium architectural with hand-crafted appearance and richer color depth',
    features: ['Lifetime limited warranty', 'Artisan hand-cut look', '110 mph wind', 'Premium color blends'],
    ridgeCapProduct: 'Tam-Pro Ridge',
    underlaymentRecommendation: 'Tamko Moisture Guard',
  },
  {
    id: 'tamko-titan-xt',
    manufacturer: 'Tamko',
    productLine: 'Titan XT',
    tier: 'better',
    pricePerSq: 135,
    warrantyYears: 50,
    windRatingMph: 150,
    impactRating: 'Class 4',
    type: 'architectural',
    description: 'Extreme weather protection with SBS rubberized backing and 150 mph wind rating',
    features: ['Lifetime warranty', 'SBS modified asphalt', '150 mph wind rating', 'Class 4 impact', 'Extreme flexibility'],
    ridgeCapProduct: 'Tam-Pro Ridge',
    underlaymentRecommendation: 'Tamko Moisture Guard Plus',
  },
  {
    id: 'tamko-natural-timber',
    manufacturer: 'Tamko',
    productLine: 'Natural Timber',
    tier: 'best',
    pricePerSq: 165,
    warrantyYears: 50,
    windRatingMph: 130,
    impactRating: 'Class 4',
    type: 'designer',
    description: 'Designer shake-look with natural wood grain texture and multi-tonal color',
    features: ['Lifetime warranty', 'Wood shake appearance', 'Class 4 impact', 'Multi-tonal colors'],
    ridgeCapProduct: 'Tam-Pro Ridge',
    underlaymentRecommendation: 'Tamko Moisture Guard Plus',
  },
  {
    id: 'tamko-lamarite',
    manufacturer: 'Tamko',
    productLine: 'Lamarite',
    tier: 'best',
    pricePerSq: 175,
    warrantyYears: 50,
    windRatingMph: 130,
    impactRating: 'Class 4',
    type: 'luxury',
    description: 'Laminated slate-look luxury with old-world elegance and heavyweight construction',
    features: ['Lifetime warranty', 'Natural slate appearance', 'Class 4 impact', 'Heavyweight construction'],
    ridgeCapProduct: 'Tam-Pro Ridge',
    underlaymentRecommendation: 'Tamko Moisture Guard Plus',
  },
];

// ─── All Manufacturer Packages ────────────────────────────────────────────────

export const MANUFACTURER_PACKAGES: ManufacturerPackage[] = [
  { id: 'certainteed', manufacturer: 'CertainTeed', products: certainteedProducts },
  { id: 'gaf', manufacturer: 'GAF', products: gafProducts },
  { id: 'owens-corning', manufacturer: 'Owens Corning', products: owensCorningProducts },
  { id: 'iko', manufacturer: 'IKO', products: ikoProducts },
  { id: 'tamko', manufacturer: 'Tamko', products: tamkoProducts },
];

/**
 * Look up a manufacturer record by id. Returns `undefined` if the id
 * doesn't match any known manufacturer. Centralises the
 * `MANUFACTURER_PACKAGES.find(m => m.id === ...)` idiom.
 */
function findManufacturer(manufacturerId: string): ManufacturerPackage | undefined {
  return MANUFACTURER_PACKAGES.find(m => m.id === manufacturerId);
}

/**
 * Pick the first product in `products` matching `tier`, optionally preferring
 * a specific `preferredType`. If no product of the preferred type exists,
 * falls back to any product in that tier.
 *
 * Centralises the duplicated `find(p => p.tier === X && p.type === Y) ||
 * find(p => p.tier === X)` pattern from `getDefaultTierSet`.
 */
function findProductForTier(
  products: readonly ShingleProduct[],
  tier: ShingleTier,
  preferredType?: ShingleType,
): ShingleProduct | undefined {
  if (preferredType) {
    const preferred = products.find(p => p.tier === tier && p.type === preferredType);
    if (preferred) return preferred;
  }
  return products.find(p => p.tier === tier);
}

/**
 * Get all products from a manufacturer
 */
export function getManufacturerProducts(manufacturerId: string): ShingleProduct[] {
  return findManufacturer(manufacturerId)?.products ?? [];
}

/**
 * Get products by tier from a manufacturer
 */
export function getProductsByTier(
  manufacturerId: string,
  tier: ShingleTier,
): ShingleProduct[] {
  return getManufacturerProducts(manufacturerId).filter(p => p.tier === tier);
}

/**
 * Get a Good/Better/Best package set from a manufacturer
 * Returns one product per tier (the primary/most popular option):
 * Good prefers `'architectural'`, Best prefers `'designer'`, Better has no
 * preference (every manufacturer's catalogue spans different Better types).
 */
export function getDefaultTierSet(manufacturerId: string): {
  good: ShingleProduct | undefined;
  better: ShingleProduct | undefined;
  best: ShingleProduct | undefined;
} {
  const products = getManufacturerProducts(manufacturerId);
  return {
    good: findProductForTier(products, 'good', PREFERRED_GOOD_TYPE),
    better: findProductForTier(products, 'better'),
    best: findProductForTier(products, 'best', PREFERRED_BEST_TYPE),
  };
}

/**
 * Look up a single product by its `id` across every manufacturer.
 * Used by the report-generator's company-mode tier builder so it can
 * resolve a `pkg.components[i]` slug back to its full product record
 * without having to repeat the cross-manufacturer scan inline.
 */
export function findProductById(productId: string): ShingleProduct | undefined {
  for (const mfr of MANUFACTURER_PACKAGES) {
    const hit = mfr.products.find(p => p.id === productId);
    if (hit) return hit;
  }
  return undefined;
}

/**
 * Get all available manufacturers
 */
export function getManufacturerList(): Array<{ id: string; name: string; productCount: number }> {
  return MANUFACTURER_PACKAGES.map(m => ({
    id: m.id,
    name: m.manufacturer,
    productCount: m.products.length,
  }));
}
