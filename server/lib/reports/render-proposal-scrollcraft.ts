/**
 * Proposal, rebuilt as a scroll-craft page (chaptered-editorial grammar).
 *
 * Unlike a normal scroll-craft build this is NOT one static page: it is a
 * TEMPLATE a specific job's real data is poured into every time a rep
 * generates a Proposal (see scrollcraft/builds/brn-proposal/BRIEF.md for the
 * full interview this was built from). The design system, chapters and
 * bespoke devices are fixed; the customer name, address, damage photos,
 * storm history and Good/Better/Best pricing are not.
 *
 * Real assets only — no AI-generated imagery anywhere (no KIE_AI_API_KEY in
 * this environment, and James was explicit that Fred & James's photo must be
 * their real one, never generated). Grammar bans on this page: `scrub`
 * beyond one chapter (there is no video anywhere), `spotlight`, `magnet`,
 * a full-bleed scrub hero, centred hero copy. See references/uniqueness.md
 * §2.2 in the scroll-craft skill for the full spec this follows.
 */
import { esc, usd } from './report-theme.js';
import { COVER_NAME_ATTRS } from './cover-name.js';
import { arrangeSections, tagSection, type ReportSection } from './layout.js';
import { SCROLLCRAFT_JS, SCROLLCRAFT_CSS } from './scrollcraft-engine.js';
import { MOBILE_CSS, MOBILE_JS } from './sections/mobile.js';
import type { TierPricing } from './roofing-products.js';
import { COMPANY_VALUES, COMPANY_VALUES_COMMERCIAL, OWNERS_STORY, WARRANTY, CRED_MARKERS } from './certainteed-data.js';
import { plainLanguageFor, plainSeverity } from './plain-language-damage.js';
import { standardsFor, renderStandardsFootnote } from './damage-standards.js';
import { scopeTotalOf } from './scope-items.js';
import { scopeTable, SCOPE_TABLE_CSS } from './sections/scope-table.js';
import { narrativeHtml, NARRATIVE_CSS } from './sections/narrative.js';
import { roofSystemWalkthrough, ROOF_SYSTEM_CSS_SCROLL } from './sections/roof-system-walkthrough.js';
import { roofSystemFor } from './roof-systems.js';
import { stormEvidence } from './sections/storm-evidence.js';
import { warrantyFor } from './product-warranty.js';
import { factGrid } from './sections/style.js';
import type { ComprehensiveRoofReport } from './comprehensive-roof-report.js';
import { PROJECT_MAP_HEAD, PROJECT_MAP_CSS, PROJECT_MAP_JS, projectMapContainerHtml } from './project-map-widget.js';
import { SCROLL_STYLE, SECTION_CSS_SCROLL } from './sections/style.js';
import { productSpecPanel } from './sections/product-spec-panel.js';
import { colorOptions } from './sections/color-options.js';
import { serviceIncludesList } from './sections/product-spec-panel.js';
import { isServiceProduct } from './roofing-products.js';
import { howTheJobRuns } from './sections/how-the-job-runs.js';
import { financing } from './sections/financing.js';
import { whyBRN } from './sections/why-brn.js';

export const BRAND = { name: 'Best Roofing Now', phone: '(704) 605-6047' };

/** Real photo from bestroofingnow.com/about — never replace with a generated image. */
const FOUNDERS_PHOTO = 'https://cms.bestroofingnow.com/wp-content/uploads/2023/12/WhatsApp-Image-2023-12-14-at-8.23.58-AM-1.jpeg';

function fmtDate(iso?: string | null): string {
  if (!iso) return '';
  // A bare 'YYYY-MM-DD' parses as UTC midnight, which rolls back a day once
  // toLocaleDateString applies a US timezone — force noon so the calendar
  // date shown always matches what was entered/looked up.
  try { return new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }); }
  catch { return ''; }
}

const SEV_ORDER: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1, none: 0 };

const NUMBER_WORDS = ['One', 'Two', 'Three', 'Four', 'Five', 'Six',
  'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen',
  'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen', 'Twenty'];

/**
 * Chapters are numbered AFTER the empty ones are dropped.
 *
 * A chapter can legitimately not render — a Standing Seam quote has no
 * published colour list, so there is no colour chapter — and the numbering
 * has to close over the gap rather than skip a word. Every numbered chapter
 * therefore emits a `{{CH}}` token where its word belongs instead of a
 * hardcoded "Chapter Seven", which is what made a dropped chapter leave a
 * hole in the sequence.
 *
 * A chapter with NO token is skipped rather than consuming a word: the cover
 * (chapterWelcome) is a title page, not a numbered chapter.
 */
export function numberChapters(chapters: string[]): string {
  let n = 0;
  return chapters
    .filter(Boolean)
    .map((html) => {
      if (!html.includes('{{CH}}')) return html;
      const word = NUMBER_WORDS[n] ?? String(n + 1);
      n += 1;
      return html.replace('{{CH}}', word);
    })
    .join('\n');
}

/* ------------------------------------------------------------- chapters -- */

function chapterWelcome(report: ComprehensiveRoofReport, customer: string, jobType?: 'retail' | 'insurance'): string {
  const p = report.property;
  const where = [p?.address, p?.city, p?.state].filter(Boolean).join(', ');
  return `<section class="sc-section ch ch--paper ch--title" id="ch-welcome">
    <div class="sc-wrap">
      <p class="sc-label folio-eyebrow">A Proposal, Prepared For${jobType === 'insurance' ? ' &middot; Insurance Claim' : ''}</p>
      <h1 class="sc-display sc-display--xl title-name" ${COVER_NAME_ATTRS}>${esc(customer)}</h1>
      <p class="sc-lede title-address">${esc(where)}</p>
      <p class="sc-body title-date">${esc(fmtDate(report.generatedAt))} &middot; Prepared by ${esc(BRAND.name)}</p>
      <p class="sc-body title-intro">Everything in this proposal comes from the actual inspection of your roof: what we found, what it costs to fix at three real levels, and the warranty we can register because we install it right. Nothing here is a template with your name dropped in.</p>
    </div>
  </section>`;
}

