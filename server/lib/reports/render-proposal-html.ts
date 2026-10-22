/**
 * Premium roof-replacement PROPOSAL renderer. Value-first: company, values,
 * owners, measurements, product education, colors, the Integrity Roof System,
 * warranty — and pricing LAST. Section builders are exported so the combined
 * report can reuse them.
 */
import { premiumShell, esc, usd, usd2, checkCell } from './report-theme.js';
import {
  COLOR_ASSETS, PRODUCT_TIERS, scopeRows, isCertainTeedCredentialed,
  INTEGRITY_SYSTEM, warranty, DEFAULT_RATES, type TierKey,
} from './certainteed-data.js';
import { companyBrand, companyTel, companyValues, credentialMarkers, ownersStory } from './company-brand.js';


export interface ProposalInput {
  customer: string;
  address: string;
  cityStateZip?: string;
  jobNumber?: string;
  date?: string;
  rep?: string;
  /** Hero H1 override (defaults to "Roof Replacement Proposal"). */
  heroTitle?: string;
  satelliteDataUri?: string | null;
  /** Fallback hero image URL (a real JobTread job photo) when no aerial is available. */
  heroPhotoUrl?: string;
  /** Roof squares actually billed (already includes the waste factor). */
  billableSquares?: number;
  measuredSquares?: number;
  roofAreaSqFt?: number;
  averagePitch?: string;
  segments?: number;
  imageryDate?: string;
  wastePct?: number;
  /** Optional per-tier rate overrides ($/square). Defaults to the standard starting rates. */
  rates?: Partial<Record<TierKey, number>>;
  /** Override which tier is shown as "Recommended" (defaults to the PRODUCT_TIERS recommended tier = Best). */
  recommendedTier?: TierKey;
  /**
   * Replace the standard Good/Better/Best shingle tiers with fully custom packages
   * (e.g. a tune-up option plus two fixed-price replacement quotes). When set, the
   * investment section renders these instead of the standard tiers + scope table.
   * Each total is `amount` (explicit $) or `ratePerSquare` × measured squares.
   */
  customTiers?: Array<{
    name: string;
    subtitle?: string;
    amount?: number;
    ratePerSquare?: number;
    rateText?: string;
    bullets?: string[];
    recommended?: boolean;
    warrantyText?: string;
    accent?: string;
  }>;
  /** All JobTread job photos to embed in the Project Photos gallery. */
  photos?: Array<{ url: string; caption?: string }>;
  /** Gemini "new roof on YOUR home" color renders (first = hero, Weathered Wood). */
  colorRenders?: Array<{ name: string; blurb?: string; url: string }>;
  /** Pre-rendered "Inspection Findings" HTML section (inspector notes + photo AI). */
  inspectionFindings?: string;
  /** Pre-rendered "Our Recommended Solution" HTML section (bridges findings to the fix). */
  recommendedSolution?: string;
  /** Pre-rendered "Storm & Weather History" HTML section (NOAA storm data for insurance claims). */
  stormHistory?: string;
  /** Low-slope / flat roofing squares within billableSquares (priced at flatRoofRatePerSquare, not the shingle rate). */
  flatRoofSquares?: number;
  /** Installed $/square for the flat-roof portion. */
  flatRoofRatePerSquare?: number;
  /** Additional recommended repairs, priced separately from the roof package. */
  repairs?: Array<{ label: string; price: string; note?: string }>;
  /**
   * "Repair instead of replace" cost estimate (distinct from `repairs`). Renders a
   * "Repair Option" callout stating the repair price, for roofs where a repair is
   * possible but uneconomical (e.g. a repair would replace most of the roof anyway).
   * Pass an explicit `amount`, or `pctOfReplacement` to derive it from the lowest
   * replacement tier (e.g. 85 = 85% of the most basic replacement) so it never drifts.
   * `note` is a short lead after the price; `details` render as explanatory bullets.
   */
  repairEstimate?: { amount?: number; pctOfReplacement?: number; note?: string; details?: string[] };
  /** Overall discount % applied to each tier total (e.g. 10 for 10% off). */
  discountPct?: number;
  /** Priced add-ons (e.g. skylight replacement) folded INTO each tier total before the discount. */
  addOns?: Array<{ label: string; amount: number; note?: string }>;
  /** Pricing valid-through date string (computed at generation, ~30 days out). */
  validUntil?: string;
  /**
   * Optional wood-decking add-on note for replacements that will likely need new deck
   * boards. Renders a "Wood Decking" callout with per-square add/replace rates (and an
   * estimated total from the roof size). `note` carries the recommendation/specifics.
   */
  woodAddOn?: { addRatePerSquare?: number; replaceRatePerSquare?: number; note?: string; required?: boolean };
  /**
   * Optional roof tune-up / maintenance offering, presented as a lower-cost
   * alternative to a full replacement (preventative maintenance on the EXISTING roof).
   */
  tuneUp?: {
    /** Squares the tune-up is priced on. Defaults to measuredSquares ?? billableSquares (no waste — nothing is torn off). */
    squares?: number;
    /** Standalone tune-up $/square (default 49). */
    ratePerSquare?: number;
    /** Tune-up $/square when bundled with the maintenance plan (default 31.75). */
    ratePerSquareWithPlan?: number;
  };
}

const firstName = (full: string) => (full || 'there').trim().split(/\s+/)[0];

