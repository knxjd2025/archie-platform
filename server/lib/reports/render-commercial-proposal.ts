/**
 * The COMMERCIAL Proposal — the same scroll-craft page grammar, chapters and
 * devices as the residential Proposal (render-proposal-scrollcraft.ts, whose
 * shared chapters are reused here), with the chapters a building owner needs
 * instead of a homeowner: the roof as an assembly, every component rated,
 * the water, and the restore / recover / replace decision with its reasons —
 * before the options, the price, the system and the warranty.
 *
 * Rendered from a report generated off a commercial inspection
 * (report.commercial, see commercial-context.ts) with the Good/Better/Best
 * tiers already priced (replacementOptions).
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
  BRAND, PAGE_CSS, PAGE_JS, numberChapters,
  chapterWhoWeAre, chapterYourOptions, chapterInvestment, chapterProduct, chapterSystem, chapterWarranty, chapterOurWork, chapterNextStep, chapterYourRoof,
} from './render-proposal-scrollcraft.js';
import {
  buildingFacts, existingAssembly, conditionMatrix, conditionTally, drainageAndMoisture, reroofPath, energyCodeNote,
  maintenancePlan, serviceLifeContext, COMMERCIAL_FACTS_CSS,
} from './sections/commercial-facts.js';
import { commercialContextOf, commercialSummary } from './commercial-context.js';
import {
  chapterLayers, chapterEvidence, chapterPhotoRecord, chapterCompany, chapterScope, chapterBeforeStart, chapterSafety, chapterRecord,
  customSections, withSectionNotes, COMMERCIAL_CHAPTERS_CSS, COMMERCIAL_MIN_CHAPTERS,
} from './sections/commercial-chapters.js';
import { ASSEMBLY_CSS, ASSEMBLY_JS } from './sections/assembly-diagram.js';
import { brandLogo, brandCloser, chapterAboutBrn, chapterRoofWords, COMMERCIAL_BRAND_CSS } from './sections/commercial-brand.js';
import { REROOF_PATH_LABEL } from '../../../shared/commercial-inspection-form.js';
import type { InspectionFactsContext } from './sections/inspection-facts.js';

function fmtDate(iso?: string | null): string {
  if (!iso) return '';
  try { return new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }); }
  catch { return ''; }
}

export interface CommercialProposalOpts {
  customer?: string;
  jobType?: 'retail' | 'insurance';
  inspection?: InspectionFactsContext | null;
}

/* ------------------------------------------------------------- chapters -- */

function chapterWelcome(report: ComprehensiveRoofReport, customer: string, jobType?: 'retail' | 'insurance'): string {
  const p = report.property;
  const where = [p?.address, p?.city, p?.state].filter(Boolean).join(', ');
  return `<section class="sc-section ch ch--paper ch--title" id="ch-welcome">
    <div class="sc-wrap">
      <div class="title-logo">${brandLogo()}</div>
      <p class="sc-label folio-eyebrow">A Commercial Roofing Proposal, Prepared For${jobType === 'insurance' ? ' &middot; Insurance Claim' : ''}</p>
      <h1 class="sc-display sc-display--xl title-name" ${COVER_NAME_ATTRS}>${esc(customer)}</h1>
      <p class="sc-lede title-address">${esc(where)}</p>
      <p class="sc-body title-date">${esc(fmtDate(report.generatedAt))} &middot; Prepared by ${esc(BRAND.name)}</p>
      <p class="sc-body title-intro">We climbed up on your roof and checked every part of it. This proposal shows you what we found, what your roof needs, and what it will cost. We looked first and priced second &mdash; not the other way around.</p>
    </div>
  </section>`;
}

