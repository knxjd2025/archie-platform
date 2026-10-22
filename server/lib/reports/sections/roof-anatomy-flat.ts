/**
 * A commercial low-slope roof, drawn as an exploded stack: the layers the
 * inspector found, bottom to top (existingAssemblyLayers), pulled apart so
 * each one can be seen, with what sits on the roof drawn on the top layer —
 * edge metal, the parapet and its coping, drains, a pipe, an HVAC unit on
 * its curb, walkway pads, and a skylight when there is one.
 *
 * Every rating is the inspector's (the Condition Assessment section of the
 * commercial checklist). Photos are the ones the scan sorted to that part,
 * or, unscanned, the ones whose caption names it.
 */
import { existingAssemblyLayers, type RoofLayer } from '../../../../shared/commercial-inspection-form.js';
import { esc } from '../report-theme.js';
import { ans, type InspectionFactsContext } from './inspection-facts.js';
import {
  anatomyBlock, hotspotsSvg, photosMatching, statusFromRating, type AnatomyPart, type AnatomyPhoto, type Hotspot, type PartStatus,
} from './anatomy.js';
import { flatExamples } from './anatomy-examples.js';

type Photo = { url?: string; caption?: string | null; component?: string; scanned?: boolean };

/* ------------------------------------------------------------- geometry --- */

const X0 = 70;
const W = 440;
const DX = 210;
const DY = 120;
const GAP = 24;
const THICK: Record<string, number> = { deck: 16, vapor: 5, insulation: 36, cover: 9, 'older-roof': 9, membrane: 7, surfacing: 7 };

type Pt = [number, number];
const pts = (ps: Pt[]) => ps.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');

function layerFill(l: RoofLayer, membrane: string): { top: string; front: string; side: string } {
  if (l.unknown) return { top: 'url(#anat-unknown)', front: '#D9D9D9', side: '#C9C9C9' };
  switch (l.role) {
    case 'deck': return { top: 'url(#anat-deck)', front: '#7E8893', side: '#6B747E' };
    case 'vapor': return { top: '#D6DADF', front: '#B9BFC6', side: '#AAB0B7' };
    case 'insulation': return { top: '#F2D27A', front: '#E2BC56', side: '#CFA944' };
    case 'cover': return { top: '#EAE0CC', front: '#D6C9AE', side: '#C7B99C' };
    case 'older-roof': return { top: '#8E7F78', front: '#76665F', side: '#665750' };
    case 'surfacing': return { top: 'url(#anat-gravel)', front: '#A79F92', side: '#988F81' };
    default: {
      const dark = /epdm/i.test(membrane);
      const mod = /mod|bur|built/i.test(membrane);
      return dark ? { top: '#34373B', front: '#25282B', side: '#1D2023' }
        : mod ? { top: '#6B6560', front: '#56514C', side: '#4A4541' }
          : { top: '#F4F6F8', front: '#D9DEE3', side: '#C8CED5' };
    }
  }
}

function slab(y: number, t: number, fill: { top: string; front: string; side: string }, id: string): string {
  const top: Pt[] = [[X0, y - t], [X0 + W, y - t], [X0 + W + DX, y - t - DY], [X0 + DX, y - t - DY]];
  const front: Pt[] = [[X0, y], [X0 + W, y], [X0 + W, y - t], [X0, y - t]];
  const side: Pt[] = [[X0 + W, y], [X0 + W + DX, y - DY], [X0 + W + DX, y - t - DY], [X0 + W, y - t]];
  return `<g class="anat-layer" data-layer="${esc(id)}">
    <polygon points="${pts(front)}" fill="${fill.front}" stroke="#4A4038" stroke-width="1"/>
    <polygon points="${pts(side)}" fill="${fill.side}" stroke="#4A4038" stroke-width="1"/>
    <polygon points="${pts(top)}" fill="${fill.top}" stroke="#4A4038" stroke-width="1"/>
  </g>`;
}

/** An upright box on the top face, from (u1,v1) to (u2,v2), h tall. */
function box(p: (u: number, v: number) => Pt, u1: number, v1: number, u2: number, v2: number, h: number, c: { top: string; front: string; side: string }): string {
  const up = ([x, y]: Pt): Pt => [x, y - h];
  const a = p(u1, v1); const b = p(u2, v1); const c2 = p(u2, v2); const d = p(u1, v2);
  return `<polygon points="${pts([a, b, up(b), up(a)])}" fill="${c.front}" stroke="#4A4038" stroke-width="1"/>
    <polygon points="${pts([b, c2, up(c2), up(b)])}" fill="${c.side}" stroke="#4A4038" stroke-width="1"/>
    <polygon points="${pts([up(a), up(b), up(c2), up(d)])}" fill="${c.top}" stroke="#4A4038" stroke-width="1"/>`;
}