/** Project Photos gallery — embeds every JobTread job photo. No-op when empty. */
export function projectPhotosSection(input: ProposalInput): string {
  const photos = (input.photos || []).filter((p) => p && p.url);
  if (!photos.length) return '';
  const grid = `<div class="photogrid">${photos
    .map((p) => `<img loading="lazy" decoding="async" src="${esc(p.url)}" alt="${esc(p.caption || 'Project photo')}"/>`)
    .join('')}</div>`;
  return `<section class="sec">
    <div class="sec-head"><h2>Project Photos</h2><span class="n">${photos.length} photo${photos.length === 1 ? '' : 's'}</span></div>
    <p class="lead">Photos of your roof from our on-site inspection. We document everything so you can see exactly what we see.</p>
    ${grid}
  </section>`;
}

/**
 * "Your New Roof — Visualized": Gemini renders of the customer's own photo
 * with a new Landmark roof in the 8 most popular colors. STANDARD on every
 * full-replacement proposal. No-op when renders are absent (generation is
 * fail-soft upstream).
 */
export function colorRendersSection(input: ProposalInput): string {
  const renders = (input.colorRenders || []).filter((r) => r && r.url);
  if (!renders.length) return '';
  const [hero, ...rest] = renders;
  const grid = rest.length
    ? `<div class="photogrid" style="margin-top:18px">${rest
        .map(
          (r) => `<figure style="margin:0">
        <img loading="lazy" decoding="async" src="${esc(r.url)}" alt="${esc(r.name)} shown on your home" style="height:200px"/>
        <figcaption style="font-size:13px;margin-top:6px"><b>${esc(r.name)}</b>${r.blurb ? ` <span style="color:var(--muted)">— ${esc(r.blurb)}</span>` : ''}</figcaption>
      </figure>`,
        )
        .join('')}</div>`
    : '';
  return `<section>
    <div class="sec-head"><h2>Your New Roof &mdash; Visualized</h2><span class="n">On your actual home</span></div>
    <p class="lead">These aren't stock photos &mdash; each image is generated from the actual inspection photo of <em>your</em> home, with one change: a brand-new CertainTeed Landmark architectural roof. Same house, same trees, same angle &mdash; new roof.</p>
    <figure style="margin:0">
      <img loading="lazy" decoding="async" src="${esc(hero.url)}" alt="${esc(hero.name)} shown on your home" style="width:100%;border-radius:14px;border:1px solid var(--line);display:block"/>
      <figcaption style="font-size:13.5px;margin-top:8px;text-align:center"><b>${esc(hero.name)}</b>${hero.blurb ? ` &mdash; ${esc(hero.blurb)}` : ''}</figcaption>
    </figure>
    ${grid}
    <p class="fineprint">Visualizations are AI-generated from your inspection photo and are representative only &mdash; actual shingle blends vary, and roof features not visible in this view are unchanged. Always confirm your final color from a physical sample board, which we bring to you.</p>
  </section>`;
}

export function proposalHero(input: ProposalInput): string {
  const meta = [
    `<div><b>${esc(input.address)}</b>${input.cityStateZip ? ', ' + esc(input.cityStateZip) : ''}</div>`,
    input.jobNumber ? `<div>Job #${esc(input.jobNumber)}</div>` : '',
    input.date ? `<div>${esc(input.date)}</div>` : '',
    input.rep ? `<div>Prepared by ${esc(input.rep)}</div>` : '',
  ].join('');
  const sat = input.satelliteDataUri
    ? `<div class="hero__sat"><img src="${input.satelliteDataUri}" alt="Satellite view of ${esc(input.address)}"/><span class="hero__sattag">Your roof &middot; satellite imagery</span></div>`
    : input.heroPhotoUrl
    ? `<div class="hero__sat"><img loading="lazy" src="${esc(input.heroPhotoUrl)}" alt="${esc(input.address)}"/><span class="hero__sattag">Your home</span></div>`
    : '';
  return `<div class="hero">
    <div class="hero__brand">${esc(companyBrand().displayName)}</div>
    <h1>${input.heroTitle ? esc(input.heroTitle) : 'Roof Replacement Proposal'}</h1>
    <div class="hero__for">Prepared for ${esc(input.customer)}</div>
    ${companyBrand().promise ? `<div class="hero__promise">&ldquo;${esc(companyBrand().promise)}&rdquo;</div>` : ''}
    <div class="hero__meta">${meta}</div>
    ${sat}
  </div>`;
}

export function welcomeSection(input: ProposalInput): string {
  return `<section>
    <div class="sec-head"><h2>Welcome, ${esc(firstName(input.customer))}</h2><span class="n">A note before the numbers</span></div>
    <p class="lead">Thank you for inviting ${esc(companyBrand().displayName)} to look at your roof. Before we talk about price, we want you to know exactly who we are, how your roof will be built, and what your choices are. We would rather you make a confident, informed decision than a fast one. Take your time with this &mdash; and ask us anything.</p>
  </section>`;
}

export function companySection(): string {
  const p = companyBrand();
  const values = companyValues().map(([t, d]) => `<div class="value"><b>${esc(t)}</b><span>${esc(d)}</span></div>`).join('');
  const since = p.foundedYear ? `since ${p.foundedYear}` : '';
  const note = [p.cityState, since].filter(Boolean).join(', ');
  const lead = [p.tagline, ...p.trustStats.slice(0, 3)].filter(Boolean).map((t) => esc(t)).join(' &middot; ');
  if (!values && !lead) return '';
  return `<section>
    <div class="sec-head"><h2>Who We Are</h2>${note ? `<span class="n">${esc(note)}</span>` : ''}</div>
    ${lead ? `<p class="lead">${lead}</p>` : ''}
    ${values ? `<div class="values">${values}</div>` : ''}
  </section>`;
}

