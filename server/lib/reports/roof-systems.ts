/**
 * What actually goes on the roof, layer by layer, for each package we sell.
 *
 * One manufacturer per package wherever that manufacturer makes the part:
 * CertainTeed makes the whole Integrity Roof System; TAMKO makes everything
 * but the vents and the metal; CeDur, DaVinci, Union Corrugating and DECRA
 * make the top layer (and their own starter / ridge / trim) and nothing
 * underneath it, so those packages sit on CertainTeed's underlayments and
 * vents (decided 2026-09-14: one brand a roofer is most likely to be
 * credentialed with). Where NO manufacturer makes the piece (drip edge, step
 * flashing, pipe boots), the step says so plainly and names it as supplied by
 * the company doing the work (COMPANY_SUPPLIED, shown as its name).
 *
 * Product names are spelled the way the manufacturer prints them. Every
 * `spec` line is a figure the manufacturer publishes on its own site — no
 * roll coverages, weights or ASTM classes that were not found there
 * (scratchpad research 2026-09-14). Where a step has `image: null` the
 * manufacturer either makes no such part or publishes no usable photo of it
 * — the walkthrough renders a labelled card, never a stand-in photo of some
 * other product.
 *
 * Images are self-hosted under client/public/roof-systems/ (served by the
 * app's own static host). Site photos were pulled while rights are being
 * cleared with each manufacturer (TAMKO and DECRA license
 * contractor use outright; CertainTeed / Duro-Last / CeDur / Westlake want
 * written permission or their contractor-portal assets; GAF's own
 * guidelines point certified contractors at Partner Portal assets — its
 * product-page photos are used here in the meantime, captured from the
 * rendered page since its CDN refuses non-browser downloads).
 */
import type { ProductKey, RoofingProduct } from './roofing-products.js';
import type { CommercialProductKey } from './commercial-products.js';
import { companyBrand } from './company-brand.js';

export type ComponentRole =
  | 'drip-edge' | 'ice-water' | 'underlayment' | 'starter' | 'field' | 'hip-ridge'
  | 'exhaust' | 'intake' | 'flashing' | 'fasteners' | 'trim'
  | 'prep' | 'vapor' | 'insulation' | 'cover-board' | 'attachment' | 'membrane'
  | 'accessories' | 'edge-metal' | 'walkway';

export interface RoofSystemComponent {
  role: ComponentRole;
  /** What the crew is doing at this step, in the homeowner's words. */
  step: string;
  /** The product, spelled as the manufacturer prints it. May carry HTML entities. */
  name: string;
  /** Who makes it. COMPANY_SUPPLIED when no manufacturer in the package does (shown as the company's name, makerName). */
  maker: string;
  /** What it is and why it is there. Plain English, no jargon. */
  plain: string;
  /** One manufacturer-published line. Omitted rather than guessed. */
  spec?: string;
  /** Path under /roof-systems/, or null when there is no manufacturer image. */
  image: string | null;
}

export interface RoofSystem {
  /** The manufacturer whose name the package carries. */
  maker: string;
  /** e.g. "CertainTeed Integrity Roof System®" */
  systemName: string;
  /** One paragraph on why this stack, before the steps. May carry HTML entities. */
  lede: string;
  /** Optional whole-system illustration shown above the steps. */
  cutaway: string | null;
  components: RoofSystemComponent[];
}

/**
 * Absolute on purpose: a report is opened at /r/:token on the app host but is
 * also mailed, printed, and rendered outside it. REPORT_ASSET_BASE lets a
 * preview deployment point at itself.
 */
export const ASSET_BASE = (process.env.REPORT_ASSET_BASE || process.env.APP_BASE_URL || '').replace(/\/$/, '');
export function assetUrl(path: string): string {
  return `${ASSET_BASE}/roof-systems/${path}`;
}

/* ------------------------------------------------------- shared parts --- */

/**
 * The maker of a part no manufacturer in the package makes: the company doing
 * the work supplies it. Data here is built once at load, before any company is
 * known, so it carries this marker and makerName() turns it into the name.
 */
export const COMPANY_SUPPLIED = '@company';

/** True when the company doing the work supplies the part itself. */
export const isCompanySupplied = (c: Pick<RoofSystemComponent, 'maker'>): boolean => c.maker === COMPANY_SUPPLIED;

/** Who makes a part, for display: the manufacturer, or the current company's name. */
export function makerName(c: Pick<RoofSystemComponent, 'maker'>): string {
  return isCompanySupplied(c) ? companyBrand().displayName : c.maker;
}

/** No manufacturer in any residential package makes drip edge. */
const dripEdge = (why: string): RoofSystemComponent => ({
  role: 'drip-edge', step: 'Metal edge on every eave and rake',
  name: 'Metal drip edge', maker: COMPANY_SUPPLIED,
  plain: `${why} A corrosion-resistant metal edge goes on first along the bottom of every slope and up every side edge. It covers the cut end of the wood deck and kicks water out into the gutter instead of letting it wick back under the roof.`,
  image: null,
});

const flashing = (extra = ''): RoofSystemComponent => ({
  role: 'flashing', step: 'Seal every wall, chimney and pipe',
  name: 'Step flashing, counter-flashing and pipe boots', maker: COMPANY_SUPPLIED,
  plain: `Everywhere the roof meets something that is not roof &mdash; a wall, a chimney, a plumbing vent &mdash; gets new metal flashing woven into the courses and a new boot around each pipe. These are where most roof leaks actually start, so nothing here is reused from the old roof.${extra ? ' ' + extra : ''}`,
  image: null,
});

