/**
 * Itemized repair ESTIMATE document.
 *
 * The inspection report answers "what's wrong with this roof"; this answers
 * "what will it cost to fix". Same findings, same pricing table — presented as a
 * document a homeowner can hand to an adjuster or sign off on.
 *
 * It never re-prices anything: every figure comes from the stored report, so an
 * estimate and the inspection it came from can't disagree.
 */
import { premiumShell, esc, usd, usd2 } from './report-theme.js';
import { commercialIncludes } from './commercial-products.js';
import { arrangeSections, joinSections, type ReportSection } from './layout.js';
import { reportFooter } from './render-proposal-html.js';
import { scopeRows } from './certainteed-data.js';
import { toEstimateLines, estimateTotal } from './estimate-lines.js';
import type { ComprehensiveRoofReport } from './comprehensive-roof-report.js';
import { PROJECT_MAP_HEAD, PROJECT_MAP_CSS, PROJECT_MAP_JS, projectMapContainerHtml, ourWorkMapAvailable } from './project-map-widget.js';
import { DOCUMENT_STYLE, SECTION_CSS_DOCUMENT } from './sections/style.js';
import { scopeTotalOf } from './scope-items.js';
import { standardsFor, renderStandardsFootnote } from './damage-standards.js';
import { plainLanguageFor } from './plain-language-damage.js';
import { stormEvidence } from './sections/storm-evidence.js';
import { assemblyAttentionList, measuredRoofFacts, INSPECTION_FACTS_CSS, type InspectionFactsContext } from './sections/inspection-facts.js';
import { roofSystemWalkthrough, ROOF_SYSTEM_CSS_DOCUMENT } from './sections/roof-system-walkthrough.js';
import { existingAssembly, conditionMatrix, drainageAndMoisture, reroofPath, COMMERCIAL_FACTS_CSS } from './sections/commercial-facts.js';
import { commercialContextOf, isCommercialReport } from './commercial-context.js';
import { roofSystemFor } from './roof-systems.js';
import { warrantyFor } from './product-warranty.js';
import { productSpecPanel } from './sections/product-spec-panel.js';
import { colorOptions } from './sections/color-options.js';
import { financing, hasFinancing } from './sections/financing.js';
import { whyUs } from './sections/why-us.js';
import { companyBrand, companyTel } from './company-brand.js';


function fmtDate(iso?: string): string {
  try { return new Date(iso || Date.now()).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }); }
  catch { return ''; }
}

/**
 * A replacement quote is not a repair estimate. The hero and the document
 * title must say which.
 *
 * This shipped wrong: a $15,839 full replacement went to a customer titled
 * "Roof Repair Estimate", in both the <h1> and the browser/PDF title.
 */
export function estimateTitle(report: ComprehensiveRoofReport): string {
  return report.replacementOptions?.length ? 'Roof Replacement Estimate' : 'Roof Repair Estimate';
}

export function estimateHero(report: ComprehensiveRoofReport, customer?: string, jobType?: 'retail' | 'insurance'): string {
  const p = report.property;
  const where = [p?.address, p?.city, p?.state].filter(Boolean).join(', ');
  return `<header class="hero">
    <div class="hero__in">
      <p class="eyebrow">${esc(companyBrand().displayName)}${jobType === 'insurance' ? ' · Insurance Claim' : ''}</p>
      <h1>${esc(estimateTitle(report))}</h1>
      <p class="sub">${esc(customer || '')}${customer ? ' · ' : ''}${esc(where)}</p>
      <p class="sub tiny">Prepared ${esc(fmtDate(report.generatedAt))}</p>
    </div>
  </header>`;
}

/** A repair-itemized Estimate doesn't match a "full replacement" recommendation from the field — flag it so a rep doesn't hand over the wrong document. */
export function estimateRecommendationNotice(recommendation?: string | null): string {
  if (recommendation !== 'Full replacement') return '';
  return `<section>
    <p class="muted tiny" style="background:#FFF7ED;border:1px solid #FED7AA;border-radius:8px;padding:10px 14px">
      The field inspection recommended a <b>full replacement</b>. This document only prices individual repairs — a Proposal or Presentation is the right document for a replacement quote.
    </p>
  </section>`;
}