export function ownersSection(): string {
  const story = ownersStory();
  if (!story) return '';
  return `<section>
    <div class="sec-head"><h2>About the Owners</h2></div>
    <div class="owner"><h3>${esc(story.heading)}</h3>${story.paragraphs.map((t) => `<p>${esc(t)}</p>`).join('')}<div class="sig">${story.signature}</div></div>
  </section>`;
}

export function measurementsSection(input: ProposalInput): string {
  const sq = input.billableSquares ?? 0;
  return `<section>
    <div class="sec-head"><h2>Your Roof by the Numbers</h2><span class="n">${input.satelliteDataUri ? 'Measured from satellite' : 'Roof measurements'}</span></div>
    <div class="stats">
      <div class="stat"><div class="v">${input.measuredSquares ?? sq}</div><div class="k">Squares Measured</div></div>
      <div class="stat"><div class="v">${sq}</div><div class="k">Squares Installed (+${input.wastePct ?? 15}%)</div></div>
      <div class="stat"><div class="v">${esc(input.averagePitch || 'n/a')}</div><div class="k">Avg Roof Pitch</div></div>
      <div class="stat"><div class="v">${(input.roofAreaSqFt ?? Math.round(sq * 100)).toLocaleString()}</div><div class="k">Sq Ft of Roof</div></div>
    </div>
    <p class="muted tiny" style="margin-top:12px">${input.satelliteDataUri ? `Measured from Google satellite imagery${input.segments ? ` (${input.segments} roof planes)` : ''}` : 'Roof measurements'}. A ${input.wastePct ?? 15}% factor is added for waste, starter, hip &amp; ridge, and cut-in. Final quantities are confirmed before we order a single bundle.${input.flatRoofSquares ? ` Approximately ${input.flatRoofSquares} square${input.flatRoofSquares === 1 ? '' : 's'} of this roof is low-slope / flat roofing, finished with a flat-roof membrane system.` : ''}</p>
  </section>`;
}

/** Which tier is "Recommended" for this report — an explicit override, else the PRODUCT_TIERS default. */
function isRecommendedTier(input: ProposalInput, p: typeof PRODUCT_TIERS[number]): boolean {
  return input.recommendedTier ? p.key === input.recommendedTier : !!p.recommended;
}

export function productsSection(input: ProposalInput): string {
  const block = (p: typeof PRODUCT_TIERS[number], i: number) => `
    <article class="prod ${i % 2 ? 'prod--rev' : ''}">
      <div class="prod__img" style="background-image:url('${COLOR_ASSETS.roofs[i % COLOR_ASSETS.roofs.length]}')"></div>
      <div class="prod__txt">
        <div class="prod__tier" style="color:${p.accent}">${p.label} &middot; ${isRecommendedTier(input, p) ? 'Our Recommendation' : 'Option'}</div>
        <h3>${p.shingle}</h3><div class="prod__tag">${p.tagline}</div><p>${p.body}</p>
      </div>
    </article>`;
  return `<section>
    <div class="sec-head"><h2>The Shingles We Install</h2><span class="n">Good &middot; Better &middot; Best</span></div>
    <p class="lead">Every package below is a complete, code-compliant roof replacement installed start to finish. The difference is the shingle and the level of weather protection &mdash; never the quality of the work.</p>
    ${PRODUCT_TIERS.map(block).join('')}
  </section>`;
}

export function colorsSection(): string {
  return `<section>
    <div class="sec-head"><h2>Your Color Options</h2><span class="n">CertainTeed palette</span></div>
    <p class="lead">See how the colors read on a full roof, then choose from CertainTeed's complete palette below. Color looks different in sun and shade, so we'll bring physical samples to your home before you decide.</p>
    <div class="roofstrip">${COLOR_ASSETS.roofs.map(r => `<img loading="lazy" src="${r}" alt="Shingle color shown on a roof"/>`).join('')}</div>
    <div class="palette"><h3>Landmark &mdash; the Good package</h3><p>The widest color palette in the industry.</p>
      <div class="grid2"><img loading="lazy" src="${COLOR_ASSETS.landmark1}" alt="Landmark colors"/><img loading="lazy" src="${COLOR_ASSETS.landmark2}" alt="Landmark colors"/></div></div>
    <div class="palette"><h3>Landmark PRO &amp; Solaris &mdash; the Better &amp; Best packages</h3><p>Richer, more vibrant Max Def color blends. Solaris offers these in solar-reflective High Index versions.</p>
      <img loading="lazy" src="${COLOR_ASSETS.pro}" alt="Landmark PRO Max Def colors"/></div>
    <p class="fineprint">Color images are the manufacturer's own swatches and lifestyle photos. Because of screen and print limitations, CertainTeed cannot guarantee an identical match &mdash; please confirm your final color from a physical sample or the CertainTeed ColorView visualizer before we order.</p>
  </section>`;
}