/** CertainTeed underlayments and vents, reused under the packages whose maker sells none. */
const CT = {
  winterGuard: (where: string): RoofSystemComponent => ({
    role: 'ice-water', step: 'Waterproof the places that leak first',
    name: 'WinterGuard&reg; Waterproofing Underlayment', maker: 'CertainTeed',
    plain: `A sticky, rubberized sheet that bonds straight to the deck ${where}. It seals itself around every nail driven through it, so wind-driven rain and ice backing up under the shingles cannot reach the wood.`,
    spec: 'Composite asphalt polymer membrane that stretches and seals around nails; warranted watertight for the same period as the shingles above it, up to 50 years (CertainTeed).',
    image: 'certainteed/winterguard.jpg',
  }),
  winterGuardHT: (where: string): RoofSystemComponent => ({
    role: 'ice-water', step: 'Waterproof the places that leak first',
    name: 'WinterGuard&reg; HT X Waterproofing Underlayment', maker: 'CertainTeed',
    plain: `A high-temperature, high-tack version of CertainTeed's self-sealing membrane, made for the heat that builds under a metal roof. It bonds to the deck ${where} and seals around every fastener.`,
    spec: 'Rated for use under shingles, metal, slate or tile; formulated to resist the high roof temperatures under metal roofs; applied to a clean, dry, bare deck (CertainTeed).',
    image: 'certainteed/winterguard-ht-x.jpg',
  }),
  diamondDeck: (under: string): RoofSystemComponent => ({
    role: 'underlayment', step: 'Cover the whole deck',
    name: 'DiamondDeck&reg; Synthetic Underlayment', maker: 'CertainTeed',
    plain: `A tough woven synthetic sheet rolled over every square foot of the deck ${under}. It is the second line of defense: if water ever gets past the top layer, this is what keeps it off the wood.`,
    spec: 'Premium polypropylene-and-polymer composite; scrim-reinforced; resists tears, punctures and impact; slip-resistant surface; rated for use under shingle, shake, metal or slate (CertainTeed).',
    image: 'certainteed/diamonddeck.jpg',
  }),
  ridgeVent: (note = ''): RoofSystemComponent => ({
    role: 'exhaust', step: 'Let the attic breathe out at the peak',
    name: 'CertainTeed Filtered Ridge Vent', maker: 'CertainTeed',
    plain: `A low vent that runs the length of the peak, hidden under the ridge cap, so hot, damp attic air escapes along the whole ridge instead of through a few box vents.${note ? ' ' + note : ''}`,
    spec: 'External baffles; less than an inch tall; internal weather filter guards against rain, snow, dust and insects; Limited Lifetime Warranty with 5-year SureStart&trade; protection (CertainTeed).',
    image: 'certainteed/ridge-vent.jpg',
  }),
  intakeVent: (): RoofSystemComponent => ({
    role: 'intake', step: 'Let fresh air in at the eaves',
    name: 'CertainTeed Intake Vent', maker: 'CertainTeed',
    plain: 'Air has to come in low for the ridge vent to pull anything out high. Where your existing soffit vents already supply enough intake we keep them clear and use them; where they cannot, this shingle-over vent goes on at the roof edge to do that job.',
    spec: 'Roof-top installed, shingle-over intake vent; internal baffles, weather filter and drainage system; pairs with CertainTeed Ridge Vent; Limited Lifetime Warranty with 5-year SureStart&trade; protection (CertainTeed).',
    image: 'certainteed/intake-vent.jpg',
  }),
};

/* ---------------------------------------------------------- CertainTeed --- */

const CT_FIELD: Record<Exclude<ProductKey, 'tamko_titan_basic' | 'standing_seam_metal' | 'stone_coated_steel' | 'cedur_shake' | 'davinci_shake' | 'custom'>, { name: string; plain: string; spec: string; image: string }> = {
  landmark: {
    name: 'Landmark&reg;',
    plain: 'A two-layer architectural shingle that gives the roof a dimensional look, laid over the starter course with the nails in the marked NailTrak&reg; zone.',
    spec: 'UL 2218 Class 3 impact; 25-year StreakFighter&reg; algae resistance; wind warranty upgradable to 160 mph with CertainTeed starter and hip &amp; ridge; UL Class A fire (CertainTeed).',
    image: 'certainteed/landmark.jpg',
  },
  landmark_pro: {
    name: 'Landmark&reg; PRO',
    plain: 'A heavier Landmark with richer Max Def color blends and a longer algae-stain warranty, laid the same way with the nails in the NailTrak&reg; zone.',
    spec: 'Heavy-weight design; UL 2218 Class 3 impact; 30-year StreakFighter&reg; algae resistance; wind warranty upgradable to 160 mph; UL Class A fire (CertainTeed).',
    image: 'certainteed/landmark-pro.jpg',
  },
  landmark_premium: {
    name: 'Landmark&reg; Premium',
    plain: 'The heaviest Landmark, with the top hail rating and thicker tabs that throw a deeper shadow line across the roof.',
    spec: 'UL 2218 Class 4 impact; 30-year StreakFighter&reg; algae resistance; wind warranty upgradable to 160 mph; UL Class A fire (CertainTeed).',
    image: 'certainteed/landmark-premium.jpg',
  },
  landmark_belmont: {
    name: 'Belmont&reg;',
    plain: 'A luxury shingle with the look of chiseled slate, laid in a random pattern so no two courses read the same from the street.',
    spec: 'UL 2218 Class 4 impact; 30-year StreakFighter&reg; algae resistance; wind warranty upgradable to 130 mph; UL Class A fire (CertainTeed).',
    image: 'certainteed/belmont.jpg',
  },
  landmark_grand_manor: {
    name: 'Grand Manor&reg;',
    plain: 'A luxury slate-look shingle with a random tab pattern and the deepest shadow line in the CertainTeed line.',
    spec: 'UL 2218 Class 4 impact; 30-year StreakFighter&reg; algae resistance; wind warranty upgradable to 130 mph; nine color blends; UL Class A fire (CertainTeed).',
    image: 'certainteed/grand-manor.jpg',
  },
  landmark_presidential: {
    name: 'Presidential Shake&reg;',
    plain: 'A luxury shingle sculpted to look like hand-split cedar shakes, with the thickest build in the shingle lineup.',
    spec: 'UL 2218 Class 3 impact; 30-year StreakFighter&reg; algae resistance; wind warranty upgradable to 130 mph; UL Class A fire (CertainTeed).',
    image: 'certainteed/presidential-shake.jpg',
  },
  landmark_solaris: {
    name: 'Landmark&reg; Solaris&reg;',
    plain: 'A Landmark with sun-reflecting granules that bounce heat off the roof instead of soaking it into the attic.',
    spec: 'Solaris&reg; Cool Roof Technology, CRRC-rated, California Title 24 compliant; UL 2218 Class 3 impact; 25-year StreakFighter&reg;; wind warranty upgradable to 160 mph (CertainTeed).',
    image: 'certainteed/landmark-solaris.jpg',
  },
};

