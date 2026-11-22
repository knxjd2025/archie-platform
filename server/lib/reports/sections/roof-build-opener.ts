/**
 * The opening of every customer document: the roof coming off and the new one
 * going on, layer by layer, as the reader scrolls.
 *
 * A house for a pitched roof, a flat-roof building for a low-slope one, and a
 * different set of layers for each product: the steps and their wording come
 * from the product's own system in roof-systems.ts, so a standing seam quote
 * shows panels going on and names the panel, not a shingle. A product with no
 * system on file (a rep-typed custom product, EPDM, modified bitumen, the
 * coating) gets a plain stack that names no manufacturer and promises nothing
 * the "every job includes" lists do not already say.
 *
 * Self-contained on purpose. It carries its own CSS and its own scroll loop,
 * and is not a section in the arranged list, so it renders the same in the
 * document shells (premiumShell, dossierShell) and the scroll shells without
 * touching chapter numbers, the folio or a rep's saved layout.
 *
 * It is a drawing, and says so on the page. It never stands in for a job
 * photo: every photo in these documents is still the real roof.
 */
import { esc } from '../report-theme.js';
import { companyBrand } from '../company-brand.js';
import { isCommercialReport } from '../commercial-context.js';
import { roofSystemFor, type ComponentRole, type RoofSystem } from '../roof-systems.js';
import type { RoofingProduct, TierPricing } from '../roofing-products.js';

/* ------------------------------------------------------------------ model --- */

export type BuildKind = 'house' | 'flat';
/** What the finished roof is drawn as. */
export type BuildSurface =
  | 'shingle' | 'standing-seam' | 'stone-coated' | 'shake' | 'slate'
  | 'membrane-white' | 'membrane-black' | 'membrane-granule' | 'coating';
/** What happens to the roof that is there today. */
export type BuildPath = 'tear_off' | 'layover' | 'coating';

/** The picture a step draws: a system role, or one of the steps around it. */
export type BuildVisual = ComponentRole | 'protect' | 'tear-off' | 'deck' | 'cricket' | 'survey' | 'coating' | 'clean-up'
  | 'setup' | 'taper' | 'seams' | 'final';

export interface BuildStep {
  visual: BuildVisual;
  /** Short name in the checklist. */
  label: string;
  /** The headline. Plain text. */
  title: string;
  /** One or two sentences. Authored HTML (may carry entities). */
  body: string;
  /** The product used at this step, as the manufacturer prints it. Authored HTML. */
  product?: string;
}

export interface BuildScene {
  kind: BuildKind;
  surface: BuildSurface;
  path: BuildPath;
  /** Set when the document offers this as one of Good / Better / Best. */
  tier?: 'good' | 'better' | 'best';
  /** The product's name, or null when the document names none. */
  productName: string | null;
  steps: BuildStep[];
}

export interface RoofBuildOpenerOpts {
  /** What the document calls itself, e.g. "Roof Replacement Proposal". */
  docLabel: string;
  customer?: string | null;
  /**
   * 'options' shows every distinct product the document offers; 'selected'
   * only the one being quoted; 'generic' is for a document that picks no
   * product (an inspection) and names none.
   */
  mode: 'options' | 'selected' | 'generic';
}

const PITCHED_ORDER: ComponentRole[] = [
  'drip-edge', 'ice-water', 'underlayment', 'starter', 'field', 'fasteners', 'flashing', 'trim', 'hip-ridge', 'exhaust', 'intake',
];
const FLAT_ORDER: ComponentRole[] = [
  'prep', 'vapor', 'insulation', 'cover-board', 'attachment', 'membrane', 'accessories', 'edge-metal', 'walkway',
];

const FIELD_LABEL: Record<BuildSurface, string> = {
  shingle: 'Shingles', 'standing-seam': 'Metal panels', 'stone-coated': 'Steel panels', shake: 'Shakes', slate: 'Tiles',
  'membrane-white': 'Membrane', 'membrane-black': 'Membrane', 'membrane-granule': 'Membrane', coating: 'Coating',
};

const ROLE_LABEL: Record<Exclude<BuildVisual, 'field'>, string> = {
  protect: 'Property protected', 'tear-off': 'Old roof removed', deck: 'Deck checked', cricket: 'Crickets', survey: 'Moisture check',
  setup: 'Site set up', taper: 'Sloped to drain', seams: 'Seams sealed', final: 'Final check',
  'drip-edge': 'Drip edge', 'ice-water': 'Leak barrier', underlayment: 'Underlayment', starter: 'Starter row',
  'hip-ridge': 'Ridge caps', exhaust: 'Ridge vent', intake: 'Intake vents', flashing: 'Flashing', fasteners: 'Fasteners', trim: 'Trim',
  prep: 'Roof prepared', vapor: 'Vapor barrier', insulation: 'Insulation', 'cover-board': 'Cover board', attachment: 'Attachment',
  membrane: 'Membrane', accessories: 'Flashings', 'edge-metal': 'Edge metal', walkway: 'Walkway pads', coating: 'Coating',
  'clean-up': 'Clean up',
};

function labelFor(visual: BuildVisual, surface: BuildSurface): string {
  return visual === 'field' ? FIELD_LABEL[surface] : ROLE_LABEL[visual];
}

/** The finished surface a product is drawn as. Keys first; the name only for a rep-typed product. */
export function surfaceFor(product: Pick<RoofingProduct, 'key' | 'name' | 'category' | 'system'> | null, kind: BuildKind): BuildSurface {
  const key = String(product?.key ?? '');
  const name = String(product?.name ?? '');
  if (kind === 'flat') {
    if (product?.system === 'coating' || /coating/i.test(key)) return 'coating';
    if (/epdm/i.test(key) || /\bepdm\b|rubber/i.test(name)) return 'membrane-black';
    if (/modified|bitumen/i.test(key) || /modified|bitumen|mod[- ]?bit/i.test(name)) return 'membrane-granule';
    return 'membrane-white';
  }
  if (/^standing_seam/.test(key)) return 'standing-seam';
  if (key === 'stone_coated_steel') return 'stone-coated';
  if (key === 'cedur_shake') return 'shake';
  if (key === 'davinci_shake') return 'slate';
  if (product?.category === 'metal') return /stone/i.test(name) ? 'stone-coated' : 'standing-seam';
  if (/shake/i.test(name) && key === 'custom') return 'shake';
  if (/slate|tile/i.test(name) && key === 'custom') return 'slate';
  return 'shingle';
}

/* The steps around the product's own. Wording follows how-the-job-runs.ts and
   COMMERCIAL_INCLUDES, which are the commitments already made on these documents. */

const HOUSE_BEFORE: BuildStep[] = [
  { visual: 'protect', label: ROLE_LABEL.protect, title: 'First, we protect your home.', body: 'We cover landscaping, walkways, and anything else on the ground before a single shingle comes off.' },
  { visual: 'tear-off', label: ROLE_LABEL['tear-off'], title: 'The old roof comes off.', body: 'Every layer is removed down to the wood deck and hauled away, so nothing new is laid over a problem.' },
  { visual: 'deck', label: ROLE_LABEL.deck, title: 'The deck is inspected.', body: 'Anything soft or rotten is photographed and priced before we go further. Nothing gets covered up without you seeing it first.' },
  { visual: 'cricket', label: ROLE_LABEL.cricket, title: 'Crickets behind the chimney and skylight.', body: 'A cricket is a small peaked ridge on the high side of a chimney or skylight. It splits the water and sends it around both sides, so it never sits against the back wall.' },
];
const HOUSE_AFTER: BuildStep = {
  visual: 'clean-up', label: ROLE_LABEL['clean-up'], title: 'Then we clean up.', body: 'We run magnets over the driveway and yard for stray nails, and haul away every bit of the old roof before we leave.',
};

const GENERIC_HOUSE: Record<'shingle' | 'standing-seam' | 'stone-coated' | 'shake' | 'slate', Array<[ComponentRole, string, string]>> = {
  shingle: [
    ['drip-edge', 'Metal edge on every eave and rake', 'A metal strip along the roof edges that sends water into the gutter instead of behind it.'],
    ['ice-water', 'Waterproof the places that leak first', 'A self-sealing membrane goes on the eaves, valleys and around anything that comes through the roof.'],
    ['underlayment', 'Cover the whole deck', 'Underlayment covers the rest of the deck, a second line of defense under the shingles.'],
    ['starter', 'Lock down the first row', 'A starter row seals the bottom edge, where wind tries to lift a roof first.'],
    ['field', 'Lay the shingles', 'The shingles go on from the eave up to the peak, row over row.'],
    ['flashing', 'Seal every wall, chimney and pipe', 'Metal flashing and new pipe boots go wherever the roof meets something else.'],
    ['hip-ridge', 'Cap the peaks and hips', 'Ridge caps close the top of the roof and finish the lines you see from the street.'],
  ],
  'standing-seam': [
    ['drip-edge', 'Metal edge on every eave', 'A metal edge along the eaves sends water into the gutter instead of behind it.'],
    ['underlayment', 'Cover the whole deck', 'Underlayment covers the deck before any panel goes down.'],
    ['field', 'Set the panels', 'Each panel runs from the eave to the peak in one piece and locks to the next along a raised seam.'],
    ['trim', 'Trim every edge and valley', 'Matching metal trim finishes the rakes, valleys and walls.'],
    ['hip-ridge', 'Cap the peaks and hips', 'A matching ridge cap closes the top of the roof.'],
  ],
  'stone-coated': [
    ['drip-edge', 'Metal edge on every eave', 'A metal edge along the eaves sends water into the gutter instead of behind it.'],
    ['underlayment', 'Cover the whole deck', 'Underlayment covers the deck before any panel goes down.'],
    ['field', 'Set the panels', 'The steel panels go on from the eave up, each one locking into the row below.'],
    ['trim', 'Trim every edge and valley', 'Matching trim finishes the rakes, valleys and walls.'],
    ['hip-ridge', 'Cap the peaks and hips', 'Matching caps close the peaks and hips.'],
  ],
  shake: [
    ['underlayment', 'Cover the whole deck', 'Underlayment covers the deck before the first course goes down.'],
    ['starter', 'Set the starter course', 'A starter course sets the line for every row above it.'],
    ['field', 'Lay the shakes', 'The shakes go on from the eave up to the peak, row over row.'],
    ['flashing', 'Seal every wall, chimney and pipe', 'Metal flashing and new pipe boots go wherever the roof meets something else.'],
    ['hip-ridge', 'Cap the peaks and hips', 'Matching caps close the peaks and hips.'],
  ],
  slate: [
    ['underlayment', 'Cover the whole deck', 'Underlayment covers the deck before the first course goes down.'],
    ['starter', 'Set the starter course', 'A starter course sets the line for every row above it.'],
    ['field', 'Lay the tiles', 'The tiles go on from the eave up to the peak, row over row.'],
    ['flashing', 'Seal every wall, chimney and pipe', 'Metal flashing and new pipe boots go wherever the roof meets something else.'],
    ['hip-ridge', 'Cap the peaks and hips', 'Matching caps close the peaks and hips.'],
  ],
};

/* Commercial steps around the product's own. The wording is the approved
   "How the Job Runs" copy in render-commercial-proposal.ts (COMMERCIAL_STEPS),
   split so each sentence sits beside the picture it describes. */