interface Drawing { svg: string; spots: Hotspot[] }

function drawing(layers: RoofLayer[], a: Record<string, any>, parts: AnatomyPart[]): Drawing {
  const membrane = String(a['Membrane type'] ?? '');
  const totalT = layers.reduce((n, l) => n + (THICK[l.role] ?? 8), 0);
  const H = Math.round(totalT + GAP * (layers.length - 1) + DY + 110);
  const spots: Hotspot[] = [];
  const num = new Map(parts.filter((p) => p.n).map((p) => [p.id, p]));
  const spot = (id: string, x: number, y: number) => { const p = num.get(id); if (p) spots.push({ id, n: p.n!, x, y, name: p.name }); };

  let y = H - 16;
  const slabs: string[] = [];
  const leaders: string[] = [];
  let topY = y;
  layers.forEach((l, i) => {
    const t = THICK[l.role] ?? 8;
    slabs.push(slab(y, t, layerFill(l, membrane), `layer-${l.role}`));
    const sx = X0 + W + DX + 30;
    const sy = y - t / 2 - DY + 6;
    leaders.push(`<line x1="${X0 + W + DX - 2}" y1="${sy}" x2="${sx - 14}" y2="${sy}" stroke="#8A8178" stroke-width="1" stroke-dasharray="3 3"/>`);
    spot(`layer-${l.role}`, sx, sy);
    topY = y - t;
    if (i < layers.length - 1) y = y - t - GAP;
  });

  // The top face of the top layer, addressed by (u along the front, v toward the back).
  const p = (u: number, v: number): Pt => [X0 + u * W + v * DX, topY - v * DY];
  const items: string[] = [];
  const rated = (id: string) => num.has(id);

  // Seams across the membrane.
  items.push(`<g class="anat-layer" data-layer="seams" stroke="#9AA3AD" stroke-width="2">${[0.28, 0.52].map((u) => `<line x1="${p(u, 0)[0]}" y1="${p(u, 0)[1]}" x2="${p(u, 1)[0]}" y2="${p(u, 1)[1]}"/>`).join('')}</g>`);
  spot('seams', p(0.52, 0.9)[0] - 4, p(0.52, 0.9)[1] - 22);

  // Parapet along the back edge, with its coping and base flashing.
  const parapet = !!a['Parapet walls'] && !/^none/i.test(String(a['Parapet walls']));
  if (parapet) {
    const b0 = p(0, 1); const b1 = p(1, 1); const h = 40;
    items.push(`<g class="anat-layer" data-layer="base-flashing"><polygon points="${pts([b0, b1, [b1[0], b1[1] - 12], [b0[0], b0[1] - 12]])}" fill="#E7EAED" stroke="#8C939B"/></g>`);
    items.push(`<polygon points="${pts([[b0[0], b0[1] - 12], [b1[0], b1[1] - 12], [b1[0], b1[1] - h], [b0[0], b0[1] - h]])}" fill="url(#anat-block)" stroke="#6E655C"/>`);
    items.push(`<g class="anat-layer" data-layer="coping"><polygon points="${pts([[b0[0] - 4, b0[1] - h], [b1[0] + 4, b1[1] - h], [b1[0] + 4, b1[1] - h - 7], [b0[0] - 4, b0[1] - h - 7]])}" fill="#AEB5BD" stroke="#6E757D"/></g>`);
    spot('coping', b0[0] + 70, b0[1] - h - 22);
    spot('base-flashing', b1[0] - 40, b1[1] - h - 22);
  }

  // Edge metal along the front edge.
  items.push(`<g class="anat-layer" data-layer="edge"><polygon points="${pts([[X0 - 4, topY - 3], [X0 + W + 4, topY - 3], [X0 + W + 4, topY + 9], [X0 - 4, topY + 9]])}" fill="#B9C0C8" stroke="#6E757D"/></g>`);
  spot('edge', X0 + 40, topY + 30);

  // Ponding and a drain.
  const pond = !!a['Ponding observed'] && !/^none/i.test(String(a['Ponding observed']));
  const [dxp, dyp] = p(0.34, 0.24);
  items.push(`<g class="anat-layer" data-layer="drains">${pond ? `<ellipse cx="${dxp}" cy="${dyp}" rx="58" ry="17" fill="#7FB3D5" opacity=".55"/>` : ''}
    <ellipse cx="${dxp}" cy="${dyp}" rx="13" ry="6" fill="#2E3236"/><ellipse cx="${dxp}" cy="${dyp - 3}" rx="8" ry="4" fill="#5A6066"/></g>`);
  spot('drains', dxp - 50, dyp + 4);

  // A pipe through the roof.
  const [px, py] = p(0.1, 0.42);
  items.push(`<g class="anat-layer" data-layer="penetrations"><ellipse cx="${px}" cy="${py}" rx="12" ry="5" fill="#8C939B"/><rect x="${px - 6}" y="${py - 30}" width="12" height="30" fill="#D4D8DC" stroke="#8C939B"/><ellipse cx="${px}" cy="${py - 30}" rx="6" ry="2.5" fill="#9AA1A8"/></g>`);
  spot('penetrations', px - 30, py - 30);

  // HVAC unit on its curb, reached by walkway pads.
  items.push(`<g class="anat-layer" data-layer="walkways" fill="#8B8F94" stroke="#5E6266">${[0.05, 0.16, 0.27].map((v) => `<polygon points="${pts([p(0.68, v), p(0.75, v), p(0.75, v + 0.07), p(0.68, v + 0.07)])}"/>`).join('')}</g>`);
  spot('walkways', p(0.78, 0.1)[0] + 26, p(0.78, 0.1)[1] + 6);
  items.push(`<g class="anat-layer" data-layer="hvac">${box(p, 0.64, 0.42, 0.86, 0.76, 9, { top: '#F1F3F5', front: '#C9CFD5', side: '#B6BDC4' })}
    ${box((u, v) => { const q = p(u, v); return [q[0], q[1] - 9]; }, 0.66, 0.45, 0.84, 0.73, 44, { top: '#C7CED6', front: '#A9B2BC', side: '#97A1AC' })}</g>`);
  spot('hvac', p(0.75, 0.6)[0], p(0.75, 0.6)[1] - 82);

  if (rated('skylights')) {
    items.push(`<g class="anat-layer" data-layer="skylights">${box(p, 0.08, 0.68, 0.2, 0.86, 10, { top: '#9DCBEA', front: '#C3C9D0', side: '#AEB5BD' })}</g>`);
    spot('skylights', p(0.14, 0.77)[0] - 40, p(0.14, 0.77)[1] - 10);
  }

  const svg = `<svg viewBox="0 0 820 ${H}" role="img" aria-label="The layers of this roof pulled apart, bottom to top, with the parts on top, numbered">
  <defs>
    <pattern id="anat-deck" width="22" height="22" patternUnits="userSpaceOnUse"><rect width="22" height="22" fill="#97A1AB"/><path d="M0 0L22 22" stroke="#7E8893" stroke-width="5"/></pattern>
    <pattern id="anat-gravel" width="14" height="10" patternUnits="userSpaceOnUse"><rect width="14" height="10" fill="#BDB5A6"/><circle cx="3" cy="3" r="2" fill="#9C9384"/><circle cx="10" cy="7" r="2.2" fill="#D3CCBE"/></pattern>
    <pattern id="anat-unknown" width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="12" height="12" fill="#EFEFEF"/><rect width="6" height="12" fill="#DDDDDD"/></pattern>
    <pattern id="anat-block" width="24" height="12" patternUnits="userSpaceOnUse"><rect width="24" height="12" fill="#CFC6B8"/><path d="M0 11.5H24M12 0V6M0 6V12M0 5.5H24" stroke="#B3A897" stroke-width="1"/></pattern>
  </defs>
  ${leaders.join('')}
  ${slabs.join('')}
  ${items.join('')}
  ${hotspotsSvg(spots)}
</svg>`;
  return { svg, spots };
}