export function integritySection(): string {
  return `<section>
    <div class="sec-head"><h2>The CertainTeed Integrity Roof System&trade;</h2><span class="n">How your roof is built</span></div>
    <p class="lead">A roof isn't just shingles &mdash; it's a system. CertainTeed engineers six components to work together, each one doing a specific job. We install the <b>complete</b> Integrity Roof System on every roof, top to bottom, because that's what makes a roof watertight, wind-rated, and built to last &mdash; and it's also what qualifies your roof for CertainTeed's strongest warranty coverage.</p>
    <div class="system">${INTEGRITY_SYSTEM.map(([t, d], i) => `<div class="sysrow"><b>${i + 1} &middot; ${t}</b><span>${d}</span></div>`).join('')}</div>
  </section>`;
}

export function warrantySection(): string {
  const w = warranty();
  const workmanship = w.workmanshipYears ? `a ${w.workmanshipYears}-year workmanship warranty` : 'our workmanship warranty';
  const credentialed = isCertainTeedCredentialed();
  const markers = credentialMarkers().map((m) => `<span>${esc(m)}</span>`).join('');
  return `<section>
    <div class="sec-head"><h2>Your Warranty</h2></div>
    <p class="lead">${w.certificationCopy}</p>
    <div class="warr">
      <div class="warr__badges">
        ${credentialed ? `<div class="badge"><div class="num">${w.manufacturerYears}</div><div class="lbl">YEAR<br/>Manufacturer Warranty</div></div>` : ''}
        ${w.workmanshipYears ? `<div class="badge"><div class="num">${w.workmanshipYears}</div><div class="lbl">YEAR<br/>Workmanship Warranty</div></div>` : ''}
      </div>
      <div><h2>Covered coming and going.</h2><p>Your roof carries ${credentialed ? `a ${w.manufacturerYears}-year manufacturer warranty` : "CertainTeed's manufacturer warranty"} on the materials and ${workmanship} from us on the installation. If it's ever the product, CertainTeed stands behind it. If it's ever the work, we do. You're covered either way &mdash; in writing.</p></div>
    </div>
    ${markers ? `<div class="cred">${markers}</div>` : ''}
  </section>`;
}

/**
 * Compute the "repair instead of replace" dollar figure. Uses an explicit amount when
 * given, otherwise derives it from `pctOfReplacement` × the LOWEST replacement tier total
 * (rounded to whole dollars first so it equals pct × the displayed price). Shared by the
 * full proposal (Repair Option callout) and the repair-only report.
 */
export function repairAmountFor(input: ProposalInput): number {
  const re = input.repairEstimate;
  if (!re) return 0;
  if (typeof re.amount === 'number' && re.amount > 0) return re.amount;
  const sq = input.billableSquares ?? 0;
  if (!(re.pctOfReplacement && re.pctOfReplacement > 0 && sq > 0)) return 0;
  const flatSq = Math.max(0, input.flatRoofSquares ?? 0);
  const shingleSq = Math.max(0, sq - flatSq);
  const flatCost = flatSq > 0 ? (input.flatRoofRatePerSquare ?? 0) * flatSq : 0;
  const addOnTotal = (input.addOns || []).filter((a) => a && a.label && a.amount > 0).reduce((s, a) => s + a.amount, 0);
  const discPct = input.discountPct && input.discountPct > 0 ? input.discountPct : 0;
  const lowestTotal = Math.min(...PRODUCT_TIERS.map((p) => {
    const r = input.rates?.[p.key] ?? p.ratePerSquare ?? DEFAULT_RATES[p.key];
    return Math.round((r * shingleSq + flatCost + addOnTotal) * (1 - discPct / 100));
  }));
  return Math.round((lowestTotal * re.pctOfReplacement) / 100);
}

/** Investment section using fully custom packages (per-job pricing) instead of the
 * standard shingle tiers + scope table. */
function customInvestmentSection(input: ProposalInput): string {
  const sqBasis = input.measuredSquares ?? input.billableSquares ?? 0;
  const tiers = input.customTiers || [];
  const card = (t: NonNullable<ProposalInput['customTiers']>[number]) => {
    const total = typeof t.amount === 'number' && t.amount > 0
      ? usd(t.amount)
      : (t.ratePerSquare && t.ratePerSquare > 0 && sqBasis > 0 ? usd(Math.round(t.ratePerSquare * sqBasis)) : '&mdash;');
    const accent = t.accent || (t.recommended ? 'var(--gold)' : 'var(--red)');
    return `<article class="tier ${t.recommended ? 'tier--rec' : ''}" style="--accent:${accent};text-align:left">
      ${t.recommended ? '<div class="ribbon">Recommended</div>' : ''}
      <div class="tier__name" style="text-align:left">${esc(t.name)}</div>
      ${t.subtitle ? `<div class="tier__shingle" style="text-align:left">${esc(t.subtitle)}</div>` : ''}
      <div class="tier__price" style="text-align:left">${total}</div>
      ${t.rateText ? `<div class="tier__rate" style="text-align:left">${esc(t.rateText)}</div>` : ''}
      ${t.bullets && t.bullets.length ? `<ul style="margin:12px 0 8px;padding-left:18px;font-size:12.5px;color:#3f372f">${t.bullets.map((b) => `<li style="margin:5px 0">${esc(b)}</li>`).join('')}</ul>` : ''}
      ${t.warrantyText ? `<div class="tier__warranty">${esc(t.warrantyText)}</div>` : ''}
    </article>`;
  };
  const repairs = (input.repairs || []).filter((r) => r && r.label);
  const repairsBlock = repairs.length ? `
    <div class="sec-head" style="margin-top:28px"><h2>Additional Recommended Repairs</h2><span class="n">Priced separately</span></div>
    <p class="lead">We note these so you can plan &mdash; you're never obligated to bundle them.</p>
    <table>
      <thead><tr><th scope="col">Item</th><th scope="col">Estimated price</th></tr></thead>
      <tbody>${repairs.map((r) => `<tr><td>${esc(r.label)}${r.note ? `<div class="muted tiny" style="margin-top:4px">${esc(r.note)}</div>` : ''}</td><td>${esc(r.price)}</td></tr>`).join('')}</tbody>
    </table>` : '';
  return `<section>
    <div class="sec-head"><h2>Your Investment</h2><span class="n">Good &middot; Better &middot; Best</span></div>
    <p class="lead">Now the numbers &mdash; your options laid out side by side, installed start to finish.</p>
    <div class="tiers">${tiers.map(card).join('')}</div>
    ${woodAddOnBlock(input)}
    ${repairsBlock}
    <p class="muted tiny" style="margin-top:12px">Pricing valid for 30 days${input.validUntil ? ` (through ${esc(input.validUntil)})` : ''}. Each replacement package is a complete tear-off and full CertainTeed Integrity Roof System; decking replacement, if any rotten wood is found during tear-off, is reviewed and approved with you before we proceed &mdash; no surprises.</p>
  </section>`;
}