const FLAT_SETUP: BuildStep = { visual: 'setup', label: ROLE_LABEL.setup, title: 'First, we get set up.', body: 'The crane or lift day is planned around the building. Where the dumpster and materials go is settled before work starts.' };
const FLAT_BEFORE: Record<BuildPath, BuildStep[]> = {
  tear_off: [
    FLAT_SETUP,
    { visual: 'tear-off', label: ROLE_LABEL['tear-off'], title: 'The old roof comes off.', body: 'We take the old roof off down to the deck and haul it away.' },
    { visual: 'deck', label: ROLE_LABEL.deck, title: 'The deck is inspected.', body: 'If we find wet or broken parts, we show you and give you a price before we go on.' },
  ],
  layover: [
    FLAT_SETUP,
    { visual: 'survey', label: ROLE_LABEL.survey, title: 'The existing roof is checked first.', body: 'It is core-sampled for trapped moisture. Wet insulation is reported and priced before we proceed.' },
  ],
  coating: [FLAT_SETUP],
};
const FLAT_TAPER: BuildStep = { visual: 'taper', label: ROLE_LABEL.taper, title: 'Sloped boards where water sat.', body: 'Where water was sitting, sloped boards go down so it drains.' };
const FLAT_SEAMS: BuildStep = { visual: 'seams', label: ROLE_LABEL.seams, title: 'Every seam is sealed.', body: 'The new roof sheets are rolled out and every seam is sealed, so the roof is one continuous surface.' };
const FLAT_FINAL: BuildStep = { visual: 'final', label: ROLE_LABEL.final, title: 'The finished roof is checked.', body: 'Seams, flashings, drains and edges are walked and checked before the job is closed out.' };
const FLAT_AFTER: BuildStep = { visual: 'clean-up', label: ROLE_LABEL['clean-up'], title: 'Then we clean up.', body: 'The roof and the ground around the building are left clean.' };

const GENERIC_FLAT: Record<BuildPath, Array<[BuildVisual, string, string]>> = {
  tear_off: [
    ['insulation', 'Insulate the roof', 'We put down the insulation you picked and fasten it the way the maker says.'],
    ['membrane', 'Lay the new membrane', 'The new membrane covers the whole roof, sheet by sheet.'],
    ['accessories', 'Flash every wall, drain, vent and pipe', 'We seal around every wall, drain, vent and pipe with the maker&rsquo;s own parts.'],
    ['edge-metal', 'Finish the perimeter', 'We put new metal trim around the edges and seal it.'],
    ['walkway', 'Protect the paths to the equipment', 'We lay walk pads to every rooftop unit so workers do not damage the roof.'],
  ],
  layover: [
    ['prep', 'Prepare the existing roof', 'A separation sheet goes over the existing roof, which stays in place underneath.'],
    ['membrane', 'Lay the new membrane', 'The new membrane covers the whole roof, sheet by sheet.'],
    ['accessories', 'Flash every wall, drain, vent and pipe', 'We seal around every wall, drain, vent and pipe with the maker&rsquo;s own parts.'],
    ['edge-metal', 'Finish the perimeter', 'We put new metal trim around the edges and seal it.'],
    ['walkway', 'Protect the paths to the equipment', 'We lay walk pads to every rooftop unit so workers do not damage the roof.'],
  ],
  coating: [
    ['prep', 'Clean and prepare the roof', 'The roof is cleaned and prepared, and seams, penetrations and flashings are reinforced.'],
    ['coating', 'Apply the coating', 'The restoration coating goes on at the manufacturer&rsquo;s coverage rate, over the roof that is already there.'],
  ],
};

/** Slots the steps no system lists (sloped boards, sealing the seams) in beside the layer they belong to. */
function withFlatExtras(body: BuildStep[], path: BuildPath): BuildStep[] {
  const out: BuildStep[] = [];
  for (const step of body) {
    out.push(step);
    if (step.visual === 'insulation' && path === 'tear_off') out.push(FLAT_TAPER);
    if (step.visual === 'membrane') out.push(FLAT_SEAMS);
  }
  return out;
}

function systemSteps(system: RoofSystem, order: ComponentRole[], surface: BuildSurface): BuildStep[] {
  const seen = new Set<ComponentRole>();
  const steps: Array<BuildStep & { at: number }> = [];
  for (const c of system.components) {
    const at = order.indexOf(c.role);
    if (at < 0 || seen.has(c.role)) continue;
    seen.add(c.role);
    steps.push({ at, visual: c.role, label: labelFor(c.role, surface), title: c.step, body: c.plain, product: c.name });
  }
  return steps.sort((a, b) => a.at - b.at).map(({ at: _at, ...s }) => s);
}

function genericSteps(rows: Array<[BuildVisual, string, string]>, surface: BuildSurface): BuildStep[] {
  return rows.map(([visual, title, body]) => ({ visual, label: labelFor(visual, surface), title, body }));
}

/** The scene for one product, or for no product at all (`product` null). */
export function buildSceneFor(product: RoofingProduct | null, opts: { commercial: boolean; tier?: BuildScene['tier'] }): BuildScene {
  const kind: BuildKind = product ? (product.category === 'commercial' ? 'flat' : 'house') : (opts.commercial ? 'flat' : 'house');
  const surface = surfaceFor(product, kind);
  const path: BuildPath = kind === 'flat' ? (product?.system ?? 'tear_off') : 'tear_off';
  const system = product ? roofSystemFor(product as Pick<RoofingProduct, 'key'>) : null;
  let steps: BuildStep[];
  if (kind === 'house') {
    const mine = system ? systemSteps(system, PITCHED_ORDER, surface) : [];
    // A system with no finished surface in it cannot be drawn going on; fall back to the plain stack.
    const body = mine.some((s) => s.visual === 'field') ? mine : genericSteps(GENERIC_HOUSE[surface as keyof typeof GENERIC_HOUSE] ?? GENERIC_HOUSE.shingle, surface);
    steps = [...HOUSE_BEFORE, ...body, HOUSE_AFTER];
  } else {
    const mine = system ? systemSteps(system, FLAT_ORDER, surface) : [];
    const body = mine.some((s) => s.visual === 'membrane') ? mine : genericSteps(GENERIC_FLAT[path], surface);
    steps = [...FLAT_BEFORE[path], ...withFlatExtras(body, path), FLAT_FINAL, FLAT_AFTER];
  }
  return { kind, surface, path, tier: opts.tier, productName: product?.name ?? null, steps };
}

/** Every scene a document opens with; empty when there is no new roof on it to show. */
export function buildScenes(report: any, mode: RoofBuildOpenerOpts['mode']): BuildScene[] {
  const commercial = isCommercialReport(report);
  if (mode === 'generic') return [buildSceneFor(null, { commercial })];
  const all = ((report?.replacementOptions as TierPricing[] | undefined) ?? []).filter((o) => o?.product && o.product.category !== 'service');
  if (!all.length) return [];
  const selected = all.find((o) => o.tier === report?.selectedTier) ?? all[0];
  const picked = mode === 'selected' ? [selected] : all;
  const distinct = new Set(picked.map((o) => `${o.product.key}|${o.product.name}`));
  if (distinct.size === 1) return [buildSceneFor(selected.product, { commercial })];
  return picked.map((o) => buildSceneFor(o.product, { commercial, tier: o.tier }));
}

/* --------------------------------------------------------------- drawing --- */

type Pt = [number, number];
interface View { ox: number; oy: number; s: number }
const EX: Pt = [0.86, 0.30];
const EY: Pt = [0.52, -0.40];
const r1 = (n: number): number => Math.round(n * 10) / 10;

function proj(v: View, x: number, y: number, z: number): Pt {
  return [r1(v.ox + (x * EX[0] + y * EY[0]) * v.s), r1(v.oy + (x * EX[1] + y * EY[1] - z) * v.s)];
}
const pts = (p: Pt[]): string => p.map((q) => q.join(',')).join(' ');
function poly(p: Pt[], fill: string, extra = ''): string {
  return `<polygon points="${pts(p)}" fill="${fill}"${extra ? ' ' + extra : ''}/>`;
}
/** matrix() that maps a flat (u, v) drawing onto the plane through `o` spanned by `eu` and `ev`. */
function plane(o: Pt, eu: Pt, ev: Pt): string {
  return `matrix(${[eu[0], eu[1], ev[0], ev[1], o[0], o[1]].map((n) => Math.round(n * 1000) / 1000).join(' ')})`;
}
/** The three faces of a box you can see from the front right. */
function box(v: View, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, c: { front: string; side: string; top: string }, extra = ''): string {
  return [
    poly([proj(v, x0, y0, z0), proj(v, x1, y0, z0), proj(v, x1, y0, z1), proj(v, x0, y0, z1)], c.front, extra),
    poly([proj(v, x1, y0, z0), proj(v, x1, y1, z0), proj(v, x1, y1, z1), proj(v, x1, y0, z1)], c.side, extra),
    poly([proj(v, x0, y0, z1), proj(v, x1, y0, z1), proj(v, x1, y1, z1), proj(v, x0, y1, z1)], c.top, extra),
  ].join('');
}

/**
 * `data-*` for an element the scroll loop drives: which step, and how it moves.
 * `from` and `span` place the move inside the step (fractions of it), so one
 * step can show two things in turn.
 */
function drive(step: number | undefined, mode: string, extra = '', from = 0, span = 0.72): string {
  if (step === undefined) return '';
  const timing = from === 0 && span === 0.72 ? '' : ` data-rbo-f="${from}" data-rbo-s="${span}"`;
  return ` data-rbo-step="${step}" data-rbo-m="${mode}"${timing}${extra}`;
}

interface Painter {
  id: string;
  /** Step index by visual, for the scene being drawn. */
  at: Partial<Record<BuildVisual, number>>;
  U: number;
  V: number;
}

interface LayerOpts { v0?: number; v1?: number; from?: number; span?: number; edge?: number; edgeFill?: string }

/**
 * One layer on the roof plane, revealed by a growing clip, with a bright
 * working edge that travels with it. Without the script (or with motion
 * turned off) the clip is full size, so the page shows the finished roof; a
 * layer that is taken away starts at zero instead.
 */
function layer(p: Painter, name: string, visual: BuildVisual, mode: 'up' | 'x' | 'off-up' | 'off-x', inner: string, o: LayerOpts = {}): string {
  const step = p.at[visual];
  if (step === undefined) return '';
  const cid = `${p.id}-clip-${name}`;
  const off = mode.startsWith('off');
  const y = o.v0 ?? 0;
  const h = (o.v1 ?? p.V) - y;
  const edge = o.edge ?? 1.1;
  return `<clipPath id="${cid}"><rect x="0" y="${y}" width="${off ? 0 : p.U}" height="${off ? 0 : h}" data-u="${p.U}" data-v0="${y}" data-h="${h}" data-e="${edge}"${drive(step, mode, '', o.from ?? 0, o.span ?? 0.72)}/></clipPath><g clip-path="url(#${cid})" class="rbo-l rbo-l--${name}">${inner}</g><rect data-rbo-edge="${cid}" width="0" height="0" fill="${o.edgeFill ?? '#fff7dd'}" opacity="0"/>`;
}

const SURFACE_FILL: Record<BuildSurface, string> = {
  shingle: '#3f4347', 'standing-seam': '#4a4038', 'stone-coated': '#7a4a35', shake: '#8a6a4a', slate: '#4d5866',
  'membrane-white': '#e6e9eb', 'membrane-black': '#232527', 'membrane-granule': '#6b6964', coating: '#f3f5f6',
};

