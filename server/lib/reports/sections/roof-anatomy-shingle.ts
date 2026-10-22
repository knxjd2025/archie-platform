/**
 * A pitched roof, drawn as a cutaway: the deck at one corner, then the ice &
 * water shield and underlayment, the starter strip and the shingles, with the
 * drip edge, gutter, ridge cap and vent, a pipe boot, and — only when this
 * house has them — a chimney and a skylight.
 *
 * The drawing is generic and brand-free. Manufacturer photos appear only as
 * labelled examples of what a part looks like (anatomy-examples.ts), never as
 * this roof. Each part's status is the inspector's own
 * answer, graded by the same rules as the "Roof Assembly vs. the Standard"
 * table (damage-standards.ts).
 */
import { ASSEMBLY_STANDARDS } from '../damage-standards.js';
import { ans, type InspectionFactsContext } from './inspection-facts.js';
import {
  anatomyBlock, hotspotsSvg, photosMatching, type AnatomyPart, type Hotspot, type PartStatus,
} from './anatomy.js';
import { shingleExamples } from './anatomy-examples.js';

type Photo = { url?: string; caption?: string | null };

/* ------------------------------------------------------------- geometry --- */

// The roof face: eave along y=E, ridge along y=R; both rakes slope in by half
// a unit for every unit of height.
const E = 360;
const R = 120;
const xl = (y: number, d = 0) => 70 + d + (E - y) * 0.5;
const xr = (y: number) => 750 - (E - y) * 0.5;
const face = (d: number, top: number, bot: number) =>
  `${xl(bot, d)},${bot} ${xl(top, d)},${top} ${xr(top)},${top} ${xr(bot)},${bot}`;

function lines(from: number, to: number, step: number, draw: (y: number) => string): string {
  const out: string[] = [];
  for (let y = from; y <= to; y += step) out.push(draw(y));
  return out.join('');
}

interface Drawn { chimney: boolean; skylight: boolean; metal: boolean }

