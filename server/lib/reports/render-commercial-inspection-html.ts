/**
 * Commercial (low-slope) roof CONDITION REPORT. Rendered from the commercial
 * inspection checklist in the shared premium document theme — the same shell
 * as the residential Inspection, a different document: it walks the
 * building, the assembly layer by layer, every rated component, the water,
 * and the decision (restore / recover / replace) with its reasons, then how
 * the roof should be kept.
 *
 * Two things are added when the rep asks for them at generation:
 *   - the photo scan (commercial-photo-scan.ts): the photos the rep picked,
 *     sorted by the part of the roof and described, beside the inspector's
 *     own rating. Without it the photos print as taken;
 *   - options and pricing: when the rep picked Good / Better / Best systems,
 *     the layer diagram draws those products and the report carries the
 *     three prices and what the quoted one includes. Without them the
 *     diagram shows the three paths and the report has no price on it.
 */
import { premiumShell, esc, usd } from './report-theme.js';
import { arrangeSections, joinSections, type ReportSection } from './layout.js';
import { reportFooter } from './render-proposal-html.js';
import type { ComprehensiveRoofReport } from './comprehensive-roof-report.js';
import { PROJECT_MAP_HEAD, PROJECT_MAP_CSS, PROJECT_MAP_JS } from './project-map-widget.js';
import { DOCUMENT_STYLE, SECTION_CSS_DOCUMENT } from './sections/style.js';
import { NARRATIVE_CSS } from './sections/narrative.js';
import { INSPECTION_FACTS_CSS, type InspectionFactsContext, fullChecklist } from './sections/inspection-facts.js';
import {
  buildingFacts, existingAssembly, conditionMatrix, conditionTally, drainageAndMoisture, claimEvidence, reroofPath,
  safetyAndAccess, maintenancePlan, serviceLifeContext, COMMERCIAL_FACTS_CSS,
} from './sections/commercial-facts.js';
import { inspectionOurWorkSection, photoRecordSection, inspectionNarrativeSection, inspectionStormSection } from './render-inspection-html.js';
import { commercialContextOf } from './commercial-context.js';
import { assemblyPathsHtml, assemblyDiagramDocumentHtml, ASSEMBLY_CSS_DOCUMENT, ASSEMBLY_JS } from './sections/assembly-diagram.js';
import { evidenceBlockDocument, photoRecordBlockDocument, EVIDENCE_CSS_DOCUMENT } from './sections/commercial-chapters.js';
import { commercialIncludes } from './commercial-products.js';
import { warrantyFor } from './product-warranty.js';
import { scopeTotalOf } from './scope-items.js';
import type { TierPricing } from './roofing-products.js';
import { REROOF_PATH_LABEL } from '../../../shared/commercial-inspection-form.js';
import { ANATOMY_CSS, ANATOMY_JS } from './sections/anatomy.js';
import { GLANCE_CSS, GLANCE_JS, fold, commercialGlance } from './sections/inspection-glance.js';
import { flatRoofAnatomy } from './sections/roof-anatomy-flat.js';
import { brandLogo, aboutCompanySectionDocument, roofWordsSectionDocument, COMMERCIAL_BRAND_CSS } from './sections/commercial-brand.js';
import { companyBrand, companyTel, credentialMarkers } from './company-brand.js';