function chapterSummary(report: ComprehensiveRoofReport, insp: InspectionFactsContext | null): string {
  if (!insp) return '';
  const summary = commercialSummary(report, insp);
  const t = conditionTally(insp);
  const d = reroofPath(insp, SCROLL_STYLE).determination;
  const a = (insp.answers ?? {}) as Record<string, any>;
  const sqft = Number(a['Roof area (sq ft)']);
  return `<section class="sc-section ch ch--dark" id="ch-summary">
    <div class="sc-wrap sc-stack" data-sc-in data-sc-stagger="60">
      <p class="sc-label">Chapter {{CH}}</p>
      <h2 class="sc-display sc-display--lg">The Short Version</h2>
      ${summary ? `<p class="sc-lede sc-prose">${esc(summary)}</p>` : ''}
      <div class="fact-grid">
        <div class="fact"><b>Roof area</b><span>${Number.isFinite(sqft) && sqft > 0 ? `${Math.round(sqft).toLocaleString('en-US')} sq ft` : '—'}</span></div>
        <div class="fact"><b>Roof systems in place</b><span>${esc(String(a['Number of roof systems in place'] || '—'))}</span></div>
        <div class="fact"><b>Components poor or failed</b><span>${t.poor + t.failed} of ${t.good + t.fair + t.poor + t.failed}</span></div>
        <div class="fact"><b>What it needs</b><span>${esc(d ? REROOF_PATH_LABEL[d.path] : '—')}</span></div>
      </div>
    </div>
  </section>`;
}

function chapterRoofToday(report: ComprehensiveRoofReport, insp: InspectionFactsContext | null): string {
  const facts = buildingFacts(insp, (report as any).measurements, SCROLL_STYLE);
  const asm = existingAssembly(insp, SCROLL_STYLE);
  if (!facts && !asm) return '';
  return `<section class="sc-section ch ch--paper" id="ch-roof-today">
    <div class="sc-wrap sc-stack" data-sc-in data-sc-stagger="60">
      <p class="sc-label">Chapter {{CH}}</p>
      <h2 class="sc-display sc-display--lg">Your Roof Today</h2>
      <p class="sc-body sc-prose">A flat roof is built in layers, like a sandwich. At the bottom is the deck. Next is the insulation. On top is the waterproof layer, called the membrane. Here is what we found in each layer.</p>
      ${facts}
      ${asm}
      ${serviceLifeContext(insp, SCROLL_STYLE)}
    </div>
  </section>`;
}

function chapterCondition(insp: InspectionFactsContext | null): string {
  const m = conditionMatrix(insp, SCROLL_STYLE);
  if (!m) return '';
  return `<section class="sc-section ch ch--dark" id="ch-condition">
    <div class="sc-wrap sc-stack" data-sc-in data-sc-stagger="60">
      <p class="sc-label">Chapter {{CH}}</p>
      <h2 class="sc-display sc-display--lg">Component by Component</h2>
      <p class="sc-body sc-prose">We gave every part of your roof its own grade: Good, Fair, Poor or Failed. The joints and edges often wear out first, so we check them closely.</p>
      ${m}
    </div>
  </section>`;
}

function chapterWater(insp: InspectionFactsContext | null): string {
  const w = drainageAndMoisture(insp, SCROLL_STYLE);
  if (!w) return '';
  return `<section class="sc-section ch ch--paper" id="ch-water">
    <div class="sc-wrap sc-stack" data-sc-in data-sc-stagger="60">
      <p class="sc-label">Chapter {{CH}}</p>
      <h2 class="sc-display sc-display--lg">Where the Water Goes</h2>
      <p class="sc-body sc-prose">Most flat roofs fail because water does not drain off. We looked at where water sits, where it drains, and whether the insulation under the roof is wet. That tells us more than the roof&rsquo;s age does.</p>
      ${w}
    </div>
  </section>`;
}

function chapterTheFix(insp: InspectionFactsContext | null, selected: TierPricing | undefined): string {
  const p = reroofPath(insp, SCROLL_STYLE);
  if (!p.html) return '';
  return `<section class="sc-section ch ch--dark" id="ch-fix">
    <div class="sc-wrap sc-stack" data-sc-in data-sc-stagger="60">
      <p class="sc-label">Chapter {{CH}}</p>
      <h2 class="sc-display sc-display--lg">Restore, Recover, or Replace</h2>
      <p class="sc-body sc-prose">There are three ways to fix a flat roof. You can <b>restore</b> it with a coating, <b>recover</b> it with a new roof on top, or <b>replace</b> it by tearing it off. What we found on your roof decides which ones will work.</p>
      ${p.html}
      ${energyCodeNote(insp, selected?.iso ?? null, SCROLL_STYLE)}
    </div>
  </section>`;
}