function svg(d: Drawn, spots: Hotspot[]): string {
  const roof = face(0, R, E);
  const covering = d.metal
    ? `<polygon class="anat-layer" data-layer="covering" points="${face(300, R + 4, E - 6)}" fill="url(#anat-metal)"/>`
    : `<polygon class="anat-layer" data-layer="covering" points="${face(300, R + 4, E - 6)}" fill="url(#anat-shingle)"/>`;
  const chimney = d.chimney ? `<g class="anat-layer" data-layer="flashing">
      <rect x="560" y="150" width="54" height="88" fill="url(#anat-brick)" stroke="#6E3B22" stroke-width="1.5"/>
      <rect x="553" y="142" width="68" height="10" rx="2" fill="#7A7F86"/>
      <polygon points="548,236 626,236 632,250 542,250" fill="#C3C9D0" stroke="#8C939B"/>
      <rect x="552" y="160" width="8" height="78" fill="#C3C9D0" stroke="#8C939B"/><rect x="614" y="160" width="8" height="78" fill="#C3C9D0" stroke="#8C939B"/>
    </g>` : '';
  const skylight = d.skylight ? `<g class="anat-layer" data-layer="skylight">
      <polygon points="250,196 318,196 322,240 246,240" fill="#C3C9D0" stroke="#7A7F86" stroke-width="1.5"/>
      <polygon points="256,201 312,201 315,235 253,235" fill="url(#anat-glass)"/>
    </g>` : '';
  return `<svg viewBox="36 70 748 410" role="img" aria-label="A shingle roof cut away to show each layer and part, numbered">
  <defs>
    <clipPath id="anat-roof"><polygon points="${roof}"/></clipPath>
    <pattern id="anat-shingle" width="48" height="36" patternUnits="userSpaceOnUse">
      <rect width="48" height="36" fill="#5B5550"/>
      <rect y="0" width="48" height="17" fill="#6A635D"/><rect y="18" width="48" height="17" fill="#635C56"/>
      <path d="M0 17.5H48M0 35.5H48M12 0V17M36 0V17M0 18V35M24 18V35" stroke="#3E3934" stroke-width="1.2"/>
    </pattern>
    <pattern id="anat-metal" width="40" height="40" patternUnits="userSpaceOnUse">
      <rect width="40" height="40" fill="#5E6B78"/><path d="M0 0V40M20 0V40" stroke="#8796A4" stroke-width="3"/>
    </pattern>
    <pattern id="anat-brick" width="20" height="12" patternUnits="userSpaceOnUse">
      <rect width="20" height="12" fill="#A3532F"/><path d="M0 11.5H20M0 5.5H20M10 0V6M0 6V12" stroke="#7B3A1F" stroke-width="1"/>
    </pattern>
    <linearGradient id="anat-glass" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#BFE0F5"/><stop offset="1" stop-color="#5E9BC4"/></linearGradient>
    <linearGradient id="anat-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#DCEBF7"/><stop offset="1" stop-color="#F6F1E8"/></linearGradient>
  </defs>
  <g aria-hidden="true">
    <rect x="96" y="392" width="628" height="90" fill="#EFE7DA"/>
    <g stroke="#DCCFBC" stroke-width="1.5">${lines(404, 476, 12, (y) => `<line x1="96" y1="${y}" x2="724" y2="${y}"/>`)}</g>
    <rect x="200" y="410" width="70" height="60" fill="#B9D3E6" stroke="#FFFFFF" stroke-width="5"/><rect x="420" y="410" width="70" height="60" fill="#B9D3E6" stroke="#FFFFFF" stroke-width="5"/>
  </g>
  <g clip-path="url(#anat-roof)">
    <polygon class="anat-layer" data-layer="deck" points="${roof}" fill="#D7B98C"/>
    <g stroke="#B08F60" stroke-width="1.2">${lines(R + 30, E, 30, (y) => `<line x1="40" y1="${y}" x2="780" y2="${y}"/>`)}</g>
    <polygon class="anat-layer" data-layer="underlayment" points="${face(70, R, 300)}" fill="#9AA1A9"/>
    <g stroke="#B6BCC3" stroke-width="1">${lines(R + 45, 290, 45, (y) => `<line x1="${xl(y, 70)}" y1="${y}" x2="780" y2="${y}"/>`)}</g>
    <polygon class="anat-layer" data-layer="ice-water" points="${face(70, 300, E)}" fill="#33373D"/>
    <polygon class="anat-layer" data-layer="starter" points="${face(220, E - 18, E)}" fill="#2B2724"/>
    ${covering}
  </g>
  <polygon points="${roof}" fill="none" stroke="#4A4038" stroke-width="2"/>
  <polygon class="anat-layer" data-layer="ridge-vent" points="184,110 636,110 632,127 188,127" fill="#3F3832"/>
  <g stroke="#2A2420" stroke-width="1">${lines(206, 620, 22, (x) => `<line x1="${x}" y1="111" x2="${x}" y2="126"/>`)}</g>
  <g class="anat-layer" data-layer="ridge-vent"><rect x="500" y="127" width="110" height="8" fill="#1F1B18"/>
    <g stroke="#6B625A" stroke-width="1.2">${lines(506, 604, 8, (x) => `<line x1="${x}" y1="128" x2="${x}" y2="134"/>`)}</g></g>
  ${chimney}
  ${skylight}
  <g class="anat-layer" data-layer="pipe-boot">
    <ellipse cx="430" cy="266" rx="26" ry="9" fill="#2F2B28"/><ellipse cx="430" cy="264" rx="22" ry="7" fill="#4B4B4B"/>
    <rect x="421" y="226" width="18" height="38" fill="#E8E8E8" stroke="#A3A3A3"/><ellipse cx="430" cy="226" rx="9" ry="3.2" fill="#BDBDBD"/>
  </g>
  <rect class="anat-layer" data-layer="drip-edge" x="62" y="359" width="696" height="8" fill="#C3C9D0" stroke="#8C939B"/>
  <g class="anat-layer" data-layer="gutter">
    <path d="M56 368H764V384Q764 394 754 394H66Q56 394 56 384Z" fill="#E9ECEF" stroke="#9AA3AD" stroke-width="1.5"/>
    <rect x="728" y="394" width="16" height="62" fill="#E9ECEF" stroke="#9AA3AD" stroke-width="1.5"/>
  </g>
  ${hotspotsSvg(spots)}
</svg>`;
}

/* ---------------------------------------------------------------- parts --- */