/** The Good/Better/Best comparison for a replacement Estimate — only rendered when replacementOptions was set (see estimate-replacement.ts). */
export function estimateReplacementSection(report: ComprehensiveRoofReport): string {
  const options = report.replacementOptions as Array<{ tier: 'good' | 'better' | 'best'; product: { name: string; tagline: string; category: string }; ratePerSquare: number; total: number }> | undefined;
  if (!options?.length) return '';
  const squares = report.roofDetails?.squares;
  const cards = options.map((o) => `<article class="tier ${o.tier === report.selectedTier ? 'tier--rec' : ''}">
    <div class="tier__name">${o.tier}${o.tier === report.selectedTier ? ' · This Quote' : ''}</div>
    <div class="tier__shingle">${esc(o.product.name)}</div>
    <div class="tier__price">${usd(o.total)}</div>
    <div class="tier__rate">${usd(o.ratePerSquare)}/sq${squares ? ` &times; ${squares} sq` : ''}</div>
    <div class="tier__warranty">${esc(o.product.tagline)}</div>
  </article>`).join('');
  const scopeTotal = scopeTotalOf(report);
  return `<section>
    <div class="sec-head"><h2>Your Options</h2><span class="n">${squares ? `${squares} squares` : ''}</span></div>
    <div class="tiers">${cards}</div>
    ${measuredRoofFacts(report, DOCUMENT_STYLE)}
    ${scopeTotal > 0 ? `<p class="muted tiny" style="margin-top:12px">Each option above is the roof system alone. This quote also includes <b>${usd(scopeTotal)}</b> of additional scope, itemised under Scope of Work below.</p>` : ''}
    <p class="muted tiny" style="margin-top:12px">This estimate is priced for the <b>${esc(report.selectedTier || '')}</b> option above. Ask your rep about the others any time before you sign.</p>
  </section>`;
}

/** The priced scope of work. */
export function estimateScopeSection(report: ComprehensiveRoofReport): string {
  const e: any = report.repairEstimate;
  const lines = toEstimateLines(e?.lineItems);
  const total = estimateTotal(e);

  if (!lines.length) {
    return `<section>
      <div class="sec-head"><h2>Scope of Work</h2></div>
      <p class="muted">No repair items were identified from the photos reviewed. A free on-site inspection is the next step — some conditions simply aren't visible from photographs.</p>
    </section>`;
  }

  // Exact amounts, not whole dollars: a homeowner or adjuster adds this column
  // up by hand. Rounding each line and the total separately let them disagree —
  // $577.50 and $742.50 printed as $578 + $743 = $1,321 under a total of $1,320.
  const rows = lines.map((li) => `<tr>
      <td>${esc(li.label)}${(li as any).because?.length
        ? `<div style="color:var(--muted);font-size:12px;margin-top:2px">Because we found: ${esc((li as any).because.join('; '))}</div>`
        : ''}</td>
      <td>${esc(li.quantityLabel)}</td>
      <td>${usd2(li.unitPrice)}</td>
      <td><b>${usd2(li.total)}</b></td>
    </tr>`).join('');

  return `<section>
    <div class="sec-head"><h2>Scope of Work</h2><span class="n">${lines.length} item${lines.length === 1 ? '' : 's'}</span></div>
    <table>
      <thead><tr><th scope="col">Repair</th><th scope="col">Quantity</th><th scope="col">Unit price</th><th scope="col">Total</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr>
        <td colspan="3" style="text-align:right;font-weight:600;padding:12px 14px;border-top:1px solid var(--line)">Estimated Total</td>
        <td style="text-align:center;font-weight:700;color:var(--red);padding:12px 14px;border-top:1px solid var(--line)">${usd2(total)}</td>
      </tr></tfoot>
    </table>
  </section>`;
}

/**
 * The replacement the customer is being quoted, if this is one.
 *
 * The selected tier is the quote; without a match, the first option is still a
 * better answer than nothing, since replacementOptions only exists at all when
 * the job was priced as a replacement.
 */
function selectedReplacement(report: ComprehensiveRoofReport): any | null {
  const options = (report as any).replacementOptions as any[] | undefined;
  if (!options?.length) return null;
  return options.find((o) => o.tier === (report as any).selectedTier) ?? options[0];
}

/**
 * Every line of the base scope — the rows that are included at all three tiers.
 * The tier-specific rows belong to the Good/Better/Best comparison, not here:
 * this section describes the job being quoted, not the ones that weren't.
 */
const replacementIncludes = (): string[] => scopeRows()
  .filter(([, good, better, best]) => good === true && better === true && best === true)
  .map(([label]) => label);

