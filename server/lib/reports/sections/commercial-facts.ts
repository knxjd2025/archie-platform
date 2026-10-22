/**
 * Commercial (low-slope) report sections, built from the commercial
 * inspection checklist (shared/commercial-inspection-form.ts). Shared by the
 * commercial Inspection (document shell), the commercial Proposal (scroll
 * shell) and the Estimate — the customer is told the same thing everywhere.
 *
 * Every builder returns '' when the checklist has nothing for it, so a
 * caller's section heading is dropped rather than shown over nothing.
 * Citations print only once verified (commercial-standards.ts).
 */
import { esc } from '../report-theme.js';
import { factGrid, type SectionStyle } from './style.js';
import {
  existingAssemblyLayers, conditionItems, reroofDetermination, REROOF_PATH_LABEL,
  type Rating, type ReroofDetermination,
} from '../../../../shared/commercial-inspection-form.js';
import { printableCommercialRefs, COMMERCIAL_CODE_EDITION, type CommercialStandardKey } from '../commercial-standards.js';
import type { InspectionFactsContext } from './inspection-facts.js';
import { ans } from './inspection-facts.js';

export type CommercialContext = InspectionFactsContext & { answers?: Record<string, unknown> | null };

const has = (insp: CommercialContext | null | undefined) => !!insp?.answers && Object.keys(insp.answers).length > 0;
const A = (insp: CommercialContext | null | undefined) => (insp?.answers ?? {}) as Record<string, any>;