/** "Wood Decking" callout: per-square add/replace rates + estimated total + our recommendation.
 * When `required`, it is highlighted as a manufacturer-warranty requirement (red accent + badge). */
function woodAddOnBlock(input: ProposalInput): string {
  const w = input.woodAddOn;
  if (!w || !(w.addRatePerSquare || w.replaceRatePerSquare)) return '';
  const sq = input.billableSquares ?? 0;
  const est = (rate?: number) => (rate && sq > 0 ? ` (about ${usd(Math.round(rate * sq))} for your ${sq}-square roof)` : '');
  const addLine = w.addRatePerSquare ? `Adding new wood is an additional ${usd2(w.addRatePerSquare)} per square${est(w.addRatePerSquare)}.` : '';
  const repLine = w.replaceRatePerSquare ? `Replacing existing wood is ${usd2(w.replaceRatePerSquare)} per square${est(w.replaceRatePerSquare)}.` : '';
  const required = !!w.required;
  const accent = required ? 'var(--red)' : 'var(--gold)';
  const head = required ? 'Wood Decking — Required for Your Warranty' : 'Wood Decking';
  const badge = required ? ' <span style="display:inline-block;background:var(--red);color:#fff;font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;padding:2px 9px;border-radius:999px;vertical-align:middle">Required</span>' : '';
  const warrantyLine = required
    ? `<p style="margin:6px 0"><b>A sound, properly fastened wood deck is required for any shingle manufacturer's warranty to be valid — this is true of every shingle manufacturer.</b> Sound decking must be in place before the new shingles go on; without it, the manufacturer will not honor a warranty on your roof, so this is not optional.</p>`
    : '';
  return `<div class="findings" style="border-left-color:${accent};margin-top:18px">
    <h3 class="findings-h" style="margin:0 0 6px;font-size:16px">${head}${badge}</h3>
    ${warrantyLine}
    <p style="margin:6px 0">When we tear off this roof, it will most likely need new wood added to the deck so the new roof can be shingled properly. ${addLine}${addLine && repLine ? ' ' : ''}${repLine}${w.note ? ` ${esc(w.note)}` : ''}</p>
  </div>`;
}

