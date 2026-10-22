/**
 * The live layer diagram for a commercial roof: what is on the building
 * today, what comes off, what stays, and what goes on — drawn as the stack a
 * core cut shows, and tagged layer by layer.
 *
 * Two halves, kept apart on purpose:
 *   - the MODEL (buildAssemblyDiagram) is pure and tested: it reads the
 *     inspector's checklist and the tier being quoted, and decides each
 *     layer's fate the way the scope of that system does;
 *   - the RENDER (assemblyDiagramHtml) draws one diagram per tier. The page
 *     shows the one for the tier the reader has tapped, and scroll drives the
 *     story: the existing roof, the tags, then the new roof building up.
 *
 * Nothing here is guessed. A layer the inspector could not determine is drawn
 * hatched and says so; a custom product with no catalog system gets a single
 * honest "new roof system" layer rather than an invented stack.
 */
import { esc } from '../report-theme.js';
import { existingAssemblyLayers, reroofDetermination, type RoofLayer, type ReroofPath, type ReroofDetermination } from '../../../../shared/commercial-inspection-form.js';
import { roofSystemFor, type RoofSystemComponent } from '../roof-systems.js';
import type { TierPricing } from '../roofing-products.js';

export type LayerAction = 'removed' | 'stays' | 'repaired' | 'new';
export type SystemKind = 'tear_off' | 'layover' | 'coating';
export type TierKey = 'good' | 'better' | 'best';

export interface DiagramLayer {
  /** Stable across re-renders — the editor's overrides are keyed by it. */
  id: string;
  role: string;
  label: string;
  /** One short line shown on the layer itself. */
  detail: string | null;
  /** The plain-English explanation shown when the layer is tapped. */
  explain: string;
  action: LayerAction;
  /** The word on the tag; defaults from the action. */
  tag: string;
  unknown: boolean;
}

export interface AssemblyDiagram {
  tier: TierKey;
  /** The word on the diagram's switch: the tier on a priced document, where the option stands on an inspection. */
  chip?: string;
  productName: string;
  /** null when neither the product nor the inspection says what happens to the old roof. */
  system: SystemKind | null;
  /** The existing roof, top to bottom, each layer tagged with its fate. */
  today: DiagramLayer[];
  /** The finished roof, top to bottom: what is new, over what stays. */
  after: DiagramLayer[];
  /** One sentence: what this option does to the building. */
  headline: string;
}

/** What a rep may change on the diagram from the editor (draft.ts validates it). */
export interface AssemblyEdits {
  /** Layer id -> the wording shown for it. */
  layers?: Record<string, { label?: string; detail?: string }>;
  /** Per system, existing-layer id -> its fate, where the job differs from the standard scope. */
  actions?: Partial<Record<SystemKind, Record<string, Exclude<LayerAction, 'new'>>>>;
  /** A line under the diagram, e.g. what the core cut showed. */
  note?: string;
  /** A photo beside the diagram — usually the core cut. */
  photoUrl?: string;
  photoCaption?: string;
}

const TAG: Record<LayerAction, string> = { removed: 'Comes off', stays: 'Stays', repaired: 'Repaired', new: 'New' };

const ROLE_PLAIN: Record<string, string> = {
  surfacing: 'The very top. Gravel, grit or a coating that keeps the sun off the roof.',
  membrane: 'The waterproof sheet. This is the part that keeps the rain out. The other layers hold it up.',
  'older-roof': 'An old roof that was left on when the roof you have now was put on top of it.',
  cover: 'A thin, hard board. It protects the insulation and gives the roof a firm top to sit on.',
  insulation: 'Foam boards that keep heat in during winter and out in summer. When they get wet, they stop working and rust the deck under them.',
  vapor: 'A sheet on the deck. It keeps damp air from inside the building out of the insulation.',
  deck: 'The strong base the whole roof is fastened to.',
};

