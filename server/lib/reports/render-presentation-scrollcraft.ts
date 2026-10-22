/**
 * Presentation, rebuilt as a scroll-craft page (chaptered-editorial grammar,
 * matching Proposal's chapter/folio-nav mechanics).
 *
 * This replaced an earlier Gallery/Catalog build of Presentation (fixed
 * filmstrip nav, tap-to-jump objects) after a much deeper bespoke one-off
 * page built for one job (a 45-facet estate re-roof) was set as the bar every
 * Presentation should clear: a long, chapter-numbered narrative
 * document — company story, a deep dive on the recommended shingle, the
 * full Integrity system, ventilation, color options, how the job actually
 * runs, an FAQ, then the real Good/Better/Best numbers.
 *
 * That reference page carried facet-level measurements (ridge/valley/eave
 * footage from a Nearmap survey) this app has no data source for — the
 * decision was: build from the squares we already have, skip anything that
 * needs a measurement service we don't have. It also carried specific
 * numeric certifications (110/130 MPH wind warranty, UL 2218 Class 4 impact
 * rating) that were true of THAT job's two CertainTeed products only.
 * product-specs.ts now carries the same kind of fact, but researched and
 * sourced from CertainTeed/Tamko's own current data sheets for every product
 * in roofing-products.ts (not just the two on that one job) — specFor()
 * returns null for standing-seam metal, which has no single manufacturer
 * data sheet to cite, and every chapter below degrades to omitting that
 * fact-grid rather than fabricating a number for it.
 *
 * Like Proposal, this is a TEMPLATE poured with one job's real data every
 * time a rep generates a Presentation, not a static page. Reuses the same
 * tier-pricing plumbing as Estimate's replacement mode and Proposal
 * (estimate-replacement.ts's applyReplacementPricing) so all three read the
 * report's own replacementOptions/selectedTier rather than recomputing.
 *
 * Real assets only — no AI-generated imagery; the color/roof photography is
 * CertainTeed's own product photography already used by Proposal, and the
 * owners' photo is the company's own (its profile), never generated.
 */
import { COVER_NAME_ATTRS } from './cover-name.js';
import { esc, usd } from './report-theme.js';
import { arrangeSections, tagSection, type ReportSection } from './layout.js';
import { SCROLLCRAFT_JS, SCROLLCRAFT_CSS } from './scrollcraft-engine.js';
import { MOBILE_CSS, MOBILE_JS } from './sections/mobile.js';
import type { TierPricing } from './roofing-products.js';
import { warranty } from './certainteed-data.js';
import { productImage } from './sections/product-spec-panel.js';
import { specFor } from './product-specs.js';
import { PROJECT_MAP_HEAD, PROJECT_MAP_CSS, PROJECT_MAP_JS, projectMapContainerHtml, ourWorkMapAvailable } from './project-map-widget.js';
import { plainLanguageFor, plainSeverity } from './plain-language-damage.js';
import { standardsFor, renderStandardsFootnote } from './damage-standards.js';
import { scopeTotalOf } from './scope-items.js';
import { scopeTable, SCOPE_TABLE_CSS } from './sections/scope-table.js';
import { narrativeHtml, NARRATIVE_CSS } from './sections/narrative.js';
import { roofSystemWalkthrough, ROOF_SYSTEM_CSS_SCROLL } from './sections/roof-system-walkthrough.js';
import { roofSystemFor } from './roof-systems.js';
import { stormEvidence } from './sections/storm-evidence.js';
import { assemblyAgainstStandard, ventilation, roofAge, INSPECTION_FACTS_CSS } from './sections/inspection-facts.js';
import { warrantyFor } from './product-warranty.js';
import { isServiceProduct } from './roofing-products.js';
import { serviceIncludesList } from './sections/product-spec-panel.js';
import { factGrid, SCROLL_STYLE, SECTION_CSS_SCROLL } from './sections/style.js';
import { colorOptions } from './sections/color-options.js';
import { howTheJobRuns } from './sections/how-the-job-runs.js';
import { financing, hasFinancing } from './sections/financing.js';
import { productSpecPanel } from './sections/product-spec-panel.js';
import type { ComprehensiveRoofReport } from './comprehensive-roof-report.js';
import type { InspectionReportContext } from '../../inspections/lookup.js';
import { brandStyleTag, companyBrand, companyTel, companyValues, documentMetaTags, ownersStory } from './company-brand.js';

/**
 * Reads one answer off the field inspection's 33-field checklist (shared/
 * inspection-form.ts), or null if it was never asked, never answered, or no
 * inspection has been submitted for this job at all. Every chapter below
 * that reads from this degrades gracefully to "don't render this chapter"
 * rather than a blank/broken section — a small repair job's inspection
 * naturally has fewer answered fields than a full-exterior insurance claim,
 * which is what makes the document scale itself to the job instead of
 * forcing every job through the same fixed chapter count.
 */
function ans(insp: InspectionReportContext | null | undefined, field: string): string | null {
  const v = insp?.answers?.[field];
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s && s.toLowerCase() !== 'n/a' ? s : null;
}


function fmtDate(iso?: string | null): string {
  if (!iso) return '';
  try { return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }); }
  catch { return ''; }
}

const SEV_ORDER: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1, none: 0 };

export interface Chapter { id: string; label: string; html: string }

/* factGrid — the small fact card used by several of the inspection-detail
   chapters below — now comes from ./sections/style.ts, shared with the
   Estimate/Proposal sections. Same single-argument signature, same markup. */

/* ------------------------------------------------------------- chapters -- */

function chWelcome(report: ComprehensiveRoofReport, customer: string, rep: string | undefined, jobType: 'retail' | 'insurance' | undefined, n: number): Chapter {
  const p = report.property;
  const where = [p?.address, p?.city, p?.state].filter(Boolean).join(', ');
  return {
    id: 'welcome', label: 'Welcome',
    html: `<section class="sc-section ch ch--paper ch--title" id="ch-welcome">
      <div class="sc-wrap">
        <p class="sc-label folio-eyebrow">Prepared For${jobType === 'insurance' ? ' &middot; Insurance Claim' : ''}</p>
        <h1 class="sc-display sc-display--xl title-name" ${COVER_NAME_ATTRS}>${esc(customer)}</h1>
        <p class="sc-lede title-address">${esc(where)}</p>
        <p class="sc-body title-date">${esc(fmtDate(report.generatedAt))}${rep ? ` &middot; Presented by ${esc(rep)}` : ''} &middot; ${esc(companyBrand().displayName)}</p>
        <p class="sc-body title-intro">Everything in here comes from the actual inspection of your roof: what we found, what's already there, what it costs to fix at three real levels, and the warranty we can register because we install it right. Take your time with it — call us with anything you want walked through in person.</p>
      </div>
    </section>`,
  };
}