/**
 * "What This Covers" — what the customer is actually buying.
 *
 * A replacement quote covers a new roof, so it names the product going on the
 * house and what the crew does. A repair quote covers specific fixes, so it
 * lists those. This is the WORK — the evidence for it stays in its own "What
 * We Found" section below, so the document says both what you're buying and
 * what we saw.
 */
export function estimateCoversSection(report: ComprehensiveRoofReport, inspection?: InspectionFactsContext | null): string {
  const replacement = selectedReplacement(report);
  if (replacement) return replacementCovers(report, replacement, inspection);

  const lines = toEstimateLines((report as any).repairEstimate?.lineItems);
  return lines.length ? repairCovers(lines, inspection) : '';
}

/** A new roof: the product, then the work. */
function replacementCovers(report: ComprehensiveRoofReport, option: any, inspection?: InspectionFactsContext | null): string {
  const p = option.product ?? {};
  const squares = option.squares ?? (report as any).roofDetails?.squares;
  const rate = Number(option.ratePerSquare) || 0;
  // The hand-rolled card this replaces printed the name, tagline and body and
  // nothing else. productSpecPanel adds the manufacturer's published wind,
  // impact, fire and algae numbers plus a photo — the same panel the
  // Presentation and Proposal show, so the three documents can't disagree
  // about the product being sold. It emits p.body unescaped, which is right:
  // that is authored copy carrying HTML entities (&reg;, &rsquo;).
  // The named-product fallback is kept from the card this replaces: a stored
  // option with no product still has to say something.
  const panel = p.name
    ? productSpecPanel({ product: p, squares: Number(squares) || undefined, ratePerSquare: rate || undefined }, DOCUMENT_STYLE)
    : `<div class="product-panel"><h3>Your selected roofing system</h3></div>`;

  // What stands behind the product actually being quoted — never a borrowed
  // number (product-warranty.ts).
  const w = p.key ? warrantyFor(p) : null;
  const corrected = assemblyAttentionList(inspection, DOCUMENT_STYLE);
  // The base includes list was written for a CertainTeed shingle roof. On a
  // metal or synthetic roof its CertainTeed-specific rows (the hip & ridge
  // shingles, the 50-year figure) would contradict the warranty line above.
  // A commercial low-slope system gets its own list entirely: nothing about
  // starter strips or attic ventilation applies to a membrane roof.
  const includes = p.system
    ? commercialIncludes(p.system) ?? replacementIncludes()
    : w && !w.certainteed
      ? replacementIncludes().filter((r) => !/certainteed|manufacturer warranty/i.test(r))
      : replacementIncludes();
  const isoLine = option.iso
    ? `<p class="muted tiny" style="margin:-8px 0 14px">Includes <b>${esc(option.iso.label)}</b> at ${usd2(option.iso.ratePerSquare)} per square, folded into the rate above.</p>`
    : '';
  // The same layer-by-layer walkthrough the Proposal and Presentation carry,
  // so the estimate names every part the price includes, not just the
  // shingle. Null for a rep-typed custom product (no catalog system).
  const system = p.key ? roofSystemFor(p) : null;
  const walkthrough = system
    ? `<h3 style="margin:16px 0 0;font-size:15px">What goes on, layer by layer</h3>${roofSystemWalkthrough(system, DOCUMENT_STYLE, { cutaway: false })}`
    : '';

  // A tune-up or cleaning on the existing roof: its own list and an honest line — no new-roof promises.
  if (w?.service) {
    return `<section>
    <div class="sec-head"><h2>What This Covers</h2><span class="n">your roof as it is</span></div>
    ${panel}
    <p class="muted tiny" style="margin:4px 0 14px">${w.manufacturerLine}.</p>
    ${corrected.html ? `<p style="font-weight:600;margin:14px 0 8px">Also worth knowing &mdash; ${corrected.count} item${corrected.count === 1 ? '' : 's'} the inspection flagged that this visit does not fix:</p>${corrected.html}` : ''}
  </section>`;
  }
  return `<section>
    <div class="sec-head"><h2>What This Covers</h2><span class="n">your new roof</span></div>
    ${panel}
    ${w ? `<p class="muted tiny" style="margin:4px 0 14px"><b>Backed by:</b> ${w.manufacturerLine}; ${w.workmanshipYears ? `${w.workmanshipYears}-year ` : ''}${esc(companyBrand().displayName)} workmanship warranty on the installation.</p>` : ''}
    ${isoLine}
    ${walkthrough}
    <p style="font-weight:600;margin-bottom:8px">Every replacement we install includes:</p>
    <ul style="line-height:1.8;padding-left:20px">
      ${includes.map((r) => `<li>${esc(r)}</li>`).join('')}
    </ul>
    ${corrected.html ? `<p style="font-weight:600;margin:14px 0 8px">Corrected as part of this roof &mdash; ${corrected.count} item${corrected.count === 1 ? '' : 's'} the inspection flagged:</p>${corrected.html}` : ''}
    <p class="muted tiny" style="margin-top:10px">Hidden damage found once the old roof is off &mdash; decking, for example &mdash; is quoted separately and approved by you before we proceed.</p>
  </section>`;
}