/** CertainTeed's own pairing table: which cap goes with which shingle. */
function certainteedHipRidge(key: keyof typeof CT_FIELD): RoofSystemComponent {
  const base = { role: 'hip-ridge' as const, step: 'Cap the peaks and hips', maker: 'CertainTeed' };
  if (key === 'landmark_presidential' || key === 'landmark_belmont') {
    return {
      ...base, name: 'Cedar Crest&reg; Hip &amp; Ridge',
      plain: 'A two-layer cap shingle for the peaks and hips that adds a shake-like shadow line where the slopes meet &mdash; the most exposed lines on the roof, sealed with a matching accessory instead of cut field shingles.',
      spec: 'Two full layers; UL 2218 Class 4 impact; 15-year 110 mph wind; UL Class A; 25-year algae resistance (CertainTeed).',
      image: 'certainteed/cedar-crest.jpg',
    };
  }
  if (key === 'landmark_grand_manor') {
    return {
      ...base, name: 'Shangle Ridge&reg; Hip &amp; Ridge',
      plain: 'The cap CertainTeed makes to match Grand Manor, folded over the peaks and hips so the random-tab look carries all the way to the ridge.',
      image: null,
    };
  }
  return {
    ...base, name: 'Shadow Ridge&reg; Hip &amp; Ridge',
    plain: 'The low-profile cap made to match Landmark shingles, with a reinforced nail zone so the most wind-exposed line on the roof stays put.',
    spec: 'UL 2218 Class 4 impact; 15-year 110 mph wind; UL Class A; 25-year algae resistance (CertainTeed).',
    image: 'certainteed/shadow-ridge.jpg',
  };
}

function certainteedSystem(key: keyof typeof CT_FIELD): RoofSystem {
  const f = CT_FIELD[key];
  return {
    maker: 'CertainTeed',
    systemName: 'CertainTeed Integrity Roof System&reg;',
    lede: `Every layer under your shingles is CertainTeed's, designed to work together and installed in this order. That is what lets a CertainTeed-credentialed contractor register the SureStart&trade; PLUS warranty on the whole system &mdash; not just the shingle &mdash; and it is why the underneath of this roof gets as much attention as the part you can see.`,
    cutaway: 'certainteed/integrity-cutaway.jpg',
    components: [
      dripEdge("CertainTeed does not make roof metal, so this piece is ours."),
      CT.winterGuard('in every valley, around every pipe and chimney, and along the eaves'),
      CT.diamondDeck('before a single shingle goes on'),
      {
        role: 'starter', step: 'Lock down the first row',
        name: 'SwiftStart&reg; Starter Shingles', maker: 'CertainTeed',
        plain: 'A factory-cut first strip along every eave and rake with its own adhesive line, so the bottom row of shingles glues down exactly where wind uplift begins.',
        spec: 'CertaSeal&trade; modified-asphalt sealant against wind uplift; each 18-piece bundle covers 116 linear ft; required for the 130/160 mph wind-warranty upgrade (CertainTeed).',
        image: 'certainteed/swiftstart.jpg',
      },
      { role: 'field', step: 'Lay the shingles', maker: 'CertainTeed', ...f },
      certainteedHipRidge(key),
      flashing(),
      CT.ridgeVent(),
      CT.intakeVent(),
    ],
  };
}

/* ---------------------------------------------------------------- TAMKO --- */