export function investmentSection(input: ProposalInput): string {
  if (input.customTiers && input.customTiers.length) return customInvestmentSection(input);
  const sq = input.billableSquares ?? 0;
  const flatSq = Math.max(0, input.flatRoofSquares ?? 0);
  const shingleSq = Math.max(0, sq - flatSq);
  const flatRate = input.flatRoofRatePerSquare ?? 0;
  const flatCost = flatSq > 0 ? flatRate * flatSq : 0;
  const addOns = (input.addOns || []).filter((a) => a && a.label && a.amount > 0);
  const addOnTotal = addOns.reduce((s, a) => s + a.amount, 0);
  const discPct = input.discountPct && input.discountPct > 0 ? input.discountPct : 0;
  const tierCard = (p: typeof PRODUCT_TIERS[number]) => {
    const rate = input.rates?.[p.key] ?? p.ratePerSquare ?? DEFAULT_RATES[p.key];
    const base = rate * shingleSq + flatCost + addOnTotal;
    const total = sq > 0 ? usd(base * (1 - discPct / 100)) : '&mdash;';
    const rateLine = flatSq > 0
      ? `${usd2(rate)}/sq &times; ${shingleSq} sq shingle${flatCost ? ` + ${usd(flatCost)} flat roofing` : ''}`
      : `${usd2(rate)} / square${sq > 0 ? ` &middot; ${sq} squares` : ''}`;
    const rec = isRecommendedTier(input, p);
    return `<article class="tier ${rec ? 'tier--rec' : ''}" style="--accent:${p.accent}">
      ${rec ? '<div class="ribbon">Recommended</div>' : ''}
      <div class="tier__name">${p.label}</div>
      <div class="tier__shingle">${p.shingle}</div>
      <div class="tier__price">${total}</div>
      <div class="tier__rate">${rateLine}</div>
      <div class="tier__warranty">${warranty().manufacturerYears}-Yr Manufacturer${warranty().workmanshipYears ? ` + ${warranty().workmanshipYears}-Yr Workmanship` : ''}</div>
    </article>`;
  };
  const flatNote = flatSq > 0
    ? `<p class="muted tiny" style="margin-top:12px">Your roof includes about ${flatSq} square${flatSq === 1 ? '' : 's'} of low-slope / flat roofing, finished with a flat-roof membrane system rather than shingles. That portion is priced at ${usd2(flatRate)} per square and is already included in the totals above.</p>`
    : '';
  const addOnsNote = (addOns.length || discPct) ? `<p class="muted tiny" style="margin-top:12px">Each total above is all-in${addOns.length ? `, including ${addOns.map((a) => `${esc(a.label)} (${usd(a.amount)})`).join(' and ')}` : ''}${discPct ? `, with a ${discPct}% discount already applied` : ''}.${addOns.filter((a) => a.note).map((a) => ` ${esc(a.note)}`).join('')}</p>` : '';
  const re = input.repairEstimate;
  const repairAmount = repairAmountFor(input);
  const reDetails = (re && Array.isArray(re.details) ? re.details : []).filter((d) => d && d.trim());
  const repairEstimateBlock = repairAmount > 0 ? `
    <div class="findings" style="border-left-color:var(--gold);margin-top:18px">
      <h3 class="findings-h" style="margin:0 0 6px;font-size:16px">Repair Option</h3>
      <p style="margin:6px 0">The repair cost for this roof would be ${usd(repairAmount)}.${re && re.note ? ` ${esc(re.note)}` : ''}</p>
      ${reDetails.length ? `<ul style="margin:8px 0 0;padding-left:20px">${reDetails.map((d) => `<li style="margin:6px 0">${esc(d)}</li>`).join('')}</ul>` : ''}
    </div>` : '';
  const repairs = (input.repairs || []).filter((r) => r && r.label);
  const repairsBlock = repairs.length ? `
    <div class="sec-head" style="margin-top:28px"><h2>Additional Recommended Repairs</h2><span class="n">Priced separately</span></div>
    <p class="lead">These items are outside the roof-replacement package above. We note them so you can plan &mdash; you're never obligated to bundle them with your roof.</p>
    <table>
      <thead><tr><th scope="col">Repair</th><th scope="col">Estimated price</th></tr></thead>
      <tbody>${repairs.map((r) => `<tr><td>${esc(r.label)}${r.note ? `<div class="muted tiny" style="margin-top:4px">${esc(r.note)}</div>` : ''}</td><td>${esc(r.price)}</td></tr>`).join('')}</tbody>
    </table>` : '';
  return `<section>
    <div class="sec-head"><h2>Your Investment</h2><span class="n">Three ways to go</span></div>
    <p class="lead">Now the numbers.${sq > 0 ? ` All three are priced for your full ${sq}-square roof, installed start to finish.` : ' Final pricing is confirmed before work begins.'}</p>
    <div class="tiers">${PRODUCT_TIERS.map(tierCard).join('')}</div>
    ${flatNote}
    ${addOnsNote}
    ${repairEstimateBlock}
    ${woodAddOnBlock(input)}
    <table>
      <thead><tr><th scope="col">What's included</th><th scope="col">Good</th><th scope="col">Better</th><th scope="col">Best</th></tr></thead>
      <tbody>${scopeRows().map(r => `<tr><td>${esc(r[0])}</td>${checkCell(r[1])}${checkCell(r[2])}${checkCell(r[3])}</tr>`).join('')}</tbody>
    </table>
    ${repairsBlock}
    <p class="muted tiny" style="margin-top:12px">Pricing valid for 30 days${input.validUntil ? ` (through ${esc(input.validUntil)})` : ''}. Decking replacement, if any rotten wood is found during tear-off, is reviewed and approved with you before we proceed &mdash; no surprises.</p>
  </section>`;
}

/**
 * Roof tune-up / maintenance option — a lower-cost alternative to replacement that
 * extends the life of the EXISTING roof. Two prices: standalone, or a lower per-square
 * rate when bundled with the maintenance plan (return visits at 6 months and 1 year).
 * Honest framing: a tune-up is maintenance, not a replacement or a warranty — it does
 * not reset the roof's age or guarantee against leaks.
 */
