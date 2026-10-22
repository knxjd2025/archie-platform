/**
 * Combined INSPECTION + PROPOSAL report. Leads with who we are, walks the
 * inspection findings (storm + AI damage + repair estimate), then transitions
 * into the full replacement proposal (products, colors, system, warranty,
 * pricing). One document, the shared premium theme.
 */
import { premiumShell, esc } from './report-theme.js';
import { arrangeSections, joinSections, type ReportSection } from './layout.js';
import type { ComprehensiveRoofReport } from './comprehensive-roof-report.js';
import { inspectionFindings } from './render-inspection-html.js';
import {
  type ProposalInput,
  companySection, ownersSection, measurementsSection, productsSection,
  colorsSection, colorRendersSection, integritySection, warrantySection, investmentSection,
  acceptSection, reportFooter,
} from './render-proposal-html.js';
import { companyBrand } from './company-brand.js';


export interface CombinedInput {
  report: ComprehensiveRoofReport;
  proposal: ProposalInput;
}

function combinedHero(input: CombinedInput): string {
  const p = input.proposal;
  const sat = p.satelliteDataUri
    ? `<div class="hero__sat"><img src="${p.satelliteDataUri}" alt="Satellite view of ${esc(p.address)}"/><span class="hero__sattag">Your roof &middot; satellite imagery</span></div>`
    : '';
  const meta = [
    `<div><b>${esc(p.address)}</b>${p.cityStateZip ? ', ' + esc(p.cityStateZip) : ''}</div>`,
    p.jobNumber ? `<div>Job #${esc(p.jobNumber)}</div>` : '',
    p.date ? `<div>${esc(p.date)}</div>` : '',
    p.rep ? `<div>Prepared by ${esc(p.rep)}</div>` : '',
  ].join('');
  return `<div class="hero">
    <div class="hero__brand">${companyBrand().displayName}</div>
    <h1>Roof Inspection &amp; Replacement Proposal</h1>
    <div class="hero__for">Prepared for ${esc(p.customer)}</div>
    <div class="hero__promise">&ldquo;We tell people the truth, even when it isn't a sale.&rdquo;</div>
    <div class="hero__meta">${meta}</div>
    ${sat}
  </div>`;
}

function findingsIntro(): string {
  return `<section>
    <div class="sec-head"><h2>What We Found</h2><span class="n">Inspection findings</span></div>
    <p class="lead">Here's what our inspection and the storm history for your address turned up. We document everything with photos and AI-assisted analysis so you can see exactly what we see &mdash; then decide what makes sense for your home.</p>
  </section>`;
}

/** The Combined document's sections, keyed for the editor; report.layout hides/reorders them. */
export function combinedSections(input: CombinedInput): ReportSection[] {
  return [
    { key: 'company', label: 'Who We Are', html: companySection() },
    { key: 'owners', label: 'The Owners', html: ownersSection() },
    { key: 'findings-intro', label: 'What We Found', html: findingsIntro() },
    { key: 'findings', label: 'Inspection Findings', html: inspectionFindings(input.report) },
    { key: 'measurements', label: 'Measurements', html: measurementsSection(input.proposal) },
    { key: 'color-renders', label: 'Your Home, New Roof', html: colorRendersSection(input.proposal) },
    { key: 'products', label: 'Products', html: productsSection(input.proposal) },
    { key: 'colors', label: 'Color Options', html: colorsSection() },
    { key: 'integrity', label: 'The Integrity System', html: integritySection() },
    { key: 'warranty', label: 'Warranty', html: warrantySection() },
    { key: 'investment', label: 'Investment', html: investmentSection(input.proposal) },
    { key: 'accept', label: 'Accept', html: acceptSection(input.proposal) },
    { key: 'footer', label: 'Footer', html: reportFooter(), fixed: true },
  ];
}

export function renderCombinedHtml(input: CombinedInput): string {
  const body = joinSections(arrangeSections(combinedSections(input), (input.report as any).layout));
  return premiumShell({
    title: `Roof Inspection & Proposal · ${input.proposal.customer} · ${companyBrand().displayName}`,
    hero: combinedHero(input),
    body,
  });
}