const TAMKO_SYSTEM: RoofSystem = {
  maker: 'TAMKO',
  systemName: 'TAMKO Complete&reg; Roof System',
  lede: 'TAMKO makes the shingle, the starter, the cap and both underlayments, and only its own branded accessories count toward its enhanced warranties &mdash; so those are what go on. The two pieces TAMKO does not make, the roof metal and the ridge vent, are supplied by us.',
  cutaway: 'tamko/complete-system.jpg',
  components: [
    dripEdge("TAMKO does not make roof metal, so this piece is ours."),
    {
      role: 'ice-water', step: 'Waterproof the places that leak first',
      name: 'Moisture Guard&reg; Ice &amp; Rain Underlayment', maker: 'TAMKO',
      plain: 'A sticky-backed rubberized membrane that seals to the deck at the eaves, in the valleys and around chimneys and vents, so ice dams and wind-driven rain cannot back up under the shingles.',
      spec: 'Self-adhering SBS-modified asphalt on a fiberglass mat, 55 mils; UL classified to ASTM D1970; 36" rolls; 5-year limited warranty (TAMKO).',
      image: 'tamko/moisture-guard.jpg',
    },
    {
      role: 'underlayment', step: 'Cover the whole deck',
      name: 'Synthetic Guard&trade; Plus Underlayment', maker: 'TAMKO',
      plain: 'A tough, lightweight woven sheet rolled over the entire deck under the shingles &mdash; the second line of defense against water, and a slip-resistant surface for the crew.',
      spec: 'Woven polypropylene with printed lay and fastener lines; 42" &times; 286\' roll; ASTM D226 Types I &amp; II and D4869 Types II &amp; IV; Class A under asphalt shingles; 20-year limited warranty (TAMKO).',
      image: 'tamko/synthetic-guard-plus.jpg',
    },
    {
      role: 'starter', step: 'Lock down the first row',
      name: 'TAMKO&reg; 10-Inch Starter', maker: 'TAMKO',
      plain: 'A factory-cut first strip with its own adhesive line along every roof edge, so the edge course glues down against wind.',
      spec: '10" &times; 40"; 30 per bundle &asymp; 100 lineal ft; required for the 160 mph WindGuard&reg; warranty (TAMKO).',
      image: 'tamko/10-inch-starter.jpg',
    },
    {
      role: 'field', step: 'Lay the shingles',
      name: 'Titan XT&reg;', maker: 'TAMKO',
      plain: 'A thick two-layer architectural shingle with a wide reinforced nailing strip and an extra-strong sealant, rated for hail impact and warranted to 160 mph when installed with TAMKO\'s starter and cap.',
      spec: 'UL 2218 Class 3 impact; ASTM D7158 Class H and D3161 Class F wind; UL 790 Class A fire; 110 mph standard / 160 mph WindGuard&reg; wind warranty; limited lifetime; 120-month algae (TAMKO).',
      image: 'tamko/titan-xt.jpg',
    },
    {
      role: 'hip-ridge', step: 'Cap the peaks and hips',
      name: 'TAMKO&reg; 12-1/4" &times; 12" Hip &amp; Ridge', maker: 'TAMKO',
      plain: 'Pre-cut, color-matched cap shingles that fold over the peaks and corners of the roof to seal those exposed seams and finish the look.',
      spec: '12-1/4" &times; 36" perforated into three pieces; 3 bundles per 100 lineal ft; UL 2218 Class 3; ASTM D3161 Class F; 22 colors matching Titan XT (TAMKO).',
      image: 'tamko/hip-ridge.jpg',
    },
    flashing(),
    {
      role: 'exhaust', step: 'Let the attic breathe out at the peak',
      name: 'Continuous ridge vent', maker: COMPANY_SUPPLIED,
      plain: 'TAMKO does not currently sell a ridge vent, so we supply a low-profile vent that runs the length of the peak under the cap. TAMKO does require the attic to be ventilated to keep the shingle warranty in force, so this step is not optional.',
      spec: 'TAMKO requires 1 sq ft of net free vent area per 150 sq ft of attic floor (1/300 with balanced high and low venting), with equal or greater intake at the soffits (TAMKO).',
      image: null,
    },
  ],
};

/* ---------------------------------------------- Union Corrugating (metal) --- */

const UNION_SYSTEM: RoofSystem = {
  maker: 'Union Corrugating',
  systemName: 'Union Corrugating SL175 standing seam',
  lede: 'The panels, trim and ridge are Union Corrugating\'s, rolled in Fayetteville, North Carolina. Metal makers do not make underlayment, so the waterproofing under the panels is CertainTeed\'s high-temperature membrane and synthetic &mdash; the same brand we are credentialed with on shingle roofs, in the versions rated for the heat under metal.',
  cutaway: null,
  components: [
    {
      role: 'drip-edge', step: 'Metal edge on every eave and rake',
      name: 'Galvanized Metal Roofing Drip Edge', maker: 'Union Corrugating',
      plain: 'Union\'s own edge metal goes on first along the eaves and rakes, covering the cut end of the deck and directing water into the gutter.',
      spec: 'Painted or unpainted galvanized steel; heavier gauges and larger decks for snow, ice and high-wind areas (Union Corrugating).',
      image: 'union/drip-edge.jpg',
    },
    CT.winterGuardHT('at the eaves, in every valley and around every penetration'),
    CT.diamondDeck('before the first panel is set'),
    {
      role: 'field', step: 'Set the panels',
      name: 'SL175 Snap-Lock Standing Seam Roof Panel', maker: 'Union Corrugating',
      plain: 'Tall-rib vertical panels that snap together over hidden clips, so there is not a single exposed screw on the field of the roof. Each panel runs eave to ridge in one piece.',
      spec: '1-3/4" rib; 16" and 18" coverage; 24 gauge; Signature&reg; 300 PVDF paint system; 45-year limited finish warranty; 1:12 minimum pitch; concealed clips (Union Corrugating).',
      image: 'union/sl175.jpg',
    },
    {
      role: 'fasteners', step: 'Anchor the panels',
      name: 'Concealed clips and pancake-head wood screws', maker: 'Union Corrugating',
      plain: 'Each panel is held by clips screwed to the deck and hidden under the next panel\'s seam. The clips let the metal expand and contract with the weather without working a fastener loose.',
      image: null,
    },
    {
      role: 'trim', step: 'Trim every edge and valley',
      name: 'Eave, rake and valley trim with foam closures', maker: 'Union Corrugating',
      plain: 'Matching-color metal trim finishes every rake and eave, valley metal carries water between slopes, and foam closures fill the rib profile at the ends so wind, rain and insects cannot get under the panels.',
      image: null,
    },
    flashing('On a metal roof the pipe boots are the high-temperature kind, made for the heat the panels hold.'),
    {
      role: 'exhaust', step: 'Let the attic breathe out at the peak',
      name: 'Vented ridge cap', maker: 'Union Corrugating',
      plain: 'A metal ridge cap with a vent strip beneath it runs the length of the peak, so hot attic air escapes along the whole ridge without a single hole cut in the field of the roof.',
      image: null,
    },
  ],
};

/* ------------------------------------------------ DECRA (stone-coated) --- */

