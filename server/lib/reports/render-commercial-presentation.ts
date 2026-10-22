/**
 * The COMMERCIAL Presentation — the rep-narrated tablet deck, in the same
 * scroll-craft grammar as the residential Presentation
 * (render-presentation-scrollcraft.ts, whose chapters and page CSS/JS are
 * reused here), with the chapters a building owner needs: the roof as an
 * assembly, every component rated, the water, and the restore / recover /
 * replace decision — walked before the options and the price.
 *
 * Rendered from a report generated off a commercial inspection
 * (report.commercial, commercial-context.ts) with the tiers already priced.
 */
import { esc } from './report-theme.js';
import { COVER_NAME_ATTRS } from './cover-name.js';
import { arrangeSections, enforceMinimumSections, tagSection, type ReportSection } from './layout.js';
import { SCROLLCRAFT_JS, SCROLLCRAFT_CSS } from './scrollcraft-engine.js';
import { MOBILE_CSS, MOBILE_JS } from './sections/mobile.js';
import type { TierPricing } from './roofing-products.js';
import type { ComprehensiveRoofReport } from './comprehensive-roof-report.js';
import { PROJECT_MAP_HEAD, PROJECT_MAP_CSS, PROJECT_MAP_JS } from './project-map-widget.js';
import { SCROLL_STYLE } from './sections/style.js';
import { scopeTotalOf } from './scope-items.js';
import {
  BRAND, PAGE_CSS, PAGE_JS, renumberChapters, type Chapter,
  chNarrative, chWhoWeAre, chProduct, chSystem, chOurWork, chOptions, chInvestment, chWhy, chNext,
} from './render-presentation-scrollcraft.js';
import {
  buildingFacts, existingAssembly, conditionMatrix, conditionTally, drainageAndMoisture, reroofPath, energyCodeNote,
  maintenancePlan, serviceLifeContext, COMMERCIAL_FACTS_CSS,
} from './sections/commercial-facts.js';
import { commercialContextOf, commercialSummary } from './commercial-context.js';
import {
  chapterLayers, chapterEvidence, chapterPhotoRecord, chapterCompany, chapterScope, chapterBeforeStart, chapterSafety, chapterRecord,
  customSections, withSectionNotes, asNumbered, COMMERCIAL_CHAPTERS_CSS, COMMERCIAL_MIN_CHAPTERS,
} from './sections/commercial-chapters.js';
import { ASSEMBLY_CSS, ASSEMBLY_JS } from './sections/assembly-diagram.js';
import { brandLogo, brandCloser, chapterAboutBrn, chapterRoofWords, COMMERCIAL_BRAND_CSS } from './sections/commercial-brand.js';
import { REROOF_PATH_LABEL } from '../../../shared/commercial-inspection-form.js';
import type { InspectionFactsContext } from './sections/inspection-facts.js';
import type { InspectionReportContext } from '../../inspections/lookup.js';

function fmtDate(iso?: string | null): string {
  if (!iso) return '';
  try { return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }); }
  catch { return ''; }
}

export interface CommercialPresentationOpts {
  customer?: string;
  rep?: string;
  jobType?: 'retail' | 'insurance';
  inspection?: InspectionReportContext | null;
}

/* ------------------------------------------------------------- chapters -- */

function chWelcome(report: ComprehensiveRoofReport, customer: string, rep: string | undefined, jobType: 'retail' | 'insurance' | undefined): Chapter {
  const p = report.property;
  const where = [p?.address, p?.city, p?.state].filter(Boolean).join(', ');
  return {
    id: 'welcome', label: 'Welcome',
    html: `<section class="sc-section ch ch--paper ch--title" id="ch-welcome">
      <div class="sc-wrap">
        <div class="title-logo">${brandLogo()}</div>
        <p class="sc-label folio-eyebrow">Prepared For &middot; Commercial${jobType === 'insurance' ? ' &middot; Insurance Claim' : ''}</p>
        <h1 class="sc-display sc-display--xl title-name" ${COVER_NAME_ATTRS}>${esc(customer)}</h1>
        <p class="sc-lede title-address">${esc(where)}</p>
        <p class="sc-body title-date">${esc(fmtDate(report.generatedAt))}${rep ? ` &middot; Presented by ${esc(rep)}` : ''} &middot; ${esc(BRAND.name)}</p>
        <p class="sc-body title-intro">We climbed up on your roof and checked every part of it. We will show you what we found, what your roof needs, and what it will cost. Stop us on any page and ask a question &mdash; we have a photo for every problem.</p>
      </div>
    </section>`,
  };
}