/* ---------------------------------------------------------------- parts --- */

const LAYER_TEXT: Record<string, [string, string]> = {
  deck: ['The steel, wood or concrete base the whole roof is fastened to.', 'If the deck is rusted through or soft, nothing on top of it will hold.'],
  vapor: ['A sheet on the deck that keeps damp air from inside the building out of the roof.', 'Without it, moisture from inside can soak the insulation from below.'],
  insulation: ['Foam boards that keep heat in during winter and out in summer.', 'Wet insulation stops working and rusts the deck. It has to be found and cut out.'],
  cover: ['A thin, hard board on top of the insulation.', 'It stands up to foot traffic and hail, and gives the roof a firm top.'],
  'older-roof': ['An old roof that was left in place when the current one went on top.', 'The building code only allows one old roof under a new one, so this matters for what comes next.'],
  membrane: ['The waterproof sheet on top. This is the part that keeps the rain out.', 'Everything else is there to hold it up. When it splits or blisters, water gets in.'],
  surfacing: ['What covers the membrane: gravel, grit or a coating.', 'It shields the membrane from sun and wear.'],
};

/** Plain name and why-it-matters for each rated commercial field — what At a Glance prints. */
export function plainCommercialPart(field: string): { name: string; why: string } | null {
  const d = ITEMS.find((i) => i.field === field);
  if (d) return { name: d.name, why: d.why };
  if (field === 'Membrane field condition') return { name: 'Membrane', why: LAYER_TEXT.membrane[1] };
  return null;
}