/** Repairs: the specific work being priced, in plain language. */
function repairCovers(lines: ReturnType<typeof toEstimateLines>, inspection?: InspectionFactsContext | null): string {
  // A repair leaves the rest of the roof as it is. If the inspection flagged
  // an assembly component, the homeowner should know it is not in this price.
  const flagged = assemblyAttentionList(inspection, DOCUMENT_STYLE);
  const items = lines.map((li) => {
    const because = (li as any).because?.length
      ? `<div class="muted tiny" style="margin-top:2px">Because we found: ${esc((li as any).because.join('; '))}</div>`
      : '';
    return `<li style="margin-bottom:8px"><b>${esc(li.label)}</b>${li.quantityLabel ? ` <span class="muted">&mdash; ${esc(li.quantityLabel)}</span>` : ''}${because}</li>`;
  }).join('');

  return `<section>
    <div class="sec-head"><h2>What This Covers</h2><span class="n">${lines.length} repair${lines.length === 1 ? '' : 's'}</span></div>
    <ul style="line-height:1.7;padding-left:20px">${items}</ul>
    ${flagged.html ? `<p style="font-weight:600;margin:14px 0 8px">Also worth knowing &mdash; not included in this repair:</p>${flagged.html}` : ''}
    <p class="muted tiny" style="margin-top:10px">Each item is confirmed on site before any work begins. Anything we find that isn't listed here is quoted separately and approved by you first.</p>
  </section>`;
}

/**
 * Colour options — replacement quotes only; there is no product on a repair.
 *
 * colorOptions itself returns '' for a product with no published colour list
 * (Standing Seam Metal, a rep's custom product), so the heading is only
 * emitted when there is something under it.
 */
export function estimateColorSection(report: ComprehensiveRoofReport): string {
  const option = selectedReplacement(report);
  if (!option?.product) return '';
  const inner = colorOptions({ product: option.product }, DOCUMENT_STYLE);
  if (!inner) return '';
  return `<section><div class="sec-head"><h2>Your Color Options</h2></div>${inner}</section>`;
}

/** Financing — shown on every estimate when the company offers it: a repair bill is a surprise expense too. */
export function estimateFinancingSection(): string {
  if (!hasFinancing()) return '';
  return `<section><div class="sec-head"><h2>Financing</h2></div>${financing(DOCUMENT_STYLE)}</section>`;
}