function chSummary(report: ComprehensiveRoofReport, insp: InspectionFactsContext | null, n: number): Chapter | null {
  if (!insp) return null;
  const summary = commercialSummary(report, insp);
  const t = conditionTally(insp);
  const d = reroofPath(insp, SCROLL_STYLE).determination;
  const a = (insp.answers ?? {}) as Record<string, any>;
  const sqft = Number(a['Roof area (sq ft)']);
  return {
    id: 'summary', label: 'The Short Version',
    html: `<section class="sc-section ch ch--dark" id="ch-summary">
      <div class="sc-wrap sc-stack" data-sc-in data-sc-stagger="60">
        <p class="sc-label">Chapter ${n}</p>
        <h2 class="sc-display sc-display--lg">The Short Version</h2>
        ${summary ? `<p class="sc-lede sc-prose">${esc(summary)}</p>` : ''}
        <div class="obj-stats">
          <div class="stat"><span data-sc-count="0 ${Number.isFinite(sqft) && sqft > 0 ? Math.round(sqft) : 0}">0</span><b>Sq ft of roof</b></div>
          <div class="stat"><span data-sc-count="0 ${t.poor + t.failed}">0</span><b>Components poor or failed</b></div>
          <div class="stat"><span data-sc-count="0 ${t.good}">0</span><b>Components in good shape</b></div>
        </div>
        <div class="fact-grid">
          <div class="fact"><b>Roof systems in place</b><span>${esc(String(a['Number of roof systems in place'] || '—'))}</span></div>
          <div class="fact"><b>What it needs</b><span>${esc(d ? REROOF_PATH_LABEL[d.path] : '—')}</span></div>
        </div>
      </div>
    </section>`,
  };
}

function chRoofToday(report: ComprehensiveRoofReport, insp: InspectionFactsContext | null, n: number): Chapter | null {
  const facts = buildingFacts(insp, (report as any).measurements, SCROLL_STYLE);
  const asm = existingAssembly(insp, SCROLL_STYLE);
  if (!facts && !asm) return null;
  return {
    id: 'roof-today', label: 'Your Roof Today',
    html: `<section class="sc-section ch ch--paper" id="ch-roof-today">
      <div class="sc-wrap sc-stack" data-sc-in data-sc-stagger="60">
        <p class="sc-label">Chapter ${n}</p>
        <h2 class="sc-display sc-display--lg">Your Roof Today</h2>
        <p class="sc-body sc-prose">A flat roof is built in layers, like a sandwich. At the bottom is the deck. Next is the insulation. On top is the waterproof layer, called the membrane. Here is what we found in each layer.</p>
        ${facts}
        ${asm}
        ${serviceLifeContext(insp, SCROLL_STYLE)}
      </div>
    </section>`,
  };
}

function chCondition(insp: InspectionFactsContext | null, n: number): Chapter | null {
  const m = conditionMatrix(insp, SCROLL_STYLE);
  if (!m) return null;
  return {
    id: 'condition', label: 'Component by Component',
    html: `<section class="sc-section ch ch--dark" id="ch-condition">
      <div class="sc-wrap sc-stack" data-sc-in data-sc-stagger="60">
        <p class="sc-label">Chapter ${n}</p>
        <h2 class="sc-display sc-display--lg">Component by Component</h2>
        <p class="sc-body sc-prose">We gave every part of your roof its own grade: Good, Fair, Poor or Failed. The worst ones are listed first.</p>
        ${m}
      </div>
    </section>`,
  };
}