function chapterWhatWeFound(report: ComprehensiveRoofReport, damageSummary?: string | null, jobType?: 'retail' | 'insurance'): string {
  const dmg = report.damageAnalysis;
  const analysed = (dmg?.photos || []).filter((p: any) => (p.damages || []).length > 0);
  // No vision findings (analysis off, or none found): show the inspector's
  // photos as taken, captioned as they were, rather than an empty timeline.
  const asTaken = !analysed.length;
  const photos = (asTaken ? (dmg?.photos || []) : analysed).slice(0, 4);
  // Only a rep-confirmed storm (set on the field inspection's "Storm Date" /
  // "Storm Type", never an automatic NOAA nearest-event guess) earns a place
  // on this timeline — plenty of proposals (age/wear replacements, no storm
  // claim) have no storm date at all, and showing one anyway implied a claim
  // nobody made.
  const repStorm = report.repConfirmedStorm;

  const timelineNodes = [
    ...(repStorm ? [{ key: 'storm', label: `${esc(repStorm.type)} event`, sub: fmtDate(repStorm.date) }] : []),
    ...photos.map((p: any, i: number) => {
      if (asTaken) return { key: p.id, label: p.caption || `Photo ${i + 1}`, sub: 'as taken', photoUrl: p.url };
      const worst = [...(p.damages || [])].sort((a: any, b: any) => (SEV_ORDER[(b.severity || '').toLowerCase()] ?? 0) - (SEV_ORDER[(a.severity || '').toLowerCase()] ?? 0))[0];
      const plain = plainLanguageFor(worst?.type);
      return { key: p.id, label: plain.label, sub: plainSeverity(worst?.severity), photoUrl: p.url };
    }),
  ];

  // The connecting line is the thing --sc-p draws (see .tl-path in CSS); the
  // node cards themselves use an ordinary once-only entrance so they read as
  // a record that stays put rather than fading in and back out mid-scroll
  // (a scroll-cue on a middle act is required to fade out before the act
  // ends, which is wrong for a timeline meant to remain a visible record).
  const railWidth = 100 * timelineNodes.length;
  const nodeHtml = timelineNodes.map((n, i) => `
    <div class="tl-node" style="left:${(i / Math.max(1, timelineNodes.length - 1)) * 100}%">
      <span class="tl-dot"></span>
      <div class="tl-card">
        ${'photoUrl' in n && n.photoUrl ? `<img src="${esc(n.photoUrl)}" alt="${esc(n.label)}" width="240" height="180" loading="lazy">` : ''}
        <b>${esc(n.label)}</b>
        <span>${esc(n.sub)}</span>
      </div>
    </div>`).join('');

  const photoCount = asTaken ? `${dmg?.photos?.length ?? 0} photos on file.` : `${dmg?.totalPhotosAnalyzed ?? 0} photos reviewed.`;
  const lede = repStorm
    ? `From the storm that caused it to the damage it left. ${photoCount}`
    : `What our inspection found, photo by photo. ${photoCount}`;

  const timelineHtml = timelineNodes.length ? `<div class="timeline" style="--tl-count:${timelineNodes.length}">
          <svg class="tl-line" viewBox="0 0 ${railWidth} 4" preserveAspectRatio="none" aria-hidden="true">
            <path d="M0 2 H${railWidth}" pathLength="1000" class="tl-path" />
          </svg>
          <div class="tl-track">${nodeHtml}</div>
        </div>` : '';

  return `<section data-sc-act="pin" data-sc-span="1.6" class="ch ch--dark" id="ch-found">
    <div data-sc-stage class="stage-found">
      <div class="sc-wrap">
        <p class="sc-label" data-sc-cue="0 1 0">Chapter {{CH}}</p>
        <h2 class="sc-display sc-display--lg" data-sc-cue="0 1 0">What We Found On Your Roof</h2>
        <p class="sc-body found-lede" data-sc-cue="0 1 0">${lede}</p>
        ${damageSummary?.trim() ? `<p class="sc-body found-summary" data-sc-cue="0 1 0"><b>Your inspector's summary.</b> ${esc(damageSummary.trim())}</p>` : ''}
        ${timelineHtml}
        ${stormEvidence(report, jobType, SCROLL_STYLE)}
      </div>
    </div>
  </section>`;
}

/**
 * The in-depth, property-specific write-up (report-narrative.ts), when one
 * was generated. Written from this report's own findings and the rep's
 * checklist, reviewed by the rep in the editor. '' when absent, and
 * numberChapters() closes the gap.
 */
export function chapterYourRoof(report: ComprehensiveRoofReport): string {
  const text = (report as any).narrative?.findings;
  const body = narrativeHtml(text, SCROLL_STYLE);
  if (!body) return '';
  return `<section class="sc-section ch ch--dark" id="ch-narrative">
    <div class="sc-wrap sc-stack sc-prose" data-sc-in data-sc-stagger="40">
      <p class="sc-label">Chapter {{CH}}</p>
      <h2 class="sc-display sc-display--lg">Your Roof, Specifically</h2>
      <p class="sc-body">Not a template. This is what we found on your roof, what it means, and where it stands.</p>
      ${body}
    </div>
  </section>`;
}

/**
 * Every distinct condition, explained. What We Found is the timeline; this
 * is the evidence behind it — one card per finding type (worst severity,
 * the photo that shows it best), with the plain meaning, why it matters for
 * this roof, and the code / manufacturer standard once a person has
 * verified it (damage-standards.ts). Returns '' with no findings, and
 * numberChapters() closes the gap.
 */
export function chapterFindingsExplained(report: ComprehensiveRoofReport): string {
  const photos = (report.damageAnalysis?.photos || []) as any[];
  const byType = new Map<string, { type: string; severity: string; photoUrl: string; count: number; locations: string[] }>();
  const rank = (s: string | undefined) => SEV_ORDER[(s || '').toLowerCase()] ?? 0;
  for (const p of photos) {
    for (const d of (p.damages || []) as any[]) {
      const type = String(d.type || 'unknown');
      const cur = byType.get(type);
      if (!cur) {
        byType.set(type, { type, severity: d.severity, photoUrl: p.url, count: 1, locations: d.location ? [d.location] : [] });
        continue;
      }
      cur.count += 1;
      if (d.location && !cur.locations.includes(d.location)) cur.locations.push(d.location);
      if (rank(d.severity) > rank(cur.severity)) { cur.severity = d.severity; cur.photoUrl = p.url; }
    }
  }
  if (!byType.size) return '';

  const cards = [...byType.values()].sort((a, b) => rank(b.severity) - rank(a.severity)).map((f) => {
    const plain = plainLanguageFor(f.type);
    const std = standardsFor(f.type);
    const where = f.locations.slice(0, 3).join(', ');
    return `<article class="fx-card">
      <img src="${esc(f.photoUrl)}" alt="${esc(plain.label)}" loading="lazy">
      <div class="fx-body">
        <p class="sc-label">${esc(plainSeverity(f.severity))}${f.count > 1 ? ` &middot; ${f.count} places` : ''}</p>
        <h3>${esc(plain.label)}</h3>
        <p class="sc-body">${esc(plain.explanation)}</p>
        <p class="sc-body fx-why"><b>Why it matters.</b> ${esc(std.whyItMatters)}</p>
        ${where ? `<p class="sc-body tiny">Seen at: ${esc(where)}</p>` : ''}
        ${renderStandardsFootnote(f.type, 'sc-body tiny')}
      </div>
    </article>`;
  }).join('');

  return `<section class="sc-section ch ch--paper" id="ch-findings">
    <div class="sc-wrap sc-stack" data-sc-in data-sc-stagger="60">
      <p class="sc-label">Chapter {{CH}}</p>
      <h2 class="sc-display sc-display--lg">The Findings, Explained</h2>
      <p class="sc-body">Each condition we found on your roof, what it means, and why it matters &mdash; specific to this house, not a generic list.</p>
      <div class="fx-grid">${cards}</div>
    </div>
  </section>`;
}

/**
 * Who we are — the owners' story, the values list, and the credibility band.
 *
 * whyBRN is called in its FULL mode on purpose. Its trust stats ($100,000 of
 * profits donated, the Angi Super Service Awards, 500+ roofs, 5.0★ on 65+
 * reviews) reach a customer on no other document: the Estimate calls
 * whyBRN(..., { compact: true }), which is the credential chips only.
 */
export function chapterWhoWeAre(audience: 'residential' | 'commercial' = 'residential'): string {
  const values = (audience === 'commercial' ? COMPANY_VALUES_COMMERCIAL : COMPANY_VALUES).map(([t, d]) => `<div class="value-line"><b>${esc(t)}</b><span>${esc(d)}</span></div>`).join('');
  return `<section class="sc-section ch ch--paper" id="ch-who">
    <div class="sc-wrap who-grid">
      <div class="sc-stack" data-sc-in data-sc-stagger="70">
        <p class="sc-label">Chapter {{CH}}</p>
        <h2 class="sc-display sc-display--lg">${esc(OWNERS_STORY.heading)}</h2>
        ${OWNERS_STORY.paragraphs.map((p) => `<p class="sc-body">${p}</p>`).join('')}
        <p class="sig">${OWNERS_STORY.signature}</p>
        <div class="values-list">${values}</div>
        ${whyBRN(SCROLL_STYLE)}
      </div>
      <figure data-sc-reveal="right" data-sc-reveal-at="0.15 0.6" class="who-photo">
        <img src="${esc(FOUNDERS_PHOTO)}" alt="Fred and James Turner, founders of Best Roofing Now" loading="lazy">
        <figcaption>Fred &amp; James Turner &mdash; Best Roofing Now</figcaption>
      </figure>
    </div>
  </section>`;
}

/**
 * Where the squares came from. When a measurement report (GAF / EagleView)
 * was on the job, its facets, pitch and edge lengths are the basis of the
 * price — say so, with the numbers.
 */
function measuredRoof(report: ComprehensiveRoofReport): string {
  const m: any = report.measurements;
  const squares = report.roofDetails?.squares;
  if (!m && !squares) return '';
  const ft = (n: unknown) => (Number(n) > 0 ? `${Math.round(Number(n))} ft` : null);
  const grid = factGrid([
    ['Roof size', squares ? `${squares} squares` : (m?.squares ? `${m.squares} squares` : null)],
    ['Pitch', m?.predominantPitch ? esc(String(m.predominantPitch)) : (report.roofDetails?.pitch ? esc(String(report.roofDetails.pitch)) : null)],
    ['Facets', m?.facets ? String(m.facets) : null],
    ['Ridges & hips', ft(m?.ridgesHipsFt)],
    ['Valleys', ft(m?.valleysFt)],
    ['Eaves', ft(m?.eavesFt)],
    ['Rakes', ft(m?.rakesFt)],
  ]);
  if (!grid) return '';
  const source = m?.documentName ? `Measured from ${esc(String(m.documentName))}` : 'From the on-site inspection';
  return `<div class="measured" data-sc-in>
        <p class="sc-label">Your roof, measured &middot; ${source}</p>
        ${grid}
      </div>`;
}

export function chapterYourOptions(pricing: { good: TierPricing; better: TierPricing; best: TierPricing }, startingTier: 'good' | 'better' | 'best', scopeTotal = 0, report: ComprehensiveRoofReport): string {
  // data-price drives the Investment counter, so it carries the scope too:
  // the number the customer watches is the whole job, not just the shingle.
  const card = (t: TierPricing) => `<button type="button" class="opt-card" data-tier="${t.tier}" data-price="${Math.round((t.total + scopeTotal) * 100) / 100}" data-roof="${Math.round(t.total * 100) / 100}" role="tab" aria-selected="${t.tier === startingTier ? 'true' : 'false'}" id="tab-${t.tier}" aria-controls="panel-${t.tier}">
      <span class="opt-tier">${t.tier}</span>
      <span class="opt-name">${esc(t.product.name)}</span>
      <span class="opt-price">${usd(t.total)}</span>
      ${t.iso ? `<span class="opt-scope">includes ${esc(t.iso.label)}</span>` : ''}
      ${scopeTotal > 0 ? `<span class="opt-scope">+ ${usd(scopeTotal)} additional scope</span>` : ''}
    </button>`;

  const panel = (t: TierPricing) => `<div class="opt-panel" id="panel-${t.tier}" role="tabpanel" aria-labelledby="tab-${t.tier}" ${t.tier === startingTier ? '' : 'hidden'}>
      <p class="opt-tagline">${esc(t.product.tagline)}</p>
      <p class="sc-body">${t.product.body}</p>
      ${serviceIncludesList(t.product, SCROLL_STYLE)}
      <dl class="opt-specs">
        <div><dt>Rate</dt><dd>${usd(t.ratePerSquare)} / square</dd></div>
        <div><dt>Roof size</dt><dd>${t.squares} squares</dd></div>
        <div><dt>Total</dt><dd class="opt-total">${usd(t.total)}</dd></div>
      </dl>
    </div>`;

  return `<section class="sc-section ch ch--paper ch--peak" id="ch-options">
    <div class="sc-wrap">
      <p class="sc-label" data-sc-in>Chapter {{CH}} &middot; The Peak</p>
      <h2 class="sc-display sc-display--lg" data-sc-in>Your Options</h2>
      <p class="sc-body" data-sc-in>${[pricing.good, pricing.better, pricing.best].some((t) => isServiceProduct(t.product))
        ? 'Good, Better, or Best &mdash; from caring for the roof you have to putting on a new one, three real prices. Tap one.'
        : 'Good, Better, or Best &mdash; the same roof, three real products, three real prices. Tap one.'}</p>
      ${measuredRoof(report)}
      <div class="opt-instrument" data-sc-in>
        <div class="opt-tabs" role="tablist" aria-label="Good, Better, Best">
          ${card(pricing.good)}${card(pricing.better)}${card(pricing.best)}
        </div>
        ${panel(pricing.good)}${panel(pricing.better)}${panel(pricing.best)}
      </div>
    </div>
  </section>`;
}

export function chapterInvestment(startingTier: 'good' | 'better' | 'best', pricing: { good: TierPricing; better: TierPricing; best: TierPricing }, report: ComprehensiveRoofReport): string {
  const t = pricing[startingTier];
  const scopeTotal = scopeTotalOf(report);
  const total = Math.round((t.total + scopeTotal) * 100) / 100;
  const scope = scopeTable({ report, roofSystemLabel: `Roof system — ${t.product.name}`, roofSystemTotal: t.total }, SCROLL_STYLE);
  return `<section class="sc-section ch ch--dark ch--investment" id="ch-investment">
    <div class="sc-wrap" data-sc-in>
      <p class="sc-label">Chapter {{CH}}</p>
      <h2 class="sc-display sc-display--lg">The Investment</h2>
      <p class="sc-body inv-lede">Based on the <span data-inv-tier-name>${esc(t.product.name)}</span> option selected above${scopeTotal > 0 ? ', plus the additional scope listed below' : ''}. Choose a different tier and this number follows it.</p>
      <p class="inv-total"><span data-tier-total="${total}" id="inv-total-count">0</span></p>
      ${scope}
      <p class="sc-body">This is an investment estimate, confirmed on site before any work begins. Final scope and price are locked in once you sign.</p>
    </div>
  </section>`;
}

/**
 * What is actually going on the house, with the manufacturer's published
 * numbers behind it.
 *
 * `ownHeading: false` because this chapter supplies the <h2> itself; without
 * it productSpecPanel adds its own <h3> and the product name prints twice.
 */
export function chapterProduct(t: TierPricing, report: ComprehensiveRoofReport): string {
  const solution = narrativeHtml((report as any).narrative?.solution, SCROLL_STYLE);
  return `<section class="sc-section ch ch--dark" id="ch-product">
    <div class="sc-wrap sc-stack" data-sc-in data-sc-stagger="60">
      <p class="sc-label">Chapter {{CH}} &middot; Our Recommendation</p>
      <h2 class="sc-display sc-display--lg">${esc(t.product.name)}</h2>
      ${solution ? `<div class="sc-stack sc-prose"><p class="sc-label">Why this, for this roof</p>${solution}</div>` : ''}
      ${productSpecPanel({ product: t.product, squares: t.squares, ratePerSquare: t.ratePerSquare, ownHeading: false }, SCROLL_STYLE)}
    </div>
  </section>`;
}

/**
 * The package, layer by layer, with the manufacturer's picture of each part
 * (./sections/roof-system-walkthrough.ts). '' for a rep-typed custom product,
 * which has no catalog system behind it — numberChapters() closes the gap.
 */
export function chapterSystem(t: TierPricing): string {
  const system = roofSystemFor(t.product);
  if (!system) return '';
  const w = warrantyFor(t.product);
  return `<section class="sc-section ch ch--paper" id="ch-system">
    <div class="sc-wrap sc-stack" data-sc-in data-sc-stagger="60">
      <p class="sc-label">Chapter {{CH}}</p>
      <h2 class="sc-display sc-display--lg">${w.certainteed ? 'The Integrity Roof System' : 'How Your Roof Goes Together'}</h2>
      ${roofSystemWalkthrough(system, SCROLL_STYLE)}
    </div>
  </section>`;
}

/**
 * Colour options, from the shared builder (./sections/color-options.ts).
 *
 * Returns '' when the product has no published colour list (standing-seam
 * metal, a rep-typed custom product) — the builder returns '' on purpose in
 * that case, and a "Your Color Options" heading over an empty chapter is
 * worse than no chapter. numberChapters() closes the gap it leaves.
 */
function chapterColors(t: TierPricing): string {
  const inner = colorOptions({ product: t.product }, SCROLL_STYLE);
  if (!inner) return '';
  return `<section class="sc-section ch ch--paper" id="ch-colors">
    <div class="sc-wrap sc-stack" data-sc-in>
      <p class="sc-label">Chapter {{CH}}</p>
      <h2 class="sc-display sc-display--lg">Your Color Options</h2>
      ${inner}
    </div>
  </section>`;
}

/** The install sequence, from the shared builder (./sections/how-the-job-runs.ts). */
export function chapterProcess(): string {
  return `<section class="sc-section ch ch--dark" id="ch-process">
    <div class="sc-wrap sc-stack" data-sc-in data-sc-stagger="60">
      <p class="sc-label">Chapter {{CH}}</p>
      <h2 class="sc-display sc-display--lg">How the Job Runs</h2>
      ${howTheJobRuns(SCROLL_STYLE)}
    </div>
  </section>`;
}

/**
 * Financing, from the shared builder (./sections/financing.ts), which quotes
 * no APR and no monthly payment on purpose — the real numbers come from
 * HFS Financial's own application, not a figure invented in a template.
 */
export function chapterFinancing(): string {
  return `<section class="sc-section ch ch--paper" id="ch-financing">
    <div class="sc-wrap sc-stack" data-sc-in>
      <p class="sc-label">Chapter {{CH}}</p>
      <h2 class="sc-display sc-display--lg">Financing Options</h2>
      ${financing(SCROLL_STYLE)}
    </div>
  </section>`;
}

export function chapterWarranty(t: TierPricing): string {
  // The six Integrity System rows that used to sit here moved to
  // chapterSystem, which walks every layer with the manufacturer's photo;
  // this chapter is now only the promise behind them. Not a pin: the lede
  // plus the seal is taller than one 100vh stage on a phone, and a pinned
  // stage clips at 100vh (overflow:clip).
  const w = warrantyFor(t.product);
  // A tune-up or cleaning: what it covers and what it is not — no warranty years.
  if (w.service) {
    return `<section class="sc-section ch ch--paper" id="ch-warranty">
    <div class="sc-wrap sc-stack" data-sc-in data-sc-stagger="60">
      <p class="sc-label">Chapter {{CH}}</p>
      <h2 class="sc-display sc-display--lg">What This Visit Covers</h2>
      ${serviceIncludesList(t.product, SCROLL_STYLE)}
      <p class="sc-body warranty-lede">${w.manufacturerLine}. When the roof does need replacing, the options in this document are still here.</p>
    </div>
  </section>`;
  }
  // The Integrity Roof System and its SureStart PLUS registration are a
  // CertainTeed claim; a metal or synthetic roof gets the workmanship promise
  // and its own manufacturer's terms, never CertainTeed's number.
  const lede = w.certainteed
    ? WARRANTY.certificationCopy
    : `Every roof we install carries our own <b>${w.workmanshipYears}-year workmanship warranty</b> on the installation. The <b>${esc(t.product.name)}</b> carries its manufacturer's warranty on the material &mdash; ${w.manufacturerLine}.`;
  const seal = w.manufacturerYears != null
    ? `<div><span data-sc-count="0 ${w.manufacturerYears}" data-sc-count-ms="1200">0</span><b>Yr Manufacturer</b></div>`
    : `<div class="cert-seal--text"><span>${esc(w.manufacturer)}</span><b>Manufacturer warranty</b></div>`;
  return `<section class="sc-section ch ch--paper" id="ch-warranty">
    <div class="sc-wrap sc-stack" data-sc-in data-sc-stagger="60">
      <p class="sc-label">Chapter {{CH}}</p>
      <h2 class="sc-display sc-display--lg">What Stands Behind It</h2>
      <p class="sc-body warranty-lede">${lede}</p>
      <div class="certificate">
        <div class="cert-seal">
          ${seal}
          <div><span data-sc-count="0 ${w.workmanshipYears}" data-sc-count-ms="1200">0</span><b>Yr Workmanship</b></div>
        </div>
        ${w.certainteed ? `<p class="sc-body tiny">${w.manufacturerLine}.</p>` : ''}
      </div>
    </div>
  </section>`;
}