function chapterCommercialProcess(): string {
  const steps: Array<[string, string]> = [
    ['Get set up', 'We pick a day for the crane or lift that works for your business. We agree in writing on where the dumpster and materials go, and we tell your tenants before we start.'],
    ['Get the roof ready', 'We take the old roof off down to the deck, or we clean the old roof so a new one can go on top. If we find wet or broken parts, we show you and give you a price before we go on.'],
    ['Insulation', 'We put down the insulation you picked and fasten it the way the maker says. Where water was sitting, we use sloped boards so it drains.'],
    ['The waterproof layer', 'We roll out the new roof sheets and seal every seam. We seal around every wall, drain, vent and pipe with the maker\'s own parts.'],
    ['Edges and walkways', 'We put new metal trim around the edges and seal it. We lay walk pads to every rooftop unit so workers do not damage the roof.'],
    ['Final check and warranty', 'The roof maker checks our work when the warranty needs it. We sign up your warranty and give you a folder with photos, the warranty, and a care plan.'],
  ];
  return `<section class="sc-section ch ch--paper" id="ch-process">
    <div class="sc-wrap sc-stack" data-sc-in data-sc-stagger="60">
      <p class="sc-label">Chapter {{CH}}</p>
      <h2 class="sc-display sc-display--lg">How the Job Runs</h2>
      <div class="cf-maint">${steps.map(([t, d], i) => `<div class="cf-maint-item"><b>${i + 1}. ${esc(t)}</b><span>${d}</span></div>`).join('')}</div>
      <p class="sc-body tiny">If people are in the building while we work, we plan the work hours and smells with you first.</p>
    </div>
  </section>`;
}

function chapterMaintenance(): string {
  return `<section class="sc-section ch ch--paper" id="ch-maintenance">
    <div class="sc-wrap sc-stack" data-sc-in data-sc-stagger="60">
      <p class="sc-label">Chapter {{CH}}</p>
      <h2 class="sc-display sc-display--lg">Keeping the New Roof</h2>
      <p class="sc-body sc-prose">A flat roof that gets checked twice a year, and after big storms, can last ten years longer than one that is ignored. It also keeps your warranty safe.</p>
      ${maintenancePlan(SCROLL_STYLE)}
    </div>
  </section>`;
}

/* --------------------------------------------------------------- render --- */

/**
 * The chapters, in template order. `required` chapters can be moved but not
 * switched off: the inspection, the product, who the owner is contracting
 * with, and what is in their hands before work starts are on every
 * commercial proposal. The rep's own chapters and pinned notes are part of
 * the list, so the editor shows exactly what the page will.
 */