function fmtDate(iso: string): string {
  try {
    const d = new Date(iso + (iso?.length === 10 ? 'T12:00:00' : ''));
    return isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch { return iso; }
}

function section(title: string, note: string | null, inner: string): string {
  if (!inner) return '';
  return `<section>
    <div class="sec-head"><h2>${title}</h2>${note ? `<span class="n">${esc(note)}</span>` : ''}</div>
    ${inner}
  </section>`;
}

export function commercialInspectionHero(report: ComprehensiveRoofReport, jobType?: 'retail' | 'insurance'): string {
  const p = report.property;
  return `<div class="hero">
    <div class="hero__logo">${brandLogo()}</div>
    <div class="hero__brand">${companyBrand().displayName} &middot; Commercial${jobType === 'insurance' ? ' &middot; Insurance Claim' : ''}</div>
    <h1>Commercial Roof Condition Report</h1>
    <div class="hero__for">${esc(p.address)}, ${esc(p.city)}, ${esc(p.state)} ${esc(p.zip || '')}</div>
    <div class="hero__meta"><div>Report #${esc(report.id)}</div><div>${fmtDate(report.generatedAt)}</div><div>Low-slope roof assessment</div></div>
  </div>`;
}

/** The one-page answer: what the roof is, what shape it is in, and what it needs. */
export function commercialSummarySection(report: ComprehensiveRoofReport, insp: InspectionFactsContext | null): string {
  if (!insp) return '';
  const t = conditionTally(insp);
  const path = reroofPath(insp, DOCUMENT_STYLE).determination;
  const a = (insp.answers ?? {}) as Record<string, any>;
  const sqft = Number(a['Roof area (sq ft)']);
  return `<section>
    <div class="sec-head"><h2>Executive Summary</h2><span class="n">In plain English</span></div>
    <div class="stats">
      <div class="stat"><div class="v">${Number.isFinite(sqft) && sqft > 0 ? Math.round(sqft).toLocaleString('en-US') : '—'}</div><div class="k">Sq Ft of Roof</div></div>
      <div class="stat"><div class="v">${t.poor + t.failed}</div><div class="k">Components Poor or Failed</div></div>
      <div class="stat"><div class="v">${esc(String(a['Number of roof systems in place'] || '—'))}</div><div class="k">Roof Systems in Place</div></div>
      <div class="stat"><div class="v" style="font-size:15px;line-height:1.2">${esc(path ? REROOF_PATH_LABEL[path.path].split(' — ')[0] : '—')}</div><div class="k">What It Needs</div></div>
    </div>
    ${insp.damageSummary?.trim() ? `<p class="lead" style="margin-top:14px"><b>Your inspector's summary.</b> ${esc(insp.damageSummary.trim())}</p>` : ''}
    ${String(report.inspectorNotes || '').trim() ? `<p style="margin-top:14px;white-space:pre-wrap"><b>Inspector's notes.</b> ${esc(String(report.inspectorNotes).trim())}</p>` : ''}
  </section>`;
}

export function commercialNextSteps(insp: InspectionFactsContext | null): string {
  const path = insp ? reroofPath(insp, DOCUMENT_STYLE).determination : null;
  const open = path?.openQuestions ?? [];
  return `<section>
    <div class="sec-head"><h2>Next Steps</h2></div>
    <ol style="line-height:1.8;padding-left:20px">
      ${open.length ? `<li>Check the things we still need to know: ${esc(open.join('; '))}</li>` : ''}
      <li>We go over this report with you, on the roof or on the phone. We have a photo for every problem.</li>
      <li>We send you a proposal with the choices that fit your roof, priced by the size of your roof.</li>
      <li>Reach out anytime: <a href="${companyTel()}" style="color:inherit"><b>${companyBrand().phone}</b></a></li>
    </ol>
    ${credentialMarkers().length ? `<div class="cred">${credentialMarkers().map((m) => `<span>${esc(m)}</span>`).join('')}</div>` : ''}
  </section>`;
}

/** The three priced tiers on the report, or null when the rep generated the Inspection without pricing. */
function pricedTiers(report: ComprehensiveRoofReport): { good: TierPricing; better: TierPricing; best: TierPricing } | null {
  const o = report.replacementOptions as TierPricing[] | undefined;
  return o && o.length === 3 ? { good: o[0], better: o[1], best: o[2] } : null;
}

function layersBlock(report: ComprehensiveRoofReport, answers: Record<string, any>): string {
  const edits = (report as any).assemblyEdits;
  const tiers = pricedTiers(report);
  if (tiers) {
    const diagram = assemblyDiagramDocumentHtml({ answers, pricing: tiers, startingTier: report.selectedTier ?? 'better', edits });
    if (!diagram) return '';
    return `<p>Here is what each option does to the layers of your roof: what comes off, what stays, and what goes on. Pick an option. Tap any layer to learn what it is.</p>${diagram}`;
  }
  const diagram = assemblyPathsHtml(answers, edits);
  if (!diagram) return '';
  return `<p>There are three ways to fix a flat roof. Pick one to see what it does to each layer of your roof: what comes off, what stays, and what goes on. Tap any layer to learn what it is.</p>${diagram}`;
}

/** The photos the scan read and described, by part of the roof. '' when there was no scan. */
function describedPhotosSection(report: ComprehensiveRoofReport, insp: InspectionFactsContext | null): string {
  const scanned = evidenceBlockDocument(report, insp);
  return scanned ? section('What the Photos Show', scanned.note, scanned.html) : '';
}

/** What is on the roof: the exploded drawing of its layers, then the facts and the core cut. */
function assemblyBlock(insp: InspectionFactsContext | null, photos: any[]): string {
  const drawing = flatRoofAnatomy(insp, photos);
  return `${drawing}${existingAssembly(insp, DOCUMENT_STYLE, { stack: !drawing })}`;
}

/** The full photo list, at the end: what the scan did not describe, or every photo as taken. */
function photosSection(report: ComprehensiveRoofReport, insp: InspectionFactsContext | null): string {
  if (!evidenceBlockDocument(report, insp)) return photoRecordSection(report);
  const rest = photoRecordBlockDocument(report, insp);
  return rest ? section('Photo Record', rest.note, rest.html) : '';
}

const SYSTEM_PLAIN: Record<string, string> = {
  tear_off: 'Old roof off, brand-new roof on',
  layover: 'New roof on top of the old one',
  coating: 'Old roof sealed with a coating',
};

/** Good / Better / Best, when the rep priced the Inspection. */
export function commercialOptionsSection(report: ComprehensiveRoofReport): string {
  const tiers = pricedTiers(report);
  if (!tiers) return '';
  const squares = report.roofDetails?.squares;
  const scopeTotal = scopeTotalOf(report);
  const cards = (['good', 'better', 'best'] as const).map((k) => {
    const o = tiers[k];
    const picked = k === (report.selectedTier ?? 'better');
    return `<article class="tier ${picked ? 'tier--rec' : ''}">
    <div class="tier__name">${k}${picked ? ' &middot; Quoted' : ''}</div>
    <div class="tier__shingle">${esc(o.product.name)}</div>
    <div class="tier__price">${usd(o.total)}</div>
    <div class="tier__rate">${usd(o.ratePerSquare)}/sq${squares ? ` &times; ${squares} sq` : ''}</div>
    <div class="tier__warranty">${esc(SYSTEM_PLAIN[o.product.system || ''] || o.product.tagline)}${o.iso ? `<br/>includes ${esc(o.iso.label)}` : ''}</div>
  </article>`;
  }).join('');
  return section('Your Options', squares ? `${squares} squares` : null, `<div class="tiers">${cards}</div>
    ${scopeTotal > 0 ? `<p class="muted tiny" style="margin-top:12px">Each price above is for the roof only. This quote also has <b>${usd(scopeTotal)}</b> of additional scope.</p>` : ''}
    <p class="muted tiny" style="margin-top:12px">These prices come from what we found and the size of your roof. We agree on the work and the price with you in writing before we start.</p>`);
}

/** What the quoted option's price covers. */
export function commercialIncludedSection(report: ComprehensiveRoofReport): string {
  const tiers = pricedTiers(report);
  if (!tiers) return '';
  const t = tiers[report.selectedTier ?? 'better'];
  const items = t.product.system ? commercialIncludes(t.product.system) : null;
  if (!items?.length) return '';
  const w = warrantyFor(t.product);
  return section('What Is Included', t.product.name, `<ul style="line-height:1.8;padding-left:20px">${items.map((i) => `<li>${esc(i)}</li>`).join('')}${t.iso ? `<li>${esc(t.iso.label)}</li>` : ''}</ul>
    <p class="muted tiny" style="margin-top:10px">Manufacturer warranty: ${w.manufacturerLine}. Our Certificate of Insurance (COI) and our W-9 are provided to you before any work starts, and where a permit is required, every permit is pulled before the start of work.</p>`);
}

/** The sections, in template order, keyed for the editor (report.layout hides/reorders them). */
export function commercialInspectionSections(
  report: ComprehensiveRoofReport,
  opts: { jobType?: 'retail' | 'insurance'; inspection?: InspectionFactsContext | null } = {},
): ReportSection[] {
  const insp = commercialContextOf(report, opts.inspection as any);
  const photos = ((report.damageAnalysis?.photos ?? []) as any[]);
  const claim = opts.jobType === 'insurance';
  const measurements = (report as any).measurements;
  const path = reroofPath(insp, DOCUMENT_STYLE);
  const a = (insp?.answers ?? {}) as Record<string, any>;
  const hasStorm = !!(a['Storm Date'] || a['Hail impact evidence on membrane or equipment'] === 'Yes' || a['Wind damage (uplift, peeled edges, displaced ballast)'] === 'Yes');
  return [
    { key: 'summary', label: 'Executive Summary', html: commercialSummarySection(report, insp) },
    { key: 'glance', label: 'At a Glance', html: commercialGlance(insp, photos) },
    { key: 'words', label: 'Roof Words, Made Simple', html: roofWordsSectionDocument() },
    { key: 'building', label: 'The Building & Roof', html: section('The Building &amp; Roof', null, buildingFacts(insp, measurements, DOCUMENT_STYLE)) },
    { key: 'assembly', label: 'What Is On the Roof', html: section('What Is On the Roof', 'Tap a number', assemblyBlock(insp, photos)) },
    { key: 'condition', label: 'Condition Assessment', html: section('Condition Assessment', 'Every component, worst first', conditionMatrix(insp, DOCUMENT_STYLE)) },
    { key: 'water', label: 'Drainage & Moisture', html: section('Drainage &amp; Moisture', null, drainageAndMoisture(insp, DOCUMENT_STYLE)) },
    // The photos as taken and the checklist's own storm answers — no vision
    // findings, no AI write-up, no NOAA counts. The record never says more
    // than the inspector did.
    { key: 'photo-scan', label: 'What the Photos Show', html: describedPhotosSection(report, insp) },
    { key: 'narrative', label: 'Findings, In Depth', html: inspectionNarrativeSection(report, opts.jobType) },
    { key: 'claim', label: claim ? 'The Claim Evidence' : 'Storm & Impact Damage', html: (claim || hasStorm) ? section(claim ? 'The Claim Evidence' : 'Storm &amp; Impact Damage', claim ? 'What the adjuster will look for' : null, claimEvidence(insp, DOCUMENT_STYLE)) : '' },
    { key: 'storm', label: 'Storm History', html: (claim || hasStorm) ? inspectionStormSection(report, opts.jobType) : '' },
    { key: 'path', label: 'What This Roof Needs', html: section('What This Roof Needs', 'Restore, recover, or replace', path.html) },
    // The live diagram: what restoring, covering or replacing this roof would
    // do to each layer the inspector found. Derived from the checklist alone.
    { key: 'layers', label: 'What Happens to Each Layer', html: section('What Happens to Each Layer', pricedTiers(report) ? 'Option by option' : 'Coating, recover or new roof', layersBlock(report, a)) },
    { key: 'options', label: 'Your Options', html: commercialOptionsSection(report) },
    { key: 'included', label: 'What Is Included', html: commercialIncludedSection(report) },
    { key: 'life', label: 'Where This Roof Is in Its Life', html: section('Where This Roof Is in Its Life', null, serviceLifeContext(insp, DOCUMENT_STYLE)) },
    { key: 'safety', label: 'Safety & Access', html: section('Safety &amp; Access', null, safetyAndAccess(insp, DOCUMENT_STYLE)) },
    { key: 'checklist', label: 'The Inspection, Field by Field', html: section('The Inspection, Field by Field', 'Every answer the inspector recorded', fold('Show every answer the inspector recorded', fullChecklist(insp as any, DOCUMENT_STYLE))) },
    { key: 'maintenance', label: 'Keeping This Roof', html: section('Keeping This Roof', 'The maintenance program', maintenancePlan(DOCUMENT_STYLE)) },
    { key: 'about', label: 'Why Building Owners Choose Us', html: aboutCompanySectionDocument() },
    { key: 'our-work', label: 'Our Work', html: inspectionOurWorkSection() },
    { key: 'next-steps', label: 'Next Steps', html: commercialNextSteps(insp) },
    // The full photo list closes the document, whatever order the rep saved.
    { key: 'photos', label: 'Photo Record', html: photosSection(report, insp), last: true },
    { key: 'footer', label: 'Footer', html: reportFooter(), fixed: true },
  ];
}

export function renderCommercialInspectionHtml(
  report: ComprehensiveRoofReport,
  opts: { jobType?: 'retail' | 'insurance'; inspection?: InspectionFactsContext | null } = {},
): string {
  const body = joinSections(arrangeSections(commercialInspectionSections(report, opts), (report as any).layout));
  return premiumShell({
    title: `Commercial Roof Condition Report · ${report.property.address} · ${companyBrand().displayName}`,
    hero: commercialInspectionHero(report, opts.jobType),
    body,
    extraHead: `${PROJECT_MAP_HEAD}<style>${PROJECT_MAP_CSS}${SECTION_CSS_DOCUMENT}${INSPECTION_FACTS_CSS}${COMMERCIAL_FACTS_CSS}${NARRATIVE_CSS}${ASSEMBLY_CSS_DOCUMENT}${EVIDENCE_CSS_DOCUMENT}${COMMERCIAL_BRAND_CSS}${ANATOMY_CSS}${GLANCE_CSS}</style>`,
    extraScripts: `<script>${PROJECT_MAP_JS}</script><script>${ASSEMBLY_JS}</script><script>${ANATOMY_JS}</script><script>${GLANCE_JS}</script>`,
  });
}