export function chFound(report: ComprehensiveRoofReport, n: number, damageSummary?: string | null, jobType?: 'retail' | 'insurance'): Chapter {
  const dmg = report.damageAnalysis;
  const storm: any = report.stormHistory;
  const analysed = (dmg?.photos || []).filter((p: any) => (p.damages || []).length > 0);
  // No vision findings (analysis off, or none found): the inspector's photos
  // as taken, with their captions — never a label the inspector didn't write.
  const asTaken = !analysed.length;
  const photos = asTaken ? (dmg?.photos || []).slice(0, 12) : analysed;
  const findings = analysed.reduce((s: number, p: any) => s + (p.damages?.length || 0), 0);
  const cards = [
    asTaken ? { v: String(dmg?.photos?.length ?? 0), k: 'Photos on file' } : { v: String(dmg?.totalPhotosAnalyzed ?? 0), k: 'Photos reviewed' },
    ...(asTaken ? [] : [{ v: String(findings), k: 'Conditions found' }]),
    { v: String(storm?.totalEvents ?? 0), k: 'Storms nearby (3 yr)' },
  ];
  const photoCards = asTaken ? photos.map((p: any, i: number) => `<figure class="found-photo">
      <img src="${esc(p.url)}" alt="${esc(p.caption || `Photo ${i + 1}`)}" loading="lazy">
      <figcaption><b>${esc(p.caption || `Photo ${i + 1}`)}</b></figcaption>
    </figure>`).join('') : photos.map((p: any) => {
    const worst = [...(p.damages || [])].sort((a: any, b: any) => (SEV_ORDER[(b.severity || '').toLowerCase()] ?? 0) - (SEV_ORDER[(a.severity || '').toLowerCase()] ?? 0))[0];
    const plain = plainLanguageFor(worst?.type);
    const fact = [worst?.location, plainSeverity(worst?.severity)].filter(Boolean).join(', ');
    const std = standardsFor(worst?.type);
    return `<figure class="found-photo">
      <img src="${esc(p.url)}" alt="${esc(plain.label)}" loading="lazy">
      <figcaption><b>${esc(plain.label)}</b>${fact ? ` &mdash; ${esc(fact)}` : ''}<br><span>${esc(plain.explanation)}</span><br><span class="found-why"><b>Why it matters:</b> ${esc(std.whyItMatters)}</span>${renderStandardsFootnote(worst?.type, 'sc-body tiny')}</figcaption>
    </figure>`;
  }).join('');
  const stormLine = storm?.totalEvents
    ? `<p class="sc-body">${esc(String(storm.totalEvents))} storm event${storm.totalEvents === 1 ? '' : 's'} recorded within ${esc(String(storm.searchRadiusMiles ?? 5))} miles over the past ${esc(String(storm.yearsAnalyzed ?? 3))} years (${[storm.hailEvents ? `${storm.hailEvents} hail` : null, storm.windEvents ? `${storm.windEvents} wind` : null].filter(Boolean).join(', ') || 'none severe'}). Source: NOAA storm records.</p>`
    : '';
  return {
    id: 'found', label: 'What We Found',
    html: `<section class="sc-section ch ch--dark" id="ch-found">
      <div class="sc-wrap" data-sc-in data-sc-stagger="60">
        <p class="sc-label">Chapter ${n}</p>
        <h2 class="sc-display sc-display--lg">What We Found On Your Roof</h2>
        <div class="obj-stats">${cards.map((c) => `<div class="stat"><span data-sc-count="0 ${c.v}">0</span><b>${esc(c.k)}</b></div>`).join('')}</div>
        ${damageSummary?.trim() ? `<p class="sc-body found-summary"><b>Your inspector's summary.</b> ${esc(damageSummary.trim())}</p>` : ''}
        ${dmg?.aiSummary ? `<p class="sc-body">${esc(dmg.aiSummary)}</p>` : ''}
        ${stormLine}
        ${stormEvidence(report, jobType, SCROLL_STYLE)}
        ${photoCards ? `<div class="found-grid">${photoCards}</div>` : `<p class="sc-body muted">No photos on file for this inspection.</p>`}
      </div>
    </section>`,
  };
}

function chMeasured(report: ComprehensiveRoofReport, insp: InspectionReportContext | null, n: number, jobType?: 'retail' | 'insurance'): Chapter | null {
  const m: any = report.measurements;
  const squares = insp?.approxSquares ?? report.roofDetails?.squares ?? m?.squares ?? null;
  const ft = (v: unknown) => (Number(v) > 0 ? `${Math.round(Number(v))} ft` : null);
  // A claim document never editorialises about age — that is a named policy exclusion argument.
  const age = jobType === 'insurance' ? '' : roofAge(report, SCROLL_STYLE);
  const stories = ans(insp, 'Number of Stories');
  const covering = ans(insp, 'Roof Covering Type');
  const pitch = ans(insp, 'Average pitch across ALL slopes');
  const layers = ans(insp, 'Number of existing layers');
  const shingleNote = ans(insp, 'Shingle type, manufacturer, and any second layer');
  const access = ans(insp, 'How was the roof accessed?');
  if (!squares && !stories && !covering && !pitch && !age) return null;
  return {
    id: 'measured', label: 'Your Roof, Measured',
    html: `<section class="sc-section ch ch--paper" id="ch-measured">
      <div class="sc-wrap" data-sc-in>
        <p class="sc-label">Chapter ${n}</p>
        <h2 class="sc-display sc-display--lg">Your Roof, Measured</h2>
        <p class="sc-body">${squares ? `An on-site field inspection${access ? ` (${esc(access.toLowerCase())})` : ''}${m?.documentName ? ` and a measurement report (${esc(String(m.documentName))})` : ''} put your roof at <b>${esc(String(squares))} squares</b>. ` : ''}Not a driveway guess &mdash; this is what was actually walked and measured, and it is what your pricing below is built from.</p>
        ${factGrid([
          ['Roof size', squares ? `${squares} squares${m?.documentName ? ' (measured)' : ''}` : null],
          ['Stories', stories],
          ['Existing covering', covering],
          ['Average pitch', pitch ?? (m?.predominantPitch ? String(m.predominantPitch) : null)],
          ['Existing layers', layers],
          ['Facets', m?.facets ? String(m.facets) : null],
          ['Ridges &amp; hips', ft(m?.ridgesHipsFt)],
          ['Valleys', ft(m?.valleysFt)],
          ['Eaves', ft(m?.eavesFt)],
          ['Rakes', ft(m?.rakesFt)],
        ])}
        ${shingleNote ? `<p class="sc-body tiny">${esc(shingleNote)}</p>` : ''}
        ${age ? `<p class="sc-label" style="margin-top:var(--sc-6)">Roof age &middot; estimate</p>${age}` : ''}
      </div>
    </section>`,
  };
}

function chGroundExterior(insp: InspectionReportContext | null, n: number): Chapter | null {
  const gutters = ans(insp, 'Gutters and downspouts');
  const siding = ans(insp, 'Siding damage');
  const otherExt = ans(insp, 'Other exterior damage - windows, fencing, garage doors, AC units');
  const groundNotes = ans(insp, 'Ground view notes');
  if (!gutters && !siding && !otherExt && !groundNotes) return null;
  return {
    id: 'exterior', label: 'Ground & Exterior',
    html: `<section class="sc-section ch ch--paper" id="ch-exterior">
      <div class="sc-wrap" data-sc-in data-sc-stagger="50">
        <p class="sc-label">Chapter ${n}</p>
        <h2 class="sc-display sc-display--lg">Ground &amp; Exterior</h2>
        <p class="sc-body">Before anyone got on the roof, we walked the ground level: gutters, siding, and anything else on the property that could have taken damage in the same event.</p>
        ${factGrid([
          ['Gutters &amp; downspouts', gutters],
          ['Siding damage found', siding],
          ['Other exterior damage', otherExt],
        ])}
        ${groundNotes ? `<p class="sc-body"><b>Notes:</b> ${esc(groundNotes)}</p>` : ''}
      </div>
    </section>`,
  };
}

/**
 * The roof assembly, graded against the standard (sections/inspection-facts.ts
 * — the same table the Inspection prints, so the two documents cannot
 * disagree about what was found or what it means).
 */
function chAssembly(insp: InspectionReportContext | null, n: number): Chapter | null {
  const asm = assemblyAgainstStandard(insp, SCROLL_STYLE);
  if (!asm.html) return null;
  return {
    id: 'assembly', label: 'What Is Already There',
    html: `<section class="sc-section ch ch--paper" id="ch-assembly">
      <div class="sc-wrap" data-sc-in data-sc-stagger="40">
        <p class="sc-label">Chapter ${n}${asm.attention ? ` &middot; ${asm.attention} item${asm.attention === 1 ? '' : 's'} need attention` : ''}</p>
        <h2 class="sc-display sc-display--lg">What Is Already There</h2>
        <p class="sc-body">Every roof is built from the same handful of components. Here is exactly what we found on yours, component by component, and how each part measures against the standard we build to &mdash; before we recommend anything. &ldquo;Needs attention&rdquo; means we correct it as part of the new roof.</p>
        ${asm.html}
      </div>
    </section>`,
  };
}

function chAttic(insp: InspectionReportContext | null, n: number): Chapter | null {
  const leaks = ans(insp, 'Leaks or water damage in the attic or interior');
  const decking = ans(insp, 'Decking type and condition');
  const notes = ans(insp, 'Attic and interior notes');
  if (!leaks && !decking && !notes) return null;
  return {
    id: 'attic', label: 'Attic & Interior',
    html: `<section class="sc-section ch ch--paper" id="ch-attic">
      <div class="sc-wrap" data-sc-in data-sc-stagger="50">
        <p class="sc-label">Chapter ${n}</p>
        <h2 class="sc-display sc-display--lg">Attic &amp; Interior</h2>
        <p class="sc-body">Nobody can grade the deck properly until the shingles come off &mdash; but the attic tells us a lot before that day. Staining on the underside of the roof, damp insulation, or a soft spot are all visible from underneath, and we check for all three.</p>
        ${factGrid([['Leaks / water damage found', leaks], ['Decking condition', decking]])}
        ${notes ? `<p class="sc-body"><b>Notes:</b> ${esc(notes)}</p>` : ''}
      </div>
    </section>`,
  };
}

function chDamageDetail(insp: InspectionReportContext | null, jobType: 'retail' | 'insurance' | undefined, n: number): Chapter | null {
  const hail = ans(insp, 'Hail hits per test square by slope');
  const wind = ans(insp, 'Wind damage found');
  const softMetal = ans(insp, 'Soft metal hits found');
  const granule = ans(insp, 'Granule loss or accumulation in gutters and downspouts');
  const matching = ans(insp, 'Is shingle matching possible?');
  if (!hail && !wind && !softMetal && !matching) return null;
  const title = jobType === 'insurance' ? 'The Claim Evidence' : 'The Damage, In Detail';
  return {
    id: 'damage-detail', label: title,
    html: `<section class="sc-section ch ch--paper" id="ch-damage-detail">
      <div class="sc-wrap" data-sc-in>
        <p class="sc-label">Chapter ${n}</p>
        <h2 class="sc-display sc-display--lg">${esc(title)}</h2>
        ${jobType === 'insurance' ? `<p class="sc-body">This is the same list your adjuster will be looking for. We document it the same way every time, so there is nothing to argue about later.</p>` : ''}
        ${hail ? `<div class="certificate"><p class="sc-body"><b>Hail hits per test square, by slope:</b> ${esc(hail)}</p></div>` : ''}
        ${factGrid([
          ['Wind damage found', wind],
          ['Soft metal hits (AC, gutters, vents, flashing)', softMetal],
          ['Granule loss in gutters', granule],
          ['Shingle matching still possible?', matching],
        ])}
      </div>
    </section>`,
  };
}

export function chWhoWeAre(n: number, audience: 'residential' | 'commercial' = 'residential'): Chapter | null {
  const story = ownersStory();
  const values = companyValues(audience).map(([t, d]) => `<div class="value-line"><b>${esc(t)}</b><span>${esc(d)}</span></div>`).join('');
  // Nothing the company has written about itself yet: no chapter.
  if (!story && !values) return null;
  const p = companyBrand();
  return {
    id: 'who', label: 'Who We Are',
    html: `<section class="sc-section ch ch--paper" id="ch-who">
      <div class="sc-wrap who-grid">
        <div class="sc-stack" data-sc-in data-sc-stagger="70">
          <p class="sc-label">Chapter ${n}</p>
          <h2 class="sc-display sc-display--lg">${esc(story?.heading || `About ${p.displayName}`)}</h2>
          ${story ? story.paragraphs.map((t) => `<p class="sc-body">${esc(t)}</p>`).join('') : ''}
          ${story ? `<p class="sig">${story.signature}</p>` : ''}
          ${values ? `<div class="values-list">${values}</div>` : ''}
        </div>
        ${story?.photoUrl ? `<figure data-sc-reveal="right" data-sc-reveal-at="0.15 0.6" class="who-photo">
          <img src="${esc(story.photoUrl)}" alt="${esc(story.photoCaption || `The team at ${p.displayName}`)}" loading="lazy">
          ${story.photoCaption ? `<figcaption>${esc(story.photoCaption)}</figcaption>` : ''}
        </figure>` : ''}
      </div>
    </section>`,
  };
}

/** A deep dive on the recommended/starting tier's product, like Bailey's "What Grand Manor Is" chapter, generalized to whichever product a rep actually picked. */
/** The property-specific write-up (report-narrative.ts), when one was generated. */
export function chNarrative(report: ComprehensiveRoofReport, n: number): Chapter | null {
  const body = narrativeHtml((report as any).narrative?.findings, SCROLL_STYLE);
  if (!body) return null;
  return {
    id: 'narrative', label: 'Your Roof',
    html: `<section class="sc-section ch ch--dark" id="ch-narrative">
      <div class="sc-wrap sc-stack sc-prose" data-sc-in data-sc-stagger="40">
        <p class="sc-label">Chapter ${n}</p>
        <h2 class="sc-display sc-display--lg">Your Roof, Specifically</h2>
        ${body}
      </div>
    </section>`,
  };
}

export function chProduct(pricing: { good: TierPricing; better: TierPricing; best: TierPricing }, startingTier: 'good' | 'better' | 'best', n: number, report?: ComprehensiveRoofReport): Chapter {
  const t = pricing[startingTier];
  // The product's own photo when we have one (commercial membranes), else the
  // generic installed-roof photo with its honest generic caption.
  const photo = productImage(t.product.key, t.product.name);
  const service = isServiceProduct(t.product);
  const solution = narrativeHtml((report as any)?.narrative?.solution, SCROLL_STYLE);
  return {
    id: 'product', label: `What ${t.product.name.split(' ').slice(-1)[0]} Is`,
    html: `<section class="sc-section ch ch--dark" id="ch-product">
      <div class="sc-wrap who-grid" data-sc-in data-sc-stagger="60">
        <div class="sc-stack">
          <p class="sc-label">Chapter ${n} &middot; Our Recommendation</p>
          <h2 class="sc-display sc-display--lg">${esc(t.product.name)}</h2>
          ${solution ? `<div class="sc-stack sc-prose"><p class="sc-label">Why this, for this roof</p>${solution}</div>` : ''}
          ${productSpecPanel({ product: t.product, ownHeading: false, ownPhoto: false }, SCROLL_STYLE)}
          ${service ? '' : `<p class="sc-body tiny">Every roof we install gets the same crew, the same tear-off, and the full system its manufacturer specifies underneath &mdash; the next chapter walks it layer by layer, and the Options chapter ahead lays out what changes between tiers.</p>`}
        </div>
        ${service ? '' : `<figure class="who-photo">
          <img src="${esc(photo.src)}" alt="${esc(t.product.name)}" loading="lazy">
          <figcaption>${photo.caption}</figcaption>
        </figure>`}
      </div>
    </section>`,
  };
}

/** For a tune-up or cleaning: what the visit covers, and plainly what it is not — no warranty years. */
function chServiceCovers(n: number, t: TierPricing): Chapter {
  return {
    id: 'system', label: 'What It Covers',
    html: `<section class="sc-section ch ch--paper" id="ch-system">
      <div class="sc-wrap sc-stack" data-sc-in data-sc-stagger="60">
        <p class="sc-label">Chapter ${n}</p>
        <h2 class="sc-display sc-display--lg">What This Visit Covers</h2>
        ${serviceIncludesList(t.product, SCROLL_STYLE)}
        <p class="sc-body">${warrantyFor(t.product).manufacturerLine}. When the roof does need replacing, the options in this document are still here.</p>
      </div>
    </section>`,
  };
}

/**
 * The package layer by layer with the manufacturer's photo of each part
 * (./sections/roof-system-walkthrough.ts), then the promise behind it. A
 * rep-typed custom product has no catalog system, so it gets the warranty
 * seal alone — the six generic Integrity rows this used to print would have
 * been wrong on it.
 */
export function chSystem(n: number, t: TierPricing): Chapter {
  if (isServiceProduct(t.product)) return chServiceCovers(n, t);
  const system = roofSystemFor(t.product);
  const rows = system ? roofSystemWalkthrough(system, SCROLL_STYLE) : '';
  const w = warrantyFor(t.product);
  // CertainTeed's system and SureStart PLUS registration are CertainTeed
  // claims — a metal or synthetic roof gets its own manufacturer's terms.
  const workmanship = w.workmanshipYears ? `our own <b>${w.workmanshipYears}-year workmanship warranty</b>` : 'our workmanship warranty';
  const lede = w.certainteed
    ? warranty().certificationCopy
    : `Every roof we install carries ${workmanship} on the installation. The <b>${esc(t.product.name)}</b> carries its manufacturer's warranty on the material &mdash; ${w.manufacturerLine}.`;
  const seal = w.manufacturerYears != null
    ? `<div><span data-sc-count="0 ${w.manufacturerYears}">0</span><b>Yr Manufacturer</b></div>`
    : `<div class="cert-seal--text"><span>${esc(w.manufacturer)}</span><b>Manufacturer warranty</b></div>`;
  return {
    id: 'system', label: w.certainteed ? 'Integrity System' : system ? 'The System' : 'Warranty',
    html: `<section class="sc-section ch ch--paper" id="ch-system">
      <div class="sc-wrap sc-stack" data-sc-in data-sc-stagger="60">
        <p class="sc-label">Chapter ${n}</p>
        <h2 class="sc-display sc-display--lg">${w.certainteed ? 'The Integrity Roof System' : system ? 'How Your Roof Goes Together' : 'What Stands Behind It'}</h2>
        ${rows}
        <p class="sc-body">${lede}</p>
        <div class="certificate">
          <div class="cert-seal">
            ${seal}
            ${w.workmanshipYears ? `<div><span data-sc-count="0 ${w.workmanshipYears}">0</span><b>Yr Workmanship</b></div>` : ''}
          </div>
          ${w.certainteed ? `<p class="sc-body tiny">${w.manufacturerLine}.</p>` : ''}
        </div>
      </div>
    </section>`,
  };
}

function chVentilation(n: number, insp: InspectionReportContext | null, squares: number | null): Chapter {
  // The prose is the why; the numbers beneath it are THIS roof's requirement
  // and the rep's plan for it (sections/inspection-facts.ts).
  const yours = ventilation(insp, squares, SCROLL_STYLE);
  return {
    id: 'ventilation', label: 'Ventilation',
    html: `<section class="sc-section ch ch--dark" id="ch-ventilation">
      <div class="sc-wrap" data-sc-in>
        <p class="sc-label">Chapter ${n}</p>
        <h2 class="sc-display sc-display--lg">Ventilation, and Why It Matters</h2>
        ${yours ? `<div class="sc-stack ventilation-yours"><p class="sc-label">Your attic</p>${yours}</div>` : ''}
        <p class="sc-body">A roof that cannot breathe cooks itself from underneath. Warm, damp air rises out of the house into the attic year-round &mdash; it has to get out. If it cannot, trapped heat bakes the shingle from the back and ages it years faster than the warranty assumes, and warm air meeting a cold deck in winter puts condensation on the wood, which shows up as staining and, over enough time, rot in a roof that never once let rain in.</p>
        <p class="sc-body">Ventilation is a balance, not a product: air has to come in low at the eaves and go out high at the ridge. We size the exhaust against the actual attic area it has to serve, check that the intake at the soffits is not blocked, and never mix exhaust types on the same attic &mdash; ridge vent plus box vents plus a powered fan sounds like more ventilation, but it is usually less, because the ridge ends up pulling air from the nearest vent instead of from the eaves.</p>
        <p class="sc-body tiny">Worth knowing: manufacturers can decline a warranty claim on a roof that was not adequately ventilated. Getting this right is not an upsell &mdash; it is what keeps the rest of the paperwork in this document worth something.</p>
      </div>
    </section>`,
  };
}

/**
 * Color options, from the shared builder (./sections/color-options.ts).
 *
 * Returns null when the product has no published color list (standing-seam
 * metal, a rep-typed custom product): the builder returns '' in that case on
 * purpose, and a "Your Color Options" heading over an empty chapter is worse
 * than no chapter — the same degrade-or-omit rule every inspection-detail
 * chapter above follows.
 */
function chColors(pricing: { good: TierPricing; better: TierPricing; best: TierPricing }, startingTier: 'good' | 'better' | 'best', n: number): Chapter | null {
  const t = pricing[startingTier];
  const inner = colorOptions({ product: t.product }, SCROLL_STYLE);
  if (!inner) return null;
  return {
    id: 'colors', label: 'Color Options',
    html: `<section class="sc-section ch ch--paper" id="ch-colors">
      <div class="sc-wrap" data-sc-in>
        <p class="sc-label">Chapter ${n}</p>
        <h2 class="sc-display sc-display--lg">Your Color Options</h2>
        ${inner}
      </div>
    </section>`,
  };
}

/** The install sequence, from the shared builder (./sections/how-the-job-runs.ts). */
function chProcess(n: number): Chapter {
  return {
    id: 'process', label: 'How the Job Runs',
    html: `<section class="sc-section ch ch--dark" id="ch-process">
      <div class="sc-wrap sc-stack" data-sc-in data-sc-stagger="60">
        <p class="sc-label">Chapter ${n}</p>
        <h2 class="sc-display sc-display--lg">How the Job Runs</h2>
        ${howTheJobRuns(SCROLL_STYLE)}
      </div>
    </section>`,
  };
}

export function chFaq(n: number): Chapter {
  const qas: Array<[string, string]> = [
    ['What if it rains partway through tear-off?', "We don't open more roof than we can dry in the same day. If weather is close, we plan around it rather than leave your home exposed overnight."],
    ['What if you find rotten wood under the old shingles?', 'It gets photographed and priced, and you approve it in writing before anyone touches it. Nothing gets added or covered up without you seeing it first.'],
    ['Do I need to be home during the work?', "No, but we'll keep you updated, and you're welcome to be there for tear-off, which is the loudest part of the job."],
    ['Can I change my color after I sign?', "Yes, up until the material is ordered. We'd rather you take the time to get it right with a physical sample than rush the decision."],
    ['Who do I call if something goes wrong later?', "Us — the number on this page. We register the manufacturer warranty and handle any claim with them directly; you don't deal with the manufacturer yourself."],
  ];
  const rows = qas.map(([q, a]) => `<div class="faq-row"><b>${esc(q)}</b><span>${esc(a)}</span></div>`).join('');
  return {
    id: 'faq', label: 'Questions',
    html: `<section class="sc-section ch ch--paper" id="ch-faq">
      <div class="sc-wrap" data-sc-in data-sc-stagger="50">
        <p class="sc-label">Chapter ${n}</p>
        <h2 class="sc-display sc-display--lg">Questions People Ask</h2>
        <div class="faq-list">${rows}</div>
      </div>
    </section>`,
  };
}

/** Completed projects on a live map; left out until Archie has a per-company project feed (project-map-widget.ts). */
export function chOurWork(n: number): Chapter | null {
  if (!ourWorkMapAvailable()) return null;
  return {
    id: 'our-work', label: 'Our Work',
    html: `<section class="sc-section ch ch--dark" id="ch-our-work">
      <div class="sc-wrap sc-stack" data-sc-in>
        <p class="sc-label">Chapter ${n}</p>
        <h2 class="sc-display sc-display--lg">See Our Work Near You</h2>
        <p class="sc-body">Real completed projects near you &mdash; tap any pin to see before &amp; after photos from a real job, not a stock image.</p>
        ${projectMapContainerHtml()}
      </div>
    </section>`,
  };
}

/**
 * Financing, from the shared builder (./sections/financing.ts), which keeps
 * the original decision to invent no APR and no monthly-payment figure: the
 * point of a real partner link is that the actual numbers come from the
 * lender's own application. Left out when the company has no partner.
 */
function chFinancing(n: number): Chapter | null {
  if (!hasFinancing()) return null;
  return {
    id: 'financing', label: 'Financing',
    html: `<section class="sc-section ch ch--paper" id="ch-financing">
      <div class="sc-wrap sc-stack" data-sc-in>
        <p class="sc-label">Chapter ${n}</p>
        <h2 class="sc-display sc-display--lg">Financing Options</h2>
        ${financing(SCROLL_STYLE)}
      </div>
    </section>`,
  };
}

export function chOptions(pricing: { good: TierPricing; better: TierPricing; best: TierPricing }, startingTier: 'good' | 'better' | 'best', n: number, scopeTotal = 0): Chapter {
  // data-price drives the Investment counter, so it carries the scope too.
  const card = (t: TierPricing) => `<button type="button" class="opt-card" data-tier="${t.tier}" data-price="${Math.round((t.total + scopeTotal) * 100) / 100}" data-roof="${Math.round(t.total * 100) / 100}" role="tab" aria-selected="${t.tier === startingTier ? 'true' : 'false'}" id="tab-${t.tier}" aria-controls="panel-${t.tier}">
      <span class="opt-tier">${t.tier}</span>
      <span class="opt-name">${esc(t.product.name)}</span>
      <span class="opt-price">${usd(t.total)}</span>
      ${t.iso ? `<span class="opt-scope">includes ${esc(t.iso.label)}</span>` : ''}
      ${scopeTotal > 0 ? `<span class="opt-scope">+ ${usd(scopeTotal)} additional scope</span>` : ''}
    </button>`;
  const panel = (t: TierPricing) => {
    const spec = specFor(t.product.key);
    return `<div class="opt-panel" id="panel-${t.tier}" role="tabpanel" aria-labelledby="tab-${t.tier}" ${t.tier === startingTier ? '' : 'hidden'}>
      <p class="opt-tagline">${esc(t.product.tagline)}</p>
      <p class="sc-body">${t.product.body}</p>
      ${serviceIncludesList(t.product, SCROLL_STYLE)}
      <dl class="opt-specs">
        <div><dt>Rate</dt><dd>${usd(t.ratePerSquare)} / square</dd></div>
        <div><dt>Roof size</dt><dd>${t.squares} squares</dd></div>
        <div><dt>Total</dt><dd class="opt-total">${usd(t.total)}</dd></div>
      </dl>
      ${spec ? factGrid([
        ['Impact resistance', spec.impactClass],
        ['Algae-resistance warranty', `${spec.algaeWarrantyYears} years`],
        ['Fire rating', spec.fireRating],
      ]) : ''}
    </div>`;
  };
  return {
    id: 'options', label: 'Your Options',
    html: `<section class="sc-section ch ch--paper ch--peak" id="ch-options">
      <div class="sc-wrap">
        <p class="sc-label" data-sc-in>Chapter ${n} &middot; The Peak</p>
        <h2 class="sc-display sc-display--lg" data-sc-in>Your Options</h2>
        <p class="sc-body" data-sc-in>${[pricing.good, pricing.better, pricing.best].some((t) => isServiceProduct(t.product))
          ? 'Good, Better, or Best &mdash; from caring for the roof you have to putting on a new one. Tap one.'
          : 'Good, Better, or Best &mdash; the same crew, the same tear-off, the full manufacturer system underneath. Tap one.'}</p>
        <div class="opt-instrument" data-sc-in>
          <div class="opt-tabs" role="tablist" aria-label="Good, Better, Best">${card(pricing.good)}${card(pricing.better)}${card(pricing.best)}</div>
          ${panel(pricing.good)}${panel(pricing.better)}${panel(pricing.best)}
        </div>
      </div>
    </section>`,
  };
}

export function chInvestment(startingTier: 'good' | 'better' | 'best', pricing: { good: TierPricing; better: TierPricing; best: TierPricing }, n: number, report: ComprehensiveRoofReport): Chapter {
  const t = pricing[startingTier];
  const scopeTotal = scopeTotalOf(report);
  const total = Math.round((t.total + scopeTotal) * 100) / 100;
  const scope = scopeTable({ report, roofSystemLabel: `Roof system — ${t.product.name}`, roofSystemTotal: t.total }, SCROLL_STYLE);
  return {
    id: 'investment', label: 'Investment',
    html: `<section class="sc-section ch ch--dark ch--investment" id="ch-investment">
      <div class="sc-wrap" data-sc-in>
        <p class="sc-label">Chapter ${n}</p>
        <h2 class="sc-display sc-display--lg">The Investment</h2>
        <p class="sc-body inv-lede">Based on the <span data-inv-tier-name>${esc(t.product.name)}</span> option selected above${scopeTotal > 0 ? ', plus the additional scope listed below' : ''}. Choose a different tier there and this number follows it.</p>
        <p class="inv-total"><span data-tier-total="${total}" id="inv-total-count">0</span></p>
        ${scope}
        <p class="sc-body inv-note">This is a real quote from real squares, confirmed on site before any work begins. Final scope and price are locked in once you sign.</p>
      </div>
    </section>`,
  };
}

export function chWhy(n: number): Chapter | null {
  const p = companyBrand();
  const markers = p.credentials.map((m) => `<span>${esc(m)}</span>`).join(' &middot; ');
  const reasons = p.whyUs.map((r) => `<li>${esc(r)}</li>`).join('');
  if (!reasons && !markers) return null;
  return {
    id: 'why', label: 'Why Us',
    html: `<section class="sc-section ch ch--paper" id="ch-why">
      <div class="sc-wrap" data-sc-in data-sc-stagger="60">
        <p class="sc-label">Chapter ${n}</p>
        <h2 class="sc-display sc-display--lg">Why ${esc(p.displayName)}</h2>
        ${reasons ? `<ul class="why-list">${reasons}</ul>` : ''}
        ${markers ? `<p class="obj-markers">${markers}</p>` : ''}
      </div>
    </section>`,
  };
}

/** `salutation` defaults to the customer's first name; a company is addressed by its full name. */
export function chNext(customer: string, n: number, salutation: string = customer.split(' ')[0] || 'there'): Chapter {
  const p = companyBrand();
  const markers = p.credentials.map((m) => `<span>${esc(m)}</span>`).join(' &middot; ');
  const tel = companyTel();
  return {
    id: 'next', label: 'Next Step',
    html: `<section class="sc-section ch ch--dark ch--close" id="ch-next">
      <div class="sc-wrap">
        <p class="sc-label">Chapter ${n}</p>
        <h2 class="sc-display sc-display--md">One decision left, ${esc(salutation)}.</h2>
        <p class="sc-body">Tell your ${esc(p.displayName)} rep which tier you want, and we turn this presentation into a signed job &mdash; the same numbers you saw above, nothing renegotiated after the fact.</p>
        ${p.phone && tel ? `<p class="cta-tel"><a href="${tel}">${esc(p.phone)}</a></p>` : ''}
        <p class="colophon">${esc(p.displayName)}${markers ? ` &middot; ${markers}` : ''}</p>
      </div>
    </section>`,
  };
}

/* ----------------------------------------------------------------- css --- */

export const PAGE_CSS = `
:root {
  --sc-canvas: #F7F4EE; --sc-surface: #FFFFFF;
  --sc-ink: #17130F; --sc-ink-soft: #6B6259;
  --sc-accent: #1F3A5F; --sc-accent-ink: #FFFFFF;
  --sc-font-display: 'Fraunces', Georgia, serif;
  --sc-font-text: 'Archivo', system-ui, sans-serif;
}
.ch { background: var(--sc-canvas); color: var(--sc-ink); position: relative; }
.ch--dark { --sc-canvas: #17130F; --sc-ink: #F5EFE6; --sc-ink-soft: #B4A99A; background: var(--sc-canvas); color: var(--sc-ink); }
.ch--paper { --sc-canvas: #F7F4EE; --sc-ink: #17130F; --sc-ink-soft: #6B6259; }
.tiny { font-size: var(--sc-t-xs); color: var(--sc-ink-soft); }
.muted { color: var(--sc-ink-soft); }

.folio-nav { position: fixed; left: var(--sc-2); top: 50%; translate: 0 -50%; z-index: var(--sc-z-chrome); display: flex; flex-direction: column; gap: var(--sc-3); }
.folio-nav a { font-family: var(--sc-font-text); font-size: 11px; letter-spacing: .06em; text-transform: uppercase; color: color-mix(in oklab, var(--sc-ink, #17130F) 40%, transparent); text-decoration: none; writing-mode: vertical-rl; padding: var(--sc-2) 0; }
.folio-nav a.is-active { color: var(--sc-accent); font-weight: 600; }
@media (max-width: 860px) { .folio-nav { display: none; } }

.ch--title { padding-top: clamp(6rem, 18vh, 11rem); padding-bottom: var(--sc-9); }
.folio-eyebrow { margin: 0 0 var(--sc-3); }
.title-name { font-size: clamp(2.6rem, 3vw + 2rem, 5rem); }
.title-address { margin-top: var(--sc-3); }
.title-date { margin-top: var(--sc-5); color: var(--sc-ink-soft); }
.title-intro { margin-top: var(--sc-7); max-width: 52ch; }

.obj-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--sc-4); margin: var(--sc-6) 0; }
@media (max-width: 480px) { .obj-stats { grid-template-columns: 1fr; } }
.obj-stats .stat { background: color-mix(in oklab, var(--sc-surface, #fff) 8%, transparent); border: 1px solid var(--sc-hairline); border-radius: var(--sc-r-lg); padding: var(--sc-5); text-align: center; }
.obj-stats .stat span { display: block; font-family: var(--sc-font-display); font-size: var(--sc-t-3xl); color: var(--sc-accent); }
.obj-stats .stat b { font-size: var(--sc-t-xs); text-transform: uppercase; letter-spacing: var(--sc-track-wide); color: var(--sc-ink-soft); }

.found-grid { margin-top: var(--sc-6); display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: var(--sc-4); }
.found-photo { margin: 0; background: color-mix(in oklab, var(--sc-surface, #fff) 8%, transparent); border: 1px solid var(--sc-hairline); border-radius: var(--sc-r-lg); overflow: hidden; }
.found-photo img { width: 100%; height: 200px; object-fit: cover; display: block; }
.found-photo figcaption { padding: var(--sc-3) var(--sc-4); font-size: var(--sc-t-sm); }
.found-photo figcaption span { display: block; color: var(--sc-ink-soft); font-size: var(--sc-t-xs); margin-top: 2px; }
.found-photo figcaption .found-why { margin-top: 6px; }
.opt-scope { display: block; font-size: var(--sc-t-xs); color: var(--sc-ink-soft); margin-top: 2px; }
${SCOPE_TABLE_CSS}
${NARRATIVE_CSS}
${INSPECTION_FACTS_CSS}
${ROOF_SYSTEM_CSS_SCROLL}
.asm-table th, .asm-table td { border-color: var(--sc-hairline); }
.asm-table th { color: var(--sc-ink-soft); }
.found-summary { margin-top: var(--sc-4); max-width: 62ch; }
.storm-evidence { margin-top: var(--sc-7); }
.ventilation-yours { margin-bottom: var(--sc-7); }
.sc-prose { max-width: 62ch; }
.cert-seal--text span { display: block; font-family: var(--sc-font-display); font-size: var(--sc-t-lg); line-height: 1.2; }

/* .fact-grid / .fact / .spec-colors / .spec-chip moved to SECTION_CSS_SCROLL
   (./sections/style.ts), appended at the foot of this stylesheet. */

.who-grid { display: grid; grid-template-columns: 1.1fr 0.9fr; gap: var(--sc-8); align-items: start; }
@media (max-width: 860px) { .who-grid { grid-template-columns: 1fr; } }
.sig { font-family: var(--sc-font-display); font-style: italic; margin-top: var(--sc-5); }
.values-list { margin-top: var(--sc-7); display: grid; gap: var(--sc-4); }
.value-line b { display: block; font-family: var(--sc-font-display); }
.value-line span { color: var(--sc-ink-soft); font-size: var(--sc-t-sm); }
.who-photo { position: sticky; top: var(--sc-8); }
.who-photo img { display: block; width: 100%; max-width: 460px; aspect-ratio: 600 / 905; object-fit: cover; object-position: 0% 22%; border-radius: var(--sc-r-md); margin: 0 auto; box-shadow: var(--sc-e2); }
.who-photo figcaption { margin-top: var(--sc-3); font-size: var(--sc-t-xs); color: var(--sc-ink-soft); text-align: center; }
#ch-product .who-photo img { aspect-ratio: 4 / 5; object-position: center; }

.opt-tagline { font-family: var(--sc-font-display); font-style: italic; font-size: var(--sc-t-lg); margin: var(--sc-2) 0 var(--sc-3); }

.certificate { margin-top: var(--sc-8); border: 1px solid var(--sc-hairline-strong); border-radius: var(--sc-r-lg); padding: var(--sc-7); background: var(--sc-surface); }
.ig-rows { display: grid; gap: var(--sc-4); }
.ig-row b { display: block; font-family: var(--sc-font-display); }
.ig-row span { color: var(--sc-ink-soft); font-size: var(--sc-t-sm); }
.cert-seal { margin-top: var(--sc-7); padding-top: var(--sc-7); border-top: 1px dashed var(--sc-hairline-strong); display: flex; gap: var(--sc-8); justify-content: center; }
.cert-seal div { text-align: center; }
.cert-seal span { display: block; font-family: var(--sc-font-display); font-size: var(--sc-t-3xl); color: var(--sc-accent); }
.cert-seal b { font-size: var(--sc-t-xs); text-transform: uppercase; letter-spacing: var(--sc-track-wide); color: var(--sc-ink-soft); }

/* .roofstrip moved to SECTION_CSS_SCROLL (./sections/style.ts). */

.faq-list { margin-top: var(--sc-6); display: grid; gap: var(--sc-5); }
.faq-row b { display: block; font-family: var(--sc-font-display); font-size: var(--sc-t-lg); margin-bottom: var(--sc-2); }
.faq-row span { color: var(--sc-ink-soft); font-size: var(--sc-t-sm); }

.ch--peak { padding-block: var(--sc-10); }
.opt-instrument { margin-top: var(--sc-7); }
.opt-tabs { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--sc-3); }
.opt-card { font: inherit; text-align: left; cursor: pointer; background: var(--sc-surface); border: 2px solid var(--sc-hairline); border-radius: var(--sc-r-lg); padding: var(--sc-5); display: flex; flex-direction: column; gap: var(--sc-2); transition: border-color var(--sc-d-base) var(--sc-ease-out), transform var(--sc-d-fast) var(--sc-ease-out); }
@media (hover: hover) { .opt-card:hover { border-color: color-mix(in oklab, var(--sc-accent) 40%, var(--sc-hairline)); } }
.opt-card:active { transform: scale(0.98); }
.opt-card[aria-selected="true"] { border-color: var(--sc-accent); box-shadow: var(--sc-e1); }
.opt-tier { font-family: var(--sc-font-text); font-size: var(--sc-t-xs); text-transform: uppercase; letter-spacing: var(--sc-track-wide); color: var(--sc-ink-soft); }
.opt-card[aria-selected="true"] .opt-tier { color: var(--sc-accent); }
.opt-name { font-family: var(--sc-font-display); font-size: var(--sc-t-lg); }
.opt-price { font-family: var(--sc-font-display); font-size: var(--sc-t-xl); }
.opt-panel { margin-top: var(--sc-6); padding-top: var(--sc-6); border-top: 1px solid var(--sc-hairline); }
.opt-specs { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--sc-4); margin-top: var(--sc-5); }
.opt-specs dt { font-size: var(--sc-t-xs); text-transform: uppercase; letter-spacing: var(--sc-track-wide); color: var(--sc-ink-soft); }
.opt-specs dd { margin: var(--sc-1) 0 0; font-family: var(--sc-font-display); font-size: var(--sc-t-lg); }
.opt-total { color: var(--sc-accent); }
/* Tablet (iPad portrait 768–834px, landscape 1024–1180px): keep the three tiers
   side by side so the choice and its detail share one screen; shrink the type
   instead of stacking, so a long system name is two lines, not four. */
@media (max-width: 1180px) {
  .opt-tabs { gap: var(--sc-2); }
  .opt-card { padding: var(--sc-4); gap: var(--sc-1); min-width: 0; }
  .opt-name { font-size: var(--sc-t-base); line-height: 1.25; }
  .opt-price { font-size: var(--sc-t-lg); }
  .opt-specs { gap: var(--sc-3); }
}
/* Phone: one compact row per tier (tier + name left, price right) so all three
   fit above the detail panel instead of three tall cards pushing it off screen. */
@media (max-width: 600px) {
  .opt-tabs { grid-template-columns: 1fr; }
  .opt-card { display: grid; grid-template-columns: minmax(0, 1fr) auto; grid-template-areas: "tier price" "name price" "scope scope"; align-items: center; column-gap: var(--sc-3); row-gap: 2px; }
  .opt-tier { grid-area: tier; }
  .opt-name { grid-area: name; }
  .opt-price { grid-area: price; text-align: right; }
  .opt-scope { grid-area: scope; }
  .opt-specs { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}

.ch--investment { text-align: center; padding-block: var(--sc-10); }
.inv-lede { max-width: 46ch; margin-inline: auto; }
.inv-total { font-family: var(--sc-font-display); font-size: clamp(3.5rem, 8vw, 7rem); color: var(--sc-accent); margin: var(--sc-6) 0; }
.inv-total::before { content: "$"; }
.inv-note { max-width: 52ch; margin-inline: auto; }
.ch--investment .scope-table-wrap { text-align: left; }
@media (max-width: 600px) {
  .scope-table { font-size: 13px; }
  /* Drop the per-unit column: collapsing the <col> (not display:none on the
     cells) keeps the colspan="3" roof-system and total rows aligned. */
  .scope-table col.scope-col-each { visibility: collapse; }
  .scope-table tbody tr:not(.scope-roof) td:nth-child(2), .scope-table th:nth-child(2) { width: 1%; white-space: normal; }
  .scope-table th, .scope-table td { padding: 8px 4px; }
  .scope-badge { display: block; width: max-content; max-width: 100%; margin: 4px 0 0; white-space: normal; }
}

.why-list { line-height: 1.9; padding-left: 1.2em; margin-top: var(--sc-5); }
.obj-markers { margin-top: var(--sc-5); color: var(--sc-ink-soft); font-size: var(--sc-t-sm); }
/* .cta-tel moved to SECTION_CSS_SCROLL (./sections/style.ts). */

.ch--close { padding-block: var(--sc-10); }
.colophon { margin-top: var(--sc-8); padding-top: var(--sc-5); border-top: 1px solid var(--sc-hairline); font-size: var(--sc-t-xs); letter-spacing: var(--sc-track-wide); text-transform: uppercase; color: var(--sc-ink-soft); }

/* The shared sections' own CSS, against the --sc-* variables declared above.
   Carries the .fact-grid/.fact/.spec-colors/.spec-chip/.roofstrip/.cta-tel
   rules that used to be written out here, byte-for-byte. Appended last: none
   of its selectors collide with anything above, so load order is immaterial
   except for #ch-product .who-photo img, which outranks it on specificity. */
${SECTION_CSS_SCROLL}`;

/* ------------------------------------------------------------------ js --- */

export const PAGE_JS = `
(function () {
  var tabs = document.querySelectorAll('.opt-card');
  var panels = document.querySelectorAll('.opt-panel');
  var invCount = document.getElementById('inv-total-count');

  // The Investment number is fully hand-driven (no data-sc-count on this
  // element): it has to react to a click on Your Options, and the engine's
  // own scroll-triggered count fires once from a static attribute, which
  // would stomp a click-driven update the first time this section scrolls
  // into view. One tween function owns it end to end instead.
  var invCurrent = 0;
  var invRaf = null;
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function tweenCount(target) {
    if (reduceMotion) { invCurrent = target; if (invCount) invCount.textContent = Math.round(target).toLocaleString('en-US'); return; }
    var start = invCurrent, delta = target - start, t0 = performance.now(), dur = 1200;
    if (invRaf) cancelAnimationFrame(invRaf);
    function tick(now) {
      var p = Math.min(1, (now - t0) / dur);
      var eased = 1 - Math.pow(1 - p, 3);
      invCurrent = start + delta * eased;
      if (invCount) invCount.textContent = Math.round(invCurrent).toLocaleString('en-US');
      if (p < 1) invRaf = requestAnimationFrame(tick); else invCurrent = target;
    }
    invRaf = requestAnimationFrame(tick);
  }


  // The Investment chapter follows the tier the reader tapped, not the one the
  // report was generated with: the count-up target and the scope table's
  // roof-system row and total are all rewritten on select().
  var invTarget = invCount ? (Number(invCount.dataset.tierTotal) || 0) : 0;
  function usd(n) { return '$' + Math.round(n).toLocaleString('en-US'); }
  function followTier(card) {
    invTarget = Number(card.dataset.price) || 0;
    var roofLabel = document.querySelector('[data-scope-roof-label]');
    var roofTotal = document.querySelector('[data-scope-roof-total]');
    var grand = document.querySelector('[data-scope-grand-total]');
    var name = card.querySelector('.opt-name');
    if (roofLabel && name) roofLabel.textContent = 'Roof system \u2014 ' + name.textContent;
    if (roofTotal && card.dataset.roof) roofTotal.textContent = usd(Number(card.dataset.roof));
    if (grand) grand.textContent = usd(invTarget);
    var lede = document.querySelector('[data-inv-tier-name]');
    if (lede && name) lede.textContent = name.textContent;
  }
  function select(tier, fromTap) {
    tabs.forEach(function (t) { t.setAttribute('aria-selected', String(t.dataset.tier === tier)); });
    panels.forEach(function (p) { p.hidden = p.id !== 'panel-' + tier; });
    var card = document.querySelector('.opt-card[data-tier="' + tier + '"]');
    if (card) { followTier(card); if (invSeen) tweenCount(invTarget); }
    // The one place the page records which tier is showing; the commercial
    // layer diagram keys off it.
    document.documentElement.setAttribute('data-tier', tier);
    // On a tablet or phone the detail panel can sit below the fold, so a tap
    // looks like it did nothing. Bring the top of the panel on screen, but
    // never scroll when it is already visible (desktop stays still).
    if (fromTap) {
      var panel = document.getElementById('panel-' + tier);
      if (panel) {
        var r = panel.getBoundingClientRect();
        if (r.top > window.innerHeight * 0.6 || r.top < 0) {
          glideTo(window.scrollY + r.top - Math.min(96, window.innerHeight * 0.12));
        }
      }
    }
  }
  // A short rAF glide rather than behavior:'smooth' — the native smooth scroll
  // is cancelled by any other scroll write and stalls in an occluded window,
  // so it cannot be relied on (or tested); this one always arrives.
  function glideTo(top) {
    var from = window.scrollY, dist = top - from;
    if (Math.abs(dist) < 2) return;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { window.scrollTo({ top: top, behavior: 'instant' }); return; }
    var t0 = performance.now(), dur = 420;
    (function step(now) {
      var p = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - p, 3);
      window.scrollTo({ top: from + dist * e, behavior: 'instant' });
      if (p < 1) requestAnimationFrame(step);
    })(t0);
  }
  tabs.forEach(function (t) { t.addEventListener('click', function () { select(t.dataset.tier, true); }); });
  // A tier picked elsewhere on the page (the layer diagram) changes the tier
  // without scrolling the reader away from where they tapped.
  document.addEventListener('report:select-tier', function (e) { var tier = e.detail && e.detail.tier; if (tier) select(tier, false); });

  // The count-up runs once, when the number first comes on screen, to the
  // tier selected at that moment; after that every tap re-tweens it directly.
  var invSeen = false;
  if (invCount && 'IntersectionObserver' in window) {
    var invIo = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        invSeen = true;
        tweenCount(invTarget);
        invIo.disconnect();
      });
    }, { threshold: 0.5 });
    invIo.observe(invCount);
  } else if (invCount) {
    invSeen = true;
    tweenCount(invTarget);
  }

  var links = document.querySelectorAll('.folio-nav a');
  var sections = Array.prototype.map.call(links, function (a) { return document.querySelector(a.getAttribute('href')); }).filter(Boolean);
  if ('IntersectionObserver' in window && sections.length) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        links.forEach(function (a) { a.classList.remove('is-active'); });
        var idx = sections.indexOf(entry.target);
        if (idx > -1) links[idx].classList.add('is-active');
      });
    }, { rootMargin: '-45% 0px -45% 0px' });
    sections.forEach(function (s) { io.observe(s); });
  }
})();
`;

/* -------------------------------------------------------------- render --- */

/**
 * The report must already carry replacementOptions/selectedTier — set them
 * with estimate-replacement.ts's applyReplacementPricing() before calling
 * this, the same helper Estimate's replacement mode and Proposal use.
 */
function buildPresentationChapters(report: ComprehensiveRoofReport, opts: { customer?: string; rep?: string; jobType?: 'retail' | 'insurance'; inspection?: InspectionReportContext | null } = {}): Chapter[] {
  const options = report.replacementOptions as TierPricing[] | undefined;
  if (!options || options.length !== 3) {
    throw new Error('Pick your Good, Better and Best products and confirm the roof size before generating a Presentation.');
  }
  const pricing = { good: options[0], better: options[1], best: options[2] };
  const startingTier = report.selectedTier ?? 'better';
  const customer = opts.customer || 'Homeowner';
  const insp = opts.inspection ?? null;

  // Every chapter below that reads the field inspection degrades to "don't
  // render" when the underlying answers aren't there — a quick repair job's
  // checklist naturally has fewer filled-in fields than a full insurance
  // claim on a complex roof, so the document's length follows the job
  // instead of forcing every job through the same fixed chapter count.
  let i = 0;
  const next = () => ++i;
  const chapters: Chapter[] = [
    chWelcome(report, customer, opts.rep, opts.jobType, next()),
    chFound(report, next(), insp?.damageSummary, opts.jobType),
    chNarrative(report, next()),
    chMeasured(report, insp, next(), opts.jobType),
    chGroundExterior(insp, next()),
    chAssembly(insp, next()),
    chAttic(insp, next()),
    chDamageDetail(insp, opts.jobType, next()),
    chWhoWeAre(next()),
    chProduct(pricing, startingTier, next(), report),
    chSystem(next(), pricing[startingTier]),
    chVentilation(next(), insp, insp?.approxSquares ?? report.roofDetails?.squares ?? (report.measurements as any)?.squares ?? null),
    chColors(pricing, startingTier, next()),
    chOurWork(next()),
    chProcess(next()),
    chFaq(next()),
    chOptions(pricing, startingTier, next(), scopeTotalOf(report)),
    chInvestment(startingTier, pricing, next(), report),
    chFinancing(next()),
    chWhy(next()),
    chNext(customer, next()),
  ].filter(Boolean) as Chapter[];
  return chapters;
}

/** Chapters as layout sections — the key is the chapter id. */
export function presentationSections(chapters: Chapter[]): ReportSection[] {
  return chapters.map((c) => ({ key: c.id, label: c.label, html: c.html }));
}

/** Chapters print "Chapter N" from build order; after a reorder the numbers must follow the page. */
export function renumberChapters(sections: ReportSection[]): ReportSection[] {
  let n = 0;
  return sections.map((s) => (/<p class="sc-label">Chapter \d+/.test(s.html)
    ? { ...s, html: s.html.replace(/<p class="sc-label">Chapter \d+/, () => `<p class="sc-label">Chapter ${++n}`) }
    : s));
}

/**
 * The Presentation's chapters as the editor lists them. Builds the document
 * once (chapters that have nothing to say drop out) — same call the renderer
 * makes, so the list can't disagree with the page.
 */
export function presentationSectionList(report: ComprehensiveRoofReport, opts: { customer?: string; rep?: string; jobType?: 'retail' | 'insurance'; inspection?: InspectionReportContext | null } = {}): ReportSection[] {
  return presentationSections(buildPresentationChapters(report, opts));
}

export function renderPresentationScrollcraftHtml(report: ComprehensiveRoofReport, opts: { customer?: string; rep?: string; jobType?: 'retail' | 'insurance'; inspection?: InspectionReportContext | null } = {}): string {
  const options = report.replacementOptions as TierPricing[] | undefined;
  if (!options || options.length !== 3) {
    throw new Error('Pick your Good, Better and Best products and confirm the roof size before generating a Presentation.');
  }
  const pricing = { good: options[0], better: options[1], best: options[2] };
  const startingTier = report.selectedTier ?? 'better';
  const customer = opts.customer || 'Homeowner';
  const insp = opts.inspection ?? null;
  const chapters = buildPresentationChapters(report, opts);

  // The rep's saved layout hides and reorders chapters; the folio follows
  // the same list (PAGE_JS pairs links to sections by index), and the
  // "Chapter N" labels are renumbered to match the new order.
  const arranged = renumberChapters(arrangeSections(presentationSections(chapters), (report as any).layout));
  const folio = `<nav class="folio-nav" aria-label="Chapters">${arranged.map((c) => `<a href="#ch-${c.key}">${esc(c.label)}</a>`).join('')}</nav>`;
  const body = arranged.map(tagSection).join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<title>Presentation for ${esc(customer)} &middot; ${esc(companyBrand().displayName)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&family=Archivo:wght@400;500;600;700&display=swap" rel="stylesheet">
${PROJECT_MAP_HEAD}
<style>${SCROLLCRAFT_CSS}</style>
<style>${PAGE_CSS}</style>
<style>${PROJECT_MAP_CSS}</style>
<style>${MOBILE_CSS}</style>
${documentMetaTags(`Presentation for ${customer}`)}
${brandStyleTag()}
</head>
<body>
<span data-sc-progress></span>
<div class="sc-grain" aria-hidden="true"></div>
${folio}
<main id="top">
${body}
</main>
<script>${SCROLLCRAFT_JS}</script>
<script>${MOBILE_JS}</script>
<script>ScrollCraft.mount(document.body);</script>
<script>${PAGE_JS}</script>
<script>${PROJECT_MAP_JS}</script>
</body>
</html>`;
}