/** Component names in roof-systems.ts carry HTML entities; the diagram escapes its own text. */
export function decodeEntities(s: string): string {
  const map: Record<string, string> = {
    '&reg;': '®', '&trade;': '™', '&amp;': '&', '&ndash;': '–', '&mdash;': '—',
    '&frac12;': '½', '&times;': '×', '&Prime;': '″', '&prime;': '′', '&nbsp;': ' ',
    '&rsquo;': '’', '&lsquo;': '‘', '&quot;': '"', '&#39;': "'",
  };
  return String(s ?? '').replace(/&[a-zA-Z][a-zA-Z0-9]*;|&#\d+;/g, (m) => map[m] ?? '');
}

function kindOf(t: TierPricing, path: ReroofPath): SystemKind | null {
  const s = t.product?.system;
  if (s === 'tear_off' || s === 'layover' || s === 'coating') return s;
  const name = t.product?.name || '';
  if (/coat/i.test(name)) return 'coating';
  if (/layover|recover|overlay/i.test(name)) return 'layover';
  if (/tear[\s-]?off/i.test(name)) return 'tear_off';
  return path === 'replace' ? 'tear_off' : path === 'recover' ? 'layover' : path === 'restore' ? 'coating' : null;
}

const filled = (v: unknown) => v !== undefined && v !== null && String(v).trim() !== '';

/** What the standard scope of each system does to one existing layer, and why. */
function fateOf(layer: RoofLayer, kind: SystemKind | null, a: Record<string, any>): { action: Exclude<LayerAction, 'new'>; tag?: string; why: string } {
  const wet = filled(a['Estimated wet insulation (% of roof area)']) ? Number(a['Estimated wet insulation (% of roof area)']) : null;
  const deckCondition = filled(a['Deck condition']) ? String(a['Deck condition']) : null;

  if (kind === 'tear_off') {
    if (layer.role === 'deck') {
      return deckCondition === 'Poor' || deckCondition === 'Failed'
        ? { action: 'repaired', why: `The deck stays, but it was rated ${deckCondition} at the inspection. Once we can see it, we measure the bad parts, give you a price, and replace them before the new roof goes on.` }
        : { action: 'stays', why: 'The deck stays. With the old roof off, we check all of it. If any part is bad, we show you and give you a price before we go on.' };
    }
    return { action: 'removed', why: 'Torn off and hauled away. We take the roof down to the deck, so nothing wet or broken is left under the new roof.' };
  }

  if (kind === 'layover') {
    if (layer.role === 'surfacing') {
      return /gravel|ballast|paver/i.test(layer.label)
        ? { action: 'removed', why: 'We take the loose gravel or grit off, so the new roof sits on a clean, flat top.' }
        : { action: 'stays', why: 'Stays in place under the new system.' };
    }
    if (layer.role === 'insulation' && wet != null && wet > 0) {
      return { action: 'repaired', why: `Stays, except where it is wet. About ${wet}% of the insulation is wet. We cut out those spots and put in dry boards before anything goes on top.` };
    }
    if (layer.role === 'membrane') return { action: 'stays', why: 'The old roof stays. The new roof goes right on top of it. Nothing is torn off.' };
    if (layer.role === 'deck') return { action: 'stays', why: 'The deck stays covered. The new roof is fastened through the old roof into the deck.' };
    return { action: 'stays', why: 'Stays in place under the new system.' };
  }

  if (kind === 'coating') {
    if (layer.role === 'membrane') return { action: 'repaired', tag: 'Restored', why: 'This is the layer we restore. We clean it, make the seams and edges stronger, and then coat it.' };
    if (layer.role === 'insulation' && wet != null && wet > 0) {
      return { action: 'repaired', why: `Stays, except where it is wet. About ${wet}% of the insulation is wet. We cut out those spots and replace them before the coating goes on.` };
    }
    return { action: 'stays', why: 'Stays just as it is. A coating only goes on the top and does not touch the layers below.' };
  }

  return { action: 'stays', why: 'We will know if this layer stays or comes off after a core cut (a small sample of the roof).' };
}

const NEW_LAYER_ROLES = ['prep', 'vapor', 'insulation', 'cover-board', 'membrane'];

function newLayerFrom(c: RoofSystemComponent, kind: SystemKind, t: TierPricing): DiagramLayer {
  const name = decodeEntities(c.name);
  const label = c.role === 'insulation' && t.iso ? `${t.iso.label} — ${name}`
    : c.role === 'prep' ? 'Separation layer over the existing roof'
    : name;
  const optional = c.role === 'vapor';
  return {
    id: `n-${kind}-${c.role}`,
    role: c.role,
    label,
    detail: optional ? 'Where the building needs it' : `${c.maker === 'Best Roofing Now' ? 'Installed by' : 'Made by'} ${c.maker}`,
    explain: `${decodeEntities(c.plain)}${c.spec ? ` ${decodeEntities(c.spec)}` : ''}`,
    action: 'new',
    tag: optional ? 'If needed' : TAG.new,
    unknown: false,
  };
}

/** The new layers a system puts on the roof, top to bottom. */
function newLayersFor(t: TierPricing, kind: SystemKind): DiagramLayer[] {
  const system = roofSystemFor(t.product);
  const productName = t.product?.name || 'New roof system';
  if (kind === 'coating') {
    return [{
      id: 'n-coating-coating', role: 'coating', label: `Restoration coating — ${productName}`,
      detail: 'Applied over the cleaned, reinforced membrane',
      explain: 'We clean the roof and make every seam, pipe and edge stronger. Then we put the coating on as thick as the maker says, so the whole roof is sealed in one piece.',
      action: 'new', tag: TAG.new, unknown: false,
    }];
  }
  if (!system) {
    return [{
      id: `n-${kind}-membrane`, role: 'membrane', label: `New roof system — ${productName}`, detail: null,
      explain: 'The new roof in this option. We write down every layer with you, using the maker’s plan, before work starts.',
      action: 'new', tag: TAG.new, unknown: false,
    }];
  }
  // A layover keeps the existing insulation, so it adds only the separation
  // layer and the membrane (commercial-products.ts: no tear-off, no new ISO).
  const roles = kind === 'layover' ? ['prep', 'membrane'] : NEW_LAYER_ROLES.filter((r) => r !== 'prep');
  const bottomUp = system.components.filter((c) => roles.includes(c.role));
  return [...bottomUp].reverse().map((c) => newLayerFrom(c, kind, t));
}

const HEADLINE: Record<SystemKind, (p: string) => string> = {
  tear_off: (p) => `${p}: the old roof comes off down to the deck, and a whole new roof is built on top.`,
  layover: (p) => `${p}: the old roof stays, and the new roof goes on top of it.`,
  coating: (p) => `${p}: the old roof stays and gets a coating to seal it.`,
};

function applyWording(layer: DiagramLayer, edits?: AssemblyEdits | null): DiagramLayer {
  const e = edits?.layers?.[layer.id];
  if (!e) return layer;
  return {
    ...layer,
    ...(e.label?.trim() ? { label: e.label.trim() } : {}),
    ...(e.detail !== undefined ? { detail: e.detail.trim() || null } : {}),
  };
}

/** One tier's diagram, from the checklist answers and the product quoted. */
export function buildAssemblyDiagram(answers: Record<string, any>, t: TierPricing, edits?: AssemblyEdits | null): AssemblyDiagram {
  const path = reroofDetermination(answers).path;
  const kind = kindOf(t, path);
  const existing = [...existingAssemblyLayers(answers)].reverse(); // top to bottom
  const overrides = (kind && edits?.actions?.[kind]) || {};

  const today: DiagramLayer[] = existing.map((l) => {
    const id = `t-${l.role}`;
    const fate = fateOf(l, kind, answers);
    const forced = overrides[id];
    const action = forced ?? fate.action;
    return applyWording({
      id, role: l.role, label: l.label, detail: l.detail,
      explain: `${ROLE_PLAIN[l.role] ?? ''} ${forced && forced !== fate.action ? '' : fate.why}`.trim(),
      action,
      tag: forced && forced !== fate.action ? TAG[forced] : (fate.tag ?? TAG[action]),
      unknown: l.unknown,
    }, edits);
  });

  const kept = today.filter((l) => l.action !== 'removed');
  const added = kind ? newLayersFor(t, kind).map((l) => applyWording(l, edits)) : [];
  const productName = t.product?.name || 'New roof system';
  return {
    tier: t.tier,
    productName,
    system: kind,
    today,
    after: [...added, ...kept],
    headline: kind ? HEADLINE[kind](productName) : `${productName}: we will know what stays and what comes off after a core cut (a small sample of the roof).`,
  };
}

/** The layers a rep can edit, for the tier the document opens on. */
export interface EditableLayer {
  id: string;
  side: 'today' | 'new';
  /** The wording as the template writes it — what an empty field falls back to. */
  label: string;
  detail: string;
  /** What the standard scope of this option does to the layer, before any override. */
  action: LayerAction;
}

/**
 * The layers a rep can edit, for the tier the document opens on — as the
 * template draws them, with the saved edits alongside so the editor can show
 * each field's current value and what clearing it restores.
 */
export function assemblyForEditing(answers: Record<string, any>, t: TierPricing, edits?: AssemblyEdits | null): {
  system: SystemKind | null;
  layers: EditableLayer[];
  edits: AssemblyEdits | null;
} {
  const d = buildAssemblyDiagram(answers, t, null);
  const row = (side: 'today' | 'new') => (l: DiagramLayer): EditableLayer => ({ id: l.id, side, label: l.label, detail: l.detail ?? '', action: l.action });
  return {
    system: d.system,
    layers: [...d.today.map(row('today')), ...newLayersOf(d).map(row('new'))],
    edits: edits ?? null,
  };
}

const newLayersOf = (d: AssemblyDiagram): DiagramLayer[] => d.after.filter((l) => l.action === 'new');

/* ---------------------------------------------------------------- render --- */

/** A swatch class from what the layer is made of, so EPDM reads black and TPO white. */
function swatch(l: DiagramLayer): string {
  const s = l.label.toLowerCase();
  if (l.unknown) return 'unknown';
  if (l.role === 'deck') return /wood|plywood/.test(s) ? 'deck-wood' : /concrete|gypsum|tectum/.test(s) ? 'deck-concrete' : 'deck-steel';
  if (l.role === 'membrane' || l.role === 'coating') {
    if (l.action === 'new') return 'mem-new';
    if (/epdm/.test(s)) return 'mem-black';
    if (/tpo|pvc/.test(s)) return 'mem-white';
    if (/metal/.test(s)) return 'deck-steel';
    return 'mem-bitumen';
  }
  if (l.role === 'insulation') return 'ins';
  if (l.role === 'cover' || l.role === 'cover-board') return 'cover';
  if (l.role === 'vapor') return 'vapor';
  if (l.role === 'surfacing') return 'surf';
  if (l.role === 'older-roof') return 'old';
  if (l.role === 'prep') return 'vapor';
  return 'cover';
}

function layerHtml(l: DiagramLayer, index: number, order: number): string {
  return `<li class="asm-layer asm-sw--${swatch(l)} is-${l.action}${l.unknown ? ' is-unknown' : ''}" style="--i:${index};--j:${order}" data-asm-layer="${esc(l.id)}" tabindex="0" role="button" aria-label="${esc(`${l.label}: ${l.tag}. Tap for details.`)}">
        <span class="asm-txt"><b>${esc(l.label)}</b>${l.detail ? `<small>${esc(l.detail)}</small>` : ''}</span>
        <span class="asm-tag asm-tag--${l.action}">${esc(l.tag)}</span>
      </li>`;
}

function oneDiagram(d: AssemblyDiagram, isDefault: boolean, aside: { note: string; photo: string }): string {
  const newCount = d.after.filter((l) => l.action === 'new').length;
  // New layers build bottom-up: the lowest new layer arrives first.
  let n = 0;
  const after = d.after.map((l, i) => {
    const order = l.action === 'new' ? newCount - 1 - n++ : 0;
    return layerHtml(l, i, order);
  }).join('');
  const today = d.today.map((l, i) => layerHtml(l, i, 0)).join('');
  const seen = new Set<string>();
  const details = [...d.today, ...d.after].filter((l) => !seen.has(l.id) && seen.add(l.id)).map((l) =>
    `<div class="asm-info" data-asm-info="${esc(l.id)}"><b>${esc(l.label)} <span class="asm-tag asm-tag--${l.action}">${esc(l.tag)}</span></b><p>${esc(l.explain)}</p></div>`).join('');
  const removed = d.today.filter((l) => l.action === 'removed').length;
  return `<div class="asm" data-asm data-asm-tier="${d.tier}"${isDefault ? ' data-asm-default' : ''} data-phase="today">
      <p class="asm-headline">${esc(d.headline)}</p>
      <div class="asm-cols">
        <div class="asm-col asm-col--today">
          <p class="asm-col-title">Your roof today <span>${d.today.length} layer${d.today.length === 1 ? '' : 's'}${removed ? `, ${removed} coming off` : ''}</span></p>
          <ol class="asm-stack" aria-label="The existing roof, top to bottom">${today}</ol>
        </div>
        <div class="asm-col asm-col--after">
          <p class="asm-col-title">Your roof after <span>${newCount} new layer${newCount === 1 ? '' : 's'}</span></p>
          <ol class="asm-stack" aria-label="The finished roof, top to bottom">${after}</ol>
        </div>
      </div>
      <div class="asm-detail" aria-live="polite">
        <div class="asm-detail-text">
          <p class="asm-hint">Tap any layer to see what it is and what happens to it.${aside.note ? ` <span class="asm-note">${aside.note}</span>` : ''}</p>
          ${details}
        </div>
        ${aside.photo}
      </div>
    </div>`;
}

function chipsHtml(diagrams: AssemblyDiagram[], selected: TierKey): string {
  return diagrams.map((d) => `<button type="button" class="asm-chip" data-asm-pick="${d.tier}" aria-pressed="${d.tier === selected ? 'true' : 'false'}"><span>${esc(d.chip ?? d.tier)}</span>${esc(d.productName)}</button>`).join('');
}

/* ------------------------------------------------- the inspection's version --- */

/**
 * The Inspection prices nothing and names no product, so its diagram shows
 * the three things that can be done to a low-slope roof — restore it, cover
 * it, or replace it — and what each would do to the layers the inspector
 * found. The option the inspection's own findings call for opens first, and
 * one the findings rule out says so, with the reason, rather than being
 * drawn as if it were on the table.
 */
const PATHS: Array<{ tier: TierKey; kind: SystemKind; path: ReroofPath; name: string }> = [
  { tier: 'good', kind: 'coating', path: 'restore', name: 'Restoration coating' },
  { tier: 'better', kind: 'layover', path: 'recover', name: 'Recover, a new roof over this one' },
  { tier: 'best', kind: 'tear_off', path: 'replace', name: 'Full replacement, down to the deck' },
];

const GENERIC_NEW: Record<SystemKind, Array<[role: string, label: string, explain: string]>> = {
  coating: [
    ['coating', 'Restoration coating', 'We clean the roof and make every seam, pipe and edge stronger. Then we coat the whole roof, so it is sealed in one piece.'],
  ],
  layover: [
    ['membrane', 'New roof membrane', 'A new waterproof sheet. We seal it at every wall, drain and pipe, and put new metal trim on the edges.'],
    ['prep', 'Separation layer', 'A layer between the old roof and the new one, so they do not touch.'],
  ],
  tear_off: [
    ['membrane', 'New roof membrane', 'A new waterproof sheet. We seal it at every wall, drain and pipe, and put new metal trim on the edges.'],
    ['cover-board', 'New cover board', 'A thin, hard board over the insulation. It stands up to feet and hail and gives the roof a firm top.'],
    ['insulation', 'New insulation', 'New foam insulation on the bare deck. With the old roof off, this is the best time to add more insulation.'],
  ],
};

/** Where one option stands, given what the inspection determined. */
function standing(option: ReroofPath, determined: ReroofDetermination): { chip: string; lead: string } {
  const why = determined.reasons[0]?.text ?? '';
  if (determined.path === 'undetermined') return { chip: 'To be confirmed', lead: 'We have not decided yet. ' };
  if (option === determined.path) return { chip: 'What the inspection calls for', lead: 'This is what your roof needs. ' };
  if (determined.path === 'replace') return { chip: 'Not an option here', lead: `This will not work on your roof. ${why} ` };
  if (determined.path === 'recover' && option === 'restore') return { chip: 'Not an option here', lead: 'This will not work on your roof. A coating only works on a roof that is still strong, and this one is not. ' };
  return { chip: 'Also possible', lead: 'This would also work, but it is more than your roof needs. ' };
}

/** The three diagrams for an inspection, and which one opens. */
export function buildPathDiagrams(answers: Record<string, any>, edits?: AssemblyEdits | null): { diagrams: AssemblyDiagram[]; opening: TierKey } {
  const determined = reroofDetermination(answers);
  const diagrams = PATHS.map((o) => {
    const product = { key: `path_${o.kind}`, manufacturer: '', name: o.name, category: 'commercial', system: o.kind, ratePerSquare: 0, tagline: '', body: '' } as unknown as TierPricing['product'];
    // Wording edits carry over from the editor; a changed fate is a decision
    // about a priced scope and has no place on the inspector's record.
    const base = buildAssemblyDiagram(answers, { tier: o.tier, product, squares: 0, ratePerSquare: 0, total: 0 }, edits?.layers ? { layers: edits.layers } : null);
    const added: DiagramLayer[] = GENERIC_NEW[o.kind].map(([role, label, explain]) => ({
      id: `n-${o.kind}-${role}`, role, label, detail: null, explain, action: 'new', tag: TAG.new, unknown: false,
    }));
    const s = standing(o.path, determined);
    return { ...base, chip: s.chip, after: [...added, ...base.today.filter((l) => l.action !== 'removed')], headline: `${s.lead}${HEADLINE[o.kind](o.name)}` };
  });
  const opening = PATHS.find((o) => o.path === determined.path)?.tier ?? 'best';
  return { diagrams, opening };
}

/** The inspection's diagram block, for the document shell. '' with no assembly to draw. */
export function assemblyPathsHtml(answers: Record<string, any> | null | undefined, edits?: AssemblyEdits | null): string {
  if (!answers) return '';
  const { diagrams, opening } = buildPathDiagrams(answers, edits);
  if (!diagrams[0].today.length) return '';
  return `<div class="asm-doc">
    <div class="asm-tiers" role="group" aria-label="Show what each option does to the roof">${chipsHtml(diagrams, opening)}</div>
    ${diagrams.map((d) => oneDiagram(d, d.tier === opening, { note: '', photo: '' })).join('\n')}
  </div>`;
}

/** The priced diagram (Good / Better / Best) in the document shell. */
export function assemblyDiagramDocumentHtml(input: AssemblyDiagramInput): string {
  const inner = assemblyDiagramHtml(input);
  return inner ? `<div class="asm-doc">${inner}</div>` : '';
}

export interface AssemblyDiagramInput {
  answers: Record<string, any>;
  pricing: { good: TierPricing; better: TierPricing; best: TierPricing };
  startingTier: TierKey;
  edits?: AssemblyEdits | null;
}

/**
 * The diagram block: a tier switch and one diagram per tier. '' when the
 * checklist has no assembly to draw.
 */
export function assemblyDiagramHtml(input: AssemblyDiagramInput): string {
  const tiers: TierKey[] = ['good', 'better', 'best'];
  const diagrams = tiers.map((k) => buildAssemblyDiagram(input.answers, input.pricing[k], input.edits));
  if (!diagrams[0].today.length) return '';
  const chips = chipsHtml(diagrams, input.startingTier);
  const photo = input.edits?.photoUrl
    ? `<figure class="asm-photo"><img src="${esc(input.edits.photoUrl)}" alt="${esc(input.edits.photoCaption || 'Core cut')}" loading="lazy">${input.edits.photoCaption ? `<figcaption>${esc(input.edits.photoCaption)}</figcaption>` : ''}</figure>`
    : '';
  const note = input.edits?.note?.trim() ? esc(input.edits.note.trim()) : '';
  return `<div class="asm-tiers" role="group" aria-label="Show the diagram for an option">${chips}</div>
    ${diagrams.map((d) => oneDiagram(d, d.tier === input.startingTier, { note, photo })).join('\n')}`;
}

/* -------------------------------------------------------------------- css --- */

/**
 * --k runs 0 → 2 across the pinned act: 0 is the roof as it stands, 1 is every
 * layer tagged, 2 is the new roof fully built. Outside a pinned act (print,
 * a short screen, no script) --sc-p is absent and --k falls back to 2, the
 * finished state, so the diagram is never left half-drawn.
 */
export const ASSEMBLY_CSS = `
#ch-layers .asm-stage { display: flex; align-items: safe center; padding-block: var(--sc-5); }
.asm-shell { width: 100%; }
.asm-head h2 { margin-top: var(--sc-2); }
.asm-caps { display: grid; margin-top: var(--sc-3); min-height: 3.2em; }
.asm-caps > * { grid-area: 1 / 1; max-width: 62ch; color: var(--sc-ink-soft); }
.asm-tiers { display: flex; gap: var(--sc-2); margin-top: var(--sc-3); overflow-x: auto; scrollbar-width: none; }
.asm-tiers::-webkit-scrollbar { display: none; }
.asm-chip { flex: none; white-space: nowrap; font: inherit; font-size: var(--sc-t-xs); cursor: pointer; background: var(--sc-surface); color: var(--sc-ink); border: 1px solid var(--sc-hairline-strong); border-radius: var(--sc-r-pill); padding: 0.4rem 0.9rem; }
.asm-chip span { text-transform: uppercase; letter-spacing: var(--sc-track-wide); color: var(--sc-ink-soft); margin-right: 0.5em; }
.asm-chip[aria-pressed="true"] { border-color: var(--sc-accent); box-shadow: inset 0 0 0 1px var(--sc-accent); }
.asm-chip[aria-pressed="true"] span { color: var(--sc-accent); }

.asm { display: none; margin-top: var(--sc-4); --k: clamp(0, calc((var(--sc-p, 1) - 0.1) / 0.72 * 2), 2); }
html[data-tier="good"] .asm[data-asm-tier="good"],
html[data-tier="better"] .asm[data-asm-tier="better"],
html[data-tier="best"] .asm[data-asm-tier="best"],
html:not([data-tier]) .asm[data-asm-default] { display: block; }
.asm-headline { font-family: var(--sc-font-display); font-size: var(--sc-t-base); line-height: 1.35; margin: 0 0 var(--sc-3); max-width: 80ch; }
.asm-cols { display: grid; grid-template-columns: 1fr 1fr; gap: var(--sc-6); align-items: end; }
.asm-col-title { margin: 0 0 var(--sc-2); font-size: var(--sc-t-xs); text-transform: uppercase; letter-spacing: var(--sc-track-wide); font-weight: 600; }
.asm-col-title span { font-weight: 400; color: var(--sc-ink-soft); text-transform: none; letter-spacing: 0; margin-left: 0.6em; }
.asm-stack { list-style: none; margin: 0; padding: 0; display: grid; gap: 3px; }
.asm-layer { position: relative; display: flex; align-items: center; justify-content: space-between; gap: var(--sc-3); min-height: 42px; padding: 6px 12px 6px 18px; border-radius: 6px; border: 1px solid rgba(0,0,0,.14); color: #17130F; cursor: pointer; overflow: hidden; }
.asm-layer::before { content: ""; position: absolute; inset: 0 auto 0 0; width: 8px; background: var(--asm-edge, rgba(0,0,0,.25)); }
.asm-layer:focus-visible, .asm-layer.is-open { outline: 2px solid var(--sc-accent); outline-offset: 1px; }
.asm-txt { min-width: 0; display: flex; flex-direction: column; }
.asm-txt b { font-weight: 600; font-size: var(--sc-t-sm); line-height: 1.25; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.asm-txt small { font-size: 11px; opacity: .75; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.asm-tag { flex: none; font-size: 10px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: #fff; padding: 3px 8px; border-radius: 4px; white-space: nowrap; }
.asm-tag--removed { background: #B3261E; }
.asm-tag--stays { background: #4B5563; }
.asm-tag--repaired { background: #9A6700; }
.asm-tag--new { background: #1B6B3A; }

.asm-sw--surf { background: linear-gradient(180deg, #CFC6B4, #A99F8B); --asm-edge: #8A8272; }
.asm-sw--mem-white { background: linear-gradient(180deg, #FBFAF6, #E4E2D9); --asm-edge: #BDBAAE; }
.asm-sw--mem-black { background: linear-gradient(180deg, #4A4A48, #2C2C2A); --asm-edge: #111; color: #F5EFE6; }
.asm-sw--mem-bitumen { background: linear-gradient(180deg, #B9B2A8, #958D82); --asm-edge: #5E564C; }
.asm-sw--mem-new { background: linear-gradient(180deg, #FFFFFF, #EEF6F0); --asm-edge: #1B6B3A; }
.asm-sw--old { background: repeating-linear-gradient(135deg, #D9CFC4 0 8px, #C7BBAE 8px 16px); --asm-edge: #7A6A5A; }
.asm-sw--cover { background: linear-gradient(180deg, #EFEDE6, #D6D3C8); --asm-edge: #A9A598; }
.asm-sw--ins { background: linear-gradient(180deg, #F7E3A6, #E6C766); --asm-edge: #B8942C; min-height: 58px; }
.asm-sw--vapor { background: linear-gradient(180deg, #C9D5DD, #A9BAC6); --asm-edge: #6F8696; min-height: 34px; }
.asm-sw--deck-steel { background: repeating-linear-gradient(90deg, #C3C8CC 0 14px, #A9AFB4 14px 28px); --asm-edge: #6F767C; }
.asm-sw--deck-wood { background: linear-gradient(180deg, #DDBF86, #C39F5C); --asm-edge: #8E6E33; }
.asm-sw--deck-concrete { background: linear-gradient(180deg, #D5D5D0, #BDBDB8); --asm-edge: #8C8C86; }
.asm-sw--unknown, .asm-layer.is-unknown { background: repeating-linear-gradient(135deg, #F4F4F2 0 8px, #E6E6E3 8px 16px); border-style: dashed; --asm-edge: #9CA3AF; }

/* Phase one (k 0 → 1): the tags arrive top to bottom, and each layer that is
   coming off slides aside and fades as its tag lands. */
.asm-col--today .asm-tag { opacity: clamp(0, calc((var(--k) - 0.08 - var(--i) * 0.1) * 6), 1); }
.asm-col--today .asm-layer.is-removed {
  --rm: clamp(0, calc((var(--k) - 0.3 - var(--i) * 0.1) * 4), 1);
  opacity: calc(1 - var(--rm) * 0.55);
  translate: calc(var(--rm) * 16px) 0;
}
/* Phase two (k 1 → 2): the new roof builds from the bottom up over what stays. */
.asm-col--after { opacity: clamp(0.55, calc((var(--k) - 0.75) * 4), 1); }
.asm-col--after .asm-layer.is-new {
  --in: clamp(0, calc((var(--k) - 1.05 - var(--j) * 0.15) * 5), 1);
  opacity: calc(0.32 + var(--in) * 0.68);
  translate: 0 calc((1 - var(--in)) * -5px);
  filter: grayscale(calc(1 - var(--in)));
  border-style: dashed;
}
.asm-col--after .asm-layer.is-new .asm-tag { opacity: var(--in); }
.asm-col--after .asm-layer:not(.is-new) { filter: saturate(0.6); }

.asm-detail { margin-top: var(--sc-3); min-height: 5.6em; display: flex; gap: var(--sc-4); align-items: flex-start; justify-content: space-between; border-left: 3px solid var(--sc-accent); padding: var(--sc-2) var(--sc-4); background: color-mix(in oklab, var(--sc-ink) 4%, transparent); border-radius: 0 var(--sc-r-sm) var(--sc-r-sm) 0; }
.asm-detail-text { min-width: 0; flex: 1; }
.asm-hint { margin: 0; color: var(--sc-ink-soft); font-size: var(--sc-t-sm); line-height: 1.5; }
.asm-info { display: none; }
.asm-info.is-open { display: block; }
.asm.has-open .asm-hint { display: none; }
.asm-info b { display: flex; align-items: center; gap: var(--sc-2); flex-wrap: wrap; font-size: var(--sc-t-sm); }
.asm-info p { margin: 4px 0 0; font-size: var(--sc-t-sm); line-height: 1.5; max-width: 90ch; }
.asm-note { display: block; margin-top: 4px; color: var(--sc-ink); }
.asm-photo { flex: none; margin: 0; width: 132px; }
.asm-photo img { width: 100%; height: 84px; object-fit: cover; border-radius: var(--sc-r-sm); display: block; }
.asm-photo figcaption { font-size: 11px; color: var(--sc-ink-soft); margin-top: 2px; line-height: 1.3; }

/* Narrow screens hold one stack at a time: today's roof, then the new one in
   the same place. The page script flips data-phase as --k passes 1 so the
   stack that is not showing cannot be tapped. */
@media (max-width: 860px) {
  .asm-head h2 { font-size: var(--sc-t-xl); }
  .asm-cols { grid-template-columns: 1fr; gap: 0; }
  .asm-col { grid-area: 1 / 1; }
  .asm-col--today { opacity: clamp(0, calc((1.04 - var(--k)) * 10), 1); }
  .asm-col--after { opacity: clamp(0, calc((var(--k) - 0.96) * 10), 1); }
  .asm[data-phase="today"] .asm-col--after, .asm[data-phase="after"] .asm-col--today { pointer-events: none; }
  .asm-headline { font-size: var(--sc-t-sm); margin-bottom: var(--sc-2); }
  .asm-caps { min-height: 4.4em; margin-top: var(--sc-2); }
  .asm-caps > * { font-size: var(--sc-t-sm); }
  .asm-photo { width: 84px; }
  .asm-photo img { height: 60px; }
  .asm-photo figcaption { display: none; }
  .asm-layer { min-height: 38px; }
  .asm-sw--ins { min-height: 48px; }
  .asm-detail { min-height: 7.5em; }
}

/* A screen too short to hold the stage un-pins the act and shows the finished
   diagram, both stacks, in normal flow — nothing is clipped. */
@media (max-height: 640px), print {
  #ch-layers { height: auto !important; padding-block: var(--sc-8); }
  #ch-layers [data-sc-stage] { position: static; height: auto; overflow: visible; display: block; }
  #ch-layers .asm { --k: 2; }
  #ch-layers .asm-caps > * { opacity: 1 !important; transform: none !important; grid-area: auto; }
  #ch-layers .asm-col { grid-area: auto; opacity: 1; pointer-events: auto !important; }
  #ch-layers .asm-cols { gap: var(--sc-4); }
}
@media print {
  .asm-info { display: block; margin-top: 6px; }
  .asm-tiers { display: none; }
}
`;

/**
 * The same diagram in the document shell (the Inspection). That shell has
 * none of the scroll pages' variables and no pinned stage, so the block
 * brings its own values, shows both stacks at once in their finished state,
 * and lets the option names wrap.
 */
export const ASSEMBLY_CSS_DOCUMENT = `
.asm-doc {
  --sc-surface: #fff; --sc-ink: #17130F; --sc-ink-soft: #6b7280; --sc-accent: #C8102E; --sc-hairline-strong: #d1d5db;
  --sc-t-xs: 12px; --sc-t-sm: 13.5px; --sc-t-base: 15px; --sc-t-lg: 18px; --sc-t-xl: 22px;
  --sc-1: 4px; --sc-2: 8px; --sc-3: 12px; --sc-4: 16px; --sc-5: 24px; --sc-6: 32px;
  --sc-r-sm: 6px; --sc-r-md: 12px; --sc-r-pill: 999px; --sc-font-display: inherit; --sc-track-wide: .06em;
  margin-top: 14px;
}
${ASSEMBLY_CSS}
.asm-doc .asm-tiers { flex-wrap: wrap; overflow: visible; margin-top: 0; }
.asm-doc .asm-chip { white-space: normal; text-align: left; }
.asm-doc .asm-chip span { display: block; margin: 0 0 2px; }
.asm-doc .asm-headline { font-weight: 600; }
@media (max-width: 860px) {
  .asm-doc .asm-cols { gap: 16px; }
  .asm-doc .asm-col { grid-area: auto; opacity: 1 !important; pointer-events: auto !important; }
}
@media print { .asm-doc .asm { break-inside: avoid; } }
`;

/* --------------------------------------------------------------------- js --- */

/**
 * Tier chips, tap-for-detail, and the phase flag. The tier itself lives on
 * <html data-tier> and is set by the page script's select() — one source of
 * truth for the diagram, the options and the investment number.
 */
export const ASSEMBLY_JS = `
(function () {
  var root = document.documentElement;
  var chips = document.querySelectorAll('[data-asm-pick]');
  function syncChips() {
    var t = root.getAttribute('data-tier');
    if (!t) return;
    chips.forEach(function (c) { c.setAttribute('aria-pressed', String(c.getAttribute('data-asm-pick') === t)); });
  }
  chips.forEach(function (c) {
    c.addEventListener('click', function () {
      var tier = c.getAttribute('data-asm-pick');
      root.setAttribute('data-tier', tier);
      document.dispatchEvent(new CustomEvent('brn:select-tier', { detail: { tier: tier } }));
      syncChips();
    });
  });
  if ('MutationObserver' in window) new MutationObserver(syncChips).observe(root, { attributes: true, attributeFilter: ['data-tier'] });
  syncChips();

  document.querySelectorAll('[data-asm]').forEach(function (asm) {
    function open(id) {
      var any = false;
      asm.querySelectorAll('[data-asm-info]').forEach(function (d) { var on = d.getAttribute('data-asm-info') === id; d.classList.toggle('is-open', on); if (on) any = true; });
      asm.querySelectorAll('[data-asm-layer]').forEach(function (l) { l.classList.toggle('is-open', l.getAttribute('data-asm-layer') === id); });
      asm.classList.toggle('has-open', any);
    }
    asm.querySelectorAll('[data-asm-layer]').forEach(function (l) {
      l.addEventListener('click', function () { open(l.getAttribute('data-asm-layer')); });
      l.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(l.getAttribute('data-asm-layer')); } });
    });
  });

  var act = document.getElementById('ch-layers');
  if (act) {
    var asms = act.querySelectorAll('[data-asm]');
    var ticking = false;
    function phase() {
      ticking = false;
      var p = parseFloat(getComputedStyle(act).getPropertyValue('--sc-p'));
      if (isNaN(p)) p = 1;
      var name = p < 0.46 ? 'today' : 'after';
      asms.forEach(function (a) { if (a.getAttribute('data-phase') !== name) a.setAttribute('data-phase', name); });
    }
    window.addEventListener('scroll', function () { if (!ticking) { ticking = true; requestAnimationFrame(phase); } }, { passive: true });
    phase();
  }

  // The document shell (the Inspection) has no scroll engine and no pinned
  // stage, so the diagram is driven here: as the block rises through the
  // screen its progress runs 0 to 1, the layers are tagged, and the new roof
  // builds. Reduced motion and print get the finished diagram.
  var docs = document.querySelectorAll('.asm-doc');
  if (docs.length) {
    var still = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var queued = false;
    function drive(done) {
      queued = false;
      var vh = window.innerHeight || 1;
      docs.forEach(function (d) {
        var p = (done === true || still) ? 1 : Math.max(0, Math.min(1, (vh * 0.9 - d.getBoundingClientRect().top) / (vh * 0.7)));
        d.style.setProperty('--sc-p', p.toFixed(3));
      });
    }
    function queue() { if (!queued) { queued = true; requestAnimationFrame(drive); } }
    window.addEventListener('scroll', queue, { passive: true });
    window.addEventListener('resize', queue);
    window.addEventListener('beforeprint', function () { drive(true); });
    window.addEventListener('afterprint', queue);
    drive();
  }
})();
`;