function chWater(insp: InspectionFactsContext | null, n: number): Chapter | null {
  const w = drainageAndMoisture(insp, SCROLL_STYLE);
  if (!w) return null;
  return {
    id: 'water', label: 'Where the Water Goes',
    html: `<section class="sc-section ch ch--paper" id="ch-water">
      <div class="sc-wrap sc-stack" data-sc-in data-sc-stagger="60">
        <p class="sc-label">Chapter ${n}</p>
        <h2 class="sc-display sc-display--lg">Where the Water Goes</h2>
        <p class="sc-body sc-prose">Most flat roofs fail because water does not drain off. We looked at where water sits, where it drains, and whether the insulation under the roof is wet. That tells us more than the roof&rsquo;s age does.</p>
        ${w}
      </div>
    </section>`,
  };
}

function chTheFix(insp: InspectionFactsContext | null, selected: TierPricing | undefined, n: number): Chapter | null {
  const p = reroofPath(insp, SCROLL_STYLE);
  if (!p.html) return null;
  return {
    id: 'fix', label: 'Restore, Recover, or Replace',
    html: `<section class="sc-section ch ch--dark" id="ch-fix">
      <div class="sc-wrap sc-stack" data-sc-in data-sc-stagger="60">
        <p class="sc-label">Chapter ${n}</p>
        <h2 class="sc-display sc-display--lg">Restore, Recover, or Replace</h2>
        <p class="sc-body sc-prose">There are three ways to fix a flat roof. You can <b>restore</b> it with a coating, <b>recover</b> it with a new roof on top, or <b>replace</b> it by tearing it off. What we found on your roof decides which ones will work.</p>
        ${p.html}
        ${energyCodeNote(insp, selected?.iso ?? null, SCROLL_STYLE)}
      </div>
    </section>`,
  };
}

function chCommercialProcess(n: number): Chapter {
  const steps: Array<[string, string]> = [
    ['Get set up', 'We pick a day for the crane or lift that works for your business. We agree in writing on where the dumpster and materials go, and we tell your tenants before we start.'],
    ['Get the roof ready', 'We take the old roof off down to the deck, or we clean the old roof so a new one can go on top. If we find wet or broken parts, we show you and give you a price before we go on.'],
    ['Insulation', 'We put down the insulation you picked and fasten it the way the maker says. Where water was sitting, we use sloped boards so it drains.'],
    ['The waterproof layer', 'We roll out the new roof sheets and seal every seam. We seal around every wall, drain, vent and pipe with the maker\'s own parts.'],
    ['Edges and walkways', 'We put new metal trim around the edges and seal it. We lay walk pads to every rooftop unit so workers do not damage the roof.'],
    ['Final check and warranty', 'The roof maker checks our work when the warranty needs it. We sign up your warranty and give you a folder with photos, the warranty, and a care plan.'],
  ];
  return {
    id: 'process', label: 'How the Job Runs',
    html: `<section class="sc-section ch ch--dark" id="ch-process">
      <div class="sc-wrap sc-stack" data-sc-in data-sc-stagger="60">
        <p class="sc-label">Chapter ${n}</p>
        <h2 class="sc-display sc-display--lg">How the Job Runs</h2>
        <div class="cf-maint">${steps.map(([t, d], i) => `<div class="cf-maint-item"><b>${i + 1}. ${esc(t)}</b><span>${d}</span></div>`).join('')}</div>
        <p class="sc-body tiny">If people are in the building while we work, we plan the work hours and smells with you first.</p>
      </div>
    </section>`,
  };
}