function surfacePattern(id: string, surface: BuildSurface): string {
  const f = SURFACE_FILL[surface];
  const open = (w: number, h: number): string => `<pattern id="${id}" width="${w}" height="${h}" patternUnits="userSpaceOnUse"><rect width="${w}" height="${h}" fill="${f}"/>`;
  switch (surface) {
    case 'standing-seam':
      return `${open(7, 60)}<rect x="0" width="0.7" height="60" fill="#6a5c50"/><rect x="0.7" width="0.5" height="60" fill="#2c2520"/></pattern>`;
    case 'stone-coated':
      return `${open(8, 5)}<path d="M0 5 Q4 1.4 8 5" fill="none" stroke="#5a3323" stroke-width="0.7"/><path d="M0 0.4 H8" stroke="#94614a" stroke-width="0.4"/></pattern>`;
    case 'shake':
      return `${open(15, 8)}<rect width="15" height="4" fill="#94734f"/><path d="M0 0H15M0 4H15" stroke="#4d3924" stroke-width="0.5"/><path d="M4 0V4M9.5 0V4M13 0V4M2 4V8M7 4V8M11.5 4V8" stroke="#5c452d" stroke-width="0.45"/></pattern>`;
    case 'slate':
      return `${open(8, 8)}<rect width="4" height="4" fill="#56626f"/><rect x="2" y="4" width="4" height="4" fill="#445060"/><path d="M0 0H8M0 4H8" stroke="#2c343f" stroke-width="0.45"/><path d="M0 0V4M4 0V4M2 4V8M6 4V8" stroke="#2c343f" stroke-width="0.4"/></pattern>`;
    case 'membrane-white':
      return `${open(20, 60)}<rect x="0" width="0.5" height="60" fill="#c3c9cd"/></pattern>`;
    case 'membrane-black':
      return `${open(20, 60)}<rect x="0" width="0.5" height="60" fill="#3a3d40"/></pattern>`;
    case 'membrane-granule':
      return `${open(10, 60)}<rect x="0" width="0.6" height="60" fill="#4d4b47"/><rect x="5" y="0" width="0.3" height="60" fill="#7c7a74"/></pattern>`;
    case 'coating':
      return `${open(40, 40)}<path d="M-5 45 L45 -5" stroke="#ffffff" stroke-width="5" opacity="0.55"/></pattern>`;
    default:
      return `${open(12, 8)}<rect width="6" height="4" fill="#474b50"/><rect x="9" y="4" width="3" height="4" fill="#383c40"/><path d="M0 0H12M0 4H12" stroke="#24272a" stroke-width="0.5"/><path d="M0 0V4M6 0V4M3 4V8M9 4V8" stroke="#2a2d30" stroke-width="0.4"/></pattern>`;
  }
}

function sharedDefs(id: string, surface: BuildSurface): string {
  return `<defs>
<pattern id="${id}-deck" width="24" height="16" patternUnits="userSpaceOnUse"><rect width="24" height="16" fill="#c9a26a"/><path d="M0 0H24M0 8H24" stroke="#9a7743" stroke-width="0.4"/><path d="M0 0V8M12 8V16" stroke="#9a7743" stroke-width="0.4"/></pattern>
<pattern id="${id}-old" width="12" height="8" patternUnits="userSpaceOnUse"><rect width="12" height="8" fill="#5f5a52"/><rect x="1" y="1" width="4" height="2.4" fill="#6f695f"/><rect x="7" y="5" width="3.4" height="2" fill="#4b4741"/><path d="M0 0H12M0 4H12" stroke="#403c37" stroke-width="0.5"/><path d="M0 0V4M6 0V4M3 4V8M9 4V8" stroke="#45413b" stroke-width="0.4"/></pattern>
<pattern id="${id}-under" width="110" height="10" patternUnits="userSpaceOnUse"><rect width="110" height="10" fill="#8fa2b0"/><path d="M0 0H110" stroke="#6f8494" stroke-width="0.5"/><path d="M0 5H110" stroke="#9fb1be" stroke-width="0.25" stroke-dasharray="3 3"/></pattern>
<pattern id="${id}-nail" width="6" height="4" patternUnits="userSpaceOnUse"><circle cx="1.5" cy="1" r="0.42" fill="#d9dde0"/><circle cx="4.5" cy="3" r="0.42" fill="#d9dde0"/></pattern>
<pattern id="${id}-flute" width="4" height="70" patternUnits="userSpaceOnUse"><rect width="4" height="70" fill="#9c9b97"/><rect x="0" width="1.3" height="70" fill="#7f7e7a"/></pattern>
<pattern id="${id}-gravel" width="14" height="14" patternUnits="userSpaceOnUse"><rect width="14" height="14" fill="#4c4944"/><circle cx="3" cy="4" r="1.6" fill="#5b5852"/><circle cx="10" cy="9" r="2.1" fill="#423f3b"/><circle cx="6" cy="12" r="1" fill="#605c56"/></pattern>
<pattern id="${id}-iso" width="16" height="32" patternUnits="userSpaceOnUse"><rect width="16" height="32" fill="#d3bb72"/><path d="M0 0V32M0 0H16M8 16H24M0 16H8" stroke="#ad954f" stroke-width="0.5"/></pattern>
<pattern id="${id}-iso2" width="16" height="32" patternUnits="userSpaceOnUse" patternTransform="translate(8 16)"><rect width="16" height="32" fill="#e3cf8c"/><path d="M0 0V32M0 0H16M8 16H24M0 16H8" stroke="#bfa85f" stroke-width="0.5"/></pattern>
<pattern id="${id}-board" width="16" height="32" patternUnits="userSpaceOnUse"><rect width="16" height="32" fill="#c9cdc9"/><path d="M0 0V32M0 0H16" stroke="#a3a8a4" stroke-width="0.5"/></pattern>
<pattern id="${id}-plate" width="10" height="10" patternUnits="userSpaceOnUse"><circle cx="5" cy="5" r="1.1" fill="#f0c24a" stroke="#7d6420" stroke-width="0.3"/></pattern>
${surfacePattern(`${id}-surf`, surface)}
<radialGradient id="${id}-ground" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#2c4a33"/><stop offset="0.7" stop-color="#1c2f22"/><stop offset="1" stop-color="#1c2f22" stop-opacity="0"/></radialGradient>
<linearGradient id="${id}-shade" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#000" stop-opacity="0.26"/><stop offset="0.45" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#fff" stop-opacity="0.10"/></linearGradient>
<radialGradient id="${id}-glow" cx="0.5" cy="0.6" r="0.6"><stop offset="0" stop-color="#ffd98a" stop-opacity="0.9"/><stop offset="1" stop-color="#e9a94a" stop-opacity="0.55"/></radialGradient>
</defs>`;
}

