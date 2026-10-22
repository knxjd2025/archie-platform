/**
 * The rep's on-site checklist (shared/inspection-form.ts), rendered for a
 * customer document — and, for the roof assembly, graded against what the
 * standard calls for (damage-standards.ts).
 *
 * The Presentation already showed the checklist; the Inspection — the
 * document the adjuster reads — did not. These builders are what the
 * Inspection now prints. Pure functions: `(context, style) => fragment`,
 * '' when there is nothing to show.
 */
import { esc } from '../report-theme.js';
import { factGrid, type SectionStyle } from './style.js';
import { ASSEMBLY_STANDARDS, VENTILATION_STANDARD, renderRefsFootnote, type AssemblyStatus } from '../damage-standards.js';
import { INSPECTION_FORM_FIELDS } from '../../../../shared/inspection-form';
import { COMMERCIAL_INSPECTION_FIELDS } from '../../../../shared/commercial-inspection-form';

export interface InspectionFactsContext {
  inspectionType?: string | null;
  recommendation?: string | null;
  damageSummary?: string | null;
  approxSquares?: number | null;
  answers?: Record<string, unknown> | null;
}

export function ans(insp: InspectionFactsContext | null | undefined, field: string): string | null {
  const v = insp?.answers?.[field];
  if (v === undefined || v === null) return null;
  const s = Array.isArray(v) ? v.join(', ') : String(v).trim();
  return s && s.toLowerCase() !== 'n/a' ? s : null;
}