const DECRA_SYSTEM: RoofSystem = {
  maker: 'DECRA',
  systemName: 'DECRA stone-coated steel',
  lede: 'DECRA makes the panels, the caps, the trim, the ridge vent and the fasteners. It does not make underlayment, so the waterproofing under the steel is CertainTeed\'s high-temperature membrane and synthetic. The profile &mdash; Shingle XD&reg;, Shake XD&reg; or Villa Tile &mdash; is chosen with you; the layers under it are the same.',
  cutaway: null,
  components: [
    {
      role: 'drip-edge', step: 'Metal edge on every eave',
      name: 'Starter Clip w/ Drip Edge', maker: 'DECRA',
      plain: 'DECRA\'s own eave metal goes on first: a drip edge that also serves as the starter clip the first row of panels locks into.',
      spec: '6\'6" lengths; 2.58 lbs per piece (DECRA Components Chart).',
      image: 'decra/starter-clip.jpg',
    },
    CT.winterGuardHT('at the eaves, in every valley and around every penetration'),
    CT.diamondDeck('before the first panel is set'),
    {
      role: 'field', step: 'Set the panels',
      name: 'DECRA Shingle XD&reg; (or Shake XD&reg; / Villa Tile)', maker: 'DECRA',
      plain: 'Steel panels with a bonded stone-granule finish, screwed straight to the deck with the fasteners hidden under the next course. From the street it reads as a shingle or shake roof; up close it is a steel roof that hail bounces off.',
      spec: 'Steel with aluminum-zinc coating and ceramic-coated stone granules; UL 2218 Class 4 hail; UL 790 Class A fire; UL 580 / UL 1897 Class 90 uplift; 120 mph wind-speed warranty; Lifetime Limited Warranty. Shingle XD: 14-1/8" &times; 52-3/8" panels, 23.8 per square, about 150 lbs per square installed, 4:12 minimum pitch (DECRA).',
      image: 'decra/shingle-xd.jpg',
    },
    {
      role: 'fasteners', step: 'Anchor the panels',
      name: 'DECRA #10 &times; 1.5" hex-head fastener', maker: 'DECRA',
      plain: 'DECRA supplies its own corrosion-resistant screws, driven at the overlap so the head is covered by the next panel.',
      spec: '#10 hex-head corrosion-resistant screw, &frac14;" drive &times; 1-1/2" long; hidden under the panel overlap (DECRA).',
      image: null,
    },
    {
      role: 'hip-ridge', step: 'Cap the peaks and hips',
      name: 'DECRA Shingle Hip &amp; Ridge', maker: 'DECRA',
      plain: 'Matching stone-coated caps cover the peaks and hips over DECRA\'s XD&reg; Channel on each side, so the ridge line is sealed as well as finished.',
      spec: '25-3/4" exposure; 1.08 lbs per piece; XD&reg; Channel along both sides of each hip (DECRA Components Chart).',
      image: 'decra/hip-ridge.jpg',
    },
    {
      role: 'trim', step: 'Trim every edge and valley',
      name: 'XD&reg; Channel, XD&reg; Valley &amp; Cap, Rake/Gable Channel', maker: 'DECRA',
      plain: 'DECRA\'s own channel pieces finish the rakes and roof-to-wall lines, and its valley-and-cap pair carries water between slopes, all in the same stone-coated finish as the panels.',
      spec: 'XD&reg; Channel 6\'6", 3.55 lbs; XD&reg; Valley &amp; Cap 6\'6"; Rake/Gable Channel 6\'6", 3.40 lbs; Shingle/XD&reg; Underpan 24-3/4" &times; 30" at pipes and vents (DECRA Components Chart).',
      image: 'decra/xd-channel.jpg',
    },
    flashing('On a steel roof the pipe boots are the high-temperature kind.'),
    {
      role: 'exhaust', step: 'Let the attic breathe out at the peak',
      name: 'DECRA Ridge Vent', maker: 'DECRA',
      plain: 'A roll vent that sits under the DECRA ridge cap along the whole peak, so hot attic air escapes through the ridge instead of through box vents cut into the panels.',
      spec: '2-1/2" W &times; 1" H &times; 20\' rolls, two per package; 14.1 sq in net free area per lineal ft (DECRA).',
      image: null,
    },
  ],
};

/* ----------------------------------------------------------------- CeDur --- */

const CEDUR_SYSTEM: RoofSystem = {
  maker: 'CeDur',
  systemName: 'CeDur synthetic shake',
  lede: 'CeDur makes exactly three things: the shake, the starter and the hip-and-ridge. Everything under them &mdash; the waterproofing, the deck underlayment and the ridge vent &mdash; is CertainTeed\'s, and CeDur\'s own installation guide is what sets where the membrane goes and what the flashing metal has to be.',
  cutaway: 'cedur/live-oak-roof.jpg',
  components: [
    dripEdge("CeDur does not make roof metal, so this piece is ours."),
    CT.winterGuard('in every valley (CeDur calls for a 36"-wide self-adhering membrane there), around every penetration, and along the eaves'),
    CT.diamondDeck('before the first shake goes on &mdash; CeDur accepts a synthetic underlayment in place of #30 felt'),
    {
      role: 'starter', step: 'Set the starter course',
      name: 'CEDUR Starter Material', maker: 'CeDur',
      plain: 'A flat 15" square piece goes under the first row at every eave, so the bottom course sits level and sheds water into the gutter.',
      spec: '15" &times; 15"; 20 per bundle = 25 lineal ft; four corrosion-resistant fasteners per piece (CeDur).',
      image: 'cedur/starter.jpg',
    },
    {
      role: 'field', step: 'Lay the shakes',
      name: 'CEDUR Shakes', maker: 'CeDur',
      plain: 'Thick, solid polyurethane shakes molded from real cedar in three random widths, nailed course by course. They give the hand-split cedar look but will not burn, split, rot, or crack from hail, and they weigh about a quarter of real wood shake.',
      spec: 'Class A fire (ASTM E108 / UL 790) with no special underlayment; UL 2218 Class 4 impact; 115 mph wind rated (ASTM E330 / UL 1897); about 170 lbs per square; 50-year limited material warranty (CeDur).',
      image: 'cedur/field-shake.jpg',
    },
    {
      role: 'hip-ridge', step: 'Cap the peaks and hips',
      name: 'CEDUR Hip and Ridge Material', maker: 'CeDur',
      plain: 'Factory-bent one-piece caps, made in the profile that matches your roof\'s pitch, cover the peaks and corners over a layer of felt CeDur specifies underneath them.',
      spec: 'Pre-formed one-piece caps in low / medium / high profiles (24&deg; / 38&deg; / 45&deg;); 10" exposure; 12 per bundle = 10 lineal ft (CeDur).',
      image: 'cedur/hip-ridge.jpg',
    },
    {
      role: 'fasteners', step: 'Nail it the way CeDur specifies',
      name: 'Hot-dipped galvanized ring-shank roofing nails', maker: COMPANY_SUPPLIED,
      plain: 'CeDur is specific about the nail, and so are we: a ring-shank nail that will not back out of the deck as the roof heats and cools.',
      spec: '1-3/4" hot-dipped galvanized ring-shank, 11 gauge, 5/16" head; roughly 400 nails per square; flashing metal no lighter than 26 gauge (CeDur).',
      image: null,
    },
    flashing(),
    CT.ridgeVent('CeDur specifies that the roof space be ventilated but names no product; this is the one we pair with it.'),
    CT.intakeVent(),
  ],
};