function fmtDate(iso: string): string {
  const d = new Date(iso + (iso?.length === 10 ? 'T12:00:00' : ''));
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

/** Citation footnote for a set of standards — '' until any of them is verified. */
export function commercialRefsFootnote(keys: CommercialStandardKey[], className: string): string {
  const refs = printableCommercialRefs(keys);
  if (!refs.length) return '';
  return `<div class="${esc(className)} standards-note" style="margin-top:6px;font-size:11px;line-height:1.5"><b>${esc(COMMERCIAL_CODE_EDITION)} / standards:</b> ${refs.map((r) => `${esc(r.cite)} (${esc(r.title)})`).join('; ')}</div>`;
}

/* ------------------------------------------------------------ building --- */

export function buildingFacts(insp: CommercialContext | null | undefined, measurements: any, style: SectionStyle): string {
  if (!has(insp) && !measurements) return '';
  const a = A(insp);
  const sqft = Number(a['Roof area (sq ft)']);
  const squares = insp?.approxSquares ?? measurements?.squares ?? null;
  const grid = factGrid([
    ['Inspected by', ans(insp, 'Inspector Name')],
    ['Inspection date', ans(insp, 'Inspection Date') ? fmtDate(ans(insp, 'Inspection Date')!) : null],
    ['Inspection type', ans(insp, 'Inspection Type')],
    ['How the roof was accessed', ans(insp, 'How was the roof accessed?')],
    ['Building', ans(insp, 'Building type / use')],
    ['Occupied during work', ans(insp, 'Building occupied during work?')],
    ['Stories', ans(insp, 'Number of stories')],
    ['Roof height', ans(insp, 'Roof height (ft)') ? `${ans(insp, 'Roof height (ft)')} ft` : null],
    ['Roof area', Number.isFinite(sqft) && sqft > 0 ? `${Math.round(sqft).toLocaleString('en-US')} sq ft (${Math.round(sqft / 100)} squares${measurements?.documentName ? `; measured ${measurements.documentName}` : ', field estimate'})` : squares ? `${squares} squares` : null],
    ['Roof sections', ans(insp, 'Number of roof sections / levels')],
    ['Slope', ans(insp, 'Roof slope')],
    ['Parapets', ans(insp, 'Parapet walls')],
    ['Rooftop access', ans(insp, 'Rooftop access')],
  ]);
  return grid;
}

/* ------------------------------------------------------------ assembly --- */

const LAYER_CLASS: Record<string, string> = {
  deck: 'deck', vapor: 'vapor', insulation: 'ins', cover: 'cover', 'older-roof': 'old', membrane: 'mem', surfacing: 'surf',
};

/**
 * What is on the roof today, drawn as the stack the core cut shows: the
 * membrane on top, the deck at the bottom. Unknown layers are drawn hatched
 * — the reason to take a core cut is visible on the page.
 */
export function existingAssembly(insp: CommercialContext | null | undefined, style: SectionStyle, opts: { stack?: boolean } = {}): string {
  if (!has(insp)) return '';
  const a = A(insp);
  const layers = existingAssemblyLayers(a);
  if (!layers.length) return '';
  const top = [...layers].reverse(); // draw membrane first
  const stack = `<div class="cf-stack" role="img" aria-label="The existing roof assembly, top to bottom: ${esc(top.map((l) => l.label).join(', '))}">
    ${top.map((l) => `<div class="cf-layer cf-layer--${LAYER_CLASS[l.role]}${l.unknown ? ' cf-layer--unknown' : ''}"><b>${esc(l.label)}</b>${l.detail ? `<span>${esc(l.detail)}</span>` : ''}</div>`).join('')}
  </div>`;
  const age = ans(insp, 'Estimated age of current roof (years)');
  const count = ans(insp, 'Number of roof systems in place');
  const facts = factGrid([
    ['Roof systems in place', count],
    ['Estimated age', age ? `about ${age} years` : null],
    ['Core cut', ans(insp, 'Core cut taken')],
    ['Manufacturer / warranty on file', ans(insp, 'Manufacturer / warranty on file')],
  ]);
  const core = ans(insp, 'Core cut findings');
  const history = ans(insp, 'Roof history');
  const unknowns = layers.filter((l) => l.unknown).length;
  return `${opts.stack === false ? '' : stack}${facts}
    ${core ? `<p class="${esc(style.body)}"><b>What the core cut showed:</b> ${esc(core)}</p>` : ''}
    ${history ? `<p class="${esc(style.body)}"><b>Roof history:</b> ${esc(history)}</p>` : ''}
    ${unknowns ? `<p class="${esc(style.note)}">${unknowns} layer${unknowns === 1 ? '' : 's'} could not be seen from the top. To know what is under the roof and if it is dry, we cut out a small sample, called a core cut. We do this before any recover or coating, and it is part of our price.</p>` : ''}`;
}

/* ----------------------------------------------------------- condition --- */

const RATING_CLASS: Record<Rating, string> = { Good: 'good', Fair: 'fair', Poor: 'poor', Failed: 'failed', 'N/A': 'na' };

export function conditionTally(insp: CommercialContext | null | undefined): { good: number; fair: number; poor: number; failed: number } {
  const t = { good: 0, fair: 0, poor: 0, failed: 0 };
  for (const c of conditionItems(A(insp))) {
    if (c.rating === 'Good') t.good++; else if (c.rating === 'Fair') t.fair++; else if (c.rating === 'Poor') t.poor++; else if (c.rating === 'Failed') t.failed++;
  }
  return t;
}

/** Every rated component, worst first, with the rating as a chip. */
export function conditionMatrix(insp: CommercialContext | null | undefined, style: SectionStyle): string {
  if (!has(insp)) return '';
  const items = conditionItems(A(insp)).filter((c) => c.rating !== 'N/A');
  if (!items.length) return '';
  const t = conditionTally(insp);
  const rows = items.map((c) => `<tr class="cf-row cf-row--${RATING_CLASS[c.rating]}">
      <td><b>${esc(c.item)}</b>${c.description ? `<div class="${esc(style.note)}">${esc(c.description)}</div>` : ''}</td>
      <td><span class="cf-rating cf-rating--${RATING_CLASS[c.rating]}">${esc(c.rating)}</span></td>
    </tr>`).join('');
  const notes = ans(insp, 'Condition notes by area');
  const edge = A(insp)['Perimeter edge metal (fascia, gravel stop, drip edge)'];
  const edgeNote = edge === 'Poor' || edge === 'Failed'
    ? `<p class="${esc(style.body)}"><b>The edge metal is rated ${esc(edge)}.</b> Rusty or worn-out metal trim cannot be used again when the roof is redone. New edge metal, made to hold up in strong wind, is part of any recover or replacement here.${commercialRefsFootnote(['reinstall-materials', 'edge-metal'], style.note)}</p>`
    : '';
  return `<div class="cf-tally">
      <span class="cf-rating cf-rating--good">${t.good} good</span>
      <span class="cf-rating cf-rating--fair">${t.fair} fair</span>
      <span class="cf-rating cf-rating--poor">${t.poor} poor</span>
      <span class="cf-rating cf-rating--failed">${t.failed} failed</span>
    </div>
    <div class="cf-wrap"><table class="cf-table">
      <thead><tr><th scope="col">Part of the roof &amp; what we check</th><th scope="col">Grade</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    ${notes ? `<p class="${esc(style.body)}"><b>Notes for each area:</b> ${esc(notes)}</p>` : ''}${edgeNote}`;
}

/* -------------------------------------------------------- water & drains --- */

export function drainageAndMoisture(insp: CommercialContext | null | undefined, style: SectionStyle): string {
  if (!has(insp)) return '';
  const wet = ans(insp, 'Estimated wet insulation (% of roof area)');
  const grid = factGrid([
    ['Ponding observed', ans(insp, 'Ponding observed')],
    ['Where it ponds', ans(insp, 'Ponding locations and approximate area')],
    ['Roof drains', ans(insp, 'Number of roof drains')],
    ['Overflow / secondary drainage', ans(insp, 'Overflow / secondary drainage present')],
    ['Drains clear, strainers in place', ans(insp, 'Drains clear with strainers in place')],
    ['Moisture survey', ans(insp, 'Moisture survey performed')],
    ['Wet insulation', wet ? `about ${wet}% of the roof area` : null],
    ['Active leaks reported', ans(insp, 'Active leaks reported by the owner')],
  ]);
  const interior = ans(insp, 'Interior evidence');
  if (!grid && !interior) return '';
  const ponding = ans(insp, 'Ponding observed');
  const pondingWhy = ponding && !/^none/i.test(ponding)
    ? `<p class="${esc(style.body)}"><b>Why ponding matters.</b> If water is still sitting on the roof two days after it rains, it is not draining. It soaks into the seams. It adds weight the building was not built to hold. And roof makers will not cover damage from it under the warranty. The fix is to give the roof more slope, with sloped insulation or more drains. We build that into the new roof from the start.${commercialRefsFootnote(['ponding-definition', 'min-slope', 'secondary-drainage'], style.note)}</p>`
    : '';
  const survey = ans(insp, 'Moisture survey performed');
  const surveyWhy = survey && /^none/i.test(survey)
    ? `<p class="${esc(style.body)}"><b>The next step is a moisture survey.</b> From the top, wet insulation looks just like dry insulation. A heat camera scan at night, or a few small core cuts, shows where water got in. That tells us if a new roof can go on top, or if the old one has to come off.${commercialRefsFootnote(['moisture-survey', 'coating-candidacy'], style.note)}</p>`
    : '';
  return `${grid}${interior ? `<p class="${esc(style.body)}"><b>Inside the building:</b> ${esc(interior)}</p>` : ''}${pondingWhy}${surveyWhy}`;
}

/* ---------------------------------------------------------------- claim --- */

export function claimEvidence(insp: CommercialContext | null | undefined, style: SectionStyle): string {
  if (!has(insp)) return '';
  const stormDate = ans(insp, 'Storm Date');
  const stormType = ans(insp, 'Storm Type');
  const grid = factGrid([
    ['Storm documented', stormDate ? `${fmtDate(stormDate)}${stormType ? ` — ${stormType}` : ''}` : null],
    ['Hail impact evidence', ans(insp, 'Hail impact evidence on membrane or equipment')],
    ['Wind damage', ans(insp, 'Wind damage (uplift, peeled edges, displaced ballast)')],
    ['Punctures / mechanical damage', ans(insp, 'Punctures or mechanical damage')],
  ]);
  void style;
  return grid;
}

/* ----------------------------------------------------------- the fix ---- */

const PATH_CLASS: Record<ReroofDetermination['path'], string> = { restore: 'restore', recover: 'recover', replace: 'replace', undetermined: 'open' };

/**
 * Restore, recover, or replace — the decision, the reasons, and what is
 * still open. The reviewer's recommendation (when set) is shown alongside
 * the checklist-derived one; when they disagree the report says so rather
 * than hiding it.
 */
export function reroofPath(insp: CommercialContext | null | undefined, style: SectionStyle): { html: string; determination: ReroofDetermination | null } {
  if (!has(insp)) return { html: '', determination: null };
  const d = reroofDetermination(A(insp));
  const reviewer = insp?.recommendation ?? null;
  const reasons = d.reasons.map((r) => `<li>${esc(r.text)}${r.code ? ` <span class="cf-code">building code</span>` : ''}</li>`).join('');
  const open = d.openQuestions.length
    ? `<p class="${esc(style.body)}" style="margin-top:10px"><b>What we still need to check before the price is final:</b></p><ul class="cf-list">${d.openQuestions.map((q) => `<li>${esc(q)}</li>`).join('')}</ul>`
    : '';
  const cites = commercialRefsFootnote(d.path === 'restore' ? ['coating-candidacy'] : d.reasons.some((r) => r.code) ? ['recover-limits', 'reroof-flashing', 'reinstall-materials'] : ['recover-limits'], style.note);
  return {
    determination: d,
    html: `<div class="cf-path cf-path--${PATH_CLASS[d.path]}">
      <span class="cf-path-label">What this roof needs</span>
      <b class="cf-path-name">${esc(REROOF_PATH_LABEL[d.path])}</b>
      ${reviewer ? `<span class="cf-path-reviewer">Reviewed recommendation: ${esc(reviewer)}</span>` : ''}
    </div>
    <ul class="cf-list">${reasons}</ul>
    ${cites}
    ${open}
    <p class="${esc(style.note)}">How we decide: The building code lets a new roof go on top of only one old roof, and never over one that is wet or falling apart. A coating only works on a roof that is still strong and dry. Our advice comes from what we found on your roof &mdash; not from what we would like to sell.</p>`,
  };
}

/* ---------------------------------------------------------- energy code --- */

/**
 * Insulation and the energy code, for a tear-off. In North Carolina a
 * like-for-like replacement that leaves the building "no less conforming" is
 * exempt from the alteration provisions (NC amends C503.1; the model code's
 * roof-replacement trigger is not adopted), and Group F/S/U buildings are
 * outside the energy code entirely — so the upgrade is the company's recommendation,
 * and the report says so. Numbers print only once the table is verified.
 */
export function energyCodeNote(insp: CommercialContext | null | undefined, iso: { label: string } | null | undefined, style: SectionStyle): string {
  if (!has(insp)) return '';
  const d = reroofDetermination(A(insp));
  if (d.path !== 'replace') return '';
  const building = ans(insp, 'Building type / use') || '';
  const fsu = /warehouse|industrial/i.test(building);
  return `<p class="${esc(style.body)}"><b>Insulation and your energy bill.</b> When the old roof comes off, it is the best time to add more insulation. You only pay for the labor once. North Carolina does not make you add more when you replace a roof the same way. Still, we think it is worth it, because more insulation means lower heating and cooling bills${fsu ? '. (A warehouse or factory does not have to meet the energy code at all.)' : '.'}${iso ? ` This proposal includes <b>${esc(iso.label)}</b> in the tear-off options.` : ''}${commercialRefsFootnote(['energy-r-value', 'energy-reroof', 'energy-cool-roof', ...(fsu ? ['energy-exempt-fsu' as const] : [])], style.note)}</p>`;
}

/* --------------------------------------------------------------- safety --- */

export function safetyAndAccess(insp: CommercialContext | null | undefined, style: SectionStyle): string {
  if (!has(insp)) return '';
  const grid = factGrid([
    ['Fall protection on the roof', ans(insp, 'Fall protection present')],
    ['Rooftop access', ans(insp, 'Rooftop access')],
  ]);
  const hazards = ans(insp, 'Rooftop hazards');
  const staging = ans(insp, 'Access and staging notes');
  if (!grid && !hazards && !staging) return '';
  return `${grid}${hazards ? `<p class="${esc(style.body)}"><b>Hazards noted:</b> ${esc(hazards)}</p>` : ''}${staging ? `<p class="${esc(style.body)}"><b>Access and staging:</b> ${esc(staging)}</p>` : ''}${commercialRefsFootnote(['fall-protection'], style.note)}`;
}

/* ---------------------------------------------------------- maintenance --- */

/** The maintenance program every membrane manufacturer expects — and that keeps their warranty in force. */
export function maintenancePlan(style: SectionStyle): string {
  const items = [
    ['Twice a year, and after big storms', 'Someone walks the whole roof in spring and fall, and after hail or strong wind. They check the roof, the seams, the edges and every drain.'],
    ['Keep the drains clear', 'Clean leaves and trash off the drains. A blocked drain makes a pond, and a pond is the fastest way to a leak. It can also cancel your warranty.'],
    ['Walk only on the walk pads', 'Put pads on every path to the rooftop units. Workers and dropped tools poke more holes in roofs than storms do.'],
    ['Fix small problems fast', 'A small open seam takes one hour to fix this month. Left alone, it can mean new insulation next year.'],
    ['Keep a written record', 'Write down each visit and take photos. Keep them with your warranty. The roof maker will ask for them if you make a claim.'],
  ];
  return `<div class="cf-maint">${items.map(([t, d]) => `<div class="cf-maint-item"><b>${esc(t)}</b><span>${d}</span></div>`).join('')}</div>
    <p class="${esc(style.note)}">Roof makers only keep their warranty if the roof is cared for like this. A roof that is never checked can lose its warranty.${commercialRefsFootnote(['maintenance-required'], style.note)}</p>`;
}

/* ---------------------------------------------------------- service life --- */

/** Where this roof is in its life — qualitative until the service-life reference is verified. */
export function serviceLifeContext(insp: CommercialContext | null | undefined, style: SectionStyle): string {
  if (!has(insp)) return '';
  const mem = ans(insp, 'Membrane type');
  const age = ans(insp, 'Estimated age of current roof (years)');
  if (!mem || /unknown/i.test(mem)) return '';
  const refs = printableCommercialRefs(['service-life']);
  return `<p class="${esc(style.body)}"><b>How much life is left.</b> This is a ${esc(mem)} roof${age ? `, about ${esc(age)} years old` : ''}. How long a roof lasts depends more on drainage, seams and care than on its age. The grades above tell you more about how much life is left than the age does.${refs.length ? ` <span class="${esc(style.note)}">${refs.map((r) => `${esc(r.cite)} — ${esc(r.title)}`).join('; ')}</span>` : ''}</p>`;
}

/* ------------------------------------------------------------------- css --- */

export const COMMERCIAL_FACTS_CSS = `
.cf-stack { display: grid; gap: 4px; margin: 14px 0; max-width: 560px; }
.cf-layer { display: flex; flex-direction: column; padding: 10px 14px; border-radius: 8px; border: 1px solid var(--line, #e5e7eb); font-size: 13px; }
.cf-layer b { font-weight: 600; }
.cf-layer span { font-size: 11px; opacity: .8; margin-top: 2px; }
.cf-layer--mem { background: #e8f1fb; border-color: #b9d2ee; }
.cf-layer--surf { background: #f1efe9; }
.cf-layer--old { background: #f8e8e8; border-color: #e5b9b9; }
.cf-layer--cover { background: #f6f1e7; }
.cf-layer--ins { background: #fff4d6; border-color: #f2dc9a; min-height: 52px; justify-content: center; }
.cf-layer--vapor { background: #eeeeee; }
.cf-layer--deck { background: #dfe3e8; border-color: #b8c0cc; }
.cf-layer--unknown { background: repeating-linear-gradient(135deg, #f7f7f7 0 8px, #ececec 8px 16px); border-style: dashed; }
.cf-tally { display: flex; flex-wrap: wrap; gap: 6px; margin: 10px 0 4px; }
.cf-wrap { overflow-x: auto; margin-top: 10px; }
.cf-table { width: 100%; border-collapse: collapse; font-size: 14px; }
.cf-table th, .cf-table td { text-align: left; vertical-align: top; padding: 9px 12px; border-bottom: 1px solid var(--line, #e5e7eb); }
.cf-table th { font-size: 11px; letter-spacing: .06em; text-transform: uppercase; color: var(--muted, #6b7280); }
.cf-rating { display: inline-block; padding: 2px 9px; border-radius: 999px; font-size: 11px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; white-space: nowrap; }
.cf-rating--good { background: #D1FAE5; color: #065F46; }
.cf-rating--fair { background: #FEF3C7; color: #92400E; }
.cf-rating--poor { background: #FFEDD5; color: #9A3412; }
.cf-rating--failed { background: #FEE2E2; color: #991B1B; }
.cf-rating--na { background: #F3F4F6; color: #6B7280; }
.cf-path { border-radius: 12px; padding: 14px 18px; margin: 12px 0; display: flex; flex-direction: column; gap: 4px; }
.cf-path--restore { background: #ECFDF5; border: 1px solid #A7F3D0; }
.cf-path--recover { background: #FFFBEB; border: 1px solid #FDE68A; }
.cf-path--replace { background: #FEF2F2; border: 1px solid #FECACA; }
.cf-path--open { background: #F3F4F6; border: 1px dashed #D1D5DB; }
.cf-path-label { font-size: 11px; letter-spacing: .06em; text-transform: uppercase; opacity: .7; }
.cf-path-name { font-size: 18px; font-weight: 700; }
.cf-path-reviewer { font-size: 12px; opacity: .8; }
.cf-list { margin: 8px 0 0; padding-left: 20px; line-height: 1.6; font-size: 14px; }
.cf-code { display: inline-block; margin-left: 6px; padding: 1px 7px; border-radius: 999px; font-size: 10px; letter-spacing: .05em; text-transform: uppercase; background: #E0E7FF; color: #3730A3; }
.cf-maint { display: grid; gap: 10px; margin-top: 8px; }
.cf-maint-item b { display: block; font-size: 14px; }
.cf-maint-item span { display: block; font-size: 13px; opacity: .85; line-height: 1.5; }
`;