function graded(insp: InspectionFactsContext | null | undefined, field: string): { status: PartStatus; found: string | null; note: string | null } {
  const found = ans(insp, field);
  const std = ASSEMBLY_STANDARDS.find((s) => s.field === field);
  if (!found || !std) return { status: 'unknown', found, note: null };
  const g = std.grade(found);
  const status: PartStatus = g.status === 'present' ? 'good' : g.status === 'attention' ? 'attention' : 'unknown';
  return { status, found, note: g.note };
}

const yes = (v: string | null) => !!v && /^yes\b/i.test(v);
const none = (v: string | null) => !v || /^(none|0|no)\b/i.test(v.trim());
const join = (...xs: Array<string | null>) => xs.filter(Boolean).join(' · ') || null;

/** The pitched-roof drawing for this inspection. */
export function shingleRoofAnatomy(insp: InspectionFactsContext | null | undefined, photos: Photo[]): string {
  if (!insp?.answers || !Object.keys(insp.answers).length) return '';
  const pics = (re: RegExp) => photosMatching(photos, re);
  const covering = ans(insp, 'Roof Covering Type');
  const metal = !!covering && /metal/i.test(covering);
  const chimney = ans(insp, 'Chimney');
  const sky = ans(insp, 'Skylights');
  const drawn: Drawn = { chimney: !none(chimney), skylight: !none(sky), metal };

  const wind = ans(insp, 'Wind damage found');
  const hail = ans(insp, 'Hail hits per test square by slope');
  const granules = ans(insp, 'Granule loss or accumulation in gutters and downspouts');
  const softMetal = ans(insp, 'Soft metal hits found');
  const hailFound = !!hail && !/^none\b/i.test(hail) && /\d/.test(hail);
  const coveringStatus: PartStatus = yes(wind) || hailFound ? 'attention' : yes(granules) ? 'fair' : covering ? 'good' : 'unknown';
  const deck = ans(insp, 'Decking type and condition');

  const parts: AnatomyPart[] = [
    { id: 'deck', name: 'Roof deck', what: 'The wood boards or sheets nailed to the rafters. Every other layer sits on it.',
      why: 'If the deck is soft or rotten, nails will not hold and the new roof will not lie flat.',
      found: deck, status: deck ? (/could not/i.test(deck) ? 'unknown' : 'info') : 'unknown',
      note: deck ? 'We see the deck from the attic. Any bad boards are swapped out when the roof is off.' : null, photos: pics(/deck|sheathing|plywood|osb|attic/i) },
    { id: 'ice-water', name: 'Ice & water shield', what: 'A sticky, rubbery sheet at the edges, in the valleys and around pipes.',
      why: 'These are the spots where water backs up first. It seals around every nail.', ...graded(insp, 'Ice and water shield'), photos: pics(/ice|water shield/i) },
    { id: 'underlayment', name: 'Underlayment', what: 'A sheet that covers the whole deck under the shingles.',
      why: 'It is the backup layer. If a shingle blows off, it keeps rain out until we fix it.', ...graded(insp, 'Felt or underlayment type'), photos: pics(/underlay|felt|synthetic/i) },
    { id: 'drip-edge', name: 'Drip edge', what: 'An L-shaped metal strip along the roof edges.',
      why: 'It steers water into the gutter so it does not soak the wood trim.', ...graded(insp, 'Drip edge'), photos: pics(/drip/i) },
    { id: 'starter', name: 'Starter strip', what: 'The first row of glued shingles along the edges.',
      why: 'It seals the bottom row so wind cannot get under the roof.', ...graded(insp, 'Starter course present'), photos: pics(/starter/i) },
    { id: 'covering', name: metal ? 'Metal panels' : 'Shingles', what: metal ? 'The metal sheets you see from the street.' : 'The overlapping pieces you see from the street. They shed rain down the roof.',
      why: 'They take the hits from sun, wind and hail. Damage here is what most claims are about.',
      found: join(covering, ans(insp, 'Shingle type, manufacturer, and any second layer'), ans(insp, 'Number of existing layers') ? `Layers: ${ans(insp, 'Number of existing layers')}` : null, hailFound ? `Hail hits: ${hail}` : null, wind ? `Wind damage: ${wind}` : null, granules ? `Grit loss in gutters: ${granules}` : null),
      status: coveringStatus,
      note: coveringStatus === 'attention' ? 'The inspector recorded storm damage on the roof covering.' : null, photos: pics(/shingle|slope|hail|wind|crease|granule|tab|field|panel/i) },
    { id: 'pipe-boot', name: 'Pipe boots & vents', what: 'Rubber or metal collars that seal around pipes and vents that come through the roof.',
      why: 'The rubber cracks in the sun. A cracked boot is one of the most common leaks.', found: ans(insp, 'Pipe jacks and exhaust caps'),
      status: ans(insp, 'Pipe jacks and exhaust caps') ? 'info' : 'unknown', photos: pics(/pipe|boot|jack|exhaust/i) },
    { id: 'ridge-vent', name: 'Ridge cap & attic vents', what: 'Thick shingles folded over the peak, with vents under them (and under the eaves) that let the attic breathe.',
      why: 'The peak takes the most wind. And a hot, damp attic cooks shingles from below and can grow mold.', found: ans(insp, 'Ventilation types, counts, and plan'),
      status: ans(insp, 'Ventilation types, counts, and plan') ? 'info' : 'unknown', photos: pics(/ridge|vent|turbine|soffit|exhaust fan/i) },
    ...(drawn.chimney ? [{ id: 'flashing', name: 'Chimney & flashing', what: 'Metal pieces that seal where the roof meets a wall or chimney.',
      why: 'Walls and chimneys are where roofs leak most. Good flashing keeps that seam dry.', found: join(chimney, ans(insp, 'Flashings present and condition')),
      status: 'info' as PartStatus, photos: pics(/chimney|flash|cricket|counter|step/i) }] : [
      { id: 'flashing', name: 'Flashing', what: 'Metal pieces that seal where the roof meets a wall.',
        why: 'Walls are where roofs leak most. Good flashing keeps that seam dry.', found: ans(insp, 'Flashings present and condition'),
        status: (ans(insp, 'Flashings present and condition') ? 'info' : 'unknown') as PartStatus, photos: pics(/flash|step|counter|kickout/i) }]),
    ...(drawn.skylight ? [{ id: 'skylight', name: 'Skylights', what: 'Windows in the roof.', why: 'The seal and the flashing kit around a skylight can let water in.',
      found: sky, status: 'info' as PartStatus, photos: pics(/skylight/i) }] : []),
    { id: 'gutter', name: 'Gutters', what: 'The troughs along the edge that carry rain to the downspouts.',
      why: 'Hail dents show up here first, and grit in the gutters tells us how worn the shingles are.',
      found: join(ans(insp, 'Gutters and downspouts'), softMetal ? `Hail dents on metal: ${softMetal}` : null),
      status: yes(softMetal) ? 'attention' : ans(insp, 'Gutters and downspouts') ? 'info' : 'unknown', photos: pics(/gutter|downspout/i) },
    { id: 'valley', name: 'Valleys', what: 'The inside corners where two roof slopes meet.',
      why: 'All the water from both slopes runs through here, so it needs extra protection.', ...graded(insp, 'Valley type'), photos: pics(/valley/i) },
  ];

  const SPOT: Record<string, [number, number]> = {
    deck: [104, 300], 'ice-water': [178, 333], underlayment: [214, 214], 'drip-edge': [120, 382], starter: [312, 351],
    covering: [500, 300], 'pipe-boot': [462, 236], 'ridge-vent': [300, 98],
    flashing: drawn.chimney ? [646, 192] : [690, 240], skylight: [286, 172], gutter: [640, 410],
  };
  let n = 0;
  const numbered = parts
    .map((p) => ({ ...p, examples: shingleExamples(p.id, { metal }) }))
    .map((p) => (SPOT[p.id] && (p.id !== 'flashing' || drawn.chimney) ? { ...p, n: ++n } : p));
  const spots: Hotspot[] = numbered.filter((p) => p.n).map((p) => ({ id: p.id, n: p.n!, x: SPOT[p.id][0], y: SPOT[p.id][1], name: p.name }));

  return anatomyBlock({
    svg: svg(drawn, spots),
    parts: numbered,
    caption: 'An illustration of how a roof like yours is built. Tap a number to see that part.',
  });
}
