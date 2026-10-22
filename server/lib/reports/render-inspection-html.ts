/**
 * Premium roof INSPECTION report renderer. Renders a ComprehensiveRoofReport
 * (storm history + AI photo damage analysis + repair estimate) in the shared
 * BRN premium theme. Section builders are exported for the combined report.
 *
 * This is the one document meant to be read by the homeowner, the office,
 * AND the insurance adjuster — written at a 5th-grade reading level and
 * carrying no pricing at all (pricing lives in Estimate/Proposal/Presentation
 * instead). inspectionEstimateSection/inspectionFindings still exist and
 * still include pricing — they're kept for the (soon-to-be-retired) Combined
 * report type, which reuses them; renderInspectionHtml itself no longer
 * calls inspectionEstimateSection.
 */
import { premiumShell, esc, usd, usd2 } from './report-theme.js';
import { arrangeSections, joinSections, type ReportSection } from './layout.js';
import { toEstimateLines, estimateTotal } from './estimate-lines.js';
import { reportFooter } from './render-proposal-html.js';
import { CRED_MARKERS, COMPANY_VALUES, OWNERS_STORY } from './certainteed-data.js';
import { CREDENTIAL_FACTS, TRUST_STATS, FINANCING_FACT } from './brand-facts.js';
import { BRN_BRAND } from './brn-brand.js';
import { plainLanguageFor, plainSeverity } from './plain-language-damage.js';
import { standardsFor, renderStandardsFootnote } from './damage-standards.js';
import type { ComprehensiveRoofReport } from './comprehensive-roof-report.js';
import { PROJECT_MAP_HEAD, PROJECT_MAP_CSS, PROJECT_MAP_JS, projectMapContainerHtml } from './project-map-widget.js';
import { consolidateFindings, occurrenceLabel, usefulLocations, type ConsolidatedFinding } from './consolidate-findings.js';
import { DOCUMENT_STYLE, SECTION_CSS_DOCUMENT } from './sections/style.js';
import { stormEvidence } from './sections/storm-evidence.js';
import { narrativeHtml, NARRATIVE_CSS } from './sections/narrative.js';
import {
  inspectionDetails, groundExterior, damageDetail, atticInterior, assemblyAgainstStandard, ventilation, roofAge, fullChecklist,
  INSPECTION_FACTS_CSS, type InspectionFactsContext,
} from './sections/inspection-facts.js';
import { ANATOMY_CSS, ANATOMY_JS } from './sections/anatomy.js';
import { GLANCE_CSS, GLANCE_JS, fold, residentialGlance } from './sections/inspection-glance.js';
import { shingleRoofAnatomy } from './sections/roof-anatomy-shingle.js';

const BRAND = { name: 'Best Roofing Now', phone: '(704) 605-6047' };