/* --------------------------------------------------------------- DaVinci --- */

const DAVINCI_SYSTEM: RoofSystem = {
  maker: 'DaVinci Roofscapes',
  systemName: 'DaVinci composite slate &amp; shake',
  lede: 'DaVinci makes the tiles, the starter tile, the hip-and-ridge and the nails. It does not make the waterproofing under them or the ridge vent, so those are CertainTeed\'s. The profile &mdash; Multi-Width Shake, Multi-Width Slate, Single-Width or Province&reg; &mdash; is chosen with you; the layers beneath are the same.',
  cutaway: 'davinci/roof-aerial.jpg',
  components: [
    dripEdge("DaVinci does not make roof metal, so this piece is ours; DaVinci's guide calls for a Style D or Style F drip edge on every eave and gable."),
    CT.winterGuard('in every valley (DaVinci requires a self-adhered membrane there regardless of climate), around every penetration, and along the eaves'),
    CT.diamondDeck('before the first tile goes on &mdash; DaVinci accepts an approved synthetic in place of #30 felt. The fire rating of a DaVinci roof depends on the underlayment assembly, so we confirm the assembly for your rating with you before install'),
    {
      role: 'starter', step: 'Set the starter course',
      name: 'DaVinci Starter tile', maker: 'DaVinci Roofscapes',
      plain: 'A dedicated 12" &times; 12" starter tile goes down first along every eave so the bottom row has a solid, water-shedding base.',
      spec: '12" W &times; 12" L; 20 pieces per bundle = 20 lineal ft; extends about 1" past the drip edge; two nails per tile (DaVinci).',
      image: null,
    },
    {
      role: 'field', step: 'Lay the tiles',
      name: 'DaVinci Multi-Width Shake (or Multi-Width Slate)', maker: 'DaVinci Roofscapes',
      plain: 'Composite tiles molded from real cedar or quarried slate in random widths, nailed course by course with the hidden nail line marked on every tile. The thick butt edge throws the same shadow line as the real material at a fraction of the weight.',
      spec: 'UL 2218 Class 4 impact; ASTM D3161 certified to 110 mph; ASTM E108 Class A (assembly-dependent); Lifetime Limited Material Warranty (DaVinci).',
      image: 'davinci/multi-width-shake.jpg',
    },
    {
      role: 'hip-ridge', step: 'Cap the peaks and hips',
      name: 'DaVinci One-Piece Hip and Ridge', maker: 'DaVinci Roofscapes',
      plain: 'Color-matched cap tiles &mdash; a single hinged piece bent to the pitch, or two overlapping pieces on very steep roofs &mdash; cover the peaks and corners.',
      spec: 'One-piece at 12" exposure with two nails each; 10 lineal ft per bundle; two-piece for pitches over 12:12 (DaVinci).',
      image: null,
    },
    {
      role: 'fasteners', step: 'Nail it the way DaVinci specifies',
      name: 'DaVinci hot-dipped galvanized ring-shank coil nails', maker: 'DaVinci Roofscapes',
      plain: 'DaVinci sells the nail it wants under its warranty, and that is the one we use: a ring-shank that will not back out of the deck.',
      spec: '3/8" head; 1-3/4" for shake, 1-1/2" for slate; ring-shank required on OSB decks and in high-wind installs (DaVinci).',
      image: null,
    },
    flashing(),
    CT.ridgeVent('DaVinci recommends a continuous ridge vent of the rigid shingle-over type with proper intake at the eaves.'),
    CT.intakeVent(),
  ],
};

/* ---------------------------------------------------------- residential --- */

const RESIDENTIAL: Partial<Record<ProductKey, RoofSystem>> = {
  landmark: certainteedSystem('landmark'),
  landmark_pro: certainteedSystem('landmark_pro'),
  landmark_premium: certainteedSystem('landmark_premium'),
  landmark_belmont: certainteedSystem('landmark_belmont'),
  landmark_grand_manor: certainteedSystem('landmark_grand_manor'),
  landmark_presidential: certainteedSystem('landmark_presidential'),
  landmark_solaris: certainteedSystem('landmark_solaris'),
  tamko_titan_basic: TAMKO_SYSTEM,
  standing_seam_metal: UNION_SYSTEM,
  stone_coated_steel: DECRA_SYSTEM,
  cedur_shake: CEDUR_SYSTEM,
  davinci_shake: DAVINCI_SYSTEM,
};

/** The layer-by-layer system for any catalog product, residential or commercial; null for a rep-typed custom product. */
export function roofSystemFor(product: Pick<RoofingProduct, 'key'> | ProductKey | CommercialProductKey): RoofSystem | null {
  const key = typeof product === 'string' ? product : product?.key;
  if (!key) return null;
  return (RESIDENTIAL as Partial<Record<string, RoofSystem>>)[key]
    ?? (COMMERCIAL as Partial<Record<string, RoofSystem>>)[key]
    ?? null;
}

/* ----------------------------------------------------------- commercial --- */