export function tuneUpSection(input: ProposalInput): string {
  const tu = input.tuneUp;
  if (!tu) return '';
  const sq = Math.max(0, tu.squares ?? input.measuredSquares ?? input.billableSquares ?? 0);
  if (sq <= 0) return '';
  const rate = tu.ratePerSquare ?? 49;
  const planRate = tu.ratePerSquareWithPlan ?? 31.75;
  // Round each total to whole dollars first, then derive savings from the rounded
  // figures so the displayed math is internally consistent ($1,220 - $791 = $429).
  const standalone = Math.round(rate * sq);
  const withPlan = Math.round(planRate * sq);
  const savings = standalone - withPlan;
  const sqLabel = Number.isInteger(sq) ? String(sq) : sq.toFixed(2).replace(/\.?0+$/, '');
  const card = (opts: { name: string; tag: string; rateText: string; total: string; bullets: string[]; rec: boolean; accent: string }) => `
    <article class="tier ${opts.rec ? 'tier--rec' : ''}" style="--accent:${opts.accent};text-align:left">
      ${opts.rec ? '<div class="ribbon">Best value</div>' : ''}
      <div class="tier__name" style="text-align:left">${opts.name}</div>
      <div class="tier__shingle" style="text-align:left;color:var(--muted);font-size:13px">${opts.tag}</div>
      <div class="tier__price" style="text-align:left">${opts.total}</div>
      <div class="tier__rate" style="text-align:left">${opts.rateText}</div>
      <ul style="margin:12px 0 0;padding-left:18px;font-size:13px;color:#3f372f">${opts.bullets.map((b) => `<li style="margin:5px 0">${b}</li>`).join('')}</ul>
    </article>`;
  const cards = [
    card({
      name: 'Roof Tune-Up', tag: 'One-time maintenance visit', accent: 'var(--muted)',
      total: usd(standalone), rateText: `${usd2(rate)}/sq &times; ${sqLabel} sq`,
      rec: false,
      bullets: [
        'Reseal lifted or loose shingles and re-secure exposed or backed-out nails',
        'Seal flashings, pipe boots, and roof penetrations &mdash; where leaks start',
        'Address the minor, visible vulnerabilities to get more life from your current roof',
      ],
    }),
    card({
      name: 'Tune-Up + Maintenance Plan', tag: 'Lower rate &middot; we keep coming back', accent: 'var(--green)',
      total: usd(withPlan), rateText: `${usd2(planRate)}/sq &times; ${sqLabel} sq`,
      rec: true,
      bullets: [
        'Everything in the one-time tune-up, at a lower per-square rate',
        'We return at <b>6 months</b> and again at <b>1 year</b> to touch up the tune-up work and reseal any shingles that have loosened',
        `Saves ${usd(savings)} versus the one-time visit &mdash; and keeps eyes on your roof through the seasons`,
      ],
    }),
  ].join('');
  return `<section class="sec">
    <div class="sec-head"><h2>Or: A Roof Tune-Up</h2><span class="n">Maintain what you have</span></div>
    <p class="lead">Not ready to replace? A tune-up is preventative maintenance for the roof you already have. Our crew reseals and re-secures the small things that let water in first &mdash; loose shingles, exposed nails, and tired flashings &mdash; to help you get more life out of it and buy time before a full replacement. A tune-up is maintenance, not a replacement or a warranty: it doesn't reset your roof's age or guarantee against future leaks, but it takes care of the vulnerable spots we can see today.</p>
    <div class="tiers" style="grid-template-columns:1fr 1fr">${cards}</div>
    <p class="muted tiny" style="margin-top:12px">Priced on your roof's full size (about ${sqLabel} squares). The maintenance plan's two return visits (6 months and 1 year) cover touch-ups to the tune-up work and resealing loose shingles; it is not a roof warranty and does not cover storm damage or new repairs. If at any point a tune-up no longer makes sense for your roof, we'll tell you honestly &mdash; that's why the replacement options above are laid out in full.</p>
  </section>`;
}

export function acceptSection(input: ProposalInput): string {
  const rep = input.rep ? `, ${esc(input.rep)}` : '';
  const repCta = input.rep ? `${esc(input.rep)} &middot; ` : '';
  return `<div class="accept">
    <h2>Ready when you are, ${esc(firstName(input.customer))}.</h2>
    <p>Pick your package and color and we'll lock in your spot on the schedule.${input.validUntil ? ` This pricing is held through ${esc(input.validUntil)}.` : ''} Most roofs are done in a single day.${input.rep ? ` Any questions at all, reach out to your ${esc(companyBrand().displayName)} rep${rep} &mdash; happy to walk through any of this with you.` : ''}</p>
    <a class="cta" href="${companyTel()}">Call ${repCta}${companyBrand().phone}</a>
    <div class="sign"><div class="sigline">Package selected (Good / Better / Best) &amp; color</div><div class="sigline">Homeowner signature &amp; date</div></div>
  </div>`;
}

export function reportFooter(kind: 'proposal' | 'claim' = 'proposal'): string {
  const fineprint = kind === 'claim'
    ? 'This claim documentation package is provided in good faith based on our inspection photos and measurements. Observed damage is documented for the homeowner and their insurance carrier; the carrier&rsquo;s adjuster determines causation, scope, and coverage.'
    : 'This proposal is provided in good faith based on the inspection photos and measurements. Final scope, quantities, and pricing are confirmed before work begins.';
  return `<footer>
    <div><b>${companyBrand().displayName}</b> &middot; ${companyBrand().cityState} &middot; <a href="${companyTel()}" style="color:inherit">${companyBrand().phone}</a> &middot; <a href="mailto:${companyBrand().email}" style="color:inherit">${companyBrand().email}</a> &middot; <a href="https://${companyBrand().websiteLabel}" target="_blank" rel="noopener" style="color:inherit">${companyBrand().websiteLabel}</a></div>
    <div class="fineprint" style="margin-top:8px;max-width:760px;margin-left:auto;margin-right:auto">${fineprint}</div>
  </footer>`;
}