function fmtDate(iso: string): string {
  const d = new Date(iso + (iso?.length === 10 ? 'T12:00:00' : ''));
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

/** Never printed: a signature image is not a fact about the roof. */
const CHECKLIST_HIDDEN = new Set(['Inspector Signature']);

/**
 * Every answer the inspector recorded, in the order and grouping of the
 * checklist itself. The curated sections above pick and phrase; this one
 * guarantees nothing the inspector wrote is left off the document — the
 * long answers (gutters, ground view, flashings, attic notes, the damage
 * summary) print in full, not trimmed into a grid cell.
 */
export function fullChecklist(insp: InspectionFactsContext | null | undefined, style: SectionStyle): string {
  const a = (insp?.answers ?? null) as Record<string, unknown> | null;
  if (!a) return '';
  const commercial = (a as any).__formKind === 'commercial' || a['Membrane type'] != null || a['Roof area (sq ft)'] != null;
  const fields = commercial ? COMMERCIAL_INSPECTION_FIELDS : INSPECTION_FORM_FIELDS;
  const sections: string[] = [];
  const order = Array.from(new Set(fields.map((f) => f.section)));
  for (const sec of order) {
    const rows: Array<[string, string | null]> = [];
    const long: string[] = [];
    for (const f of fields.filter((x) => x.section === sec)) {
      if (CHECKLIST_HIDDEN.has(f.name)) continue;
      const v = ans(insp, f.name);
      if (!v) continue;
      const shown = f.type === 'date' ? fmtDate(v) : v;
      if (f.type === 'longString' && (shown.length > 60 || shown.includes('\n'))) {
        long.push(`<div class="${esc(style.body)}" style="margin:10px 0 0"><b>${esc(f.name)}.</b> <span style="white-space:pre-wrap">${esc(shown)}</span></div>`);
      } else {
        rows.push([f.name, shown]);
      }
    }
    if (!rows.length && !long.length) continue;
    sections.push(`<h3 style="margin:18px 0 8px;font-size:15px">${esc(sec)}</h3>${factGrid(rows)}${long.join('')}`);
  }
  return sections.join('');
}

/** Who inspected, when, how, and what the roof is. */
export function inspectionDetails(insp: InspectionFactsContext | null | undefined, measurements: any, style: SectionStyle): string {
  if (!insp && !measurements) return '';
  const date = ans(insp, 'Inspection Date');
  const squares = insp?.approxSquares ?? measurements?.squares ?? null;
  const ft = (n: unknown) => (Number(n) > 0 ? `${Math.round(Number(n))} ft` : null);
  const grid = factGrid([
    ['Inspected by', ans(insp, 'Inspector Name')],
    ['Inspection date', date ? fmtDate(date) : null],
    ['Inspection type', ans(insp, 'Inspection Type')],
    ['How the roof was accessed', ans(insp, 'How was the roof accessed?')],
    ['Stories', ans(insp, 'Number of Stories')],
    ['Roof covering', ans(insp, 'Roof Covering Type')],
    ['Average pitch', ans(insp, 'Average pitch across ALL slopes') ?? (measurements?.predominantPitch ? String(measurements.predominantPitch) : null)],
    ['Existing layers', ans(insp, 'Number of existing layers')],
    ['Roof size', squares ? `${squares} squares${measurements?.documentName ? ` (measured, ${measurements.documentName})` : ' (field estimate)'}` : null],
    ['Facets', measurements?.facets ? String(measurements.facets) : null],
    ['Ridges & hips', ft(measurements?.ridgesHipsFt)],
    ['Valleys', ft(measurements?.valleysFt)],
    ['Eaves', ft(measurements?.eavesFt)],
    ['Rakes', ft(measurements?.rakesFt)],
  ]);
  const shingle = ans(insp, 'Shingle type, manufacturer, and any second layer');
  if (!grid && !shingle) return '';
  return `${grid}${shingle ? `<p class="${esc(style.body)}"><b>What is on the roof:</b> ${esc(shingle)}</p>` : ''}`;
}

/** Collateral damage on the ground — what an adjuster looks for alongside the roof. */
export function groundExterior(insp: InspectionFactsContext | null | undefined, style: SectionStyle): string {
  const gutters = ans(insp, 'Gutters and downspouts');
  const siding = ans(insp, 'Siding damage');
  const otherExt = ans(insp, 'Other exterior damage - windows, fencing, garage doors, AC units');
  const notes = ans(insp, 'Ground view notes');
  if (!gutters && !siding && !otherExt && !notes) return '';
  return `${factGrid([
    ['Gutters & downspouts', gutters],
    ['Siding damage found', siding],
    ['Other exterior damage', otherExt],
  ])}${notes ? `<p class="${esc(style.body)}"><b>Ground notes:</b> ${esc(notes)}</p>` : ''}`;
}

/** Test-square counts and the other things the adjuster will argue about. */
export function damageDetail(insp: InspectionFactsContext | null | undefined, style: SectionStyle): string {
  const hail = ans(insp, 'Hail hits per test square by slope');
  const wind = ans(insp, 'Wind damage found');
  const softMetal = ans(insp, 'Soft metal hits found');
  const granule = ans(insp, 'Granule loss or accumulation in gutters and downspouts');
  const matching = ans(insp, 'Is shingle matching possible?');
  const stormDate = ans(insp, 'Storm Date');
  const stormType = ans(insp, 'Storm Type');
  if (!hail && !wind && !softMetal && !matching && !granule) return '';
  return `${hail ? `<p class="${esc(style.body)}"><b>Hail hits per test square, by slope:</b> ${esc(hail)}</p>` : ''}${factGrid([
    ['Storm documented', stormDate ? `${fmtDate(stormDate)}${stormType ? ` — ${stormType}` : ''}` : null],
    ['Wind damage found', wind],
    ['Soft-metal hits (AC fins, gutters, vents, flashing)', softMetal],
    ['Granule loss in gutters / downspouts', granule],
    ['Shingle matching still possible?', matching],
  ])}`;
}

/** Leaks, decking, and what the attic showed. */
export function atticInterior(insp: InspectionFactsContext | null | undefined, style: SectionStyle): string {
  const leaks = ans(insp, 'Leaks or water damage in the attic or interior');
  const decking = ans(insp, 'Decking type and condition');
  const notes = ans(insp, 'Attic and interior notes');
  if (!leaks && !decking && !notes) return '';
  return `${factGrid([['Leaks / water damage found', leaks], ['Decking type & condition', decking]])}${notes ? `<p class="${esc(style.body)}"><b>Attic notes:</b> ${esc(notes)}</p>` : ''}`;
}

const STATUS_LABEL: Record<AssemblyStatus, string> = { present: 'In place', attention: 'Needs attention', unknown: 'Not verified' };

/**
 * The roof assembly, component by component: what we found, what the
 * standard calls for, and a grade. Citations print only once verified.
 */
export function assemblyAgainstStandard(insp: InspectionFactsContext | null | undefined, style: SectionStyle): { html: string; attention: number } {
  const rows: string[] = [];
  let attention = 0;
  for (const s of ASSEMBLY_STANDARDS) {
    const answer = ans(insp, s.field);
    if (!answer) continue;
    const g = s.grade(answer);
    if (g.status === 'attention') attention += 1;
    rows.push(`<tr class="asm asm--${g.status}">
      <td><b>${esc(s.label)}</b><div class="${esc(style.note)}">${esc(s.standardText)}</div>${renderRefsFootnote(s, style.note)}</td>
      <td>${esc(answer)}</td>
      <td><span class="asm-status asm-status--${g.status}">${STATUS_LABEL[g.status]}</span><div class="${esc(style.note)}">${esc(g.note)}</div></td>
    </tr>`);
  }
  // Free-text components: shown, not graded.
  const extras: Array<[string, string | null]> = [
    ['Flashings', ans(insp, 'Flashings present and condition')],
    ['Chimney', ans(insp, 'Chimney')],
    ['Skylights', ans(insp, 'Skylights')],
    ['Pipe jacks & exhaust caps', ans(insp, 'Pipe jacks and exhaust caps')],
    ['Soffit & cornice', ans(insp, 'Soffit overhang depth and cornice returns')],
    ['Solar panels', ans(insp, 'Solar panels - how many')],
  ];
  for (const [label, v] of extras) {
    if (!v || /^(none|0)$/i.test(v)) continue;
    rows.push(`<tr class="asm"><td><b>${esc(label)}</b></td><td colspan="2">${esc(v)}</td></tr>`);
  }
  if (!rows.length) return { html: '', attention: 0 };
  return {
    attention,
    html: `<div class="asm-wrap"><table class="asm-table">
      <thead><tr><th scope="col">Component &amp; what the standard calls for</th><th scope="col">What we found</th><th scope="col">Assessment</th></tr></thead>
      <tbody>${rows.join('')}</tbody>
    </table></div>`,
  };
}

/**
 * Required net free vent area from roof size and pitch. The attic floor is
 * estimated from the roof area and the average pitch (floor ≈ roof area ÷
 * √(1 + (rise/12)²)); the number is a guide for the ventilation plan, not a
 * measurement.
 */
export function ventilationRequirement(squares: number | null | undefined, pitch: string | null | undefined): { floorSqFt: number; nfa150SqIn: number; nfa300SqIn: number; pitchUsed: string } | null {
  if (!(Number(squares) > 0)) return null;
  const roofSqFt = Number(squares) * 100;
  const m = String(pitch ?? '').match(/(\d+(?:\.\d+)?)\s*[/:]\s*12/);
  const rise = m ? Number(m[1]) : 6; // 6/12 when the pitch was not recorded
  const floorSqFt = Math.round(roofSqFt / Math.sqrt(1 + (rise / 12) ** 2));
  return {
    floorSqFt,
    nfa150SqIn: Math.round((floorSqFt / 150) * 144),
    nfa300SqIn: Math.round((floorSqFt / 300) * 144),
    pitchUsed: m ? `${m[1]}/12` : '6/12 (assumed)',
  };
}

export function ventilation(insp: InspectionFactsContext | null | undefined, squares: number | null | undefined, style: SectionStyle): string {
  const plan = ans(insp, 'Ventilation types, counts, and plan');
  const req = ventilationRequirement(squares, ans(insp, 'Average pitch across ALL slopes'));
  if (!plan && !req) return '';
  return `<p class="${esc(style.body)}">${esc(VENTILATION_STANDARD.standardText)}</p>
    ${req ? factGrid([
      ['Attic floor (estimated)', `${req.floorSqFt.toLocaleString('en-US')} sq ft, from ${squares} squares at ${req.pitchUsed}`],
      ['Vent area needed, 1/150 rule', `${req.nfa150SqIn.toLocaleString('en-US')} sq in net free area`],
      ['Vent area needed, balanced 1/300', `${req.nfa300SqIn.toLocaleString('en-US')} sq in, split roughly half intake / half exhaust`],
    ]) : ''}
    ${plan ? `<p class="${esc(style.body)}"><b>What is on the roof now, and the plan:</b> ${esc(plan)}</p>` : ''}
    ${renderRefsFootnote(VENTILATION_STANDARD, style.note)}`;
}

/** Only the components that need attention, as a short list — what a new roof corrects, or what a repair leaves for later. */
export function assemblyAttentionList(insp: InspectionFactsContext | null | undefined, style: SectionStyle): { html: string; count: number } {
  const items: string[] = [];
  for (const s of ASSEMBLY_STANDARDS) {
    const answer = ans(insp, s.field);
    if (!answer) continue;
    const g = s.grade(answer);
    if (g.status !== 'attention') continue;
    items.push(`<li><b>${esc(s.label)}:</b> ${esc(g.note)}${renderRefsFootnote(s, style.note)}</li>`);
  }
  if (!items.length) return { html: '', count: 0 };
  return { count: items.length, html: `<ul class="asm-attention" style="line-height:1.7;padding-left:20px">${items.join('')}</ul>` };
}

/** Where the roof size came from: the measurement report's numbers when one was on the job. */
export function measuredRoofFacts(report: any, style: SectionStyle): string {
  const m = report?.measurements;
  const squares = report?.roofDetails?.squares ?? m?.squares ?? null;
  if (!m && !squares) return '';
  const ft = (n: unknown) => (Number(n) > 0 ? `${Math.round(Number(n))} ft` : null);
  const grid = factGrid([
    ['Roof size', squares ? `${squares} squares` : null],
    ['Pitch', m?.predominantPitch ? String(m.predominantPitch) : (report?.roofDetails?.pitch ? String(report.roofDetails.pitch) : null)],
    ['Facets', m?.facets ? String(m.facets) : null],
    ['Ridges & hips', ft(m?.ridgesHipsFt)],
    ['Valleys', ft(m?.valleysFt)],
    ['Eaves', ft(m?.eavesFt)],
    ['Rakes', ft(m?.rakesFt)],
  ]);
  if (!grid) return '';
  const source = m?.documentName ? `Measured from ${esc(String(m.documentName))}` : 'From the on-site inspection';
  return `<p class="${esc(style.note)}" style="margin-top:12px"><b>Your roof, measured</b> &middot; ${source}</p>${grid}`;
}

/** The engine's age estimate — retail jobs only; a claim document never editorialises about age. */
export function roofAge(report: any, style: SectionStyle): string {
  const a = report?.damageAnalysis?.roofAge;
  if (!a || a.estimatedAgeYears == null) return '';
  const grid = factGrid([
    ['Estimated age', `about ${a.estimatedAgeYears} years`],
    ['Typical lifespan for this material', a.expectedLifespanYears ? `${a.expectedLifespanYears} years` : null],
    ['Estimated remaining life', a.remainingLifeYears != null ? `about ${Math.max(0, a.remainingLifeYears)} years` : null],
    ['Confidence', a.confidence ? String(a.confidence) : null],
  ]);
  const why = Array.isArray(a.indicators) && a.indicators.length ? `<p class="${esc(style.note)}">Based on: ${esc(a.indicators.slice(0, 4).join('; '))}.</p>` : '';
  return `${grid}${why}`;
}

export const INSPECTION_FACTS_CSS = `
.asm-wrap { overflow-x: auto; margin-top: 12px; }
.asm-table { width: 100%; border-collapse: collapse; font-size: 14px; }
.asm-table th, .asm-table td { text-align: left; vertical-align: top; padding: 10px 12px; border-bottom: 1px solid var(--line, #e5e7eb); }
.asm-table th { font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted, #6b7280); }
.asm-status { display: inline-block; padding: 2px 9px; border-radius: 999px; font-size: 11px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; }
.asm-status--present { background: #D1FAE5; color: #065F46; }
.asm-status--attention { background: #FFEDD5; color: #9A3412; }
.asm-status--unknown { background: #F3F4F6; color: #6B7280; }
.storm-evidence { margin-top: 14px; }
`;
