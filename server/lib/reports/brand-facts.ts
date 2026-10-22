/**
 * Every customer-facing claim Best Roofing Now makes about itself, in one
 * place, with the source and the date it was checked.
 *
 * This file exists because the same claims were previously written twice —
 * CRED_MARKERS in certainteed-data.ts and BRN_BRAND.credibilityMarkers in
 * brn-brand.ts — as two different lists, both shown to customers, neither
 * accurate. Both now re-export from here.
 *
 * IMPORTANT: BRN is NOT a General Contractor. No claim here may imply an
 * "NC General Contractor License" or "Licensed General Contractor".
 *
 * James reviews these on the 1st of each month. A claim without a source is
 * not a claim — write one down or leave the fact out.
 */

export interface BrandFact {
  /** What appears on a customer document. */
  text: string;
  /** A URL, or the name of the person who asserted it. */
  source: string;
  /** YYYY-MM-DD — when this was last confirmed. */
  verifiedOn: string;
}

const SITE = 'https://bestroofingnow.com';
const CT_PROFILE = 'https://www.certainteed.com/profiles/bestroofingnowllc';
const CHECKED = '2026-09-11';

/**
 * Short credential strings for the credibility strip at the foot of a report.
 *
 * "CertainTeed ShingleMaster since 2022" replaces the old "CertainTeed
 * Certified": ShingleMaster is the credential BRN actually holds, and it is
 * the tier that qualifies them to register the extended SureStart PLUS
 * coverage that WARRANTY.certificationCopy already claims.
 */
export const CREDENTIAL_FACTS: BrandFact[] = [
  { text: 'CertainTeed ShingleMaster since 2022', source: CT_PROFILE, verifiedOn: CHECKED },
  { text: 'BBB A+ Accredited', source: SITE, verifiedOn: CHECKED },
  { text: 'Veteran-Owned & Family-Operated', source: SITE, verifiedOn: CHECKED },
  { text: 'Fully Insured', source: SITE, verifiedOn: CHECKED },
  { text: 'Local Charlotte Roofers', source: SITE, verifiedOn: CHECKED },
  { text: '15-Year Workmanship Warranty', source: SITE, verifiedOn: CHECKED },
  { text: 'Photo-Documented Work', source: SITE, verifiedOn: CHECKED },
];

/** The countable claims — the ones that go stale and get re-checked monthly. */
export const TRUST_STATS: BrandFact[] = [
  { text: '5.0★ on Google · 65+ reviews', source: SITE, verifiedOn: CHECKED },
  { text: 'Angi Super Service Award — 2021, 2022, 2023', source: SITE, verifiedOn: CHECKED },
  { text: '500+ roofs installed', source: SITE, verifiedOn: CHECKED },
  { text: '5+ years in business', source: SITE, verifiedOn: CHECKED },
  { text: '60+ neighborhoods served · 50-mile service radius', source: SITE, verifiedOn: CHECKED },
  // The only claim with no public page behind it. James asserted it directly;
  // that is legitimate for an owner's claim about his own business, but it is
  // the one entry a customer could ask to see evidence for.
  { text: 'Over $100,000 of profits donated to local charities', source: 'James Turner', verifiedOn: CHECKED },
];

export const FINANCING_FACT: BrandFact =
  { text: 'Financing available · $0 down options', source: SITE, verifiedOn: CHECKED };

export const BRAND_FACTS: BrandFact[] = [...CREDENTIAL_FACTS, ...TRUST_STATS, FINANCING_FACT];

/** The credential strip every report renders. Order is deliberate: strongest first. */
export const CREDENTIAL_MARKERS: readonly string[] = CREDENTIAL_FACTS.map((f) => f.text);

/* --------------------------------------------------------- commercial --- */

const ABOUT = 'https://bestroofingnow.com/about';
const COMMERCIAL = 'https://bestroofingnow.com/commercial-roofing';
const CHECKED_COMMERCIAL = '2026-10-05';

/** The company's own line, word for word from the About page. */
export const BRAND_PROMISE: BrandFact =
  { text: 'We tell people the truth, even when it is not a sale.', source: ABOUT, verifiedOn: CHECKED_COMMERCIAL };

