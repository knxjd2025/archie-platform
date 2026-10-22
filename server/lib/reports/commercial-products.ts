/**
 * Commercial low-slope roofing systems (TPO tear-off, TPO layover/recover,
 * and silicone/TPO restoration coating), plus the ISO insulation add-on
 * that goes with a tear-off system.
 *
 * Priced from James's own material+labor cost (baseCost) with the standard
 * COMMERCIAL_MARKUP applied to get ratePerSquare — the number a customer is
 * billed. Do not show baseCost to a customer; it's cost, not price.
 *
 * ISO thickness-to-R-value: ISO board runs roughly R-6/inch (LTTR), so
 * R25 ≈ 4.2" and R30 ≈ 5.2" — the same thicknesses referenced in James's own
 * TPO market-pricing research for a 25/30-year NDL warranty roof.
 */

/** 40% markup on cost, applied uniformly across every commercial line item. */
export const COMMERCIAL_MARKUP = 1.4;

function priced(baseCost: number): number {
  return Math.round(baseCost * COMMERCIAL_MARKUP * 100) / 100;
}

export type CommercialProductKey =
  | 'dura_last_tpo'
  | 'dura_last_layover'
  | 'gaf_commercial_tpo'
  | 'restoration_coating';

export interface CommercialProduct {
  key: CommercialProductKey;
  manufacturer: string;
  name: string;
  /** tear_off requires a full strip to deck (and usually ISO); layover recovers over the existing roof; coating recoats an existing roof with no tear-off. */
  system: 'tear_off' | 'layover' | 'coating';
  baseCost: number;
  ratePerSquare: number;
  tagline: string;
  body: string;
}

export const COMMERCIAL_PRODUCTS: CommercialProduct[] = [
  // Keys keep the original "dura_last" spelling (stored in existing reports);
  // the customer-facing name is the manufacturer's: Duro-Last, and its
  // membrane is PVC, not TPO (duro-last.com, 2026-09-14).
  {
    key: 'dura_last_tpo', manufacturer: 'Duro-Last', name: 'Duro-Last Commercial PVC (tear-off)',
    system: 'tear_off', baseCost: 550, ratePerSquare: priced(550),
    tagline: 'Full tear-off to deck and a new custom-fabricated Duro-Last PVC membrane',
    body: 'A complete tear-off to deck followed by a new Duro-Last PVC roofing system, welded to size in the factory. Pair with ISO insulation sized to the R-value the roof needs — most jobs call for more than the minimum 2".',
  },
  {
    key: 'dura_last_layover', manufacturer: 'Duro-Last', name: 'Duro-Last Commercial PVC (layover)',
    system: 'layover', baseCost: 550, ratePerSquare: priced(550),
    tagline: 'The same Duro-Last PVC system installed over the existing roof — no tear-off, no new ISO',
    body: 'Recovers directly over the existing roof instead of stripping to deck. Skips tear-off and new ISO insulation entirely, since the existing roof and insulation stay in place underneath.',
  },
  {
    key: 'gaf_commercial_tpo', manufacturer: 'GAF', name: 'GAF Commercial TPO',
    system: 'tear_off', baseCost: 650, ratePerSquare: priced(650),
    tagline: "GAF's commercial TPO line",
    body: 'A full tear-off commercial TPO system from GAF. Pair with ISO insulation sized to the R-value the roof needs.',
  },
  {
    key: 'restoration_coating', manufacturer: 'BRN', name: 'Silicone / TPO Restoration Coating',
    system: 'coating', baseCost: 600, ratePerSquare: priced(600),
    tagline: 'Recoats and extends the life of an existing roof — no tear-off',
    body: 'A silicone or TPO restoration coating applied directly over an existing roof in serviceable condition, sealing seams and extending its service life without the cost of a full tear-off or layover.',
  },
];

export function commercialProductByKey(key: CommercialProductKey): CommercialProduct | undefined {
  return COMMERCIAL_PRODUCTS.find((p) => p.key === key);
}

/**
 * "Every job includes" for a commercial quote — the residential list
 * (starter strip, hip & ridge, attic ventilation…) describes a shingle roof
 * and would be wrong on every line here. Workmanship years come from BRN's
 * own warranty; nothing manufacturer-specific is promised by number.
 */
export const COMMERCIAL_INCLUDES: Record<CommercialProduct['system'], string[]> = {
  tear_off: [
    'Complete tear-off of the existing roof to the deck & haul-away',
    'Deck inspected; damaged decking reported and priced before we proceed',
    'Insulation and cover board as quoted, mechanically fastened or adhered to the manufacturer\'s specification',
    'New membrane, factory-made flashings and perimeter edge metal to the manufacturer\'s specification',
    'Manufacturer system warranty registration',
    '15-Year Workmanship Warranty',
    'Full cleanup + magnetic sweep',
  ],
  layover: [
    'Existing roof core-sampled for trapped moisture; wet insulation reported and priced before we proceed',
    'Separation sheet over the existing roof',
    'New membrane, factory-made flashings and perimeter edge metal to the manufacturer\'s specification',
    'Manufacturer system warranty registration',
    '15-Year Workmanship Warranty',
    'Full cleanup',
  ],
  coating: [
    'Roof cleaned and prepared; seams, penetrations and flashings reinforced',
    'Restoration coating applied at the manufacturer\'s coverage rate',
    'Manufacturer coating warranty registration where offered',
    '15-Year Workmanship Warranty',
    'Full cleanup',
  ],
};

export type IsoTier = 'r25' | 'r30';

/** James's material + install cost per inch of ISO, per square — before markup. */
export const ISO_COST_PER_INCH = 85;

export const ISO_THICKNESS_INCHES: Record<IsoTier, number> = {
  r25: 4.2,
  r30: 5.2,
};

export const ISO_LABELS: Record<IsoTier, string> = {
  r25: 'R-25 ISO Insulation',
  r30: 'R-30 ISO Insulation',
};

export function isoRatePerSquare(tier: IsoTier): number {
  return Math.round(ISO_THICKNESS_INCHES[tier] * ISO_COST_PER_INCH * COMMERCIAL_MARKUP * 100) / 100;
}

export interface CommercialAddonLine {
  name: string;
  quantity: number;
  unit: string;
  unitPrice: number;
}

/** ISO priced against the roof's size — one line item, only relevant to a tear-off system. */
export function isoLineItem(tier: IsoTier, squares: number): CommercialAddonLine {
  return {
    name: ISO_LABELS[tier],
    quantity: squares,
    unit: 'sq',
    unitPrice: isoRatePerSquare(tier),
  };
}