export function chapterOurWork(): string {
  return `<section class="sc-section ch ch--paper" id="ch-our-work">
    <div class="sc-wrap sc-stack" data-sc-in>
      <p class="sc-label">Chapter {{CH}}</p>
      <h2 class="sc-display sc-display--lg">See Our Work Near You</h2>
      <p class="sc-body">Real completed roofing projects across the Charlotte area &mdash; tap any pin to see before &amp; after photos from a job near you, not a stock image.</p>
      ${projectMapContainerHtml()}
    </div>
  </section>`;
}

/** `salutation` defaults to the customer's first name; a company is addressed by its full name. */
export function chapterNextStep(customer: string, salutation: string = customer.split(' ')[0] || 'there'): string {
  const markers = CRED_MARKERS.map((m) => `<span>${esc(m)}</span>`).join(' &middot; ');
  return `<section class="sc-section ch ch--dark ch--close" id="ch-next">
    <div class="sc-wrap">
      <p class="sc-label">Chapter {{CH}}</p>
      <h2 class="sc-display sc-display--md">One decision left, ${esc(salutation)}.</h2>
      <p class="sc-body">Tell your Best Roofing Now rep which tier you want, and we turn this proposal into a signed job &mdash; the same numbers you saw above, nothing renegotiated after the fact. Call ${esc(BRAND.phone)} or reply to your rep directly.</p>
      <p class="colophon">${esc(BRAND.name)} &middot; ${markers}</p>
    </div>
  </section>`;
}