interface ItemDef { id: string; name: string; field: string; what: string; why: string; scan: string[]; re: RegExp }
const ITEMS: ItemDef[] = [
  { id: 'seams', name: 'Seams', field: 'Seams and laps', what: 'The joints where two sheets of membrane overlap and are welded or glued.', why: 'Seams open long before the rest of the roof wears out. Most flat-roof leaks start here.', scan: ['seams'], re: /seam|lap/i },
  { id: 'edge', name: 'Edge metal', field: 'Perimeter edge metal (fascia, gravel stop, drip edge)', what: 'The metal trim around the outside edge of the roof.', why: 'Wind lifts a roof from the edge first. Loose or rusty edge metal lets it peel back.', scan: ['edge_metal'], re: /edge|fascia|gravel stop/i },
  { id: 'base-flashing', name: 'Base flashing', field: 'Base flashings (walls and curbs)', what: 'The membrane that turns up the walls and around curbs.', why: 'Where the roof meets a wall is where water gets behind it.', scan: ['base_flashing'], re: /flashing|wall/i },
  { id: 'coping', name: 'Wall caps (coping)', field: 'Parapet coping and wall caps', what: 'The metal caps on top of the short walls around the roof.', why: 'Open joints in the caps let water run down inside the wall.', scan: ['coping'], re: /coping|parapet|wall cap/i },
  { id: 'drains', name: 'Drains & standing water', field: 'Drains and strainers', what: 'The drains that carry water off the roof, with strainers to keep trash out.', why: 'A clogged drain makes a pond. Standing water wears out a roof fast.', scan: ['drains', 'ponding'], re: /drain|scupper|pond|standing water/i },
  { id: 'penetrations', name: 'Pipes & penetrations', field: 'Penetrations (pipes, pitch pockets, conduits)', what: 'Pipes, vents and lines that come up through the roof.', why: 'Every hole through the roof needs its own seal, and those seals crack.', scan: ['penetrations'], re: /pipe|penetration|pitch pocket|conduit|vent/i },
  { id: 'hvac', name: 'HVAC units & curbs', field: 'HVAC curbs and rooftop equipment', what: 'Heating and cooling units, set on raised frames called curbs.', why: 'Curbs need tall, sealed flashing. Drips and service traffic around units cause leaks.', scan: ['hvac_curbs'], re: /hvac|rtu|curb|unit|condenser/i },
  { id: 'walkways', name: 'Walk pads', field: 'Walkway pads and traffic protection', what: 'Pads that mark a path for workers to walk on.', why: 'Workers and dropped tools poke more holes in roofs than storms do.', scan: ['walkways'], re: /walkway|walk pad|traffic/i },
  { id: 'skylights', name: 'Skylights & hatches', field: 'Skylights, hatches and smoke vents', what: 'Windows and doors in the roof.', why: 'Their seals and curbs leak, and an open skylight is a fall risk.', scan: ['skylights'], re: /skylight|hatch|smoke vent/i },
  { id: 'expansion', name: 'Expansion joints', field: 'Expansion joints', what: 'Flexible joints that let a big building move without tearing the roof.', why: 'When they split, water goes straight into the building.', scan: [], re: /expansion/i },
];