/**
 * GAF product-page photos, captured from the rendered page (the CDN refuses
 * any non-browser client). GAF's contractor guidelines prefer Partner Portal
 * assets — swap these for those once they are pulled.
 */
const GAF_TPO_SYSTEM: RoofSystem = {
  maker: 'GAF',
  systemName: 'GAF EverGuard&reg; TPO roofing system',
  lede: 'Every layer from the deck up is GAF\'s, which is what qualifies the roof for a GAF system guarantee instead of a materials-only warranty. Leaks caused by non-GAF materials in the assembly are excluded from those guarantees, so nothing is substituted.',
  cutaway: 'gaf/tpo-installed.jpg',
  components: [
    {
      role: 'vapor', step: 'Stop moisture rising from inside (where the building needs it)',
      name: 'GAF SA Vapor Retarder XL', maker: 'GAF',
      plain: 'A peel-and-stick sheet laid directly on the deck that stops moisture from inside the building rising into the insulation and wetting it from below. Used where the building\'s use and the deck call for it.',
      spec: 'Self-adhered; woven polyethylene facer with butyl adhesive; no primer; ASTM E108 Class A and FM 4470 Class 1 direct to steel deck (GAF).',
      image: 'gaf/vapor-retarder.jpg',
    },
    {
      role: 'insulation', step: 'Insulate the roof',
      name: 'EnergyGuard&trade; Polyiso Insulation', maker: 'GAF',
      plain: 'Rigid foam boards, installed in two layers with the joints staggered so there is no straight path for heat, keep heat in during winter and out in summer.',
      spec: 'ASTM C1289 Type II, Class 1; LTTR R-value 5.7 per inch at 1.0" and 11.4 at 2.0"; two layers of 2.6" reach R-30; FM 4450/4470, UL 1256/790 (GAF).',
      image: 'gaf/polyiso.jpg',
    },
    {
      role: 'cover-board', step: 'Harden the surface',
      name: 'EnergyGuard&trade; HD Polyiso Cover Board', maker: 'GAF',
      plain: 'A thin, hard board over the soft insulation that protects it from foot traffic and hail and gives the membrane a firm surface to bond to.',
      spec: '0.5" thick; R-2.5; ASTM C1289 Type II Class 4 Grade 1 (80&ndash;109 psi); FM 4450/4470 including Class 1-SH hail (GAF).',
      image: 'gaf/cover-board.jpg',
    },
    {
      role: 'attachment', step: 'Anchor it to the deck',
      name: 'Drill-Tec&trade; fasteners and plates (or EverGuard&reg; TPO SBA 1121 Bonding Adhesive)', maker: 'GAF',
      plain: 'The screws and plates &mdash; or, on an adhered roof, the bonding adhesive &mdash; that hold the insulation and membrane to the deck so wind cannot lift them.',
      spec: 'Drill-Tec&trade; #14 fastener for 18&ndash;22 ga steel, wood and concrete, CR-10 coating, FM Approved; SBA 1121 rubber-based contact adhesive, 50&ndash;70 sq ft per gallon (GAF).',
      image: 'gaf/fastener.jpg',
    },
    {
      role: 'membrane', step: 'Weld the roof surface',
      name: 'EverGuard&reg; TPO Smooth Membrane', maker: 'GAF',
      plain: 'The white, heat-welded waterproof sheet that is the actual roof surface. Seams are welded with hot air into one continuous sheet, and the white surface reflects sun to lower cooling costs.',
      spec: 'Meets or exceeds ASTM D6878; 45, 60 or 80 mil; UL 790 Class A; FM; CRRC initial solar reflectance 0.81; guarantees up to 20 / 25 / 30 years by thickness (GAF).',
      image: 'gaf/tpo-membrane.jpg',
    },
    {
      role: 'accessories', step: 'Flash every corner, pipe and seam',
      name: 'EverGuard&reg; TPO Universal Corners, Split Pipe Boots and Cover Tape', maker: 'GAF',
      plain: 'Factory-made TPO pieces for corners, pipes and seam intersections replace hand-cut flashings, so the tricky spots are sealed the same way every time.',
      spec: 'Universal Corner 55 mil; Split Pipe Boot 45-mil reinforced, 1"&ndash;8" pipes; Heat-Weldable Cover Tape 6" &times; 100\' (GAF).',
      image: 'gaf/universal-corner.jpg',
    },
    {
      role: 'edge-metal', step: 'Finish and anchor the perimeter',
      name: 'EverGuard&reg; TPO Coated Metal and TPO Drip Edge', maker: 'GAF',
      plain: 'Metal edging with TPO bonded to it, so the membrane welds straight onto the metal at the roof edge for a watertight, finished perimeter.',
      spec: '24-gauge steel with a 25-mil membrane film; drip edge in 3"&ndash;6" faces with concealed splice plates (GAF).',
      image: 'gaf/drip-edge.jpg',
    },
    {
      role: 'walkway', step: 'Protect the paths to the equipment',
      name: 'EverGuard&reg; TPO Walkway Roll', maker: 'GAF',
      plain: 'Non-slip walkway welded onto the roof wherever people go to service equipment, so foot traffic wears the mat instead of the roof.',
      spec: '140-mil TPO; required on a GAF-guaranteed roofing system (GAF).',
      image: 'gaf/walkway.jpg',
    },
  ],
};