/* ----------------------------------------------------------------- css --- */

export const PAGE_CSS = `
:root {
  --sc-canvas: #F7F4EE; --sc-surface: #FFFFFF;
  --sc-ink: #17130F; --sc-ink-soft: #6B6259;
  --sc-accent: #C8102E; --sc-accent-ink: #FFFFFF;
  --sc-font-display: 'Fraunces', Georgia, serif;
  --sc-font-text: 'Archivo', system-ui, sans-serif;
}
.ch { background: var(--sc-canvas); color: var(--sc-ink); position: relative; }
.ch--dark { --sc-canvas: #17130F; --sc-ink: #F5EFE6; --sc-ink-soft: #B4A99A; background: var(--sc-canvas); color: var(--sc-ink); }
.ch--paper { --sc-canvas: #F7F4EE; --sc-ink: #17130F; --sc-ink-soft: #6B6259; }
/* SCROLL_STYLE.note is "sc-body tiny" — every shared section's caveat line
   (the sizing line, the colour-availability note, the financing footnote)
   carries it, and the Proposal declared it nowhere. Same rule the
   Presentation carries in its own PAGE_CSS; deliberately NOT in
   SECTION_CSS_SCROLL, which would collide with that one at equal
   specificity. */
.tiny { font-size: var(--sc-t-xs); color: var(--sc-ink-soft); }

/* folio nav: the grammar's own chrome, not a fixed marketing bar */
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

.stage-found, .stage-warranty { display: flex; align-items: center; }
.found-lede { max-width: 46ch; color: var(--sc-ink-soft); margin-top: var(--sc-3); }
.timeline { margin-top: var(--sc-9); position: relative; }
.tl-line { width: 100%; height: 4px; display: block; }
.tl-path { fill: none; stroke: color-mix(in oklab, var(--sc-ink) 25%, transparent); stroke-width: 2; stroke-dasharray: 1000; stroke-dashoffset: calc(1000 - (1000 * var(--sc-p, 0))); }
.tl-track { position: relative; height: 220px; margin-top: -2px; }
.tl-node { position: absolute; top: 0; transform: translateX(-50%); width: clamp(9rem, 16vw, 13rem); }
.tl-dot { display: block; width: 10px; height: 10px; border-radius: 50%; background: var(--sc-accent); margin: 0 auto var(--sc-3); }
.tl-card { background: color-mix(in oklab, var(--sc-surface, #fff) 8%, transparent); border: 1px solid var(--sc-hairline); border-radius: var(--sc-r-md); padding: var(--sc-3); text-align: center; }
.tl-card img { border-radius: var(--sc-r-sm); margin-bottom: var(--sc-2); width: 100%; height: 90px; object-fit: cover; }
.tl-card b { display: block; font-family: var(--sc-font-display); font-size: var(--sc-t-sm); }
.tl-card span { display: block; font-size: var(--sc-t-xs); color: var(--sc-ink-soft); margin-top: 2px; }

.who-grid { display: grid; grid-template-columns: 1.1fr 0.9fr; gap: var(--sc-8); align-items: start; }
@media (max-width: 860px) { .who-grid { grid-template-columns: 1fr; } }
.sig { font-family: var(--sc-font-display); font-style: italic; margin-top: var(--sc-5); }
.values-list { margin-top: var(--sc-7); display: grid; gap: var(--sc-4); }
.value-line b { display: block; font-family: var(--sc-font-display); }
.value-line span { color: var(--sc-ink-soft); font-size: var(--sc-t-sm); }
.who-photo { position: sticky; top: var(--sc-8); }
/* Same source photo as the Presentation deck, and same fix — see that
   file's comment for how the crop width was verified. aspect-ratio (not a
   max-width/height pair) is what makes the crop window a fixed 600/905
   slice of the source regardless of how large this box renders. */
.who-photo img { display: block; width: 100%; max-width: 460px; aspect-ratio: 600 / 905; object-fit: cover; object-position: 0% 50%; border-radius: var(--sc-r-md); margin: 0 auto; box-shadow: var(--sc-e2); }
.who-photo figcaption { margin-top: var(--sc-3); font-size: var(--sc-t-xs); color: var(--sc-ink-soft); text-align: center; }
/* productSpecPanel reuses .who-photo for the product shot, but the crop above
   is a 600/905 portrait slice tuned for the founders photo — it would slice a
   landscape installed-roof photo into a tall strip. Same override the
   Presentation carries (render-presentation-scrollcraft.ts:596), and it
   outranks the base rule on specificity regardless of load order. Sticky is
   also dropped: there is no second column here for it to travel against. */
#ch-product .who-photo { position: static; }
#ch-product .who-photo img { aspect-ratio: 4 / 5; object-position: center; }

.ch--peak { padding-block: var(--sc-10); }
.opt-instrument { margin-top: var(--sc-7); }
.opt-tabs { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--sc-3); }
.opt-card { font: inherit; text-align: left; cursor: pointer; background: var(--sc-surface); border: 2px solid var(--sc-hairline); border-radius: var(--sc-r-lg); padding: var(--sc-5); display: flex; flex-direction: column; gap: var(--sc-2); transition: border-color var(--sc-d-base) var(--sc-ease-out), transform var(--sc-d-fast) var(--sc-ease-out); }
.opt-card:hover { border-color: color-mix(in oklab, var(--sc-accent) 40%, var(--sc-hairline)); }
.opt-card:active { transform: scale(0.98); }
.opt-card[aria-selected="true"] { border-color: var(--sc-accent); box-shadow: var(--sc-e1); }
.opt-tier { font-family: var(--sc-font-text); font-size: var(--sc-t-xs); text-transform: uppercase; letter-spacing: var(--sc-track-wide); color: var(--sc-ink-soft); }
.opt-card[aria-selected="true"] .opt-tier { color: var(--sc-accent); }
.opt-name { font-family: var(--sc-font-display); font-size: var(--sc-t-lg); }
.opt-price { font-family: var(--sc-font-display); font-size: var(--sc-t-xl); }
.opt-panel { margin-top: var(--sc-6); padding-top: var(--sc-6); border-top: 1px solid var(--sc-hairline); }
.opt-tagline { font-family: var(--sc-font-display); font-style: italic; font-size: var(--sc-t-lg); margin: 0 0 var(--sc-3); }
.opt-specs { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--sc-4); margin-top: var(--sc-5); }
.opt-specs dt { font-size: var(--sc-t-xs); text-transform: uppercase; letter-spacing: var(--sc-track-wide); color: var(--sc-ink-soft); }
.opt-specs dd { margin: var(--sc-1) 0 0; font-family: var(--sc-font-display); font-size: var(--sc-t-lg); }
.opt-total { color: var(--sc-accent); }
@media (max-width: 860px) { .opt-tabs, .opt-specs { grid-template-columns: 1fr; } }

.ch--investment { text-align: center; padding-block: var(--sc-10); }
.inv-lede { max-width: 46ch; margin-inline: auto; }
.inv-total { font-family: var(--sc-font-display); font-size: clamp(3.5rem, 8vw, 7rem); color: var(--sc-accent); margin: var(--sc-6) 0; }
.inv-total::before { content: "$"; }

.certificate { margin-top: var(--sc-8); border: 1px solid var(--sc-hairline-strong); border-radius: var(--sc-r-lg); padding: var(--sc-7); background: var(--sc-surface); }
.ig-rows { display: grid; gap: var(--sc-4); }
.ig-row b { display: block; font-family: var(--sc-font-display); }
.ig-row span { color: var(--sc-ink-soft); font-size: var(--sc-t-sm); }
.cert-seal { margin-top: var(--sc-7); padding-top: var(--sc-7); border-top: 1px dashed var(--sc-hairline-strong); display: flex; gap: var(--sc-8); justify-content: center; }
.cert-seal div { text-align: center; }
.cert-seal span { display: block; font-family: var(--sc-font-display); font-size: var(--sc-t-3xl); color: var(--sc-accent); }
.cert-seal b { font-size: var(--sc-t-xs); text-transform: uppercase; letter-spacing: var(--sc-track-wide); color: var(--sc-ink-soft); }

/* The Findings, Explained — one evidence card per condition. */
.fx-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: var(--sc-5); margin-top: var(--sc-6); }
.fx-card { background: #fff; border: 1px solid var(--sc-hairline); border-radius: var(--sc-r-lg); overflow: hidden; box-shadow: var(--sc-e1); }
.fx-card img { width: 100%; height: 190px; object-fit: cover; display: block; }
.fx-body { padding: var(--sc-4); }
.fx-body h3 { font-family: var(--sc-font-display); font-size: var(--sc-t-lg); margin: var(--sc-1) 0 var(--sc-2); }
.fx-why { margin-top: var(--sc-3); }
.standards-note { color: var(--sc-ink-soft); }
.opt-scope { display: block; font-size: var(--sc-t-xs); color: var(--sc-ink-soft); margin-top: 2px; }
${SCOPE_TABLE_CSS}
${NARRATIVE_CSS}
${ROOF_SYSTEM_CSS_SCROLL}
.sc-prose { max-width: 62ch; }
.found-summary { margin-top: var(--sc-4); max-width: 62ch; }
.storm-evidence { margin-top: var(--sc-7); }
.measured { margin: var(--sc-5) 0 var(--sc-6); }
.cert-seal--text span { display: block; font-family: var(--sc-font-display); font-size: var(--sc-t-lg); line-height: 1.2; }

.ch--close { padding-block: var(--sc-10); }
.colophon { margin-top: var(--sc-8); padding-top: var(--sc-5); border-top: 1px solid var(--sc-hairline); font-size: var(--sc-t-xs); letter-spacing: var(--sc-track-wide); text-transform: uppercase; color: var(--sc-ink-soft); }

/* whyBRN renders its trust stats as a plain <ul class="sc-body">, and the
   engine's .sc-body is margin:0 — without this the list sits flush under the
   values list with no separation from the credential chips above it. */
.cred + ul.sc-body { margin-top: var(--sc-5); line-height: 1.9; padding-left: 1.2em; }

/* The shared sections' own CSS, against the --sc-* variables declared above:
   .fact-grid/.fact, .spec-colors/.spec-chip, .roofstrip, .cta-tel,
   .award-strip, .product-panel and .cred, none of which this page declared.
   Appended last; no selector in it collides with anything above, so load
   order is immaterial except for #ch-product .who-photo img, which outranks
   it on specificity. */
${SECTION_CSS_SCROLL}`;