function photosFor(photos: Photo[], scan: string[], re: RegExp): AnatomyPhoto[] {
  const scanned = photos.filter((p) => p.scanned && p.url && scan.includes(String(p.component))).slice(0, 4)
    .map((p) => ({ url: String(p.url), caption: String(p.caption || 'Inspection photo') }));
  return scanned.length ? scanned : photosMatching(photos.filter((p) => !p.scanned), re);
}

function layerStatus(l: RoofLayer, a: Record<string, any>): { status: PartStatus; found: string | null; note: string | null } {
  const found = [l.label, l.detail].filter(Boolean).join(' · ');
  if (l.unknown) return { status: 'unknown', found, note: 'This layer could not be seen from the top. A core cut (a small sample of the roof) would show it.' };
  if (l.role === 'deck') return { status: statusFromRating(a['Deck condition']) ?? 'info', found, note: null };
  if (l.role === 'membrane') return { status: statusFromRating(a['Membrane field condition']) ?? 'info', found: [found, a['Membrane field condition'] ? `Rated ${a['Membrane field condition']}` : null].filter(Boolean).join(' · '), note: null };
  if (l.role === 'insulation') {
    const wet = Number(a['Estimated wet insulation (% of roof area)']);
    if (Number.isFinite(wet) && wet > 0) return { status: wet >= 25 ? 'failed' : 'attention', found: `${found} · About ${wet}% wet`, note: wet >= 25 ? 'This much wet insulation means the roof has to come off.' : 'The wet spots have to be cut out and replaced.' };
    if (Number.isFinite(wet) && wet === 0 && a['Moisture survey performed'] && !/^none/i.test(String(a['Moisture survey performed']))) return { status: 'good', found: `${found} · Dry`, note: null };
  }
  return { status: 'info', found, note: null };
}

/** The exploded-layer drawing for this commercial inspection. */
export function flatRoofAnatomy(insp: InspectionFactsContext | null | undefined, photos: Photo[]): string {
  const a = (insp?.answers ?? {}) as Record<string, any>;
  if (!Object.keys(a).length) return '';
  const layers = existingAssemblyLayers(a);
  if (!layers.length) return '';

  let n = 0;
  const layerParts: AnatomyPart[] = [...layers].reverse().map((l) => {
    const [what, why] = LAYER_TEXT[l.role] ?? ['A layer of the roof.', ''];
    return { id: `layer-${l.role}`, name: l.label.split(' — ')[0].replace(/,.*$/, ''), what, why, ...layerStatus(l, a),
      photos: l.role === 'membrane' ? photosFor(photos, ['membrane_field', 'overview'], /membrane|field|blister|overview/i) : l.role === 'deck' || l.role === 'insulation' ? photosFor(photos, ['core_cut', 'interior'], /core|deck|insulation|underside/i) : [] };
  });
  const parapet = !!a['Parapet walls'] && !/^none/i.test(String(a['Parapet walls']));
  const itemParts: AnatomyPart[] = ITEMS
    .filter((d) => statusFromRating(a[d.field]) || (d.id === 'seams'))
    .filter((d) => d.id !== 'coping' || parapet)
    .map((d) => {
      const extra = d.id === 'drains' && ans(insp, 'Ponding observed') ? ` · Ponding: ${ans(insp, 'Ponding observed')}` : '';
      return { id: d.id, name: d.name, what: d.what, why: d.why, found: a[d.field] ? `Rated ${a[d.field]}${extra}` : null,
        status: statusFromRating(a[d.field]) ?? 'unknown', photos: photosFor(photos, d.scan, d.re) };
    });
  const drawnItems = new Set(['seams', 'edge', 'base-flashing', 'coping', 'drains', 'penetrations', 'hvac', 'walkways', 'skylights']);
  const parts = [...layerParts, ...itemParts].map((p) => ({ ...p, examples: flatExamples(p.id, { membrane: String(a['Membrane type'] ?? '') }) })).map((p) => (p.id.startsWith('layer-') || (drawnItems.has(p.id) && (p.id !== 'base-flashing' || parapet)) ? { ...p, n: ++n } : p));
  const d = drawing(layers, a, parts);
  return anatomyBlock({ svg: d.svg, parts, caption: 'This roof, pulled apart layer by layer, with what sits on top. Tap a number to see that part.' });
}