function chCommercialFaq(n: number): Chapter {
  const qas: Array<[string, string]> = [
    ['Can the building stay open during the work?', 'Yes. We work on one part of the roof at a time, and we close up each part the same day. We plan the loud and smelly work around your hours, and we tell your tenants in writing first.'],
    ['What if it rains partway through tear-off?', 'We never open more roof than we can close up the same day. If rain is coming, we plan around it. Your building is never left open overnight.'],
    ['What if you find wet insulation or a bad deck once the roof is open?', 'We take photos, measure it, and give you a price first. You say yes in writing before we go on. Nothing gets covered up without you seeing it.'],
    ['Where do the crane, dumpster and materials go?', 'We agree on that with you before we start. We plan where things go in your lot and what hours we work, so your customers, deliveries and parking still work.'],
    ['What happens at the rooftop units?', 'We seal around every unit with the roof maker\'s own parts. If a unit has to be lifted or unhooked, your heating and air company does that part, and we set the day together.'],
    ['Who handles the warranty?', 'We do. We sign up your warranty, set up the roof maker\'s check when it is needed, and handle any claim for you. You never have to call the maker yourself.'],
  ];
  const rows = qas.map(([q, a]) => `<div class="faq-row"><b>${esc(q)}</b><span>${esc(a)}</span></div>`).join('');
  return {
    id: 'faq', label: 'Questions',
    html: `<section class="sc-section ch ch--paper" id="ch-faq">
      <div class="sc-wrap" data-sc-in data-sc-stagger="50">
        <p class="sc-label">Chapter ${n}</p>
        <h2 class="sc-display sc-display--lg">Questions Building Owners Ask</h2>
        <div class="faq-list">${rows}</div>
      </div>
    </section>`,
  };
}

function chMaintenance(n: number): Chapter {
  return {
    id: 'maintenance', label: 'Keeping the Roof',
    html: `<section class="sc-section ch ch--paper" id="ch-maintenance">
      <div class="sc-wrap sc-stack" data-sc-in data-sc-stagger="60">
        <p class="sc-label">Chapter ${n}</p>
        <h2 class="sc-display sc-display--lg">Keeping the New Roof</h2>
        <p class="sc-body sc-prose">A flat roof that gets checked twice a year, and after big storms, can last ten years longer than one that is ignored. It also keeps your warranty safe.</p>
        ${maintenancePlan(SCROLL_STYLE)}
      </div>
    </section>`,
  };
}

/* --------------------------------------------------------------- render --- */

/** A shared chapter (Proposal numbering) as a Presentation section, or null when it has nothing to show. */
const shared = (key: string, label: string, html: string, required = false): ReportSection | null =>
  (html ? { key, label, html: asNumbered(html), ...(required ? { required: true } : {}) } : null);
const lastOf = (s: ReportSection | null): ReportSection | null => (s ? { ...s, last: true } : null);
const own = (c: Chapter | null, required = false): ReportSection | null =>
  (c ? { key: c.id, label: c.label, html: c.html, ...(required ? { required: true } : {}) } : null);

/**
 * The deck, in template order. `required` chapters can be moved but not
 * switched off: the inspection, the product, who the owner is contracting
 * with, and what is in their hands before work starts.
 */