function backdrop(id: string): string {
  const stars = [[90, 70], [210, 130], [330, 50], [470, 110], [610, 40], [760, 90], [900, 60], [1040, 120], [1130, 50], [150, 210], [1010, 220], [560, 170]]
    .map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="${i % 3 === 0 ? 1.6 : 1.1}" fill="#dfe8f2" opacity="${i % 2 ? 0.5 : 0.8}"/>`).join('');
  return `<g class="rbo-stars">${stars}</g><ellipse cx="760" cy="590" rx="560" ry="150" fill="url(#${id}-ground)"/><ellipse cx="770" cy="640" rx="400" ry="46" fill="#05080b" opacity="0.5"/>`;
}

function houseSvg(scene: BuildScene, id: string): string {
  const v: View = { ox: 430, oy: 520, s: 54 };
  const W = 10; const D = 7; const H = 3.2; const R = 2.6; const OV = 0.5;
  const drop = (OV * R) / (D / 2);
  const U = 110; const V = 60;
  const at: Painter['at'] = {};
  scene.steps.forEach((s, i) => { at[s.visual] = i; });
  const p: Painter = { id, at, U, V };

  // The front slope as a flat (u, v) sheet: u along the eave, v from the eave up to the ridge.
  const o = proj(v, -OV, -OV, H - drop);
  const eu: Pt = [(EX[0] * v.s * (W + 2 * OV)) / U, (EX[1] * v.s * (W + 2 * OV)) / U];
  const ev: Pt = [(EY[0] * v.s * (D / 2 + OV)) / V, ((EY[1] * (D / 2 + OV) - (R + drop)) * v.s) / V];
  const roof = plane(o, eu, ev);
  const slope = R / (D / 2);
  const zAt = (y: number): number => H + slope * y;
  const uOf = (x: number): number => (x + OV) * (U / (W + 2 * OV));
  const vOf = (y: number): number => (y + OV) * (V / (D / 2 + OV));

  const wall = { front: '#d8cdbd', side: '#b9ad9c' };
  const frontWall = plane(proj(v, 0, 0, 0), [EX[0] * v.s, EX[1] * v.s], [0, -v.s]);
  const sideWall = plane(proj(v, W, 0, 0), [EY[0] * v.s, EY[1] * v.s], [0, -v.s]);
  const ground = plane(proj(v, 0, 0, 0), [EX[0] * v.s, EX[1] * v.s], [EY[0] * v.s, EY[1] * v.s]);
  const field = scene.surface === 'standing-seam' ? 'x' : 'up';
  const fieldFill = SURFACE_FILL[scene.surface];

  // Chimney, skylight and pipe: the three things a roof has to be sealed around.
  const c = { x0: 6.5, x1: 7.5, y0: 1.5, y1: 2.3, top: H + R + 0.55 };
  const k = { x0: 2.0, x1: 3.3, y0: 1.5, y1: 2.5, h: 0.2 };
  const pipeAt = { x: 8.7, y: 2.3 };
  // A dormer, so the roof has valleys: where two slopes meet and the most water runs.
  const d = { cx: 4.9, hw: 0.95, yf: 0.35, wall: 0.95, rise: 0.62 };

  /** A cricket: a small peaked ridge on the high side of something, so water goes around it. */
  const cricket = (x0: number, x1: number, y: number, len: number): { left: Pt[]; right: Pt[] } => {
    const mid = (x0 + x1) / 2;
    const apex = proj(v, mid, y, zAt(y) + slope * len);
    const tip = proj(v, mid, y + len, zAt(y + len));
    return { left: [proj(v, x0, y, zAt(y)), apex, tip], right: [proj(v, x1, y, zAt(y)), apex, tip] };
  };
  const EDGE = 'stroke="#1a1d20" stroke-opacity="0.55" stroke-width="1.2" stroke-linejoin="round"';
  const crickets = [cricket(c.x0, c.x1, c.y1, 0.62), cricket(k.x0, k.x1, k.y1, 0.5)];
  const cricketSkin = (light: string, dark: string, step: number | undefined): string => (step === undefined ? '' : `<g${drive(step, 'fade')}>${crickets.map((q) => poly(q.left, light, EDGE) + poly(q.right, dark, EDGE)).join('')}</g>`);
  // Each skin goes on when its layer does, so the cricket is never left bare.
  const cricketHtml = at.cricket === undefined ? '' : [
    cricketSkin('#e3c389', '#bf9a5c', at.cricket),
    cricketSkin('#2b3036', '#1d2125', at['ice-water']),
    cricketSkin('#9db0bd', '#7e93a2', at.underlayment),
    cricketSkin(fieldFill, fieldFill, at.field),
    cricketSkin('#d5dce0', '#a9b2b7', at.flashing),
  ].join('');

  const chimney = `<g${at.cricket === undefined ? '' : drive(at.cricket, 'ghost')}>${[
    poly([proj(v, c.x0, c.y0, zAt(c.y0)), proj(v, c.x1, c.y0, zAt(c.y0)), proj(v, c.x1, c.y0, c.top), proj(v, c.x0, c.y0, c.top)], '#9a5a44'),
    poly([proj(v, c.x1, c.y0, zAt(c.y0)), proj(v, c.x1, c.y1, zAt(c.y1)), proj(v, c.x1, c.y1, c.top), proj(v, c.x1, c.y0, c.top)], '#7c4635'),
    poly([proj(v, c.x0, c.y0, c.top), proj(v, c.x1, c.y0, c.top), proj(v, c.x1, c.y1, c.top), proj(v, c.x0, c.y1, c.top)], '#b5b0a8'),
    poly([proj(v, c.x0 + 0.25, c.y0 + 0.2, c.top), proj(v, c.x1 - 0.25, c.y0 + 0.2, c.top), proj(v, c.x1 - 0.25, c.y1 - 0.2, c.top), proj(v, c.x0 + 0.25, c.y1 - 0.2, c.top)], '#2a2623'),
  ].join('')}</g>`;

  const skylight = [
    poly([proj(v, k.x0, k.y0, zAt(k.y0)), proj(v, k.x1, k.y0, zAt(k.y0)), proj(v, k.x1, k.y0, zAt(k.y0) + k.h), proj(v, k.x0, k.y0, zAt(k.y0) + k.h)], '#efeae0'),
    poly([proj(v, k.x1, k.y0, zAt(k.y0)), proj(v, k.x1, k.y1, zAt(k.y1)), proj(v, k.x1, k.y1, zAt(k.y1) + k.h), proj(v, k.x1, k.y0, zAt(k.y0) + k.h)], '#cfc8bb'),
    poly([proj(v, k.x0, k.y0, zAt(k.y0) + k.h), proj(v, k.x1, k.y0, zAt(k.y0) + k.h), proj(v, k.x1, k.y1, zAt(k.y1) + k.h), proj(v, k.x0, k.y1, zAt(k.y1) + k.h)], '#f4f0e8'),
    poly([proj(v, k.x0 + 0.12, k.y0 + 0.1, zAt(k.y0 + 0.1) + k.h), proj(v, k.x1 - 0.12, k.y0 + 0.1, zAt(k.y0 + 0.1) + k.h), proj(v, k.x1 - 0.12, k.y1 - 0.1, zAt(k.y1 - 0.1) + k.h), proj(v, k.x0 + 0.12, k.y1 - 0.1, zAt(k.y1 - 0.1) + k.h)], '#5d8fb4'),
    poly([proj(v, k.x0 + 0.3, k.y0 + 0.1, zAt(k.y0 + 0.1) + k.h), proj(v, k.x0 + 0.62, k.y0 + 0.1, zAt(k.y0 + 0.1) + k.h), proj(v, k.x0 + 0.42, k.y1 - 0.1, zAt(k.y1 - 0.1) + k.h), proj(v, k.x0 + 0.12, k.y1 - 0.1, zAt(k.y1 - 0.1) + k.h)], '#a9cde6', 'opacity="0.55"'),
  ].join('');

  const dz = { eave: zAt(d.yf) + d.wall, ridge: zAt(d.yf) + d.wall + d.rise };
  const dy = { eave: d.yf + d.wall / slope, ridge: d.yf + (d.wall + d.rise) / slope };
  const dL = d.cx - d.hw; const dR = d.cx + d.hw;
  const dRoofL: Pt[] = [proj(v, dL - 0.1, d.yf - 0.12, dz.eave - 0.06), proj(v, d.cx, d.yf - 0.12, dz.ridge), proj(v, d.cx, dy.ridge, dz.ridge), proj(v, dL - 0.1, dy.eave - 0.1, dz.eave - 0.06)];
  const dRoofR: Pt[] = [proj(v, dR + 0.1, d.yf - 0.12, dz.eave - 0.06), proj(v, d.cx, d.yf - 0.12, dz.ridge), proj(v, d.cx, dy.ridge, dz.ridge), proj(v, dR + 0.1, dy.eave - 0.1, dz.eave - 0.06)];
  const dormerSkin = (light: string, dark: string, step: number | undefined, always = false): string => (step === undefined && !always ? '' : `<g${always ? '' : drive(step, 'fade')}>${poly(dRoofL, dark, EDGE)}${poly(dRoofR, light, EDGE)}</g>`);
  const dWinA = proj(v, d.cx - 0.42, d.yf, zAt(d.yf) + 0.2); const dWinB = proj(v, d.cx + 0.42, d.yf, zAt(d.yf) + 0.2);
  const dWinC = proj(v, d.cx + 0.42, d.yf, dz.eave - 0.05); const dWinD = proj(v, d.cx - 0.42, d.yf, dz.eave - 0.05);
  const dormer = [
    poly([proj(v, dR, d.yf, zAt(d.yf)), proj(v, dR, d.yf, dz.eave), proj(v, dR, dy.eave, dz.eave)], wall.side),
    poly([proj(v, dL, d.yf, zAt(d.yf)), proj(v, dR, d.yf, zAt(d.yf)), proj(v, dR, d.yf, dz.eave), proj(v, d.cx, d.yf, dz.ridge), proj(v, dL, d.yf, dz.eave)], wall.front),
    poly([dWinA, dWinB, dWinC, dWinD], `url(#${id}-glow)`, 'stroke="#f1ece3" stroke-width="3"'),
    dormerSkin('#4a4d50', '#3a3d40', undefined, true),
    dormerSkin('#e3c389', '#bf9a5c', at['tear-off']),
    dormerSkin('#9db0bd', '#7e93a2', at.underlayment),
    dormerSkin(fieldFill, fieldFill, at.field),
    `<path d="M${dRoofR[1][0]} ${dRoofR[1][1]}L${dRoofR[2][0]} ${dRoofR[2][1]}" stroke="#15181b" stroke-opacity="0.45" stroke-width="2"/>`,
    at['hip-ridge'] === undefined ? '' : `<path d="M${dRoofR[1][0]} ${dRoofR[1][1]}L${dRoofR[2][0]} ${dRoofR[2][1]}" stroke="${scene.surface === 'standing-seam' ? '#6a5c50' : scene.surface === 'shingle' ? '#54595e' : fieldFill}" stroke-width="6" stroke-linecap="round"${drive(at['hip-ridge'], 'fade')}/>`,
  ].join('');
  // The two valleys, on the main slope's own sheet.
  const valleyD = `M${r1(uOf(dL - 0.1))} ${r1(vOf(dy.eave - 0.1))}L${r1(uOf(d.cx))} ${r1(vOf(dy.ridge))}L${r1(uOf(dR + 0.1))} ${r1(vOf(dy.eave - 0.1))}`;
  const fl = 0.24;
  const pipe = proj(v, pipeAt.x, pipeAt.y, zAt(pipeAt.y));
  const flashing = at.flashing === undefined ? '' : `<g${drive(at.flashing, 'fade')} class="rbo-l">
${poly([proj(v, c.x0 - 0.08, c.y0, zAt(c.y0) - 0.05), proj(v, c.x1, c.y0, zAt(c.y0) - 0.05), proj(v, c.x1, c.y0, zAt(c.y0) + fl), proj(v, c.x0 - 0.08, c.y0, zAt(c.y0) + fl)], '#cfd6da')}
${poly([proj(v, c.x1, c.y0, zAt(c.y0) - 0.05), proj(v, c.x1, c.y1, zAt(c.y1) - 0.05), proj(v, c.x1, c.y1, zAt(c.y1) + fl), proj(v, c.x1, c.y0, zAt(c.y0) + fl)], '#a9b2b7')}
<ellipse cx="${pipe[0]}" cy="${pipe[1] + 2}" rx="13" ry="7" fill="#cfd6da"/></g>`;
  const ridgeA = proj(v, -OV, D / 2, H + R); const ridgeB = proj(v, W + OV, D / 2, H + R);
  const eaveA = proj(v, -OV, -OV - 0.12, H - drop - 0.2); const eaveB = proj(v, W + OV, -OV - 0.12, H - drop - 0.2);
  const spoutTop = proj(v, W + OV - 0.1, -OV - 0.12, H - drop - 0.2); const spoutBot = proj(v, W + OV - 0.1, -0.1, 0.1);

  // Where the leak barrier goes besides the eave: around everything that comes through the roof, and its flashings.
  const sealAround = `<rect x="${r1(uOf(c.x0) - 4)}" y="${r1(vOf(c.y0) - 4)}" width="${r1(uOf(c.x1) - uOf(c.x0) + 8)}" height="${r1(vOf(c.y1 + 0.62) - vOf(c.y0) + 7)}" rx="1" fill="#22262b"/><rect x="${r1(uOf(k.x0) - 4)}" y="${r1(vOf(k.y0) - 4)}" width="${r1(uOf(k.x1) - uOf(k.x0) + 8)}" height="${r1(vOf(k.y1 + 0.5) - vOf(k.y0) + 7)}" rx="1" fill="#22262b"/><circle cx="${r1(uOf(pipeAt.x))}" cy="${r1(vOf(pipeAt.y))}" r="4.6" fill="#22262b"/><path d="${valleyD}" fill="none" stroke="#22262b" stroke-width="7.5" stroke-linejoin="round" stroke-linecap="round"/><path d="${valleyD}" fill="none" stroke="#565d66" stroke-width="0.5" stroke-linejoin="round"/>`;

  return `<svg class="rbo__art" viewBox="0 0 1200 720" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Drawing of a house with its roof being replaced, one layer at a time">
${sharedDefs(id, scene.surface)}
${backdrop(id)}
<g transform="${ground}"><rect x="-1.4" y="-3" width="13" height="2.6" rx="0.2" fill="#3a3f44" opacity="0.55"/><rect x="4.2" y="-3" width="1.6" height="2.9" fill="#4a5056" opacity="0.6"/><circle cx="1.2" cy="-0.55" r="0.5" fill="#2f6b3a"/><circle cx="2.1" cy="-0.5" r="0.4" fill="#3b7d46"/><circle cx="8.8" cy="-0.55" r="0.5" fill="#2f6b3a"/><circle cx="7.9" cy="-0.5" r="0.36" fill="#3b7d46"/></g>
${at.protect === undefined ? '' : `<g class="rbo-l" opacity="0"${drive(at.protect, 'fade', ` data-rbo-until="${at['clean-up'] ?? scene.steps.length}"`)}><g transform="${ground}"><rect x="0.2" y="-1.5" width="9.6" height="1.35" fill="#2f6fb3" opacity="0.92"/><path d="M0.2 -1.05H9.8M0.2 -0.6H9.8" stroke="#5a93cf" stroke-width="0.05"/></g>${box(v, 11.6, 13.4, -3.1, -1.9, 0, 0.95, { front: '#2e6b4a', side: '#235238', top: '#3b3f42' })}</g>`}
${poly([proj(v, W, 0, 0), proj(v, W, D, 0), proj(v, W, D, H), proj(v, W, D / 2, H + R), proj(v, W, 0, H)], wall.side)}
${poly([proj(v, 0, 0, 0), proj(v, W, 0, 0), proj(v, W, 0, H), proj(v, 0, 0, H)], wall.front)}
<g transform="${frontWall}"><rect x="4.4" y="0" width="1.2" height="2.2" fill="#5a3b2c"/><rect x="4.55" y="1.2" width="0.9" height="0.7" fill="url(#${id}-glow)" opacity="0.5"/><rect x="1.2" y="1.05" width="1.7" height="1.3" fill="url(#${id}-glow)" stroke="#f1ece3" stroke-width="0.1"/><path d="M2.05 1.05V2.35M1.2 1.7H2.9" stroke="#f1ece3" stroke-width="0.06"/><rect x="7.1" y="1.05" width="1.7" height="1.3" fill="url(#${id}-glow)" stroke="#f1ece3" stroke-width="0.1"/><path d="M7.95 1.05V2.35M7.1 1.7H8.8" stroke="#f1ece3" stroke-width="0.06"/><rect x="0" y="0" width="10" height="0.22" fill="#8d8377"/><rect x="0" y="2.86" width="10" height="0.34" fill="#000" opacity="0.18"/>${at.intake === undefined ? '' : `<g${drive(at.intake, 'fade')}><path d="M0.6 3.02H9.4" stroke="#1d2226" stroke-width="0.1" stroke-dasharray="0.5 0.35"/></g>`}</g>
<g transform="${sideWall}"><rect x="2.6" y="1.05" width="1.6" height="1.3" fill="#222c35" stroke="#e0d9cd" stroke-width="0.1"/><circle cx="3.5" cy="4.1" r="0.36" fill="#222c35" stroke="#e0d9cd" stroke-width="0.08"/></g>
${poly([proj(v, W + OV, -OV, H - drop), proj(v, W + OV, D / 2, H + R), proj(v, W + OV, D + OV, H - drop), proj(v, W + OV, D + OV, H - drop - 0.16), proj(v, W + OV, D / 2, H + R - 0.16), proj(v, W + OV, -OV, H - drop - 0.16)], '#efe9df')}
${poly([proj(v, -OV, -OV, H - drop), proj(v, W + OV, -OV, H - drop), proj(v, W + OV, -OV, H - drop - 0.16), proj(v, -OV, -OV, H - drop - 0.16)], '#f5f0e7')}
<line x1="${eaveA[0]}" y1="${eaveA[1]}" x2="${eaveB[0]}" y2="${eaveB[1]}" stroke="#e9e4da" stroke-width="5" stroke-linecap="round"/>
<line x1="${spoutTop[0]}" y1="${spoutTop[1]}" x2="${spoutBot[0]}" y2="${spoutBot[1]}" stroke="#d8d2c6" stroke-width="4"/>
<g transform="${roof}">
<rect width="${U}" height="${V}" fill="url(#${id}-deck)"/>
${at.deck === undefined ? '' : `<rect x="84" y="8" width="24" height="16" fill="#e8c88f" stroke="#fff3d6" stroke-width="0.6"${drive(at.deck, 'fade')}/>`}
${layer(p, 'old', 'tear-off', 'off-up', `<rect width="${U}" height="${V}" fill="url(#${id}-old)"/><ellipse cx="14" cy="18" rx="8" ry="4" fill="#3d4a34" opacity="0.5"/><ellipse cx="92" cy="40" rx="11" ry="5" fill="#2e2b28" opacity="0.5"/><rect x="48" y="38" width="9" height="3.6" fill="#b08a55"/>`, { edgeFill: '#e8c88f' })}
${layer(p, 'ice', 'ice-water', 'x', `<rect width="${U}" height="14" fill="#22262b"/><path d="M0 13.6H${U}" stroke="#565d66" stroke-width="0.4"/>`, { v1: 14, span: 0.4 })}
${layer(p, 'ice2', 'ice-water', 'up', sealAround, { from: 0.36, span: 0.4 })}
${layer(p, 'under', 'underlayment', 'up', `<rect width="${U}" height="${V}" fill="url(#${id}-under)"/>`)}
${layer(p, 'starter', 'starter', 'x', `<rect width="${U}" height="4.4" fill="#34383c"/><path d="M0 4.1H${U}" stroke="#8d949a" stroke-width="0.5"/>`, { v1: 4.4, span: 0.36 })}
${layer(p, 'starter-rake', 'starter', 'up', `<rect width="4.2" height="${V}" fill="#34383c"/><rect x="${U - 4.2}" width="4.2" height="${V}" fill="#34383c"/><path d="M3.9 0V${V}M${U - 3.9} 0V${V}" stroke="#8d949a" stroke-width="0.5"/>`, { from: 0.34, span: 0.42 })}
${layer(p, 'field', 'field', field, `<rect width="${U}" height="${V}" fill="url(#${id}-surf)"/>`)}
${at.fasteners === undefined ? '' : `<rect width="${U}" height="${V}" fill="url(#${id}-nail)"${drive(at.fasteners, 'pulse')} opacity="0"/>`}
${at['drip-edge'] === undefined ? '' : `<path d="M0 0.5H${U}M0.5 0V${V}M${U - 0.5} 0V${V}" stroke="#e7ebee" stroke-width="1.1" fill="none"${drive(at['drip-edge'], 'fade')}/>`}
${at.trim === undefined ? '' : `<path d="M0.8 0V${V}M${U - 0.8} 0V${V}M0 0.8H${U}" stroke="#8a796a" stroke-width="1.7" fill="none"${drive(at.trim, 'fade')}/>`}
${at.exhaust === undefined ? '' : `<path d="M6 ${V - 2.2}H${U - 6}" stroke="#15181b" stroke-width="1.5" stroke-dasharray="1.4 0.9"${drive(at.exhaust, 'fade')}/>`}
${at.flashing === undefined ? '' : `<rect x="${r1(uOf(k.x0) - 1.6)}" y="${r1(vOf(k.y0) - 1.6)}" width="${r1(uOf(k.x1) - uOf(k.x0) + 3.2)}" height="${r1(vOf(k.y1) - vOf(k.y0) + 3.2)}" fill="none" stroke="#d5dce0" stroke-width="1.5"${drive(at.flashing, 'fade')}/>`}
<path d="${valleyD}" fill="none" stroke="#101214" stroke-opacity="0.5" stroke-width="0.7" stroke-linejoin="round"/>
<rect width="${U}" height="${V}" fill="url(#${id}-shade)" pointer-events="none"/>
</g>
${dormer}
${cricketHtml}
${skylight}
${chimney}
${flashing}
<rect x="${pipe[0] - 5}" y="${pipe[1] - 26}" width="10" height="27" rx="2" fill="#c8ccd0"/>
${at['hip-ridge'] === undefined ? '' : `<line x1="${ridgeA[0]}" y1="${ridgeA[1]}" x2="${ridgeB[0]}" y2="${ridgeB[1]}" stroke="${scene.surface === 'standing-seam' ? '#6a5c50' : scene.surface === 'shingle' ? '#54595e' : fieldFill}" stroke-width="9" stroke-linecap="round" pathLength="1" stroke-dasharray="1" stroke-dashoffset="0"${drive(at['hip-ridge'], 'draw')}/>`}
${at.cricket === undefined ? '' : `<g${drive(at.cricket, 'spot')} opacity="0">${crickets.map((q) => `<circle cx="${q.left[1][0]}" cy="${q.left[1][1]}" r="30" fill="none" stroke="#ffd98a" stroke-width="2.5" stroke-dasharray="5 5"/>`).join('')}</g>`}
</svg>`;
}

