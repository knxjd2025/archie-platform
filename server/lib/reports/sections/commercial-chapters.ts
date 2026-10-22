/**
 * The chapters only a commercial Proposal and Presentation carry, written
 * once and used by both (render-commercial-proposal.ts,
 * render-commercial-presentation.ts):
 *
 *   - the live layer diagram (what comes off, what stays, what goes on)
 *   - the photo evidence, with what the photo scan read in each picture
 *   - the full photo list, at the end of the document
 *   - company information
 *   - what the price includes
 *   - what is settled before the first day of work — the Certificate of
 *     Insurance and W-9, and the permits
 *   - the inspection record, every answer the inspector wrote down
 *   - chapters the rep adds themselves, and notes the rep pins to a chapter
 *
 * Every chapter is a whole <section> with a `Chapter {{CH}}` label, the
 * Proposal's numbering convention; the Presentation converts the token with
 * asNumbered() so its own renumbering picks the chapter up.
 */
import { esc } from '../report-theme.js';
import { SCROLL_STYLE, factGrid } from './style.js';
import { narrativeHtml } from './narrative.js';
import { fullChecklist, ans, type InspectionFactsContext } from './inspection-facts.js';
import { claimEvidence, safetyAndAccess, conditionTally } from './commercial-facts.js';
import { stormEvidence } from './storm-evidence.js';
import { assemblyDiagramHtml, type AssemblyEdits, type TierKey } from './assembly-diagram.js';
import {
  SCAN_COMPONENTS, SCAN_COMPONENT_LABEL, SCAN_COMPONENT_RATING_FIELD, type ScanComponent,
} from '../commercial-photo-scan.js';
import { commercialIncludes } from '../commercial-products.js';
import { companyBrand } from '../company-brand.js';
import { warrantyFor } from '../product-warranty.js';
import type { TierPricing } from '../roofing-products.js';
import type { ReportSection } from '../layout.js';

type Pricing = { good: TierPricing; better: TierPricing; best: TierPricing };

/** The Presentation numbers chapters with digits and renumbers them after a reorder. */
export const asNumbered = (html: string): string => html.replace('Chapter {{CH}}', 'Chapter 0');