/** What each line item is actually fixing — ties price back to evidence. */
export function estimateBasisSection(report: ComprehensiveRoofReport, damageSummary?: string | null, jobType?: 'retail' | 'insurance'): string {
  const photos: any[] = report.damageAnalysis?.photos ?? [];
  const findings = photos.flatMap((p) => (p.damages ?? []).map((d: any) => ({ ...d, caption: p.caption })));
  const storm = stormEvidence(report, jobType, DOCUMENT_STYLE);
  if (!findings.length && !damageSummary?.trim() && !storm) return '';

  // Group by condition type so one seen in six photos reads as one line —
  // and so the why-it-matters and any verified standard ride on that line.
  const grouped = new Map<string, { label: string; count: number; severity: string; where: string[] }>();
  for (const f of findings) {
    const key = f.type || f.label || 'Condition noted';
    const g = grouped.get(key) || { label: f.label || plainLanguageFor(f.type).label, count: 0, severity: String(f.severity || 'low'), where: [] as string[] };
    g.count += 1;
    if (f.location && g.where.length < 3 && !g.where.includes(f.location)) g.where.push(f.location);
    grouped.set(key, g);
  }

  const rows = [...grouped.entries()].map(([type, g]) => `<tr>
      <td><b>${esc(g.label)}</b><div class="muted tiny" style="margin-top:4px;line-height:1.5"><b>Why it matters:</b> ${esc(standardsFor(type).whyItMatters)}</div>${renderStandardsFootnote(type, 'muted')}</td>
      <td style="text-transform:capitalize">${esc(g.severity)}</td>
      <td>${g.count} photo${g.count === 1 ? '' : 's'}</td>
      <td class="muted tiny">${esc(g.where.join('; '))}</td>
    </tr>`).join('');

  return `<section>
    <div class="sec-head"><h2>What We Found</h2><span class="n">from the inspection</span></div>
    ${damageSummary?.trim() ? `<p class="lead" style="margin-bottom:12px"><b>Your inspector's summary.</b> ${esc(damageSummary.trim())}</p>` : ''}
    ${rows ? `<table>
      <thead><tr><th scope="col">Condition</th><th scope="col">Severity</th><th scope="col">Seen in</th><th scope="col">Where</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p class="muted tiny" style="margin-top:10px">Findings come from the on-site inspection and an AI-assisted review of the job photos, and are confirmed on site before any work begins.</p>` : ''}
    ${storm}
  </section>`;
}

/** Real completed projects near the customer, on a live map. Left out until Archie has a per-company project feed (project-map-widget.ts). */
export function estimateOurWorkSection(): string {
  if (!ourWorkMapAvailable()) return '';
  return `<section>
    <div class="sec-head"><h2>See Our Work Near You</h2></div>
    <p class="muted tiny" style="margin-bottom:10px">Real completed projects near you &mdash; tap any pin to see before &amp; after photos from a real job.</p>
    ${projectMapContainerHtml()}
  </section>`;
}

export function estimateTermsSection(report: ComprehensiveRoofReport, jobType?: 'retail' | 'insurance'): string {
  const notes: string[] = (report.repairEstimate as any)?.notes ?? [];
  const extra = notes.length ? `<ul style="line-height:1.8;padding-left:20px;margin-top:10px" class="muted tiny">${notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : '';
  return `<section>
    <div class="sec-head"><h2>Terms</h2></div>
    <ul style="line-height:1.8;padding-left:20px">
      <li>This is an <b>estimate</b>, not a final invoice. Scope is confirmed during a free on-site inspection.</li>
      <li>Pricing reflects current local labor and material costs and is valid for 30 days.</li>
      <li>Hidden damage (decking, underlayment) found once work begins is quoted separately before we proceed.</li>
      ${jobType === 'insurance' ? '<li>We review the eligible scope directly with your adjuster.</li>' : ''}
      <li>Questions? Call us at <a href="${companyTel()}" style="color:inherit"><b>${esc(companyBrand().phone)}</b></a>.</li>
    </ul>
    ${extra}
    ${whyUs(DOCUMENT_STYLE, { compact: true })}
  </section>`;
}

/**
 * Repair vs replacement, side by side, with a recommendation and the reason
 * for it. Shown only when the report carries both — a document that always
 * argues for replacement is one a homeowner stops trusting.
 */
export function estimateOptionsSection(report: any): string {
  const options = report?.estimateOptions;
  if (!Array.isArray(options) || options.length < 2) return '';
  const rec = report?.recommendedOption;
  const money = (n: number) => `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const cards = options.map((o: any) => `
    <div style="flex:1;min-width:240px;border:2px solid ${o.key === rec ? '#b8322b' : '#e5e7eb'};border-radius:12px;padding:18px;background:#fff">
      ${o.key === rec ? '<div style="display:inline-block;background:#b8322b;color:#fff;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;padding:3px 8px;border-radius:999px;margin-bottom:10px">Our recommendation</div>' : ''}
      <h3 style="margin:0 0 4px;font-size:18px;color:#0e1f57">${o.label}</h3>
      <p style="margin:0 0 10px;color:#6b7280;font-size:13px">${o.summary}</p>
      <p style="margin:0;font-size:26px;font-weight:700;color:#0e1f57">${money(o.total)}</p>
      <p style="margin:6px 0 0;color:#9ca3af;font-size:12px">${o.lineItems?.length || 0} line item${(o.lineItems?.length || 0) === 1 ? '' : 's'}</p>
    </div>`).join('');

  return `<section style="margin:0 0 28px">
    <h2 style="font-size:20px;color:#0e1f57;margin:0 0 4px">Your two options</h2>
    <p style="margin:0 0 14px;color:#6b7280;font-size:14px">${report?.recommendedOptionReason || ''}</p>
    <div style="display:flex;gap:14px;flex-wrap:wrap">${cards}</div>
  </section>`;
}

/**
 * Commercial only: what is on the roof today and why the priced path is the
 * right one — the same sections the commercial Inspection and Proposal
 * carry, so the three documents cannot disagree about the existing roof.
 */
export function estimateExistingRoofSection(report: ComprehensiveRoofReport, inspection?: InspectionFactsContext | null): string {
  const insp = commercialContextOf(report, inspection as any);
  if (!insp) return '';
  const asm = existingAssembly(insp, DOCUMENT_STYLE);
  const cond = conditionMatrix(insp, DOCUMENT_STYLE);
  const water = drainageAndMoisture(insp, DOCUMENT_STYLE);
  const path = reroofPath(insp, DOCUMENT_STYLE).html;
  if (!asm && !cond && !water && !path) return '';
  return `<section>
    <div class="sec-head"><h2>The Existing Roof</h2><span class="n">what this price is based on</span></div>
    ${asm ? `<h3 style="margin:14px 0 4px;font-size:15px">What is on the roof today</h3>${asm}` : ''}
    ${cond ? `<h3 style="margin:18px 0 4px;font-size:15px">Condition, component by component</h3>${cond}` : ''}
    ${water ? `<h3 style="margin:18px 0 4px;font-size:15px">Drainage and moisture</h3>${water}` : ''}
    ${path ? `<h3 style="margin:18px 0 4px;font-size:15px">Restore, recover, or replace</h3>${path}` : ''}
  </section>`;
}

/** The Estimate's sections, keyed for the editor; report.layout hides/reorders them. */
export function estimateSections(
  report: ComprehensiveRoofReport,
  opts: { customer?: string; jobType?: 'retail' | 'insurance'; recommendation?: string | null; inspection?: InspectionFactsContext | null } = {},
): ReportSection[] {
  return [
    { key: 'recommendation', label: 'Our Recommendation', html: estimateRecommendationNotice(report.replacementOptions?.length ? null : opts.recommendation) },
    { key: 'options', label: 'Your Options', html: estimateOptionsSection(report) },
    { key: 'replacement', label: 'Replacement Pricing', html: estimateReplacementSection(report) },
    { key: 'scope', label: 'Scope of Work', html: estimateScopeSection(report) },
    { key: 'covers', label: 'What the Price Covers', html: estimateCoversSection(report, opts.inspection) },
    { key: 'colors', label: 'Color Options', html: estimateColorSection(report) },
    // consumer financing is a residential program; a commercial estimate carries none
    ...(isCommercialReport(report) ? [] : [{ key: 'financing', label: 'Financing', html: estimateFinancingSection() }]),
    { key: 'basis', label: 'Basis of the Estimate', html: estimateBasisSection(report, opts.inspection?.damageSummary, opts.jobType) },
    { key: 'existing-roof', label: 'The Existing Roof', html: estimateExistingRoofSection(report, opts.inspection) },
    { key: 'our-work', label: 'Our Work', html: estimateOurWorkSection() },
    { key: 'terms', label: 'Terms', html: estimateTermsSection(report, opts.jobType) },
    { key: 'footer', label: 'Footer', html: reportFooter(), fixed: true },
  ];
}

export function renderEstimateHtml(
  report: ComprehensiveRoofReport,
  opts: { customer?: string; jobType?: 'retail' | 'insurance'; recommendation?: string | null; inspection?: InspectionFactsContext | null } = {},
): string {
  const body = joinSections(arrangeSections(estimateSections(report, opts), (report as any).layout));

  return premiumShell({
    title: `${estimateTitle(report)} · ${report.property?.address ?? ''} · ${companyBrand().displayName}`,
    hero: estimateHero(report, opts.customer, opts.jobType),
    body,
    // SECTION_CSS_DOCUMENT, never SECTION_CSS_SCROLL: the scroll bundle is
    // written against --sc-* custom properties premiumShell does not define,
    // so it would render every chip and fact card with no background, border
    // or padding. howTheJobRuns is deliberately absent from this document for
    // the mirror-image reason — its ig-row markup is styled only by the two
    // scrollcraft pages.
    extraHead: `${PROJECT_MAP_HEAD}<style>${PROJECT_MAP_CSS}${SECTION_CSS_DOCUMENT}${INSPECTION_FACTS_CSS}${ROOF_SYSTEM_CSS_DOCUMENT}${COMMERCIAL_FACTS_CSS}</style>`,
    extraScripts: `<script>${PROJECT_MAP_JS}</script>`,
  });
}