export function commercialProposalSections(report: ComprehensiveRoofReport, opts: CommercialProposalOpts = {}): ReportSection[] {
  const options = report.replacementOptions as TierPricing[] | undefined;
  if (!options || options.length !== 3) {
    throw new Error('Pick your Good, Better and Best systems and confirm the roof size before generating a commercial Proposal.');
  }
  const pricing = { good: options[0], better: options[1], best: options[2] };
  const startingTier = report.selectedTier ?? 'better';
  const customer = opts.customer || 'Building Owner';
  const insp = commercialContextOf(report, opts.inspection as any);
  const r = report as any;
  const sections: ReportSection[] = [
    { key: 'welcome', label: 'Welcome', html: chapterWelcome(report, customer, opts.jobType) },
    { key: 'summary', label: 'The Short Version', html: chapterSummary(report, insp) },
    { key: 'roof-today', label: 'Your Roof Today', html: chapterRoofToday(report, insp), required: true },
    { key: 'condition', label: 'Component by Component', html: chapterCondition(insp) },
    { key: 'water', label: 'Where the Water Goes', html: chapterWater(insp) },
    { key: 'fix', label: 'Restore, Recover, or Replace', html: chapterTheFix(insp, pricing[startingTier]) },
    { key: 'words', label: 'Roof Words, Made Simple', html: chapterRoofWords() },
    { key: 'layers', label: 'Layer Diagram', html: chapterLayers(insp?.answers as Record<string, any> | null, pricing, startingTier, r.assemblyEdits) },
    { key: 'found', label: 'What We Found', html: chapterEvidence(report, insp, opts.jobType) },
    { key: 'narrative', label: 'Your Roof', html: chapterYourRoof(report) },
    { key: 'safety', label: 'Safety & Access', html: chapterSafety(insp) },
    { key: 'who', label: 'Who We Are', html: chapterWhoWeAre('commercial') },
    { key: 'about-brn', label: 'Why Building Owners Choose Us', html: chapterAboutBrn() },
    { key: 'company', label: 'Company Information', html: chapterCompany(), required: true },
    { key: 'options', label: 'Your Options', html: chapterYourOptions(pricing, startingTier, scopeTotalOf(report), report) },
    { key: 'investment', label: 'Investment', html: chapterInvestment(startingTier, pricing, report) },
    { key: 'product', label: 'The System', html: chapterProduct(pricing[startingTier], report), required: true },
    { key: 'system', label: 'Layer by Layer', html: chapterSystem(pricing[startingTier]) },
    { key: 'scope', label: 'What Is Included', html: chapterScope(pricing[startingTier]) },
    { key: 'process', label: 'How the Job Runs', html: chapterCommercialProcess() },
    { key: 'before-start', label: 'Before We Start', html: chapterBeforeStart(r.beforeStartTerms), required: true },
    { key: 'warranty', label: 'Warranty', html: chapterWarranty(pricing[startingTier]) },
    { key: 'maintenance', label: 'Keeping the Roof', html: chapterMaintenance() },
    { key: 'our-work', label: 'Our Work', html: chapterOurWork() },
    { key: 'record', label: 'Inspection Record', html: chapterRecord(insp, r.inspectorNotes) },
    ...customSections(r.customSections),
    { key: 'next', label: 'Next Step', html: chapterNextStep(customer, customer) },
    // The full photo list closes the document, whatever order the rep saved.
    { key: 'photo-record', label: 'Photo Record', html: chapterPhotoRecord(report, insp), last: true },
  ];
  return withSectionNotes(sections, r.sectionNotes);
}

export function renderCommercialProposalHtml(report: ComprehensiveRoofReport, opts: CommercialProposalOpts = {}): string {
  const customer = opts.customer || 'Building Owner';
  const sections = commercialProposalSections(report, opts);
  const arranged = arrangeSections(sections, enforceMinimumSections(sections, (report as any).layout, COMMERCIAL_MIN_CHAPTERS));
  const body = numberChapters(arranged.map(tagSection));
  const folio = `<nav class="folio-nav" aria-label="Chapters">${arranged.map((c) => `<a href="#ch-${c.key}">${esc(c.label)}</a>`).join('')}</nav>`;
  return `<!doctype html>
<html lang="en" data-tier="${esc(report.selectedTier ?? 'better')}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<title>Commercial Roofing Proposal for ${esc(customer)} &middot; ${esc(BRAND.name)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&family=Archivo:wght@400;500;600;700&display=swap" rel="stylesheet">
${PROJECT_MAP_HEAD}
<style>${SCROLLCRAFT_CSS}</style>
<style>${PAGE_CSS}</style>
<style>${COMMERCIAL_FACTS_CSS}
/* Scroll shell: the commercial tables sit on both dark and paper chapters. */
.ch--dark .cf-table th, .ch--dark .cf-table td { border-bottom-color: color-mix(in oklab, var(--sc-ink) 18%, transparent); }
.ch--dark .cf-layer { color: #17130F; }
.ch--dark .cf-path { color: #17130F; }
.ch--dark .cf-maint-item span { opacity: .9; }
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