/** Text a rep typed can never be read as the chapter-number token. */
const noToken = (html: string): string => html.replace(/\{\{/g, '&#123;&#123;');

/** A commercial document is never shorter than this many chapters. */
export const COMMERCIAL_MIN_CHAPTERS = 10;

/* ---------------------------------------------------------------- layers --- */

export function chapterLayers(answers: Record<string, any> | null | undefined, pricing: Pricing, startingTier: TierKey, edits?: AssemblyEdits | null): string {
  if (!answers) return '';
  const diagram = assemblyDiagramHtml({ answers, pricing, startingTier, edits });
  if (!diagram) return '';
  return `<section data-sc-act="pin" data-sc-span="2.8" class="ch ch--paper" id="ch-layers">
    <div data-sc-stage class="asm-stage">
      <div class="sc-wrap asm-shell">
        <header class="asm-head">
          <p class="sc-label">Chapter {{CH}}</p>
          <h2 class="sc-display sc-display--md">What Comes Off, What Stays, What Goes On</h2>
          <div class="asm-caps">
            <p class="sc-body" data-sc-cue="0 0.5 0">This is your roof today, one layer at a time. Keep scrolling to see what happens to each layer.</p>
            <p class="sc-body" data-sc-cue="0.44 1 0.15 0.04">Then you see the new roof, built on top of what stays. Tap any layer to learn what it is.</p>
          </div>
        </header>
        ${diagram}
      </div>
    </div>
  </section>`;
}

/* -------------------------------------------------------------- evidence --- */

const CONDITION_LABEL: Record<string, string> = { good: 'Good', fair: 'Fair', poor: 'Poor', failed: 'Failed' };
const SEV_RANK: Record<string, number> = { none: 0, low: 1, medium: 2, high: 3, critical: 4 };

function photoCard(p: any, insp: InspectionFactsContext | null): string {
  const component = (SCAN_COMPONENTS as readonly string[]).includes(p.component) ? (p.component as ScanComponent) : null;
  const ratingField = component ? SCAN_COMPONENT_RATING_FIELD[component] : undefined;
  const rated = ratingField ? ans(insp, ratingField) : null;
  const findings: any[] = p.damages ?? [];
  const body = findings.map((d) => `<p class="ev-find"><b>${esc(d.label || '')}</b>${d.description ? ` ${esc(d.description)}` : ''}</p>`).join('');
  const chip = p.scanned && CONDITION_LABEL[p.condition] ? `<span class="cf-rating cf-rating--${esc(p.condition)}">${CONDITION_LABEL[p.condition]} in this photo</span>` : '';
  return `<figure class="ev-card">
      <img src="${esc(p.url)}" alt="${esc(p.caption || 'Inspection photo')}" loading="lazy">
      <figcaption>
        ${p.caption ? `<b class="ev-cap">${esc(p.caption)}</b>` : ''}
        ${chip}
        ${body}
        ${rated ? `<p class="ev-rated">Inspector's rating for ${esc(SCAN_COMPONENT_LABEL[component!].toLowerCase())}: <b>${esc(rated)}</b></p>` : ''}
      </figcaption>
    </figure>`;
}

/** Past this many, unscanned photos print as a compact strip rather than a card each. */
const AS_TAKEN_CARDS = 24;

/**
 * `described` is the photos the scan read, by part of the roof — the evidence.
 * `rest` is every other photo on the job — the full list, which prints at the
 * end of the document so the evidence is not buried in it.
 */
interface EvidenceGroups { described: string; rest: string; photos: number; appendix: number; scanned: number; issues: number }

/**
 * The photos, grouped by the part of the roof they show, with what the scan
 * read in each one beside the inspector's own rating for that part. Photos
 * the scan did not read print as taken, captioned as the inspector captioned
 * them — never with a label nobody wrote. Shared by the scroll documents and
 * the Inspection.
 */
function evidenceGroups(report: any, insp: InspectionFactsContext | null): EvidenceGroups {
  const photos: any[] = report?.damageAnalysis?.photos ?? [];
  const appendix: any[] = Array.isArray(report?.appendixPhotos) ? report.appendixPhotos : [];
  const scanned = photos.filter((p) => p.scanned);
  const groups = new Map<string, any[]>();
  for (const p of scanned) {
    const key = (SCAN_COMPONENTS as readonly string[]).includes(p.component) ? p.component : 'other';
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }
  const worst = (list: any[]) => Math.max(0, ...list.map((p) => SEV_RANK[p.overallSeverity] ?? 0));
  const ordered = [...groups.entries()].sort(([ka, a], [kb, b]) => {
    if (ka === 'other' || kb === 'other') return ka === 'other' ? 1 : -1;
    return worst(b) - worst(a) || SCAN_COMPONENTS.indexOf(ka as ScanComponent) - SCAN_COMPONENTS.indexOf(kb as ScanComponent);
  });
  const groupHtml = ordered.map(([key, list]) => `<div class="ev-group">
      <h3 class="ev-h">${esc(SCAN_COMPONENT_LABEL[key as ScanComponent])} <span>${list.length} photo${list.length === 1 ? '' : 's'}</span></h3>
      <div class="ev-grid">${list.map((p) => photoCard(p, insp)).join('')}</div>
    </div>`).join('');

  const strip = (list: any[]) => `<div class="ev-strip">${list.map((p) => `<img src="${esc(p.url)}" alt="${esc(p.caption || 'Job photo')}" loading="lazy">`).join('')}</div>`;
  const asTaken = photos.filter((p) => !p.scanned);
  const asTakenHtml = asTaken.length ? `<div class="ev-group">
      <h3 class="ev-h">${scanned.length ? 'More photos from the inspection' : 'Photos from the inspection'} <span>${asTaken.length} photo${asTaken.length === 1 ? '' : 's'}, as taken</span></h3>
      ${asTaken.length > AS_TAKEN_CARDS ? strip(asTaken) : `<div class="ev-grid">${asTaken.map((p) => photoCard(p, insp)).join('')}</div>`}
    </div>` : '';
  const appendixHtml = appendix.length ? `<div class="ev-group">
      <h3 class="ev-h">The rest of the job's photos <span>${appendix.length}, for the record</span></h3>
      ${strip(appendix.slice(0, 120))}
    </div>` : '';

  return {
    described: groupHtml,
    rest: `${asTakenHtml}${appendixHtml}`,
    photos: photos.length,
    appendix: appendix.length,
    scanned: scanned.length,
    issues: scanned.reduce((n, p) => n + (p.damages ?? []).filter((d: any) => !d.observation).length, 0),
  };
}

/** Said wherever AI-drafted photo descriptions appear. Escaped HTML. */
const scanDisclosure = (): string => `Photo descriptions were drafted with AI assistance from the photos themselves and reviewed by ${esc(companyBrand().displayName)}. The ratings, the measurements and the recommendation in this document come from the on-roof inspection, not from the photos.`;

/** What We Found, for the Proposal and Presentation. */
export function chapterEvidence(report: any, insp: InspectionFactsContext | null, jobType?: 'retail' | 'insurance'): string {
  const claim = claimEvidence(insp, SCROLL_STYLE);
  const storm = stormEvidence(report, jobType, SCROLL_STYLE);
  const g = evidenceGroups(report, insp);
  const none = !g.photos && !g.appendix;
  const t = conditionTally(insp);
  const stats = [
    g.scanned ? { v: g.scanned, k: 'Photos reviewed' } : { v: g.photos + g.appendix, k: 'Photos on file' },
    ...(g.scanned ? [{ v: g.issues, k: 'Issues visible in the photos' }] : []),
    { v: t.poor + t.failed, k: 'Components rated poor or failed' },
  ];
  const lede = g.scanned
    ? 'We took every photo below on your roof. They are grouped by the part of the roof they show. Each one says what we see, next to the grade your inspector gave that part.'
    : '';
  const toEnd = g.rest
    ? `<p class="sc-body ev-lede">${g.scanned ? 'Every other photo from the job' : `All ${g.photos + g.appendix} photos from the job`} ${g.scanned ? 'is' : 'are'} at the end of this report, in the Photo Record.</p>`
    : '';

  return `<section class="sc-section ch ch--dark" id="ch-found">
    <div class="sc-wrap" data-sc-in data-sc-stagger="60">
      <p class="sc-label">Chapter {{CH}}</p>
      <h2 class="sc-display sc-display--lg">What We Found On Your Roof</h2>
      ${lede ? `<p class="sc-body ev-lede">${lede}</p>` : ''}
      <div class="obj-stats">${stats.map((c) => `<div class="stat"><span data-sc-count="0 ${c.v}">0</span><b>${esc(c.k)}</b></div>`).join('')}</div>
      ${claim ? `<div class="ev-claim"><p class="sc-label">Recorded at the inspection</p>${claim}</div>` : ''}
      ${storm}
      ${g.described}
      ${toEnd}
      ${none ? '<p class="sc-body ev-lede">No photos are on file for this inspection yet. The findings in this document come from the on-roof inspection.</p>' : ''}
      ${g.scanned ? `<p class="sc-body tiny ev-note">${scanDisclosure()}</p>` : ''}
    </div>
  </section>`;
}

/** Every photo the evidence chapter did not show, as taken — the last chapter of the document. */
export function chapterPhotoRecord(report: any, insp: InspectionFactsContext | null): string {
  const g = evidenceGroups(report, insp);
  if (!g.rest) return '';
  return `<section class="sc-section ch ch--paper" id="ch-photo-record">
    <div class="sc-wrap" data-sc-in>
      <p class="sc-label">Chapter {{CH}}</p>
      <h2 class="sc-display sc-display--lg">Photo Record</h2>
      <p class="sc-body ev-lede">${g.scanned ? 'Here is every other photo we took on the job, just as we took it. The photos we described are in What We Found.' : 'Here is every photo we took on the job, just as we took it.'}</p>
      ${g.rest}
    </div>
  </section>`;
}

/**
 * The same photo evidence for the Inspection's document shell: the inner
 * block only, in a wrapper that carries the values the cards are styled
 * with. null when no photo on the report was scanned.
 */
export function evidenceBlockDocument(report: any, insp: InspectionFactsContext | null): { html: string; note: string } | null {
  const g = evidenceGroups(report, insp);
  if (!g.scanned) return null;
  return {
    note: `${g.photos} photo${g.photos === 1 ? '' : 's'}, ${g.scanned} read and described`,
    html: `<p>We looked closely at these photos from your roof. They are grouped by the part of the roof they show. Each one says what we see, next to the grade the inspector gave that part.${g.rest ? ' Every other photo is in the Photo Record at the end of this report.' : ''}</p>
    <div class="ev-doc">${g.described}</div>
    <p class="muted tiny" style="margin-top:14px">${scanDisclosure()}</p>`,
  };
}

/** The rest of the photos for the Inspection's Photo Record, once a scan has described some. */
export function photoRecordBlockDocument(report: any, insp: InspectionFactsContext | null): { html: string; note: string } | null {
  const g = evidenceGroups(report, insp);
  if (!g.scanned || !g.rest) return null;
  const n = g.photos - g.scanned + g.appendix;
  return {
    note: `${n} more photo${n === 1 ? '' : 's'}, as taken`,
    html: `<div class="ev-doc">${g.rest}</div>`,
  };
}

/* --------------------------------------------------------------- company --- */

/** Who the building owner is contracting with. Every claim is the company's own (its profile). */
export function chapterCompany(): string {
  const p = companyBrand();
  const rows: Array<[string, string]> = [['Company', p.legalName]];
  if (p.cityState) rows.push(['Based in', p.cityState]);
  if (p.phone) rows.push(['Phone', p.phone]);
  if (p.email) rows.push(['Email', p.email]);
  if (p.websiteLabel) rows.push(['Website', p.websiteLabel]);
  for (const l of p.licenses) rows.push(['License', l]);
  if (p.workmanshipYears) rows.push(['Workmanship warranty', `${p.workmanshipYears} years, on every roof we install`]);
  const facts = factGrid(rows);
  const creds = p.credentials.map((t) => `<span>${esc(t)}</span>`).join('');
  const stats = p.trustStats.map((t) => `<li>${esc(t)}</li>`).join('');
  return `<section class="sc-section ch ch--paper" id="ch-company">
    <div class="sc-wrap sc-stack" data-sc-in data-sc-stagger="60">
      <p class="sc-label">Chapter {{CH}}</p>
      <h2 class="sc-display sc-display--lg">Company Information</h2>
      <p class="sc-body sc-prose">Who you are contracting with, and how to reach us. Our Certificate of Insurance and W-9 are provided before any work starts.</p>
      ${facts}
      ${creds ? `<div class="cred">${creds}</div>` : ''}
      ${stats ? `<ul class="sc-body co-stats">${stats}</ul>` : ''}
    </div>
  </section>`;
}

/* ----------------------------------------------------------------- scope --- */

/** What the price covers for the option the document opens on. */
export function chapterScope(t: TierPricing): string {
  const system = t.product?.system;
  const items = system ? commercialIncludes(system) : null;
  if (!items?.length) return '';
  const w = warrantyFor(t.product);
  return `<section class="sc-section ch ch--paper" id="ch-scope">
    <div class="sc-wrap sc-stack" data-sc-in data-sc-stagger="60">
      <p class="sc-label">Chapter {{CH}}</p>
      <h2 class="sc-display sc-display--lg">What Is Included</h2>
      <p class="sc-body sc-prose">The work the <b>${esc(t.product.name)}</b> price covers, start to finish.</p>
      <ul class="co-includes">${items.map((i) => `<li>${esc(i)}</li>`).join('')}${t.iso ? `<li>${esc(t.iso.label)}</li>` : ''}</ul>
      <p class="sc-body tiny">Manufacturer warranty: ${w.manufacturerLine}.</p>
    </div>
  </section>`;
}

/* ----------------------------------------------------------- before start --- */

/** The lines every commercial document carries, word for word. Not editable. */
export const BEFORE_START_COMMITMENTS: Array<[string, string]> = [
  ['Certificate of Insurance and W-9', 'Our Certificate of Insurance (COI) and our W-9 are provided to you before any work starts.'],
  ['Permits', 'Where a permit is required for this work, every permit is pulled before the start of work.'],
];

/** The rest of the list — a rep can reword, add to or trim these per job. */
export const DEFAULT_BEFORE_START_TERMS: string[] = [
  'Scope, price and schedule are confirmed with you in writing before we mobilize.',
  'Crane or hoist location, dumpster location, material staging and working hours are agreed with you before anyone is on site.',
  'Where the building is occupied, tenants and occupants are notified in writing before work begins.',
  'Wet or damaged decking and insulation found once the roof is open is photographed, measured and priced, and approved by you in writing before it is covered.',
];

export function chapterBeforeStart(terms?: string[] | null): string {
  const extra = (Array.isArray(terms) ? terms : DEFAULT_BEFORE_START_TERMS).map((t) => String(t ?? '').trim()).filter(Boolean);
  return `<section class="sc-section ch ch--dark" id="ch-before-start">
    <div class="sc-wrap sc-stack" data-sc-in data-sc-stagger="60">
      <p class="sc-label">Chapter {{CH}}</p>
      <h2 class="sc-display sc-display--lg">Before We Start</h2>
      <p class="sc-body sc-prose">We do not start any work until you have all the papers you need.</p>
      <div class="bs-commit">${BEFORE_START_COMMITMENTS.map(([t, d]) => `<div class="bs-item"><b>${esc(t)}</b><span>${esc(d)}</span></div>`).join('')}</div>
      ${extra.length ? `<ul class="bs-list">${extra.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
    </div>
  </section>`;
}

/* ---------------------------------------------------------------- safety --- */

export function chapterSafety(insp: InspectionFactsContext | null): string {
  const s = safetyAndAccess(insp, SCROLL_STYLE);
  if (!s) return '';
  return `<section class="sc-section ch ch--paper" id="ch-safety">
    <div class="sc-wrap sc-stack" data-sc-in data-sc-stagger="60">
      <p class="sc-label">Chapter {{CH}}</p>
      <h2 class="sc-display sc-display--lg">Safety &amp; Access</h2>
      <p class="sc-body sc-prose">How our crew gets on the roof, how they stay safe, and where the crane and dumpster go. We plan all of this with you before we pick a start date.</p>
      ${s}
    </div>
  </section>`;
}

/* ---------------------------------------------------------------- record --- */

/** Every answer the inspector recorded, in checklist order. Nothing provided is left off the document. */
export function chapterRecord(insp: InspectionFactsContext | null, inspectorNotes?: string | null): string {
  const list = fullChecklist(insp, SCROLL_STYLE);
  const notes = String(inspectorNotes ?? '').trim();
  if (!list && !notes) return '';
  return `<section class="sc-section ch ch--paper" id="ch-record">
    <div class="sc-wrap sc-stack" data-sc-in>
      <p class="sc-label">Chapter {{CH}}</p>
      <h2 class="sc-display sc-display--lg">The Inspection Record</h2>
      <p class="sc-body sc-prose">Here is everything your inspector wrote down on the roof, in order. The rest of this report comes from these notes.</p>
      ${notes ? `<p class="sc-body"><b>Notes from your ${esc(companyBrand().displayName)} team.</b> <span style="white-space:pre-wrap">${esc(notes)}</span></p>` : ''}
      <div class="rec-list">${list}</div>
    </div>
  </section>`;
}

/* --------------------------------------------------------- rep's chapters --- */

export interface CustomSection { id: string; title: string; body: string; photoUrl?: string }

const CUSTOM_ID_RE = /^[a-z0-9]{1,24}$/;

/** A chapter the rep wrote. The body takes "## heading" and "- bullet" lines, like the narrative. */
export function customSections(list: unknown): ReportSection[] {
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const out: ReportSection[] = [];
  for (const c of list as CustomSection[]) {
    const id = String(c?.id ?? '');
    const title = String(c?.title ?? '').trim();
    const body = String(c?.body ?? '').trim();
    if (!CUSTOM_ID_RE.test(id) || seen.has(id) || !title || (!body && !c?.photoUrl)) continue;
    seen.add(id);
    const text = noToken(narrativeHtml(body, SCROLL_STYLE));
    const photo = c.photoUrl ? `<figure class="custom-photo"><img src="${esc(c.photoUrl)}" alt="${esc(title)}" loading="lazy"></figure>` : '';
    out.push({
      key: `custom-${id}`,
      label: title.slice(0, 40),
      html: `<section class="sc-section ch ch--paper" id="ch-custom-${id}">
    <div class="sc-wrap sc-stack" data-sc-in data-sc-stagger="40">
      <p class="sc-label">Chapter {{CH}}</p>
      <h2 class="sc-display sc-display--lg">${noToken(esc(title))}</h2>
      ${text ? `<div class="sc-prose">${text}</div>` : ''}
      ${photo}
    </div>
  </section>`,
    });
  }
  return out;
}

/**
 * Pin a rep's note to the end of a chapter. Pinned (scroll-driven) chapters
 * are skipped: their stage is exactly one screen tall and a note would be
 * clipped — the layer diagram has its own note field for that reason.
 */
export function withSectionNotes(sections: ReportSection[], notes: Record<string, string> | null | undefined): ReportSection[] {
  if (!notes || !Object.keys(notes).length) return sections;
  return sections.map((s) => {
    const note = String(notes[s.key] ?? '').trim();
    if (!note || !s.html || s.html.includes('data-sc-act')) return s;
    const end = s.html.lastIndexOf('</div>');
    if (end < 0) return s;
    const aside = `<aside class="rep-note"><b>A note from your ${esc(companyBrand().displayName)} team</b><p>${noToken(esc(note)).replace(/\n/g, '<br>')}</p></aside>`;
    return { ...s, html: `${s.html.slice(0, end)}${aside}${s.html.slice(end)}` };
  });
}

/* ------------------------------------------------------------------- css --- */

const EVIDENCE_CSS = `
.ev-lede { max-width: 62ch; margin-top: var(--sc-3); }
.ev-claim { margin-top: var(--sc-6); }
.ev-group { margin-top: var(--sc-7); }
.ev-h { font-family: var(--sc-font-display); font-size: var(--sc-t-xl); margin: 0 0 var(--sc-4); }
.ev-h span { font-family: var(--sc-font-text); font-size: var(--sc-t-xs); color: var(--sc-ink-soft); margin-left: 0.6em; font-weight: 400; }
.ev-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: var(--sc-4); }
.ev-card { margin: 0; background: color-mix(in oklab, var(--sc-surface, #fff) 8%, transparent); border: 1px solid var(--sc-hairline); border-radius: var(--sc-r-lg); overflow: hidden; }
.ev-card img { width: 100%; height: 210px; object-fit: cover; display: block; background: #2a2622; }
.ev-card figcaption { padding: var(--sc-3) var(--sc-4) var(--sc-4); font-size: var(--sc-t-sm); display: grid; gap: 6px; }
.ev-cap { font-family: var(--sc-font-display); font-size: var(--sc-t-base); }
.ev-card .cf-rating { justify-self: start; }
.ev-find { margin: 0; line-height: 1.5; color: var(--sc-ink-soft); }
.ev-find b { color: var(--sc-ink); margin-right: 0.3em; }
.ev-rated { margin: 4px 0 0; padding-top: 6px; border-top: 1px solid var(--sc-hairline); font-size: var(--sc-t-xs); color: var(--sc-ink-soft); }
.ev-rated b { color: var(--sc-ink); }
.ev-strip { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: var(--sc-2); }
.ev-strip img { width: 100%; height: 96px; object-fit: cover; border-radius: var(--sc-r-sm); display: block; background: #2a2622; }
.ev-note { margin-top: var(--sc-6); max-width: 70ch; }
`;

/** The photo evidence in the document shell, which has none of the scroll pages' variables. */
export const EVIDENCE_CSS_DOCUMENT = `
.ev-doc {
  --sc-surface: #fff; --sc-ink: #211A14; --sc-ink-soft: #6B6055; --sc-hairline: #E7DECF;
  --sc-t-xs: 12px; --sc-t-sm: 13.5px; --sc-t-base: 15px; --sc-t-xl: 20px;
  --sc-2: 8px; --sc-3: 12px; --sc-4: 16px; --sc-6: 32px; --sc-7: 28px;
  --sc-r-sm: 6px; --sc-r-lg: 14px; --sc-font-display: 'Fraunces', Georgia, serif; --sc-font-text: inherit;
}
${EVIDENCE_CSS}
.ev-doc .ev-group:first-child { margin-top: 18px; }
.ev-doc .ev-card { background: #fff; break-inside: avoid; }
.ev-doc .ev-card img, .ev-doc .ev-strip img { background: #f3efe8; }
`;

export const COMMERCIAL_CHAPTERS_CSS = `
.obj-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--sc-4); margin: var(--sc-6) 0; }
@media (max-width: 480px) { .obj-stats { grid-template-columns: 1fr; } }
.obj-stats .stat { background: color-mix(in oklab, var(--sc-surface, #fff) 8%, transparent); border: 1px solid var(--sc-hairline); border-radius: var(--sc-r-lg); padding: var(--sc-5); text-align: center; }
.obj-stats .stat span { display: block; font-family: var(--sc-font-display); font-size: var(--sc-t-3xl); color: var(--sc-accent); }
.obj-stats .stat b { font-size: var(--sc-t-xs); text-transform: uppercase; letter-spacing: var(--sc-track-wide); color: var(--sc-ink-soft); }
${EVIDENCE_CSS}
.co-stats { line-height: 1.9; padding-left: 1.2em; margin-top: var(--sc-5); }
.co-includes { margin: var(--sc-5) 0 0; padding: 0; list-style: none; display: grid; gap: var(--sc-2); max-width: 70ch; }
.co-includes li { padding: var(--sc-3) var(--sc-4) var(--sc-3) 2.4rem; position: relative; background: var(--sc-surface); border: 1px solid var(--sc-hairline); border-radius: var(--sc-r-md); font-size: var(--sc-t-sm); }
.co-includes li::before { content: "\\2713"; position: absolute; left: 0.9rem; color: #1B6B3A; font-weight: 700; }

.bs-commit { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: var(--sc-4); margin-top: var(--sc-5); }
.bs-item { border: 1px solid var(--sc-accent); border-radius: var(--sc-r-lg); padding: var(--sc-5); background: color-mix(in oklab, var(--sc-accent) 10%, transparent); }
.bs-item b { display: block; font-family: var(--sc-font-display); font-size: var(--sc-t-lg); margin-bottom: var(--sc-2); }
.bs-item span { font-size: var(--sc-t-base); line-height: 1.5; }
.bs-list { margin: var(--sc-5) 0 0; padding-left: 1.2em; line-height: 1.8; max-width: 70ch; font-size: var(--sc-t-sm); }

.rec-list h3 { font-family: var(--sc-font-display); }
.custom-photo { margin: var(--sc-5) 0 0; max-width: 720px; }
.custom-photo img { width: 100%; border-radius: var(--sc-r-md); display: block; }
.rep-note { margin-top: var(--sc-6); border-left: 3px solid var(--sc-accent); padding: var(--sc-3) var(--sc-4); background: color-mix(in oklab, var(--sc-ink) 5%, transparent); border-radius: 0 var(--sc-r-sm) var(--sc-r-sm) 0; max-width: 70ch; text-align: left; }
.rep-note b { display: block; font-size: var(--sc-t-xs); text-transform: uppercase; letter-spacing: var(--sc-track-wide); color: var(--sc-ink-soft); }
.rep-note p { margin: 4px 0 0; font-size: var(--sc-t-sm); line-height: 1.55; }

/* Printed or saved as a PDF, every chapter starts its own page and nothing
   is left waiting for a scroll that will never come. */
@media print {
  .folio-nav, [data-sc-progress], .sc-grain { display: none !important; }
  .ch { break-before: page; break-inside: auto; padding-block: 24px !important; }
  .ch:first-of-type { break-before: auto; }
  [data-sc-in], [data-sc-stagger] > *, [data-sc-cue], [data-sc-reveal] { opacity: 1 !important; transform: none !important; clip-path: none !important; }
  [data-sc-act] { height: auto !important; }
  [data-sc-stage] { position: static !important; height: auto !important; overflow: visible !important; }
  .ch--dark { --sc-canvas: #fff; --sc-ink: #17130F; --sc-ink-soft: #55504A; background: #fff; color: #17130F; }
  .ev-card, .asm-layer, .bs-item, .fact { break-inside: avoid; }
  .opt-panel[hidden] { display: block !important; }
}
`;