// NOAA storm dates arrive date-only ("2026-04-08"), which parses as UTC
// midnight and prints as the day BEFORE in any negative-offset timezone —
// misdating the hail event this whole report rests on. Anchor to local noon,
// the same way render-storm-section.ts already does.
function fmtDate(iso: string): string {
  try {
    const d = new Date(iso + (iso?.length === 10 ? 'T12:00:00' : ''));
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch { return iso; }
}

const SEV_BG: Record<string, string> = { critical: '#FEE2E2', high: '#FFEDD5', medium: '#FEF3C7', low: '#D1FAE5', none: '#F3F4F6' };
const SEV_FG: Record<string, string> = { critical: '#DC2626', high: '#EA580C', medium: '#D97706', low: '#2E7D52', none: '#6B6055' };
const sev = (s: string) => (s || 'none').toLowerCase();

export function inspectionHero(report: ComprehensiveRoofReport, jobType?: 'retail' | 'insurance'): string {
  const p = report.property;
  return `<div class="hero">
    <div class="hero__brand">${BRAND.name}${jobType === 'insurance' ? ' &middot; Insurance Claim' : ''}</div>
    <h1>Roof Inspection Report</h1>
    <div class="hero__for">${esc(p.address)}, ${esc(p.city)}, ${esc(p.state)} ${esc(p.zip || '')}</div>
    <div class="hero__meta"><div>Report #${esc(report.id)}</div><div>${fmtDate(report.generatedAt)}</div><div>${report.damageAnalysis?.photos?.length ?? 0} photos on file</div></div>
  </div>`;
}

export function inspectionSummarySection(report: ComprehensiveRoofReport, damageSummary?: string | null): string {
  const storm = report.stormHistory;
  const dmg = report.damageAnalysis;

  // Count DISTINCT problems, not raw detections. 117 photos of one roof
  // produced 92 detections of 40 actual problems — granule loss alone appeared
  // 25 times. "92 Things We Found" reads as padding and buries the real ones.
  const found = consolidateFindings((dmg?.photos || []) as any[]);

  const worst = found.slice(0, 6);
  const rows = worst.map((f: ConsolidatedFinding) => {
    const seen = occurrenceLabel(f);
    const where = usefulLocations(f).join(', ');
    return `<li style="margin:0 0 6px;padding-left:1.1rem;position:relative">
      <span style="position:absolute;left:0;color:#b8322b">—</span>
      <strong>${esc(f.label)}</strong>${seen ? ` <span style="color:#6b7280">(${esc(seen)})</span>` : ''}
      ${where ? `<span style="color:#9ca3af"> · ${esc(where)}</span>` : ''}
    </li>`;
  }).join('');

  return `<section>
    <div class="sec-head"><h2>What We Found</h2><span class="n">In plain English</span></div>
    <div class="stats">
      <div class="stat"><div class="v">${dmg?.totalPhotosAnalyzed ?? 0}</div><div class="k">Photos We Checked</div></div>
      <div class="stat"><div class="v">${storm?.totalEvents ?? 0}</div><div class="k">Storms Nearby (3 yr)</div></div>
      <div class="stat"><div class="v">${found.length}</div><div class="k">Problems We Found</div></div>
      <div class="stat"><div class="v">${esc(plainSeverity(dmg?.overallSeverity))}</div><div class="k">What To Do</div></div>
    </div>
    ${damageSummary?.trim() ? `<p class="lead" style="margin-top:14px"><b>Your inspector's summary.</b> ${esc(damageSummary.trim())}</p>` : ''}
    ${dmg?.aiSummary ? `<p class="${damageSummary?.trim() ? '' : 'lead'}" style="margin-top:14px">${esc(dmg.aiSummary)}</p>` : ''}
    ${worst.length ? `<div style="margin-top:14px">
      <p style="font-weight:600;color:#0e1f57;margin:0 0 6px">The main issues${found.length > worst.length ? `, worst first` : ''}</p>
      <ul style="list-style:none;margin:0;padding:0">${rows}</ul>
      ${found.length > worst.length ? `<p style="color:#9ca3af;font-size:13px;margin:8px 0 0">Plus ${found.length - worst.length} more, detailed with photos below.</p>` : ''}
    </div>` : ''}
  </section>`;
}

/**
 * Storm facts only.
 *
 * This used to print "Insurance claim potential: low" — our internal read of
 * the odds, on a document we hand the homeowner. It argues against their own
 * claim before an adjuster has looked, and coverage is the carrier's
 * determination, not ours. The events, counts and radius stay; the verdict
 * does not.
 */
export function inspectionStormSection(report: ComprehensiveRoofReport, jobType?: 'retail' | 'insurance'): string {
  const s = report.stormHistory;
  if (!s) return '';
  const recent = [s.mostRecentHailStorm, s.mostRecentWindStorm].filter(Boolean) as any[];
  const list = recent.length
    ? `<ul style="margin:8px 0;padding-left:18px;line-height:1.7">${recent.map(r => `<li><b>${esc(r.type)} event</b> on ${fmtDate(r.date)} &mdash; ${esc(r.magnitude)} (${(r.distanceMiles ?? 0).toFixed(1)} mi away)</li>`).join('')}</ul>`
    : `<p class="muted">No significant hail or wind events found within ${s.searchRadiusMiles || 5} miles over the past ${s.yearsAnalyzed || 3} years.</p>`;
  return `<section>
    <div class="sec-head"><h2>Storm History</h2><span class="n">${s.yearsAnalyzed || 3}-yr, ${s.searchRadiusMiles || 5}-mi radius</span></div>
    <p>${s.totalEvents || 0} storm events recorded (${s.hailEvents || 0} hail, ${s.windEvents || 0} wind, ${s.tornadoEvents || 0} tornado) within 5 miles over the last 3 years.</p>
    ${list}
    ${stormEvidence(report, jobType, DOCUMENT_STYLE)}
  </section>`;
}

/** A titled premium-shell section, or '' when there is nothing to put in it. */
function section(title: string, note: string | null, inner: string): string {
  if (!inner) return '';
  return `<section>
    <div class="sec-head"><h2>${title}</h2>${note ? `<span class="n">${esc(note)}</span>` : ''}</div>
    ${inner}
  </section>`;
}

/** The in-depth write-up (report-narrative.ts), when one was generated and the rep kept it. */
export function inspectionNarrativeSection(report: ComprehensiveRoofReport, jobType?: 'retail' | 'insurance'): string {
  const body = narrativeHtml((report as any).narrative?.findings, DOCUMENT_STYLE);
  if (!body) return '';
  return `<section class="sec">
    <div class="sec-head"><h2>Inspection Findings, In Depth</h2><span class="n">Written from this inspection</span></div>
    ${body}
    ${jobType === 'insurance' ? `<p class="muted tiny" style="margin-top:14px">Any storm-related damage noted is preliminary and subject to verification by a licensed insurance adjuster.</p>` : ''}
  </section>`;
}

const SEV_ORDER: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1, none: 0 };

/**
 * Every photo gets its own label and one-sentence, plain-language
 * explanation directly beneath it — instead of a findings list disconnected
 * from which photo shows what. If a photo has more than one finding, the
 * worst one becomes the headline and the rest are named underneath it.
 */
export function inspectionDamageSection(report: ComprehensiveRoofReport): string {
  const d = report.damageAnalysis;
  if (!d?.photos?.length) {
    return `<section><div class="sec-head"><h2>What We Saw on the Roof</h2></div><p class="muted">No photos were submitted for us to look at.</p></section>`;
  }
  // Photos that show damage get a full card. Photos that show nothing get a
  // thumbnail in one strip at the end.
  //
  // Every photo used to get an identical full card, so on a 117-photo job 77 of
  // them — 66% of the document — read "Looks Okay Here / We did not see a
  // problem in this photo". The damage was buried in the middle of it. Clean
  // photos are still worth showing (they prove the roof was covered, and an
  // adjuster wants to see them) but they are not worth a card each.
  const withDamage = d.photos.filter((p: any) => (p.damages || []).length > 0);
  const clean = d.photos.filter((p: any) => (p.damages || []).length === 0);

  const cards = withDamage.map((p: any) => {
    const damages = (p.damages || []) as any[];
    const sorted = [...damages].sort((a, b) => (SEV_ORDER[sev(b.severity)] ?? 0) - (SEV_ORDER[sev(a.severity)] ?? 0));
    const primary = sorted[0];
    const s = sev(primary.severity);
    const plain = plainLanguageFor(primary.type);
    const also = sorted.slice(1).map((dm) => plainLanguageFor(dm.type).label);
    const alsoLine = also.length ? `<br/><span style="color:var(--muted);font-size:12px">Also here: ${esc(also.join(', '))}</span>` : '';
    const std = standardsFor(primary.type);
    return `<div class="photo">
      <img loading="lazy" decoding="async" src="${esc(p.url)}" alt="${esc(plain.label)}"/>
      <div class="cap">
        <span class="sev" style="background:${SEV_BG[s]};color:${SEV_FG[s]};margin-bottom:4px;display:inline-block">${esc(plainSeverity(s))}</span><br/>
        <b>${esc(plain.label)}</b><br/>
        ${esc(plain.explanation)}${alsoLine}
        <div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--line);font-size:12px;line-height:1.55"><b>Why it matters:</b> ${esc(std.whyItMatters)}</div>
        ${renderStandardsFootnote(primary.type, 'muted')}
      </div>
    </div>`;
  }).join('');
  // Worst first: a customer should meet the problem before the paperwork.
  const cleanStrip = clean.length ? `
    <div style="margin-top:22px;padding-top:18px;border-top:1px solid var(--line)">
      <p style="font-weight:600;color:var(--navy);margin:0 0 4px">We also checked these areas and found no problems</p>
      <p class="muted" style="margin:0 0 10px;font-size:13px">${clean.length} photo${clean.length === 1 ? '' : 's'} — included so you can see the whole roof, not just the damage.</p>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:8px">
        ${clean.map((p: any) => `<img loading="lazy" decoding="async" src="${esc(p.url)}" alt="Roof area with no issues found" style="width:100%;height:88px;object-fit:cover;border-radius:8px;background:#f3f4f6"/>`).join('')}
      </div>
    </div>` : '';

  const headNote = withDamage.length
    ? `${withDamage.length} photo${withDamage.length === 1 ? '' : 's'} showing damage`
    : `${d.photos.length} photo${d.photos.length === 1 ? '' : 's'}`;

  return `<section>
    <div class="sec-head"><h2>What We Saw on the Roof</h2><span class="n">${esc(headNote)}</span></div>
    ${cards ? `<div class="photogrid">${cards}</div>` : `<p class="muted">We did not find damage in any of the photos we reviewed.</p>`}
    ${cleanStrip}
  </section>`;
}

export function inspectionEstimateSection(report: ComprehensiveRoofReport): string {
  const e = report.repairEstimate;
  if (!e?.lineItems?.length) {
    return `<section><div class="sec-head"><h2>Repair Estimate</h2></div><p class="muted">No repair items identified. A free on-site inspection is recommended to confirm.</p></section>`;
  }
  const rows = toEstimateLines(e.lineItems)
    .map((li) => `<tr><td>${esc(li.label)}</td><td>${esc(li.quantityLabel)}</td><td>${usd2(li.unitPrice)}</td><td><b>${usd2(li.total)}</b></td></tr>`)
    .join('');
  return `<section>
    <div class="sec-head"><h2>Repair Estimate</h2><span class="n">${e.lineItems.length} line items</span></div>
    <table><thead><tr><th scope="col">Item</th><th scope="col">Qty</th><th scope="col">Unit</th><th scope="col">Total</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><td colspan="3" style="text-align:right;font-weight:600;padding:12px 14px;border-top:1px solid var(--line)">Estimated Total</td><td style="text-align:center;font-weight:700;color:var(--red);padding:12px 14px;border-top:1px solid var(--line)">${usd2(estimateTotal(e))}</td></tr></tfoot>
    </table>
    <p class="muted tiny" style="margin-top:10px">Estimate reflects current local labor and material pricing. Final scope may change after an on-site inspection. Insurance-eligible scope is reviewed with the adjuster on file.</p>
  </section>`;
}

/**
 * Who we are, plus a plain-language walk-through of filing an insurance
 * claim — this is the section that lets one document work for the
 * homeowner, the office, AND the adjuster: it tells the adjuster who they're
 * dealing with, and tells the homeowner what happens next either way.
 */
export function inspectionAboutAndClaimsSection(): string {
  // Every line here is a verified fact (brand-facts.ts, reviewed monthly) or
  // the owners' own story — not a phrase a template author made up.
  const stats = TRUST_STATS.map((f) => `<div class="fact"><span>${esc(f.text)}</span></div>`).join('');
  const creds = [...CREDENTIAL_FACTS, FINANCING_FACT].map((f) => `<span>${esc(f.text)}</span>`).join('');
  return `<section>
    <div class="sec-head"><h2>About Best Roofing Now &amp; Filing a Claim</h2></div>
    <h3 style="margin:0 0 8px;font-size:17px">${OWNERS_STORY.heading}</h3>
    ${OWNERS_STORY.paragraphs.map((p) => `<p class="lead" style="margin:0 0 10px">${p}</p>`).join('')}
    <div class="values">${COMPANY_VALUES.map(([t, d]) => `<div class="value"><b>${esc(t)}</b><span>${esc(d)}</span></div>`).join('')}</div>
    <h3 style="margin:22px 0 8px;font-size:15px">By the numbers</h3>
    <div class="fact-grid">${stats}</div>
    <div class="cred" style="margin-top:10px">${creds}</div>
    <p class="muted tiny" style="margin-top:10px">${esc(BRN_BRAND.legalName)} &middot; ${esc(BRN_BRAND.city)}, ${esc(BRN_BRAND.state)} &middot; <a href="tel:+1${BRN_BRAND.phone.replace(/\D/g, '')}" style="color:inherit">${esc(BRN_BRAND.phone)}</a> &middot; ${esc(BRN_BRAND.email)} &middot; ${esc(BRN_BRAND.website.replace('https://', ''))}</p>
    <h3 style="margin:22px 0 10px;font-size:17px">If You Decide to File an Insurance Claim</h3>
    <p style="margin:0 0 10px">Filing a claim can feel confusing. Here it is in five simple steps:</p>
    <ol style="line-height:1.9;padding-left:20px;margin:0">
      <li><b>Call your insurance company.</b> Tell them a storm damaged your roof and you'd like to file a claim.</li>
      <li><b>They send an adjuster.</b> This is the person who comes to look at the damage in person and decides what insurance will cover.</li>
      <li><b>We meet the adjuster at your home.</b> We walk the roof with them and point to exactly what we found &mdash; this report is our shared list.</li>
      <li><b>Insurance approves the claim</b> and tells you (and us) what's covered.</li>
      <li><b>We schedule the work</b> and keep you updated the whole way through.</li>
    </ol>
    <p class="muted tiny" style="margin-top:12px">We do this every week. If any of this is confusing, just call us &mdash; we're happy to walk you through it before you ever call your insurance company.</p>
  </section>`;
}

/** Real completed projects near the customer — same live map embedded in every report type, fed by this app's own proxy of bestroofingnow.com's own project data (project-map-proxy.ts). */
export function inspectionOurWorkSection(): string {
  return `<section>
    <div class="sec-head"><h2>See Our Work Near You</h2></div>
    <p class="muted tiny" style="margin-bottom:10px">Real completed roofing projects across the Charlotte area &mdash; tap any pin to see before &amp; after photos from a job near you.</p>
    ${projectMapContainerHtml()}
  </section>`;
}

export function inspectionNextSteps(): string {
  return `<section>
    <div class="sec-head"><h2>Next Steps</h2></div>
    <ol style="line-height:1.8;padding-left:20px">
      <li>Give us a call so we can talk about what we found.</li>
      <li>If it's a storm claim, we'll help you get the adjuster meeting scheduled.</li>
      <li>If it's not, we'll walk you through your repair or replacement options.</li>
      <li>Reach out anytime: <a href="tel:+1${BRAND.phone.replace(/\D/g, '')}" style="color:inherit"><b>${BRAND.phone}</b></a></li>
    </ol>
    <div class="cred">${CRED_MARKERS.map(m => `<span>${esc(m)}</span>`).join('')}</div>
  </section>`;
}

/** The inspection findings (no hero) — reused by the combined report. */
export function inspectionFindings(report: ComprehensiveRoofReport): string {
  return [
    inspectionSummarySection(report),
    inspectionStormSection(report),
    inspectionDamageSection(report),
    inspectionEstimateSection(report),
  ].join('\n');
}

/**
 * The inspector's own summary and notes — and nothing generated. The
 * document used to open with a vision-model summary and a "problems we
 * found" list built from the photos; an inspector who never wrote those
 * things was being quoted saying them.
 */
export function inspectorSummarySection(report: ComprehensiveRoofReport, insp: InspectionFactsContext | null | undefined): string {
  const a = (insp as any)?.answers ?? {};
  const summary = String((report as any).executiveSummary || insp?.damageSummary || a['Overall damage summary'] || a['Overall condition summary'] || '').trim();
  const notes = String(report.inspectorNotes || '').trim();
  const photos = report.damageAnalysis?.photos?.length ?? 0;
  const recommendation = insp?.recommendation ?? (a['Recommendation'] ? String(a['Recommendation']) : null);
  const storms = (report.stormHistory as any)?.totalEvents;
  const stats = [
    ['Photos on file', String(photos)],
    ['Storms nearby (3 yr)', storms != null ? String(storms) : null],
    ['Inspection type', insp?.inspectionType ?? null],
    ['Inspector', (insp as any)?.inspectorName ?? (a['Inspector Name'] ? String(a['Inspector Name']) : null)],
    ['Recommendation', recommendation],
  ].filter(([, v]) => v).map(([k, v]) => `<div class="stat"><div class="v" style="font-size:${String(v).length > 12 ? 15 : 24}px;line-height:1.2">${esc(String(v))}</div><div class="k">${esc(String(k))}</div></div>`).join('');
  const noChecklist = !insp
    ? `<p class="muted" style="margin-top:14px">No field inspection checklist has been submitted for this job yet, so this document carries the photos${notes ? ' and notes' : ''} only. Submit the checklist and regenerate to fill in the findings.</p>`
    : '';
  return `<section>
    <div class="sec-head"><h2>What We Found</h2><span class="n">In the inspector's words</span></div>
    ${stats ? `<div class="stats">${stats}</div>` : ''}
    ${summary ? `<p class="lead" style="margin-top:14px">${esc(summary)}</p>` : ''}
    ${notes ? `<p style="margin-top:14px;white-space:pre-wrap"><b>Inspector's notes.</b> ${esc(notes)}</p>` : ''}
    ${noChecklist}
    ${!summary && !notes && insp ? `<p class="muted" style="margin-top:14px">The inspector did not write a summary on the checklist.</p>` : ''}
  </section>`;
}

/**
 * Every photo, as taken, with the caption the inspector (or the job file)
 * gave it. No detected damage, no severity badge, no "why it matters" —
 * the photo is the evidence and the checklist says what it shows.
 */
export function photoRecordSection(report: ComprehensiveRoofReport): string {
  const photos = (report.damageAnalysis?.photos ?? []) as Array<{ url: string; caption?: string }>;
  if (!photos.length) return '';
  const cards = photos.map((p, i) => `<div class="photo">
      <img loading="lazy" decoding="async" src="${esc(p.url)}" alt="${esc(p.caption || `Photo ${i + 1}`)}"/>
      <div class="cap"><b>${esc(p.caption || `Photo ${i + 1}`)}</b>${p.caption ? `<br/><span class="muted" style="font-size:12px">Photo ${i + 1} of ${photos.length}</span>` : ''}</div>
    </div>`).join('');
  return `<section>
    <div class="sec-head"><h2>Photo Record</h2><span class="n">${photos.length} photo${photos.length === 1 ? '' : 's'}, as taken</span></div>
    <div class="photogrid">${cards}</div>
  </section>`;
}

/**
 * The Inspection's sections, in template order, keyed for the editor. The
 * rep's saved layout (report.layout) hides and reorders them at render.
 *
 * Everything here comes from the inspector's checklist and notes, the NOAA
 * storm record, and the photos as taken. Nothing is derived from looking at
 * the photos: the vision findings, per-photo labels and roof-age guess the
 * document used to carry are gone, and the write-up is composed only from
 * what the inspector entered.
 */
export function inspectionSections(
  report: ComprehensiveRoofReport,
  opts: { jobType?: 'retail' | 'insurance'; inspection?: InspectionFactsContext | null } = {},
): ReportSection[] {
  const insp = opts.inspection ?? null;
  const claim = opts.jobType === 'insurance';
  const measurements = (report as any).measurements;
  const squares = insp?.approxSquares ?? report.roofDetails?.squares ?? measurements?.squares ?? null;
  const asm = assemblyAgainstStandard(insp, DOCUMENT_STYLE);
  const photos = (report.damageAnalysis?.photos ?? []) as Array<{ url?: string; caption?: string | null }>;
  return [
    { key: 'details', label: 'Inspection Details', html: section('Inspection Details', null, inspectionDetails(insp, measurements, DOCUMENT_STYLE)) },
    { key: 'summary', label: 'What We Found', html: inspectorSummarySection(report, insp) },
    { key: 'glance', label: 'At a Glance', html: residentialGlance(insp, photos) },
    { key: 'anatomy', label: 'Your Roof, Part by Part', html: section('Your Roof, Part by Part', 'Tap a number', shingleRoofAnatomy(insp, photos)) },
    // NOAA's public storm record for the address — facts, not findings.
    { key: 'storm', label: 'Storm History', html: inspectionStormSection(report, opts.jobType) },
    // The in-depth write-up, written from the checklist and the inspector's
    // notes (report-narrative.ts hard rules: only the inputs, never invented).
    { key: 'narrative', label: 'Findings, In Depth', html: inspectionNarrativeSection(report, opts.jobType) },
    { key: 'damage-detail', label: claim ? 'The Claim Evidence' : 'The Damage, In Detail', html: section(claim ? 'The Claim Evidence' : 'The Damage, In Detail', claim ? 'What the adjuster will look for' : null, damageDetail(insp, DOCUMENT_STYLE)) },
    { key: 'assembly', label: 'Roof Assembly vs. the Standard', html: section('Roof Assembly, Checked Against the Standard', asm.attention ? `${asm.attention} item${asm.attention === 1 ? '' : 's'} need attention` : null,
      asm.html ? `<p class="muted tiny">What this roof is built from, component by component, and how each part measures against the standard we build to. &ldquo;Needs attention&rdquo; means we would correct it as part of any work on this roof.</p>${asm.html}` : '') },
    { key: 'ventilation', label: 'Attic Ventilation', html: section('Attic Ventilation', null, ventilation(insp, squares, DOCUMENT_STYLE)) },
    { key: 'attic', label: 'Attic & Interior', html: section('Attic &amp; Interior', null, atticInterior(insp, DOCUMENT_STYLE)) },
    { key: 'exterior', label: 'Ground & Exterior', html: section('Ground &amp; Exterior', claim ? 'Collateral damage' : null, groundExterior(insp, DOCUMENT_STYLE)) },
    // Every recorded answer, in the checklist's own order — the sections
    // above summarise; this one leaves nothing out.
    { key: 'checklist', label: 'The Inspection, Field by Field', html: section('The Inspection, Field by Field', 'Every answer the inspector recorded', fold('Show every answer the inspector recorded', fullChecklist(insp, DOCUMENT_STYLE))) },
    { key: 'about', label: 'About Us & Claims', html: inspectionAboutAndClaimsSection() },
    { key: 'our-work', label: 'Our Work', html: inspectionOurWorkSection() },
    { key: 'next-steps', label: 'Next Steps', html: inspectionNextSteps() },
    // The full photo list closes the document, whatever order the rep saved.
    { key: 'photos', label: 'Photo Record', html: photoRecordSection(report), last: true },
    { key: 'footer', label: 'Footer', html: reportFooter(), fixed: true },
  ];
}

export function renderInspectionHtml(
  report: ComprehensiveRoofReport,
  opts: { jobType?: 'retail' | 'insurance'; inspection?: InspectionFactsContext | null } = {},
): string {
  const insp = opts.inspection ?? null;
  const claim = opts.jobType === 'insurance';
  const measurements = (report as any).measurements;
  const squares = insp?.approxSquares ?? report.roofDetails?.squares ?? measurements?.squares ?? null;
  const asm = assemblyAgainstStandard(insp, DOCUMENT_STYLE);

  const body = joinSections(arrangeSections(inspectionSections(report, opts), (report as any).layout));
  return premiumShell({
    title: `Roof Inspection Report · ${report.property.address} · ${BRAND.name}`,
    hero: inspectionHero(report, opts.jobType),
    body,
    extraHead: `${PROJECT_MAP_HEAD}<style>${PROJECT_MAP_CSS}${SECTION_CSS_DOCUMENT}${INSPECTION_FACTS_CSS}${NARRATIVE_CSS}${ANATOMY_CSS}${GLANCE_CSS}</style>`,
    extraScripts: `<script>${PROJECT_MAP_JS}</script><script>${ANATOMY_JS}</script><script>${GLANCE_JS}</script>`,
  });
}