function flatSvg(scene: BuildScene, id: string): string {
  const v: View = { ox: 410, oy: 450, s: 46 };
  const W = 13; const D = 8; const H = 3.4; const PH = 0.45; const T = 0.3;
  const U = (W - 2 * T) * 10; const V = (D - 2 * T) * 10;
  const at: Painter['at'] = {};
  scene.steps.forEach((s, i) => { at[s.visual] = i; });
  const p: Painter = { id, at, U, V };
  const roof = plane(proj(v, T, T, H), [(EX[0] * v.s) / 10, (EX[1] * v.s) / 10], [(EY[0] * v.s) / 10, (EY[1] * v.s) / 10]);
  const frontWall = plane(proj(v, 0, 0, 0), [EX[0] * v.s, EX[1] * v.s], [0, -v.s]);
  const sideWall = plane(proj(v, W, 0, 0), [EY[0] * v.s, EY[1] * v.s], [0, -v.s]);
  const ground = plane(proj(v, 0, 0, 0), [EX[0] * v.s, EX[1] * v.s], [EY[0] * v.s, EY[1] * v.s]);
  const top = H + PH;
  const brick = { front: '#a9553c', side: '#86412d' };
  const cap = '#c9c3b8';
  const metal = '#4a3424';
  const strips: Pt[][] = [
    [proj(v, 0, D - T, top), proj(v, W, D - T, top), proj(v, W, D, top), proj(v, 0, D, top)],
    [proj(v, 0, 0, top), proj(v, T, 0, top), proj(v, T, D, top), proj(v, 0, D, top)],
    [proj(v, 0, 0, top), proj(v, W, 0, top), proj(v, W, T, top), proj(v, 0, T, top)],
    [proj(v, W - T, 0, top), proj(v, W, 0, top), proj(v, W, D, top), proj(v, W - T, D, top)],
  ];
  const windows = (n: number, w: number): string => Array.from({ length: n }, (_, i) => `<rect x="${r1(0.8 + i * ((w - 1.6 - 0.9) / (n - 1)))}" y="1.2" width="0.9" height="1.25" fill="${i % 3 === 1 ? `url(#${id}-glow)` : '#161c22'}"/>`).join('');
  const rtu = { x0: 7.6, x1: 9.6, y0: 4.2, y1: 5.5 };
  const hatch = { x0: 1.2, x1: 2.1, y0: 5.4, y1: 6.2 };
  const ru = (x: number): number => (x - T) * 10; const rv = (y: number): number => (y - T) * 10;
  const pond = `<ellipse cx="38" cy="30" rx="16" ry="8" fill="#2b3a44" opacity="0.6"/>`;
  const oldRoof = `<rect width="${U}" height="${V}" fill="url(#${id}-gravel)"/>${pond}`;
  const old = scene.path === 'tear_off' ? layer(p, 'old', 'tear-off', 'off-x', oldRoof, { edgeFill: '#c4c3bd', edge: 1.6 }) : oldRoof;
  const prep = scene.path === 'coating'
    ? (at.prep === undefined ? '' : `<g${drive(at.prep, 'fade')}><rect width="${U}" height="${V}" fill="#7f8388" opacity="0.55"/><path d="M20 0V${V}M40 0V${V}M60 0V${V}M80 0V${V}M100 0V${V}" stroke="#e9edf0" stroke-width="1.3"/></g>`)
    : layer(p, 'prep', 'prep', 'x', `<rect width="${U}" height="${V}" fill="#b4afa3"/><path d="M30 0V${V}M60 0V${V}M90 0V${V}" stroke="#98938a" stroke-width="0.5"/>`);
  const seamLines = [20, 40, 60, 80, 100].filter((x) => x < U);

  // The crane, the dumpster and the stacked materials: there from set-up until clean-up.
  const until = ` data-rbo-until="${at['clean-up'] ?? scene.steps.length}"`;
  const mast = proj(v, 15.4, 1.2, 0); const mastTop = proj(v, 15.4, 1.2, 7.4); const boomTip = proj(v, 10.4, 3.0, 6.9); const load = proj(v, 10.4, 3.0, 4.6);
  const site = at.setup === undefined ? '' : `<g class="rbo-l" opacity="0"${drive(at.setup, 'fade', until)}>
${box(v, -3.4, -1.2, -2.6, -1.3, 0, 1.0, { front: '#2e6b4a', side: '#235238', top: '#3b3f42' })}
${box(v, 14.6, 16.2, 0.6, 1.8, 0, 0.9, { front: '#e0b93b', side: '#b8952a', top: '#f0cf5a' })}
<line x1="${mast[0]}" y1="${mast[1] - 30}" x2="${mastTop[0]}" y2="${mastTop[1]}" stroke="#e0b93b" stroke-width="7" stroke-linecap="round"/>
<line x1="${mastTop[0]}" y1="${mastTop[1]}" x2="${boomTip[0]}" y2="${boomTip[1]}" stroke="#f0cf5a" stroke-width="5" stroke-linecap="round"/>
<line x1="${boomTip[0]}" y1="${boomTip[1]}" x2="${load[0]}" y2="${load[1]}" stroke="#cfd6da" stroke-width="1.4"/>
${box(v, 9.9, 10.9, 2.6, 3.4, 4.0, 4.6, { front: '#d3bb72', side: '#ad954f', top: '#e3cf8c' })}
</g>`;
  const pallets = at.setup === undefined ? '' : `<g class="rbo-l" opacity="0"${drive(at.setup, 'fade', ` data-rbo-until="${at.membrane ?? at.coating ?? scene.steps.length}"`, 0.3)}>${box(v, 10.6, 11.7, 1.0, 1.9, H + 0.02, H + 0.6, { front: '#d3bb72', side: '#ad954f', top: '#e3cf8c' })}${box(v, 10.9, 11.6, 2.3, 2.9, H + 0.02, H + 0.42, { front: '#dfe3e6', side: '#b9c0c5', top: '#eef1f3' })}</g>`;

  return `<svg class="rbo__art" viewBox="0 0 1200 720" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Drawing of a flat-roof building with its roof being replaced, one layer at a time">
${sharedDefs(id, scene.surface)}
${backdrop(id)}
<g transform="${ground}"><rect x="-1.6" y="-3.4" width="19" height="2.9" rx="0.2" fill="#32373c" opacity="0.6"/><path d="M-1 -1.95H17" stroke="#c9c3b8" stroke-width="0.06" stroke-dasharray="0.7 0.6" opacity="0.5"/></g>
<g transform="${roof}">
<rect width="${U}" height="${V}" fill="url(#${id}-flute)"/>
${at.deck === undefined ? '' : `<rect x="52" y="34" width="20" height="14" fill="#c4c3bd" stroke="#ffffff" stroke-width="0.6"${drive(at.deck, 'fade')}/>`}
${old}
${at.survey === undefined ? '' : `<g${drive(at.survey, 'fade')}><circle cx="30" cy="20" r="2.4" fill="#f0c24a" stroke="#15181b" stroke-width="0.6"/><circle cx="70" cy="48" r="2.4" fill="#f0c24a" stroke="#15181b" stroke-width="0.6"/><circle cx="100" cy="24" r="2.4" fill="#f0c24a" stroke="#15181b" stroke-width="0.6"/></g>`}
${prep}
${layer(p, 'vapor', 'vapor', 'x', `<rect width="${U}" height="${V}" fill="#2a2d2f"/><path d="M0 18H${U}M0 36H${U}M0 54H${U}" stroke="#3d4144" stroke-width="0.5"/>`)}
${layer(p, 'iso', 'insulation', 'x', `<rect width="${U}" height="${V}" fill="url(#${id}-iso)"/>`, { span: 0.36, edge: 1.8, edgeFill: '#fff0b8' })}
${layer(p, 'iso2', 'insulation', 'x', `<rect width="${U}" height="${V}" fill="url(#${id}-iso2)"/>`, { from: 0.4, span: 0.4, edge: 1.8, edgeFill: '#fff0b8' })}
${at.taper === undefined ? '' : `<g${drive(at.taper, 'fade')}><polygon points="38,16 62,30 38,44 14,30" fill="#ecdca0" stroke="#bfa85f" stroke-width="0.6"/><path d="M38 16V44M14 30H62M26 23L50 37M50 23L26 37" stroke="#bfa85f" stroke-width="0.4"/><path d="M16 46Q15 52 14.5 57" fill="none" stroke="#5aa9d6" stroke-width="1.2" stroke-linecap="round" stroke-dasharray="2 1.6"/><path d="M12.6 54.5L14.4 58L16.6 54.9" fill="none" stroke="#5aa9d6" stroke-width="1.2" stroke-linecap="round"/></g>`}
${layer(p, 'board', 'cover-board', 'x', `<rect width="${U}" height="${V}" fill="url(#${id}-board)"/>`, { edge: 1.4 })}
${at.attachment === undefined ? '' : `<rect width="${U}" height="${V}" fill="url(#${id}-plate)"${drive(at.attachment, 'pulse')} opacity="0"/>`}
${layer(p, 'membrane', 'membrane', 'x', `<rect width="${U}" height="${V}" fill="url(#${id}-surf)"/>`, { edge: 3, edgeFill: scene.surface === 'membrane-black' ? '#4a4e52' : '#ffffff' })}
${layer(p, 'coat', 'coating', 'x', `<rect width="${U}" height="${V}" fill="url(#${id}-surf)"/>`, { edge: 2.4, edgeFill: '#ffffff' })}
${at.seams === undefined ? '' : seamLines.map((x, i) => `<line x1="${x}" y1="0" x2="${x}" y2="${V}" stroke="#ffb347" stroke-width="1.5" pathLength="1" stroke-dasharray="1" stroke-dashoffset="0"${drive(at.seams, 'draw', '', i * 0.12, 0.3)}/>`).join('')}
${at.walkway === undefined ? '' : `<path d="M${ru(hatch.x1) + 2} ${rv(hatch.y0) + 4}H${ru(rtu.x0) - 8}V${rv(rtu.y0) + 6}" fill="none" stroke="#e0b93b" stroke-width="5" stroke-dasharray="9 1.4"${drive(at.walkway, 'fade')}/>`}
<ellipse cx="14" cy="${V - 10}" rx="3" ry="3" fill="#15181b"/><ellipse cx="${U - 14}" cy="${V - 10}" rx="3" ry="3" fill="#15181b"/>
${at.accessories === undefined ? '' : `<g${drive(at.accessories, 'fade')}><rect x="1.2" y="1.2" width="${U - 2.4}" height="${V - 2.4}" fill="none" stroke="#f4f6f7" stroke-width="2"/><rect x="${ru(rtu.x0) - 3}" y="${rv(rtu.y0) - 3}" width="${(rtu.x1 - rtu.x0) * 10 + 6}" height="${(rtu.y1 - rtu.y0) * 10 + 6}" fill="none" stroke="#f4f6f7" stroke-width="2.2"/><rect x="${ru(hatch.x0) - 2.5}" y="${rv(hatch.y0) - 2.5}" width="${(hatch.x1 - hatch.x0) * 10 + 5}" height="${(hatch.y1 - hatch.y0) * 10 + 5}" fill="none" stroke="#f4f6f7" stroke-width="2"/><circle cx="14" cy="${V - 10}" r="5" fill="none" stroke="#f4f6f7" stroke-width="1.6"/><circle cx="${U - 14}" cy="${V - 10}" r="5" fill="none" stroke="#f4f6f7" stroke-width="1.6"/><circle cx="34" cy="50" r="3.4" fill="none" stroke="#f4f6f7" stroke-width="1.6"/><circle cx="96" cy="14" r="3.4" fill="none" stroke="#f4f6f7" stroke-width="1.6"/></g>`}
<circle cx="34" cy="50" r="1.7" fill="#b9bec2"/><circle cx="96" cy="14" r="1.7" fill="#b9bec2"/>
${at.final === undefined ? '' : `<g${drive(at.final, 'spot')} opacity="0">${[[14, V - 10], [U - 14, V - 10], [ru(rtu.x0) + 10, rv(rtu.y0) - 6], [60, 12], [60, V - 12]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="7" fill="none" stroke="#7fe0a0" stroke-width="1.6"/><path d="M${x - 3} ${y}l2.2 2.6l4-5" fill="none" stroke="#7fe0a0" stroke-width="1.6" stroke-linecap="round"/>`).join('')}</g>`}
<rect width="${U}" height="${V}" fill="url(#${id}-shade)" pointer-events="none"/>
</g>
${poly([proj(v, T, D - T, H), proj(v, W - T, D - T, H), proj(v, W - T, D - T, top), proj(v, T, D - T, top)], '#8f4a35')}
${poly([proj(v, T, T, H), proj(v, T, D - T, H), proj(v, T, D - T, top), proj(v, T, T, top)], '#733a29')}
${box(v, hatch.x0, hatch.x1, hatch.y0, hatch.y1, H + 0.02, H + 0.5, { front: '#aab1b6', side: '#868e93', top: '#c9cfd3' })}
${box(v, rtu.x0, rtu.x1, rtu.y0, rtu.y1, H + 0.15, H + 1.15, { front: '#c4c9cd', side: '#9aa1a6', top: '#dde1e4' })}
${pallets}
${poly([proj(v, W, 0, 0), proj(v, W, D, 0), proj(v, W, D, top), proj(v, W, 0, top)], brick.side)}
${poly([proj(v, 0, 0, 0), proj(v, W, 0, 0), proj(v, W, 0, top), proj(v, 0, 0, top)], brick.front)}
<g transform="${frontWall}">${windows(8, W)}<rect x="0" y="0" width="${W}" height="0.25" fill="#6b3525"/><rect x="5.9" y="0" width="1.2" height="2.1" fill="#2a2f35"/></g>
<g transform="${sideWall}">${windows(5, D)}</g>
${strips.map((s) => poly(s, cap)).join('')}
${at['edge-metal'] === undefined ? '' : `<g${drive(at['edge-metal'], 'fade')}>${strips.map((s) => poly(s, metal)).join('')}</g>`}
${site}
</svg>`;
}

/* ----------------------------------------------------------------- markup --- */

const SWATCH: Partial<Record<BuildVisual, string>> = {
  protect: '#2f6fb3', 'tear-off': '#5f5a52', deck: '#c9a26a', cricket: '#e3c389', survey: '#f0c24a',
  setup: '#e0b93b', taper: '#ecdca0', seams: '#ffb347', final: '#7fe0a0', 'drip-edge': '#e7ebee', 'ice-water': '#22262b',
  underlayment: '#8fa2b0', starter: '#2b2e31', fasteners: '#d9dde0', flashing: '#cfd6da', trim: '#8a796a', 'hip-ridge': '#54595e',
  exhaust: '#15181b', intake: '#1d2226', prep: '#b4afa3', vapor: '#2a2d2f', insulation: '#dcc57d', 'cover-board': '#c9cdc9',
  attachment: '#f0c24a', accessories: '#f4f6f7', 'edge-metal': '#4a3424', walkway: '#e0b93b', 'clean-up': '#3b7d46',
};

const TIER_NAME = { good: 'Good', better: 'Better', best: 'Best' } as const;

function sceneHtml(scene: BuildScene, id: string, on: boolean, o: RoofBuildOpenerOpts, address: string | null): string {
  const b = companyBrand();
  const n = scene.steps.length;
  const flat = scene.kind === 'flat';
  const reader = o.customer ? `Prepared for ${esc(o.customer)}. ` : '';
  const title = o.mode === 'generic'
    ? (flat ? 'How a flat roof like this one is replaced.' : 'How a roof like yours is replaced.')
    : (address ? `A new roof for ${esc(address)}.` : 'Your new roof, layer by layer.');
  const watch = o.mode === 'generic' ? 'Scroll to watch the old roof come off and a new one go on, layer by layer.' : 'Scroll to watch the new roof go on, layer by layer.';
  const steps = scene.steps.map((s, i) => `
    <div class="rbo__cap" data-rbo-cap="${i}">
      <p class="rbo__eb">Step ${i + 1} of ${n} &middot; ${esc(s.label)}</p>
      <h2>${esc(s.title)}</h2>
      <p>${s.body}</p>
      ${s.product ? `<p class="rbo__prod">${s.product}</p>` : ''}
    </div>`).join('');
  const hud = scene.steps.map((s, i) => `<li data-rbo-hud="${i}" style="--sw:${s.visual === 'field' || s.visual === 'membrane' || s.visual === 'coating' ? SURFACE_FILL[scene.surface] : SWATCH[s.visual] ?? '#9aa1a6'}"><i></i>${esc(s.label)}</li>`).join('');
  return `<div class="rbo__scene${on ? ' is-on' : ''}" data-rbo-scene="${esc(scene.tier ?? 'only')}" data-rbo-n="${n}">
  ${flat ? flatSvg(scene, id) : houseSvg(scene, id)}
  <div class="rbo__dawn" aria-hidden="true"></div>
  <div class="rbo__vig" aria-hidden="true"></div>
  <div class="rbo__num" aria-hidden="true"></div>
  <div class="rbo__caps">
    <div class="rbo__cap rbo__cap--intro" data-rbo-cap="intro">
      ${b.logoUrl ? `<img class="rbo__logo" src="${esc(b.logoUrl)}" alt="${esc(b.displayName)}"/>` : `<p class="rbo__co">${esc(b.displayName)}</p>`}
      <p class="rbo__eb">${esc(o.docLabel)}</p>
      <h1>${title}</h1>
      <p>${reader}${watch}</p>
      ${scene.productName ? `<p class="rbo__prod">${esc(scene.productName)}</p>` : ''}
    </div>${steps}
    <div class="rbo__cap rbo__cap--outro" data-rbo-cap="outro">
      <p class="rbo__eb">The finished roof</p>
      <h2>${scene.productName ? esc(scene.productName) : (flat ? 'A new roof, start to finish.' : 'A new roof, start to finish.')}</h2>
      <p>Keep scrolling for the rest of your ${esc(o.docLabel.toLowerCase())}.</p>
    </div>
  </div>
  <aside class="rbo__hud" aria-hidden="true"><h4>Roof build <b class="rbo__count"></b></h4><div class="rbo__meter"><i></i></div><ul>${hud}</ul></aside>
</div>`;
}

/**
 * The whole opener, ready to drop in as the first thing on the page, or ''
 * when the document has no new roof on it (a repair-only estimate, a tune-up).
 */
export function roofBuildOpener(report: any, o: RoofBuildOpenerOpts): string {
  const scenes = buildScenes(report, o.mode);
  if (!scenes.length) return '';
  const uid = 'rbo';
  const address = (report?.property?.address as string | undefined)?.trim() || null;
  const selected = scenes.find((s) => s.tier && s.tier === report?.selectedTier) ?? scenes[Math.min(1, scenes.length - 1)];
  const active = scenes.length > 1 ? selected : scenes[0];
  const chips = scenes.length > 1
    ? `<div class="rbo__chips" role="group" aria-label="Choose which roof to watch">${scenes.map((s) => `<button type="button" class="rbo__chip${s === active ? ' is-on' : ''}" data-rbo-pick="${esc(s.tier ?? '')}" aria-pressed="${s === active}"><b>${TIER_NAME[s.tier!]}</b><span>${esc(s.productName ?? '')}</span></button>`).join('')}</div>`
    : '';
  return `<style>${ROOF_BUILD_CSS}</style>
<div class="rbo rbo--static" data-rbo style="--rbo-n:${active.steps.length}" aria-label="The new roof, built layer by layer">
  <div class="rbo__pin">
    ${scenes.map((s, i) => sceneHtml(s, `${uid}s${i}`, s === active, o, address)).join('\n')}
    ${chips}
    <div class="rbo__hint" aria-hidden="true"><b></b>Scroll</div>
    <p class="rbo__note">Illustration only, not to scale. Your roof is installed to the manufacturer&rsquo;s current instructions.</p>
    <div class="rbo__bar" aria-hidden="true"><i></i></div>
  </div>
</div>
<script>${ROOF_BUILD_JS}</script>`;
}

/* -------------------------------------------------------------------- css --- */

export const ROOF_BUILD_CSS = `
.rbo { position: relative; height: calc((var(--rbo-n, 8) + 2) * 62vh + 100vh); background: #0b1015; color: #fff; font-family: inherit; z-index: 3; }
.rbo *, .rbo *::before { box-sizing: border-box; }
.rbo__pin { position: sticky; top: 0; height: 100vh; height: 100svh; overflow: hidden; background: linear-gradient(180deg, #1b2530 0%, #121a22 62%, #0b1015 100%); }
.rbo__scene { position: absolute; inset: 0; display: none; }
.rbo__scene.is-on { display: block; }
.rbo__art { position: absolute; inset: 0; width: 100%; height: 100%; max-width: none; display: block; }
.rbo__dawn { position: absolute; inset: 0; pointer-events: none; opacity: 0; background: linear-gradient(180deg, rgba(72,104,140,.55) 0%, rgba(214,150,96,.34) 58%, rgba(255,196,128,.2) 78%, rgba(11,16,21,0) 100%); mix-blend-mode: screen; }
.rbo__num { position: absolute; left: clamp(12px, 4.5vw, 72px); top: 50%; transform: translateY(-58%); font-family: var(--sc-font-display, 'Fraunces', Georgia, serif); font-weight: 700; font-size: clamp(180px, 30vw, 420px); line-height: 1; letter-spacing: -.04em; color: #fff; opacity: 0; pointer-events: none; user-select: none; transition: opacity .35s; }
.rbo-stars { transition: opacity .4s; }
.rbo__vig { position: absolute; inset: 0; pointer-events: none; background: linear-gradient(90deg, rgba(8,12,16,.86) 0%, rgba(8,12,16,.55) 30%, rgba(8,12,16,0) 56%), linear-gradient(0deg, rgba(8,12,16,.6) 0%, rgba(8,12,16,0) 26%); }
.rbo__caps { position: absolute; left: clamp(20px, 6vw, 96px); top: 50%; width: min(520px, 42vw); transform: translateY(-50%); }
.rbo__cap { position: absolute; left: 0; right: 0; top: 0; transform: translateY(-50%); opacity: 0; pointer-events: none; will-change: opacity, transform; }
.rbo__cap--intro { opacity: 1; }
.rbo__logo { display: block; height: 62px; width: auto; max-width: 240px; margin: 0 0 22px; padding: 8px 12px; border-radius: 10px; background: #fff; }
.rbo__co { margin: 0 0 18px; font-size: 15px; font-weight: 700; letter-spacing: .04em; color: #fff; }
.rbo__eb { margin: 0 0 14px; font-size: 12px; font-weight: 700; letter-spacing: .2em; text-transform: uppercase; color: var(--rbo-accent, #f0b24a); }
.rbo__cap h1, .rbo__cap h2 { margin: 0; color: #fff; font-family: var(--sc-font-display, 'Fraunces', Georgia, serif); font-weight: 600; letter-spacing: -.01em; line-height: 1.06; text-wrap: balance; }
.rbo__cap h1 { font-size: clamp(34px, 4.6vw, 62px); }
.rbo__cap h2 { font-size: clamp(28px, 3.5vw, 46px); }
.rbo__cap p { margin: 16px 0 0; font-size: clamp(16px, 1.25vw, 19px); line-height: 1.55; color: rgba(255,255,255,.84); max-width: 46ch; }
.rbo__cap p.rbo__eb { margin: 0 0 14px; font-size: 12px; color: var(--rbo-accent, #f0b24a); }
.rbo__cap p.rbo__prod { display: inline-block; margin-top: 18px; padding: 7px 12px; border: 1px solid rgba(255,255,255,.28); border-radius: 999px; font-size: 13px; font-weight: 600; line-height: 1.3; color: #fff; background: rgba(255,255,255,.07); }
.rbo__hud { position: absolute; right: clamp(16px, 3vw, 44px); bottom: clamp(56px, 9vh, 96px); width: 232px; padding: 16px 18px; border-radius: 14px; background: rgba(12,18,22,.78); border: 1px solid rgba(255,255,255,.12); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); opacity: 0; transition: opacity .3s; }
.rbo__hud h4 { display: flex; justify-content: space-between; align-items: baseline; margin: 0 0 8px; font-size: 11px; letter-spacing: .2em; text-transform: uppercase; color: rgba(255,255,255,.62); font-weight: 700; font-family: inherit; }
.rbo__count { font-size: 11px; letter-spacing: .08em; color: var(--rbo-accent, #f0b24a); font-weight: 700; }
.rbo__meter { height: 3px; border-radius: 3px; background: rgba(255,255,255,.14); margin: 0 0 12px; overflow: hidden; }
.rbo__meter i { display: block; height: 100%; width: 0; border-radius: 3px; background: var(--rbo-accent, #f0b24a); }
.rbo__hud ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
@media (max-height: 760px) { .rbo__hud ul { gap: 4px; } .rbo__hud li { font-size: 12px; } .rbo__hud li i { width: 12px; height: 12px; } }
.rbo__hud li { display: flex; align-items: center; gap: 10px; font-size: 13px; line-height: 1.2; color: rgba(255,255,255,.5); transition: color .25s; }
.rbo__hud li i { flex: none; width: 15px; height: 15px; border-radius: 4px; border: 1.5px solid rgba(255,255,255,.34); transition: background .25s, border-color .25s, box-shadow .25s; }
.rbo__hud li.is-on { color: rgba(255,255,255,.9); }
.rbo__hud li.is-on i { background: var(--sw); border-color: rgba(255,255,255,.7); }
.rbo__hud li.is-now { color: #fff; font-weight: 700; }
.rbo__hud li.is-now i { box-shadow: 0 0 0 4px rgba(240,178,74,.3); animation: rboNow 1.4s ease-in-out infinite; }
@keyframes rboNow { 0%, 100% { box-shadow: 0 0 0 3px rgba(240,178,74,.34); } 50% { box-shadow: 0 0 0 7px rgba(240,178,74,.08); } }
.rbo__chips { position: absolute; left: 50%; top: clamp(14px, 3vh, 28px); transform: translateX(-50%); display: flex; gap: 8px; max-width: calc(100% - 24px); z-index: 2; }
.rbo__chip { appearance: none; display: flex; flex-direction: column; gap: 1px; min-width: 0; padding: 8px 14px; border-radius: 12px; border: 1px solid rgba(255,255,255,.22); background: rgba(12,18,22,.72); color: rgba(255,255,255,.78); font: inherit; font-size: 12px; line-height: 1.25; text-align: left; cursor: pointer; }
.rbo__chip b { font-size: 11px; letter-spacing: .14em; text-transform: uppercase; }
.rbo__chip span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 22ch; }
.rbo__chip.is-on { background: #fff; color: #10161b; border-color: #fff; }
.rbo__chip:focus-visible { outline: 2px solid var(--rbo-accent, #f0b24a); outline-offset: 2px; }
.rbo__hint { position: absolute; left: 50%; bottom: 44px; transform: translateX(-50%); display: flex; flex-direction: column; align-items: center; gap: 8px; font-size: 11px; letter-spacing: .22em; text-transform: uppercase; color: rgba(255,255,255,.7); transition: opacity .3s; }
.rbo__hint b { width: 1px; height: 30px; background: linear-gradient(#fff, rgba(255,255,255,0)); animation: rboHint 1.6s ease-in-out infinite; }
@keyframes rboHint { 0%, 100% { transform: translateY(0); opacity: .9; } 50% { transform: translateY(8px); opacity: .3; } }
.rbo__note { position: absolute; left: clamp(20px, 6vw, 96px); bottom: 14px; margin: 0; font-size: 11px; line-height: 1.3; color: rgba(255,255,255,.5); max-width: 60ch; }
.rbo__bar { position: absolute; left: 0; right: 0; bottom: 0; height: 3px; background: rgba(255,255,255,.1); }
.rbo__bar i { display: block; height: 100%; width: 0; background: var(--rbo-accent, #f0b24a); }
@media (max-width: 860px) {
  .rbo__vig { background: linear-gradient(0deg, rgba(8,12,16,.94) 0%, rgba(8,12,16,.8) 34%, rgba(8,12,16,0) 60%); }
  .rbo__art { height: 56%; width: 170%; left: -55%; right: auto; top: 56px; bottom: auto; }
  .rbo__caps { left: 20px; right: 20px; width: auto; top: auto; bottom: 64px; height: 34vh; transform: none; }
  .rbo__cap { top: auto; bottom: 0; transform: none; }
  .rbo__cap p { font-size: 15px; margin-top: 10px; }
  .rbo__logo { height: 38px; margin-bottom: 12px; }
  .rbo__cap p.rbo__prod { margin-top: 10px; font-size: 12px; }
  .rbo__hud, .rbo__hint, .rbo__num { display: none; }
  .rbo__note { left: 20px; right: 20px; bottom: 10px; font-size: 10px; }
  .rbo__chip span { max-width: 12ch; }
}
/* No motion, or no script: no pinned scroll. One screen, the finished roof, the steps as a list. */
.rbo--static { height: auto; }
.rbo--static .rbo__pin { position: relative; height: auto; min-height: 0; padding: 0 0 20px; }
.rbo--static .rbo__scene { position: relative; inset: auto; }
.rbo--static .rbo__art { position: relative; height: auto; width: 100%; left: auto; top: auto; aspect-ratio: 5 / 3; max-height: 70vh; }
.rbo--static .rbo__vig, .rbo--static .rbo__dawn, .rbo--static .rbo__num, .rbo--static .rbo__meter, .rbo--static .rbo__hint, .rbo--static .rbo__bar, .rbo--static .rbo__cap:not(.rbo__cap--intro) { display: none; }
.rbo--static .rbo__caps, .rbo--static .rbo__cap { position: relative; inset: auto; top: auto; bottom: auto; left: auto; width: auto; height: auto; transform: none; opacity: 1; }
.rbo--static .rbo__caps { padding: 24px clamp(20px, 6vw, 96px) 0; }
.rbo--static .rbo__hud { position: relative; inset: auto; right: auto; bottom: auto; display: block; opacity: 1; width: auto; margin: 20px clamp(20px, 6vw, 96px) 0; }
.rbo--static .rbo__hud ul { grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); }
.rbo--static .rbo__note { position: relative; inset: auto; left: auto; bottom: auto; margin: 16px clamp(20px, 6vw, 96px) 0; }
.rbo--static .rbo__chips { position: relative; left: auto; top: auto; transform: none; margin: 16px clamp(20px, 6vw, 96px) 0; flex-wrap: wrap; }
@media (prefers-reduced-motion: reduce) { .rbo__hud li.is-now i, .rbo__hint b { animation: none; } }
@media print { .rbo { display: none !important; } }
`;

/* --------------------------------------------------------------------- js --- */

export const ROOF_BUILD_JS = `(function () {
  var roots = document.querySelectorAll('[data-rbo]:not([data-rbo-ready])');
  if (!roots.length) return;
  var still = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function clamp(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
  function each(list, fn) { for (var i = 0; i < list.length; i++) fn(list[i], i); }
  function mount(root) {
    root.setAttribute('data-rbo-ready', '');
    var hint = root.querySelector('.rbo__hint'), bar = root.querySelector('.rbo__bar i');
    var scenes = root.querySelectorAll('.rbo__scene'), chips = root.querySelectorAll('.rbo__chip');
    var active = root.querySelector('.rbo__scene.is-on') || scenes[0];
    function paint(scene, p) {
      var n = +scene.getAttribute('data-rbo-n'), A = 0.07, B = 0.92, w = (B - A) / n;
      var at = (p - A) / w;                       // which step we are in, as a number
      each(scene.querySelectorAll('[data-rbo-step]'), function (el) {
        var k = +el.getAttribute('data-rbo-step'), m = el.getAttribute('data-rbo-m');
        var from = +(el.getAttribute('data-rbo-f') || 0), span = +(el.getAttribute('data-rbo-s') || 0.72);
        var t = clamp((at - k - from) / span);
        // 1 while this step is the one on screen, easing in and out at its ends.
        var during = Math.min(clamp((at - k) / 0.14), 1 - clamp((at - k - 0.84) / 0.14));
        if (m === 'fade') {
          var until = el.getAttribute('data-rbo-until');
          el.style.opacity = until === null ? t : Math.min(t, 1 - clamp((at - (+until)) / 0.6));
        } else if (m === 'pulse') {
          el.style.opacity = Math.min(t, 1 - clamp((at - k - 1) / 0.6) * 0.75);
        } else if (m === 'draw') {
          el.style.strokeDashoffset = 1 - t;
        } else if (m === 'ghost') {
          el.style.opacity = 1 - 0.72 * during;
        } else if (m === 'spot') {
          el.style.opacity = during;
        } else {
          var U = +el.getAttribute('data-u'), v0 = +el.getAttribute('data-v0'), h = +el.getAttribute('data-h');
          if (m === 'up') { el.setAttribute('width', U); el.setAttribute('height', h * t); }
          else if (m === 'x') { el.setAttribute('height', h); el.setAttribute('width', U * t); }
          else if (m === 'off-up') { el.setAttribute('width', U); el.setAttribute('y', v0); el.setAttribute('height', h * (1 - t)); }
          else if (m === 'off-x') { el.setAttribute('height', h); el.setAttribute('x', U * t); el.setAttribute('width', U * (1 - t)); }
          // The working edge: a bright line that travels with the layer and goes out when it lands.
          var edge = el._edge || (el._edge = scene.querySelector('[data-rbo-edge="' + el.parentNode.id + '"]'));
          if (edge) {
            var e = +(el.getAttribute('data-e') || 1.1), live = t > 0.004 && t < 0.996;
            edge.setAttribute('opacity', live ? 0.95 : 0);
            if (live) {
              if (m === 'up' || m === 'off-up') { var yy = v0 + h * (m === 'up' ? t : 1 - t); edge.setAttribute('x', 0); edge.setAttribute('width', U); edge.setAttribute('y', yy - e / 2); edge.setAttribute('height', e); }
              else { edge.setAttribute('y', v0); edge.setAttribute('height', h); edge.setAttribute('x', U * t - e / 2); edge.setAttribute('width', e); }
            }
          }
        }
      });
      each(scene.querySelectorAll('[data-rbo-cap]'), function (c) {
        var id = c.getAttribute('data-rbo-cap'), a, b, o;
        if (id === 'intro') { a = -1; b = A; } else if (id === 'outro') { a = B; b = 2; } else { a = A + (+id) * w; b = a + w; }
        var f = Math.min(w * 0.22, 0.02);
        o = id === 'intro' ? 1 - clamp((p - (b - f)) / f) : Math.min(clamp((p - a) / f), id === 'outro' ? 1 : 1 - clamp((p - (b - f)) / f));
        c.style.opacity = o;
        c.style.transform = 'translateY(' + (wide() ? 'calc(-50% + ' : 'calc(0% + ') + ((1 - o) * 18 * (p < a + f ? 1 : -1)) + 'px))';
        c.style.pointerEvents = o > 0.5 ? 'auto' : 'none';
      });
      var now = -1;
      each(scene.querySelectorAll('[data-rbo-hud]'), function (li, k) { var on = at >= k; li.classList.toggle('is-on', on); if (on) now = k; });
      each(scene.querySelectorAll('[data-rbo-hud]'), function (li, k) { li.classList.toggle('is-now', k === now && p < B); });
      var hud = scene.querySelector('.rbo__hud'); if (hud) hud.style.opacity = p > A - 0.02 ? 1 : 0;
      var shown = Math.min(n, Math.max(0, now + 1));
      var count = scene.querySelector('.rbo__count'); if (count) count.textContent = shown ? shown + ' / ' + n : '';
      var meter = scene.querySelector('.rbo__meter i'); if (meter) meter.style.width = (clamp(at / n) * 100) + '%';
      var num = scene.querySelector('.rbo__num');
      if (num) { var inStep = p >= A && p < B; num.textContent = inStep ? (shown < 10 ? '0' : '') + shown : ''; num.style.opacity = inStep ? 0.05 : 0; }
      // Night at the start, first light by the time the roof is on.
      var dawn = scene.querySelector('.rbo__dawn'); if (dawn) dawn.style.opacity = clamp((p - 0.25) / 0.7) * 0.9;
      var stars = scene.querySelector('.rbo-stars'); if (stars) stars.style.opacity = 1 - clamp((p - 0.3) / 0.5);
    }
    function wide() { return window.innerWidth > 860; }
    function finished(scene) {
      each(scene.querySelectorAll('[data-rbo-hud]'), function (li) { li.classList.add('is-on'); });
    }
    function progress() {
      var r = root.getBoundingClientRect(), track = root.offsetHeight - window.innerHeight;
      return track > 0 ? clamp(-r.top / track) : 0;
    }
    var ticking = false;
    function frame() {
      ticking = false;
      var p = progress();
      paint(active, p);
      if (bar) bar.style.width = (p * 100) + '%';
      if (hint) hint.style.opacity = p > 0.02 ? 0 : 1;
    }
    function ask() { if (!ticking) { ticking = true; requestAnimationFrame(frame); } }
    each(chips, function (chip) {
      chip.addEventListener('click', function () {
        var want = chip.getAttribute('data-rbo-pick');
        each(scenes, function (s) { var on = s.getAttribute('data-rbo-scene') === want; s.classList.toggle('is-on', on); if (on) active = s; });
        each(chips, function (c) { var on = c === chip; c.classList.toggle('is-on', on); c.setAttribute('aria-pressed', on ? 'true' : 'false'); });
        root.style.setProperty('--rbo-n', active.getAttribute('data-rbo-n'));
        if (still) finished(active); else frame();
      });
    });
    if (still) { each(scenes, finished); return; }
    root.classList.remove('rbo--static');
    window.addEventListener('scroll', ask, { passive: true });
    window.addEventListener('resize', ask);
    frame();
  }
  each(roots, mount);
})();`;