/** Full proposal document. */
export function renderProposalHtml(input: ProposalInput): string {
  // The standard shingle-education + color sections hardcode the Good/Better/Best
  // Landmark/PRO/Solaris tiers, so they're omitted when custom packages are in play.
  const isCustom = !!(input.customTiers && input.customTiers.length);
  const body = [
    welcomeSection(input),
    companySection(),
    ownersSection(),
    measurementsSection(input),
    input.inspectionFindings || '',
    input.stormHistory || '',
    projectPhotosSection(input),
    input.recommendedSolution || '',
    colorRendersSection(input),
    isCustom ? '' : productsSection(input),
    isCustom ? '' : colorsSection(),
    integritySection(),
    warrantySection(),
    investmentSection(input),
    tuneUpSection(input),
    acceptSection(input),
    reportFooter(),
  ].join('\n');
  return premiumShell({
    title: `${input.heroTitle || 'Roof Replacement Proposal'} · ${input.customer} · ${companyBrand().displayName}`,
    hero: proposalHero(input),
    body,
  });
}

/** Standalone "Your Repair Estimate" section — the repair price plus its explanation. */
export function repairSection(input: ProposalInput): string {
  const re = input.repairEstimate;
  const amount = repairAmountFor(input);
  if (amount <= 0) return '';
  const details = (re && Array.isArray(re.details) ? re.details : []).filter((d) => d && d.trim());
  return `<section>
    <div class="sec-head"><h2>Your Repair Estimate</h2><span class="n">Repair scope &amp; cost</span></div>
    <p class="lead">Here is the cost to repair this roof, and exactly what that repair involves.</p>
    <div class="findings" style="border-left-color:var(--gold)">
      <p style="margin:6px 0;font-size:16px">The repair cost for this roof would be <b>${usd(amount)}</b>.${re && re.note ? ` ${esc(re.note)}` : ''}</p>
      ${details.length ? `<ul style="margin:10px 0 0;padding-left:20px">${details.map((d) => `<li style="margin:6px 0">${esc(d)}</li>`).join('')}</ul>` : ''}
    </div>
    <p class="muted tiny" style="margin-top:12px">This estimate is based on the inspection photos and roof measurements; final scope and pricing are confirmed before work begins.</p>
  </section>`;
}

/** Repair-specific call-to-action (no replacement package selection). */
export function repairAcceptSection(input: ProposalInput): string {
  const rep = input.rep ? `, ${esc(input.rep)}` : '';
  const repCta = input.rep ? `${esc(input.rep)} &middot; ` : '';
  return `<div class="accept">
    <h2>Questions about the repair, ${esc(firstName(input.customer))}?</h2>
    <p>We're happy to walk through any part of this estimate.${input.rep ? ` Reach out to your ${esc(companyBrand().displayName)} rep${rep} anytime &mdash; we'll give you a straight answer.` : ''}</p>
    <a class="cta" href="${companyTel()}">Call ${repCta}${companyBrand().phone}</a>
    <div class="sign"><div class="sigline">Repair approved &amp; scheduled</div><div class="sigline">Homeowner signature &amp; date</div></div>
  </div>`;
}

/** Repair-ONLY document: company credibility + the repair estimate + photos. No
 * replacement packages, products, colors, warranty, or replacement recommendation. */
export function renderRepairOnlyHtml(input: ProposalInput): string {
  const body = [
    companySection(),
    ownersSection(),
    repairSection(input),
    projectPhotosSection(input),
    repairAcceptSection(input),
    reportFooter(),
  ].join('\n');
  return premiumShell({
    title: `Roof Repair Estimate · ${input.customer} · ${companyBrand().displayName}`,
    hero: proposalHero({ ...input, heroTitle: 'Roof Repair Estimate' }),
    body,
  });
}

/** Claim-specific call-to-action (adjuster meeting; coverage is the carrier's call). */
export function claimAcceptSection(input: ProposalInput): string {
  const rep = input.rep ? `, ${esc(input.rep)}` : '';
  const repCta = input.rep ? `${esc(input.rep)} &middot; ` : '';
  return `<div class="accept">
    <h2>We'll meet your adjuster on the roof, ${esc(firstName(input.customer))}.</h2>
    <p>This package documents the wind damage to your roof to support your insurance claim. ${esc(companyBrand().displayName)} will meet your insurance adjuster on site, walk the documented damage with them, and make sure the full scope of damage is on the table. Your carrier makes the final determination on coverage.${input.rep ? ` Any questions, reach out to your ${esc(companyBrand().displayName)} rep${rep} anytime.` : ''}</p>
    <a class="cta" href="${companyTel()}">Call ${repCta}${companyBrand().phone}</a>
    <div class="sign"><div class="sigline">Date of loss</div><div class="sigline">Homeowner signature &amp; date</div></div>
  </div>`;
}

/** Wind-damage INSURANCE CLAIM documentation package: credibility + the wind-damage
 * findings + storm/date-of-loss + ALL photos + recommended scope. No Good/Better/Best
 * tiers, products, colors, or retail pricing (a claim is not a sales proposal). */
export function renderClaimHtml(input: ProposalInput): string {
  const body = [
    companySection(),
    measurementsSection(input),
    input.inspectionFindings || '',
    input.stormHistory || '',
    projectPhotosSection(input),
    input.recommendedSolution || '',
    claimAcceptSection(input),
    reportFooter('claim'),
  ].join('\n');
  return premiumShell({
    title: `Wind Damage Insurance Claim · ${input.customer} · ${companyBrand().displayName}`,
    hero: proposalHero({ ...input, heroTitle: 'Wind Damage Insurance Claim' }),
    body,
  });
}