/* ------------------------------------------------------------------ js --- */

export const PAGE_JS = `
(function () {
  // Reports what a rep could never learn from a PDF: which sections the
  // customer actually scrolled to, and which tier they tapped. Best-effort
  // only — sendBeacon/fetch failures are swallowed because a tracking miss
  // must never be visible to the customer or block anything on the page.
  var pending = [];
  var seenSections = {};
  function flushTrack() {
    if (!pending.length) return;
    var body = { viewedChapterIds: [] };
    pending.forEach(function (e) {
      if (e.viewedChapterIds) body.viewedChapterIds = body.viewedChapterIds.concat(e.viewedChapterIds);
      if (e.selectedTier) body.selectedTier = e.selectedTier;
    });
    pending = [];
    var url = location.pathname.replace(/\\/$/, '') + '/track';
    try {
      var payload = JSON.stringify(body);
      if (navigator.sendBeacon) {
        navigator.sendBeacon(url, new Blob([payload], { type: 'application/json' }));
      } else {
        fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload, keepalive: true }).catch(function () {});
      }
    } catch (e) { /* tracking is best-effort */ }
  }
  function track(event) { pending.push(event); }
  setInterval(flushTrack, 4000);
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') flushTrack(); });
  window.addEventListener('pagehide', flushTrack);

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
  function select(tier) {
    tabs.forEach(function (t) { t.setAttribute('aria-selected', String(t.dataset.tier === tier)); });
    panels.forEach(function (p) { p.hidden = p.id !== 'panel-' + tier; });
    var card = document.querySelector('.opt-card[data-tier="' + tier + '"]');
    if (card) { followTier(card); if (invSeen) tweenCount(invTarget); }
    // The one place the page records which tier is showing; the commercial
    // layer diagram keys off it.
    document.documentElement.setAttribute('data-tier', tier);
  }
  tabs.forEach(function (t) { t.addEventListener('click', function () { select(t.dataset.tier); track({ selectedTier: t.dataset.tier }); }); });
  document.addEventListener('brn:select-tier', function (e) { var tier = e.detail && e.detail.tier; if (tier) { select(tier); track({ selectedTier: tier }); } });

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
        if (entry.target.id && !seenSections[entry.target.id]) {
          seenSections[entry.target.id] = true;
          track({ viewedChapterIds: [entry.target.id] });
        }
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
 * this, the same helper Estimate's replacement mode uses. Reading pricing
 * off the report itself (rather than taking raw tierSelection/squares here)
 * means refine's re-render can call this with just the stored data, no
 * original generation params required.
 */
/** The Proposal's chapters, keyed for the editor; report.layout hides/reorders them. Keys match the chapter ids. */
export function proposalSections(report: ComprehensiveRoofReport, opts: { customer?: string; jobType?: 'retail' | 'insurance'; damageSummary?: string | null } = {}): ReportSection[] {
  const options = report.replacementOptions as TierPricing[] | undefined;
  if (!options || options.length !== 3) {
    throw new Error('Pick your Good, Better and Best products and confirm the roof size before generating a Proposal.');
  }
  const pricing = { good: options[0], better: options[1], best: options[2] };
  const startingTier = report.selectedTier ?? 'better';
  const customer = opts.customer || 'Homeowner';
  return [
    { key: 'welcome', label: 'Welcome', html: chapterWelcome(report, customer, opts.jobType) },
    { key: 'found', label: 'What We Found', html: chapterWhatWeFound(report, opts.damageSummary, opts.jobType) },
    { key: 'findings', label: 'The Findings', html: chapterFindingsExplained(report) },
    { key: 'narrative', label: 'Your Roof', html: chapterYourRoof(report) },
    { key: 'who', label: 'Who We Are', html: chapterWhoWeAre() },
    { key: 'options', label: 'Your Options', html: chapterYourOptions(pricing, startingTier, scopeTotalOf(report), report) },
    { key: 'investment', label: 'Investment', html: chapterInvestment(startingTier, pricing, report) },
    { key: 'product', label: 'Product', html: chapterProduct(pricing[startingTier], report) },
    { key: 'system', label: 'The System', html: chapterSystem(pricing[startingTier]) },
    { key: 'colors', label: 'Color Options', html: chapterColors(pricing[startingTier]) },
    { key: 'process', label: 'Process', html: chapterProcess() },
    { key: 'financing', label: 'Financing', html: chapterFinancing() },
    { key: 'warranty', label: 'Warranty', html: chapterWarranty(pricing[startingTier]) },
    { key: 'our-work', label: 'Our Work', html: chapterOurWork() },
    { key: 'next', label: 'Next Step', html: chapterNextStep(customer) },
  ];
}

export function renderProposalScrollcraftHtml(report: ComprehensiveRoofReport, opts: { customer?: string; jobType?: 'retail' | 'insurance'; damageSummary?: string | null } = {}): string {
  const options = report.replacementOptions as TierPricing[] | undefined;
  if (!options || options.length !== 3) {
    throw new Error('Pick your Good, Better and Best products and confirm the roof size before generating a Proposal.');
  }
  const pricing = { good: options[0], better: options[1], best: options[2] };
  const startingTier = report.selectedTier ?? 'better';
  const customer = opts.customer || 'Homeowner';

  // One list decides BOTH the folio and the body — PAGE_JS pairs folio links
  // with sections by index, so the two must never disagree.
  const arranged = arrangeSections(proposalSections(report, opts), (report as any).layout);
  const body = numberChapters(arranged.map(tagSection));
  const folio = `<nav class="folio-nav" aria-label="Chapters">${arranged.map((c) => `<a href="#ch-${c.key}">${esc(c.label)}</a>`).join('')}</nav>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Proposal for ${esc(customer)} &middot; ${esc(BRAND.name)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&family=Archivo:wght@400;500;600;700&display=swap" rel="stylesheet">
${PROJECT_MAP_HEAD}
<style>${SCROLLCRAFT_CSS}</style>
<style>${PAGE_CSS}</style>
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
<script>${SCROLLCRAFT_JS}</script>
<script>${MOBILE_JS}</script>
<script>ScrollCraft.mount(document.body);</script>
<script>${PAGE_JS}</script>
<script>${PROJECT_MAP_JS}</script>
</body>
</html>`;
}