function duroLastSystem(layover: boolean): RoofSystem {
  return {
    maker: 'Duro-Last',
    systemName: 'Duro-Last&reg; PVC roofing system',
    lede: 'Duro-Last measures the roof and welds most of the membrane, and every stack, curb and corner flashing, to size in its factory &mdash; so the seams made on your roof are a fraction of what a roll-goods roof needs. Every layer named here is Duro-Last\'s, which is what its warranty requires.',
    cutaway: 'duro-last/custom-fab.jpg',
    components: [
      layover
        ? {
            role: 'prep', step: 'Prepare the existing roof',
            name: 'Existing roof surveyed, repaired and separated', maker: COMPANY_SUPPLIED,
            plain: 'On a layover the old roof stays. We core-sample it for trapped moisture, replace any wet insulation, and lay a separation sheet so the new system never touches the old surface directly.',
            image: null,
          }
        : {
            role: 'vapor', step: 'Stop moisture rising from inside (where the building needs it)',
            name: 'Duro-Last&reg; Vapor Barrier', maker: 'Duro-Last',
            plain: 'A sticky-backed sheet on the bare deck that stops warm, moist indoor air from rising into the insulation and wetting it from below. Used where the building\'s use and the deck call for it.',
            spec: 'SBS-modified bitumen adhesive under a tri-laminated woven polyethylene facer; 31 mils; 0.03 perm (ASTM E96) (Duro-Last).',
            image: 'duro-last/vapor-barrier.jpg',
          },
      {
        role: 'insulation', step: 'Insulate the roof',
        name: 'Duro-Guard&reg; ISO II Insulation', maker: 'Duro-Last',
        plain: 'Rigid closed-cell foam boards under the membrane, flat or tapered to drain, that keep heat in during winter and out in summer.',
        spec: 'Closed-cell polyiso; ASTM C1289 Type II, Class 1, Grade 2 (20 psi) or Grade 3 (25 psi); 4\' &times; 8\'; 1"&ndash;4" flat plus tapered panels; UL Classified (Duro-Last).',
        image: 'duro-last/insulation.jpg',
      },
      {
        role: 'cover-board', step: 'Harden the surface',
        name: 'Duro-Guard&reg; Cover Board', maker: 'Duro-Last',
        plain: 'A thin, hard board over the soft insulation so the surface is flat and firm, resists hail and foot traffic, and gives the membrane something solid to bond to.',
        spec: 'Duro-Guard&reg; ISO HD: &frac12;", R-2.5, 80&ndash;110 psi; gypsum and fiber boards also supplied under the Duro-Guard name; UL, FM and Miami-Dade approved (Duro-Last).',
        image: 'duro-last/cover-board.jpg',
      },
      {
        role: 'attachment', step: 'Anchor it to the deck',
        name: 'Duro-Last&reg; fasteners and plates (Duro-Bond&reg; induction weld)', maker: 'Duro-Last',
        plain: 'Plates screwed through the insulation to the deck, then the membrane is welded to those plates from above by induction &mdash; no holes through the membrane, no exposed fasteners.',
        spec: 'Duro-Bond&reg;: specially coated plates with a non-penetrating induction-weld attachment; Duro-Last fastener and plate family (Duro-Last).',
        image: 'duro-last/fasteners.jpg',
      },
      {
        role: 'membrane', step: 'Weld the roof surface',
        name: 'Duro-Last&reg; PVC Roofing Membrane', maker: 'Duro-Last',
        plain: 'The white, heat-welded PVC sheet that is the waterproof surface of the roof, cut and welded to your building\'s measurements in the factory so far fewer seams are made on the roof.',
        spec: '40 / 50 / 60 mil; ASTM D4434 Type III internally reinforced (50 mil); CRRC initial solar reflectance 0.86, SRI 109; NSF/ANSI 347 Platinum; UL and FM approved (Duro-Last).',
        image: 'duro-last/membrane.jpg',
      },
      {
        role: 'accessories', step: 'Flash every pipe, unit and corner',
        name: 'Duro-Last&reg; prefabricated Stack, Curb and Corner Flashings', maker: 'Duro-Last',
        plain: 'Pre-made boots and collars, built in the factory to fit each pipe, unit and corner on your roof, that the crew welds to the main sheet instead of hand-cutting them where most leaks start.',
        spec: 'Stack flashings from 1" diameter; curb flashings prefabricated with outside corners to eliminate field welds in the corners; inside and outside corners; parapet and wall flashings (Duro-Last).',
        image: 'duro-last/accessories.jpg',
      },
      {
        role: 'edge-metal', step: 'Finish and anchor the perimeter',
        name: 'Duro-Last&reg; 2-Piece Snap-On Compression edge and Vinyl-Coated Drip Edge', maker: 'Duro-Last',
        plain: 'The metal trim that finishes and anchors the roof\'s outer edge and wall tops so wind cannot peel the membrane up; the PVC-coated pieces let the membrane weld straight to the metal.',
        spec: 'Domestic high-strength metal; many profiles rated per ANSI/SPRI ES-1; 2-Piece Snap-On in .040 aluminum, 24-ga steel or Galvalume, 3"&ndash;8" faces (Duro-Last / EXCEPTIONAL&reg; Metals).',
        image: 'duro-last/edge-metal.jpg',
      },
      {
        role: 'walkway', step: 'Protect the paths to the equipment',
        name: 'ROOF-TRAK&reg; III Walkway Pads', maker: 'Duro-Last',
        plain: 'Non-slip pads welded onto the roof wherever people walk to service equipment, so foot traffic wears the pad instead of the roof.',
        spec: 'Made from recycled Duro-Last membrane; 0.135" thick; white with safety-yellow skirt; hot-air welded (Duro-Last).',
        image: 'duro-last/walkway-pads.jpg',
      },
    ],
  };
}

const COMMERCIAL: Partial<Record<CommercialProductKey, RoofSystem>> = {
  gaf_commercial_tpo: GAF_TPO_SYSTEM,
  dura_last_tpo: duroLastSystem(false),
  dura_last_layover: duroLastSystem(true),
  // restoration_coating: a coating over the existing roof has no new stack to walk through.
};

export function commercialRoofSystemFor(key: CommercialProductKey): RoofSystem | null {
  return COMMERCIAL[key] ?? null;
}

/** Every system, for tests and the review sheet. */
export function allRoofSystems(): Array<{ key: string; system: RoofSystem }> {
  return [
    ...Object.entries(RESIDENTIAL).map(([key, system]) => ({ key, system: system! })),
    ...Object.entries(COMMERCIAL).map(([key, system]) => ({ key, system: system! })),
  ];
}