function buildSections(report: ComprehensiveRoofReport, opts: CommercialPresentationOpts = {}): ReportSection[] {
  const options = report.replacementOptions as TierPricing[] | undefined;
  if (!options || options.length !== 3) {
    throw new Error('Pick your Good, Better and Best systems and confirm the roof size before generating a commercial Presentation.');
  }
  const pricing = { good: options[0], better: options[1], best: options[2] };
  const startingTier = report.selectedTier ?? 'better';
  const customer = opts.customer || 'Building Owner';
  const insp = commercialContextOf(report, opts.inspection as any);
  const r = report as any;

  let i = 1; // the cover is chapter 1, unlabelled — same convention as the residential deck
  const next = () => ++i;
  const sections = [
    own(chWelcome(report, customer, opts.rep, opts.jobType)),
    own(chSummary(report, insp, next())),
    own(chRoofToday(report, insp, next()), true),
    own(chCondition(insp, next())),
    own(chWater(insp, next())),
    own(chTheFix(insp, pricing[startingTier], next())),
    shared('words', 'Roof Words, Made Simple', chapterRoofWords()),
    shared('layers', 'Layer Diagram', chapterLayers(insp?.answers as Record<string, any> | null, pricing, startingTier, r.assemblyEdits)),
    shared('found', 'What We Found', chapterEvidence(report, insp, opts.jobType)),
    own(chNarrative(report, next())),
    shared('safety', 'Safety & Access', chapterSafety(insp)),
    own(chWhoWeAre(next(), 'commercial')),
    shared('about-brn', 'Why Building Owners Choose Us', chapterAboutBrn()),
    shared('company', 'Company Information', chapterCompany(), true),
    own(chProduct(pricing, startingTier, next(), report), true),
    own(chSystem(next(), pricing[startingTier])),
    shared('scope', 'What Is Included', chapterScope(pricing[startingTier])),
    own(chOurWork(next())),
    own(chCommercialProcess(next())),
    shared('before-start', 'Before We Start', chapterBeforeStart(r.beforeStartTerms), true),
    own(chCommercialFaq(next())),
    own(chOptions(pricing, startingTier, next(), scopeTotalOf(report))),
    own(chInvestment(startingTier, pricing, next(), report)),
    own(chMaintenance(next())),
    own(chWhy(next())),
    shared('record', 'Inspection Record', chapterRecord(insp, r.inspectorNotes)),
    ...customSections(r.customSections).map((c) => ({ ...c, html: asNumbered(c.html) })),
    own(chNext(customer, next(), customer)),
    // The full photo list closes the document, whatever order the rep saved.
    lastOf(shared('photo-record', 'Photo Record', chapterPhotoRecord(report, insp))),
  ].filter(Boolean) as ReportSection[];
  return withSectionNotes(sections, r.sectionNotes);
}

/** The chapters as the editor lists them — the same build the renderer makes. */
export function commercialPresentationSectionList(report: ComprehensiveRoofReport, opts: CommercialPresentationOpts = {}): ReportSection[] {
  return buildSections(report, opts);
}

export function renderCommercialPresentationHtml(report: ComprehensiveRoofReport, opts: CommercialPresentationOpts = {}): string {
  const customer = opts.customer || 'Building Owner';
  const sections = buildSections(report, opts);
  const arranged = renumberChapters(arrangeSections(sections, enforceMinimumSections(sections, (report as any).layout, COMMERCIAL_MIN_CHAPTERS)));
  const folio = `<nav class="folio-nav" aria-label="Chapters">${arranged.map((c) => `<a href="#ch-${c.key}">${esc(c.label)}</a>`).join('')}</nav>`;
  const body = arranged.map(tagSection).join('\n');
  return `<!doctype html>
<html lang="en" data-tier="${esc(report.selectedTier ?? 'better')}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<title>Commercial Roof Presentation for ${esc(customer)} &middot; ${esc(BRAND.name)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&family=Archivo:wght@400;500;600;700&display=swap" rel="stylesheet">
${PROJECT_MAP_HEAD}
<style>${SCROLLCRAFT_CSS}</style>
<style>${PAGE_CSS}</style>
<style>${COMMERCIAL_FACTS_CSS}
.ch--dark .cf-table th, .ch--dark .cf-table td { border-bottom-color: color-mix(in oklab, var(--sc-ink) 18%, transparent); }
.ch--dark .cf-layer, .ch--dark .cf-path { color: #17130F; }
.cf-stack { margin-top: var(--sc-6); }
.cf-wrap { margin-top: var(--sc-5); }
</style>
<style>${ASSEMBLY_CSS}</style>
<style>${COMMERCIAL_CHAPTERS_CSS}</style>
<style>${COMMERCIAL_BRAND_CSS}</style>
<style>${PROJECT_MAP_CSS}</style>
<style>${MOBILE_CSS}</style>
</head>
<body>
<span data-sc-progress></span>
<div class="sc-grain" aria-hidden="true"></div>
${folio}
<main id="top">
${body}
</main>
${brandCloser()}
<script>${SCROLLCRAFT_JS}</script>
<script>${MOBILE_JS}</script>
<script>ScrollCraft.mount(document.body);</script>
<script>${PAGE_JS}</script>
<script>${ASSEMBLY_JS}</script>
<script>${PROJECT_MAP_JS}</script>
</body>
</html>`;
}