/** Who started it — the short form of OWNERS_STORY, for commercial documents. */
export const FOUNDING_FACT: BrandFact = {
  text: 'Founded by Fred Turner, a retired U.S. Army veteran, and his son James Turner.',
  source: ABOUT,
  verifiedOn: CHECKED_COMMERCIAL,
};

/**
 * The systems the commercial page says BRN installs. The site's wording,
 * put into short, plain sentences a building owner reads at a glance.
 */
export const COMMERCIAL_SYSTEM_FACTS: Array<BrandFact & { name: string }> = [
  { name: 'TPO', text: 'A white sheet roof. The seams are melted together with heat. It bounces the sun back, so the building stays cooler.', source: COMMERCIAL, verifiedOn: CHECKED_COMMERCIAL },
  { name: 'EPDM', text: 'A black rubber roof. We fix it, and we replace it, on older flat roofs.', source: COMMERCIAL, verifiedOn: CHECKED_COMMERCIAL },
  { name: 'PVC', text: 'A tough sheet roof for buildings with grease, chemicals or vents that blow out hot air.', source: COMMERCIAL, verifiedOn: CHECKED_COMMERCIAL },
  { name: 'Metal', text: 'Steel panels for shops and plants. They can last 40 to 70 years and need little care.', source: COMMERCIAL, verifiedOn: CHECKED_COMMERCIAL },
  { name: 'Coatings', text: 'A thick paint-on layer that seals an older roof. We only use it when the roof still has good years left.', source: COMMERCIAL, verifiedOn: CHECKED_COMMERCIAL },
];

/** The building types listed on the commercial page. */
export const COMMERCIAL_BUILDING_TYPES: BrandFact & { list: string[] } = {
  text: 'Building types served',
  list: ['Warehouses', 'Distribution centers', 'Offices', 'Stores & shopping centers', 'Medical buildings', 'Hotels', 'Schools', 'Factories', 'Churches', 'Apartments', 'Car dealers', 'Government buildings'],
  source: COMMERCIAL,
  verifiedOn: CHECKED_COMMERCIAL,
};

/** The three maintenance programs on the commercial page. */
export const MAINTENANCE_PROGRAM_FACTS: Array<BrandFact & { name: string; tag?: string }> = [
  { name: 'Essential', text: 'We check your roof once a year and send you a written report.', source: COMMERCIAL, verifiedOn: CHECKED_COMMERCIAL },
  { name: 'Professional', tag: 'Most popular', text: 'We check your roof twice a year, in spring and fall. You get a written report each time.', source: COMMERCIAL, verifiedOn: CHECKED_COMMERCIAL },
  { name: 'Premium', text: 'We check your roof four times a year. You also get a phone line you can call day or night.', source: COMMERCIAL, verifiedOn: CHECKED_COMMERCIAL },
];

/** Service facts a building owner asks about. */
export const COMMERCIAL_SERVICE_FACTS: BrandFact[] = [
  { text: 'Help day or night when a roof leaks — 24 hours a day, 7 days a week.', source: COMMERCIAL, verifiedOn: CHECKED_COMMERCIAL },
  { text: 'Roof warranties from the maker of 15 to 40 years. Some have no dollar limit on repairs.', source: COMMERCIAL, verifiedOn: CHECKED_COMMERCIAL },
  { text: 'Help with your insurance claim after a storm.', source: COMMERCIAL, verifiedOn: CHECKED_COMMERCIAL },
];

export const COMMUNITY_FACTS: BrandFact[] = [
  { text: 'Member of the Charlotte Area Chamber', source: ABOUT, verifiedOn: CHECKED_COMMERCIAL },
  { text: 'Member of the Lake Norman Chamber of Commerce', source: ABOUT, verifiedOn: CHECKED_COMMERCIAL },
];

/** Every commercial claim, for the monthly review and the sourcing test. */
export const COMMERCIAL_BRAND_FACTS: BrandFact[] = [
  BRAND_PROMISE, FOUNDING_FACT, ...COMMERCIAL_SYSTEM_FACTS, COMMERCIAL_BUILDING_TYPES,
  ...MAINTENANCE_PROGRAM_FACTS, ...COMMERCIAL_SERVICE_FACTS, ...COMMUNITY_FACTS,
];
