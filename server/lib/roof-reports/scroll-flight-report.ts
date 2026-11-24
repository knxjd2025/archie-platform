/**
 * scroll-flight-report.ts — a roof report as one continuous scroll-driven flight.
 *
 * The classic report is a document: sections stacked down a page. This is the
 * same report told as one unbroken descent through the job's own photographs.
 * The reader scrolls and the camera falls from the widest shot of the property
 * to the closest detail. Copy opens over the flight in windows. Nothing pins,
 * nothing unpins, and there are no section boundaries for a seam to show at.
 *
 * Built on the vendored scroll-craft engine in `worldflight` mode. The engine is
 * the mechanism and is never edited: this module writes markup, themes it with
 * CSS custom properties, and drives it with `data-sc-*` attributes.
 *
 * STILLS ONLY, BY DESIGN. The upstream mode normally scrubs video legs, which
 * needs ffmpeg to author. Archie has no ffmpeg in its Render runtime, and a
 * homeowner on cell data should not be sent tens of megabytes of it either. The
 * engine push-ins a segment's poster on every frame when that segment carries no
 * clip, and crossfades the posters through exactly the same seams, so a flight
 * built from the photographs alone is a first-class path rather than a fallback.
 * It also means this works with the photos every report already has.
 *
 * Multi-tenant: every colour, name and phone number comes from the company's own
 * brand record. Nothing about any one roofing company is hard-coded here.
 *
 * No Node-only or browser-only imports, so this is safe in both the Vite
 * frontend bundle and the Render server (same contract as report-motion.ts).
 * It pulls in ~78KB of vendored engine, so import it lazily from frontend paths.
 */

import { SCROLLCRAFT_CSS, SCROLLCRAFT_JS } from '../reports/scrollcraft-engine.js';
import { escapeHtml } from './escape-html';
import { nonceAttr, safeColor, safeHttpUrl } from './html-safety';
import { normalizeReportNumbers } from './report-normalize';
import type {
  AnalyzedPhoto,
  ComprehensiveRoofReport,
} from './comprehensive-roof-report';

/** Brand fields this renderer reads. A subset of the shared BrandColors shape. */
export interface FlightBrandColors {
  brandPrimaryColor?: string;
  brandSecondaryColor?: string;
  companyName?: string;
  companyPhone?: string;
  companyEmail?: string;
  companyWebsite?: string;
  companyLogo?: string;
}

/** How many photographs a flight can be built from before it stops reading. */
export const MIN_FLIGHT_PHOTOS = 3;
export const MAX_FLIGHT_LEGS = 9;

/** Scroll height, in viewport-heights, that one leg of the flight owns. */
const LEG_WEIGHT = 0.95;
/** Crossfade band between legs, in viewport-heights. Wider hides a still cut. */
const SEAM = 0.18;

const DEFAULT_PRIMARY = '#EA580C';
const DEFAULT_SECONDARY = '#1F2937';

type Tone = 'good' | 'watch' | 'urgent';

const SEVERITY_TONE: Record<string, Tone> = {
  none: 'good',
  low: 'good',
  medium: 'watch',
  high: 'urgent',
  critical: 'urgent',
};

/**
 * Flight order: widest shot first, closest detail last, so scrolling reads as a
 * descent. Photo category is the strongest signal we have; within a category the
 * capture order is kept, because that is the order the inspector actually worked.
 */
const CATEGORY_ALTITUDE: Record<string, number> = {
  overview: 0,
  roof_surface: 1,
  gutter: 2,
  ridge: 2,
  flashing: 3,
  vent: 3,
  chimney: 3,
  closeup: 4,
  interior: 5,
  other: 2,
};

const CATEGORY_WAYPOINT: Record<string, string> = {
  overview: 'The property',
  roof_surface: 'The roof surface',
  gutter: 'Gutters and eaves',
  flashing: 'Flashings',
  vent: 'Penetrations',
  chimney: 'The chimney',
  closeup: 'Up close',
  interior: 'Inside',
  other: 'The roof',
};

export function orderPhotosForFlight(photos: AnalyzedPhoto[]): AnalyzedPhoto[] {
  return photos
    .filter((p) => safeHttpUrl(p?.url) !== '')
    .map((p, i) => ({ p: { ...p, url: safeHttpUrl(p.url) }, i }))
    .sort((a, b) => {
      const av = CATEGORY_ALTITUDE[a.p.photoCategory || 'other'] ?? 2;
      const bv = CATEGORY_ALTITUDE[b.p.photoCategory || 'other'] ?? 2;
      return av !== bv ? av - bv : a.i - b.i;
    })
    .map(({ p }) => p)
    .slice(0, MAX_FLIGHT_LEGS);
}

/**
 * Whether this report has enough photography to be told as a flight. A flight
 * with two photographs is a slideshow, and the caller should render the classic
 * document instead of shipping something worse than what it replaced.
 */
export function canRenderFlight(report: ComprehensiveRoofReport): boolean {
  const photos = report.damageAnalysis?.photos || [];
  return orderPhotosForFlight(photos).length >= MIN_FLIGHT_PHOTOS;
}

function verdictFor(report: ComprehensiveRoofReport): {
  kicker: string;
  heading: string;
  body: string;
} {
  const sev = report.damageAnalysis?.overallSeverity || 'none';
  const age = report.damageAnalysis?.roofAge;
  const remaining = age?.remainingLifeYears;
  const total = report.repairEstimate?.total;

  // The peak of the page. It states the finding plainly, and it says the honest
  // thing in the good case as readily as in the bad one.
  if (sev === 'none' || sev === 'low') {
    const life = typeof remaining === 'number' && remaining > 0
      ? `We think you have roughly another ${Math.round(remaining)} year${Math.round(remaining) === 1 ? '' : 's'} in it.`
      : 'It is holding up.';
    return {
      kicker: 'The honest answer',
      heading: sev === 'none' ? 'This roof is in good shape.' : 'You do not need a new roof.',
      body: `${life} We would rather tell you that than sell you something you do not need. What follows is what we did find, and what it is worth doing about it.`,
    };
  }
  if (sev === 'medium') {
    return {
      kicker: 'What we found',
      heading: 'This roof needs work, not replacing.',
      body: `There is real damage here and it is worth dealing with before it turns into something bigger.${typeof total === 'number' && total > 0 ? ' The repair figure is below.' : ''}`,
    };
  }
  return {
    kicker: 'What we found',
    heading: sev === 'critical' ? 'This roof needs attention now.' : 'This roof has real damage.',
    body: 'The photographs below show what we saw and where. We have set out what it takes to put it right.',
  };
}

/** Findings that dock onto the rail, one per photograph that carries damage. */
function railFindings(photos: AnalyzedPhoto[]): {
  atLeg: number;
  title: string;
  tone: Tone;
}[] {
  const out: { atLeg: number; title: string; tone: Tone }[] = [];
  photos.forEach((p, i) => {
    const dmg = (p.damages || [])[0];
    const tone = SEVERITY_TONE[p.overallSeverity || 'none'] || 'good';
    const title = dmg?.type
      ? String(dmg.type).replace(/_/g, ' ')
      : p.overallSeverity === 'none' || !p.overallSeverity
        ? 'No damage seen'
        : 'Reviewed';
    out.push({ atLeg: i + 1, title: title.slice(0, 42), tone });
  });
  return out;
}

const money = (n: number): string =>
  '$' + Math.round(n).toLocaleString('en-US');

/**
 * Render the report as a scroll-driven flight. Returns a complete, standalone
 * HTML document with the engine inlined: no network dependency beyond the photo
 * URLs and the webfont, so a saved copy still works.
 */
export function generateScrollFlightReportHTML(
  rawReport: ComprehensiveRoofReport,
  brand: FlightBrandColors = {},
  options: { nonce?: string } = {},
): string {
  // Every script below carries the nonce of the response the page is served in.
  const nonce = nonceAttr(options.nonce);
  const report = normalizeReportNumbers(rawReport);
  const primary = safeColor(brand.brandPrimaryColor, DEFAULT_PRIMARY);
  const secondary = safeColor(brand.brandSecondaryColor, DEFAULT_SECONDARY);
  const company = brand.companyName || 'Your roofer';
  const phone = brand.companyPhone || '';

  const photos = orderPhotosForFlight(report.damageAnalysis?.photos || []);
  const prop = report.property || ({} as ComprehensiveRoofReport['property']);
  const addr = [prop.address, [prop.city, prop.state].filter(Boolean).join(', '), prop.zip]
    .filter(Boolean)
    .join('  ');
  const dateStr = (() => {
    const d = new Date(report.generatedAt);
    return Number.isNaN(d.getTime())
      ? ''
      : d.toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' });
  })();

  const verdict = verdictFor(report);
  const findings = railFindings(photos);
  const nLegs = photos.length;

  // ── the flight ────────────────────────────────────────────────────────────
  // No <video>: the engine push-ins a poster on every frame when a segment has
  // no clip, so the photographs themselves carry the move.
  const segments = photos
    .map((p, i) => {
      const waypoint = CATEGORY_WAYPOINT[p.photoCategory || 'other'] || 'The roof';
      return `<div data-sc-segment data-sc-w="${LEG_WEIGHT}" data-sc-linger="0.3" data-sc-waypoint="${escapeHtml(waypoint)}">
        <img class="sc-world__poster" src="${escapeHtml(p.url)}" alt="${escapeHtml(p.caption || `Roof inspection photograph ${i + 1}`)}" decoding="async" loading="${i < 2 ? 'eager' : 'lazy'}">
      </div>`;
    })
    .join('\n      ');

  // ── copy windows ──────────────────────────────────────────────────────────
  // Fractions of the whole track. The verdict is the peak: it gets the widest
  // window by a clear margin, and the run into it is deliberately empty so the
  // page goes quiet before it speaks.
  const w = (from: number, to: number) => `${from.toFixed(3)} ${to.toFixed(3)}`;

  const summary = report.damageAnalysis?.aiSummary || '';
  const photosAnalyzed = report.damageAnalysis?.totalPhotosAnalyzed || photos.length;
  const estTotal = report.repairEstimate?.total;

  // Named findings carry the back half of the flight, which otherwise ran on
  // nothing but the poster push-in for several legs.
  const named = [...new Set(
    (report.damageAnalysis?.photos || [])
      .flatMap((ph) => (ph.damages || []).map((d) => String((d as { type?: string }).type || '')))
      .filter(Boolean)
      .map((t) => t.replace(/_/g, ' ')),
  )].slice(0, 3);

  const findingsLine = named.length
    ? {
        heading: named.length === 1 ? 'One thing to deal with.' : `${named.length} things to deal with.`,
        body: `We found ${named.join(', ')}. Each one is photographed above, at the point of the roof where we saw it.`,
      }
    : null;

  const nextLine = typeof estTotal === 'number' && estTotal > 0
    ? {
        heading: 'What it takes to put right.',
        body: 'The figure below covers the work described in this report. We confirm it on site before anything is scheduled, and nothing starts without your say so.',
      }
    : {
        heading: 'Nothing needs doing today.',
        body: 'We have not priced any work, because we did not find any that needs doing. Keep this report; it is the baseline for the next time anyone looks at this roof.',
      };

  const rail = findings
    .map((f) => {
      const t = Math.max(0, Math.min(1, (f.atLeg - 0.5) / Math.max(nLegs, 1)));
      return `<div class="rail__dock" data-tone="${f.tone}" data-at="${t.toFixed(4)}" style="top:${(t * 100).toFixed(2)}%">
          <span class="rail__pip"></span><span class="rail__lbl">${escapeHtml(f.title)}</span>
        </div>`;
    })
    .join('\n        ');

  const estimateBlock = typeof estTotal === 'number' && estTotal > 0
    ? `<div class="figure"><span class="figure__k">Estimated to put right</span><span class="figure__v">${money(estTotal)}</span></div>`
    : '';

  const contact = [
    phone ? `<a class="cta" href="tel:${escapeHtml(phone.replace(/[^\d+]/g, ''))}">Call ${escapeHtml(phone)}</a>` : '',
    brand.companyEmail && !phone
      ? `<a class="cta" href="mailto:${escapeHtml(brand.companyEmail)}">Email ${escapeHtml(company)}</a>`
      : '',
  ]
    .filter(Boolean)
    .join('');

  const footBits = [
    brand.companyName ? escapeHtml(brand.companyName) : '',
    phone ? escapeHtml(phone) : '',
    brand.companyEmail ? escapeHtml(brand.companyEmail) : '',
    brand.companyWebsite ? escapeHtml(brand.companyWebsite.replace(/^https?:\/\//, '')) : '',
  ]
    .filter(Boolean)
    .join(' &middot; ');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<title>Roof Report${prop.address ? `, ${escapeHtml(prop.address)}` : ''}</title>
<meta name="description" content="Roof inspection report${prop.address ? ` for ${escapeHtml(prop.address)}` : ''}${brand.companyName ? `, prepared by ${escapeHtml(brand.companyName)}` : ''}.">
<meta name="theme-color" content="#12100E">
<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='7' fill='#12100E'/><path d='M6 19 16 9l10 10' stroke='${primary}' stroke-width='3' fill='none'/></svg>`)}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&family=Geist:wght@400;500;600;700&display=swap">
<style>
${SCROLLCRAFT_CSS}

:root{
  --sc-canvas:#12100E; --sc-surface:#1D1A16;
  --sc-ink:#F6F2EC; --sc-ink-soft:#B7ADA1;
  --sc-accent:${primary}; --sc-accent-ink:#16130F;
  --sc-font-display:"Fraunces",Georgia,serif;
  --sc-font-text:"Geist",system-ui,-apple-system,sans-serif;
  --tone-good:#63C79A; --tone-watch:#E7B25C; --tone-urgent:#FF7A66;
  --brand-2:${secondary};
}
body{background:var(--sc-canvas);color:var(--sc-ink)}

/* masthead */
.bar{position:fixed;inset:0 0 auto 0;z-index:60;display:flex;align-items:center;
     justify-content:space-between;gap:16px;padding:18px clamp(16px,4vw,40px);pointer-events:none}
.bar span{font-family:var(--sc-font-text);font-size:11.5px;font-weight:600;
     letter-spacing:.2em;text-transform:uppercase;text-shadow:0 1px 14px rgba(0,0,0,.8)}
.bar .bar__meta{color:var(--sc-ink-soft);letter-spacing:.14em;font-weight:500}
.bar img{height:26px;width:auto;filter:drop-shadow(0 1px 10px rgba(0,0,0,.7))}

/* the inspection rail: findings dock where they were observed */
.rail{position:fixed;left:clamp(14px,3.2vw,36px);top:50%;transform:translateY(-50%);
      z-index:55;width:172px;pointer-events:none;font-family:var(--sc-font-text);
      opacity:0;transition:opacity .5s var(--sc-ease-out)}
.rail.is-live{opacity:1}
.rail__where{font-family:var(--sc-font-display);font-size:21px;font-weight:600;
      line-height:1.15;margin-bottom:3px;min-height:1.15em;text-shadow:0 2px 20px rgba(0,0,0,.85)}
.rail__count{font-size:11.5px;font-weight:500;letter-spacing:.13em;text-transform:uppercase;
      color:var(--sc-ink-soft);margin-bottom:15px;font-variant-numeric:tabular-nums;
      text-shadow:0 1px 12px rgba(0,0,0,.85)}
.rail__track{position:relative;width:1px;height:min(46vh,360px);
      background:linear-gradient(180deg,transparent,rgba(246,242,236,.30) 12%,rgba(246,242,236,.30) 88%,transparent)}
.rail__head{position:absolute;left:-4px;width:9px;height:9px;border-radius:50%;
      background:var(--sc-accent);box-shadow:0 0 0 3px rgba(0,0,0,.28),0 2px 10px rgba(0,0,0,.6);
      transform:translateY(-50%);transition:top .12s linear}
.rail__dock{position:absolute;left:0;transform:translateY(-50%);display:flex;align-items:center;
      gap:9px;white-space:nowrap;opacity:.34;transition:opacity .35s var(--sc-ease-out)}
.rail__dock.is-passed{opacity:1}
.rail__pip{width:15px;height:1px;background:currentColor;flex:none}
.rail__dock[data-tone="good"]{color:var(--tone-good)}
.rail__dock[data-tone="watch"]{color:var(--tone-watch)}
.rail__dock[data-tone="urgent"]{color:var(--tone-urgent)}
.rail__lbl{font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:capitalize;
      text-shadow:0 1px 12px rgba(0,0,0,.9)}
@media (max-width:900px){.rail{width:auto;left:14px}.rail__lbl{display:none}
      .rail__track{height:34vh}.rail__where{font-size:16px}.rail__count{font-size:10.5px}}
@media (prefers-reduced-motion:reduce){.rail__head{transition:none}}

/* Per-block scrims, siblings of the copy and never children of it: the contrast
   pass hides every [data-sc-copy] element to photograph the frame underneath, so
   a scrim wearing that attribute is hidden with the text and never measured. */
.scrim,.plate-bg{position:absolute;inset:0;pointer-events:none;opacity:0}
.scrim--lead{background:
  linear-gradient(90deg,rgba(9,7,5,.93) 0%,rgba(9,7,5,.86) 28%,rgba(9,7,5,.55) 48%,rgba(9,7,5,.14) 70%,rgba(9,7,5,0) 86%),
  radial-gradient(110% 85% at 8% 26%,rgba(9,7,5,.52) 0%,rgba(9,7,5,.22) 48%,rgba(9,7,5,0) 82%)}
.scrim--trail{background:
  linear-gradient(270deg,rgba(9,7,5,.93) 0%,rgba(9,7,5,.86) 28%,rgba(9,7,5,.55) 48%,rgba(9,7,5,.14) 70%,rgba(9,7,5,0) 86%),
  radial-gradient(110% 85% at 92% 74%,rgba(9,7,5,.52) 0%,rgba(9,7,5,.22) 48%,rgba(9,7,5,0) 82%)}
.scrim--center{background:
  radial-gradient(88% 74% at 50% 50%,rgba(9,7,5,.90) 0%,rgba(9,7,5,.80) 44%,rgba(9,7,5,.46) 76%,rgba(9,7,5,.26) 100%)}
.plate-bg{background:
  radial-gradient(78% 72% at 50% 56%,rgba(10,8,5,.975) 0%,rgba(10,8,5,.95) 58%,rgba(10,8,5,.74) 86%,rgba(10,8,5,.55) 100%)}
@media (max-width:860px){
  .scrim--lead{background:linear-gradient(180deg,rgba(9,7,5,.97) 0%,rgba(9,7,5,.94) 42%,rgba(9,7,5,.70) 70%,rgba(9,7,5,.42) 100%)}
  .scrim--trail{background:linear-gradient(0deg,rgba(9,7,5,.97) 0%,rgba(9,7,5,.94) 42%,rgba(9,7,5,.70) 70%,rgba(9,7,5,.42) 100%)}
  .scrim--center{background:linear-gradient(180deg,rgba(9,7,5,.72) 0%,rgba(9,7,5,.90) 26%,rgba(9,7,5,.90) 74%,rgba(9,7,5,.72) 100%)}
}

/* copy */
.lede{font-family:var(--sc-font-text);font-size:clamp(15px,1.35vw,17.5px);line-height:1.65;
      color:var(--sc-ink-soft);max-width:46ch;text-shadow:0 1px 16px rgba(0,0,0,.7)}
.kicker{font-family:var(--sc-font-text);font-size:11.5px;font-weight:600;letter-spacing:.2em;
      text-transform:uppercase;color:var(--sc-accent);margin-bottom:14px;text-shadow:0 1px 14px rgba(0,0,0,.85)}
.who{font-family:var(--sc-font-text);font-size:13px;font-weight:500;letter-spacing:.13em;
      text-transform:uppercase;color:var(--sc-ink-soft);margin-top:18px;text-shadow:0 1px 14px rgba(0,0,0,.85)}
h1,h2{text-wrap:balance;text-shadow:0 2px 30px rgba(0,0,0,.6)}
.verdict h2{font-size:clamp(2.4rem,6vw,5.4rem);line-height:.99;letter-spacing:-.02em}
@media (max-width:700px){.verdict h2{font-size:2.2rem}}

/* the closing plate */
.plate{padding:clamp(20px,3vw,32px);max-width:min(96vw,820px);max-height:84svh;overflow-y:auto}
.figure{display:flex;flex-direction:column;align-items:center;gap:2px;margin:18px 0 0}
.figure__k{font-family:var(--sc-font-text);font-size:11.5px;font-weight:600;letter-spacing:.18em;
      text-transform:uppercase;color:var(--sc-ink-soft)}
.figure__v{font-family:var(--sc-font-display);font-size:clamp(2rem,4vw,2.9rem);font-weight:700;
      line-height:1;font-variant-numeric:tabular-nums}
.stats{display:flex;flex-wrap:wrap;justify-content:center;gap:26px;margin:22px 0 0}
.stat b{display:block;font-family:var(--sc-font-display);font-size:26px;font-weight:600;
      line-height:1;font-variant-numeric:tabular-nums}
.stat span{font-family:var(--sc-font-text);font-size:11px;font-weight:600;letter-spacing:.14em;
      text-transform:uppercase;color:var(--sc-ink-soft)}
.fine{font-family:var(--sc-font-text);font-size:12.5px;line-height:1.6;color:var(--sc-ink-soft);
      margin-top:18px;max-width:74ch}
.act{display:flex;flex-wrap:wrap;justify-content:center;gap:12px;align-items:center;margin-top:22px}
.cta{display:inline-block;background:var(--sc-accent);color:var(--sc-accent-ink);
      font-family:var(--sc-font-text);font-weight:700;font-size:15px;padding:13px 26px;
      border-radius:10px;text-decoration:none;
      transition:transform .14s var(--sc-ease-out),filter .14s var(--sc-ease-out)}
.cta:hover{filter:brightness(1.08)}
.cta:active{transform:translateY(1px)}
.cta:focus-visible{outline:2px solid var(--sc-ink);outline-offset:3px}
.sig{font-family:var(--sc-font-text);font-size:12px;color:var(--sc-ink-soft);margin-top:20px;
      padding-top:16px;border-top:1px solid rgba(246,242,236,.14)}
</style>
</head>
<body>

<span data-sc-progress></span>
<div class="sc-grain" aria-hidden="true"></div>

<header class="bar">
  ${safeHttpUrl(brand.companyLogo) ? `<img src="${escapeHtml(safeHttpUrl(brand.companyLogo))}" alt="${escapeHtml(company)}">` : `<span>${escapeHtml(company)}</span>`}
  <span class="bar__meta">${escapeHtml(dateStr)}</span>
</header>

<aside class="rail" id="rail" aria-hidden="true">
  <div class="rail__where" id="railWhere">${escapeHtml(CATEGORY_WAYPOINT[photos[0]?.photoCategory || 'other'] || 'The roof')}</div>
  <div class="rail__count"><span id="railN">0</span> of ${findings.length} reviewed</div>
  <div class="rail__track">
    <span class="rail__head" id="railHead" style="top:0%"></span>
    ${rail}
  </div>
</aside>

<div data-sc-mode="worldflight" data-sc-seam="${SEAM}" data-sc-lerp="0.12">

  <div data-sc-world>
      ${segments}
  </div>

  <div data-sc-world-copy>

    <div class="scrim scrim--lead" data-scrim-for="cp-hero" aria-hidden="true"></div>
    <div class="sc-copy sc-copy--lead" id="cp-hero" data-sc-copy data-sc-window="hero">
      <p class="kicker">Roof inspection report</p>
      <h1 class="sc-display sc-display--xl">${escapeHtml(prop.address || 'Your roof')}</h1>
      ${prop.city ? `<p class="lede">${escapeHtml([prop.city, prop.state].filter(Boolean).join(', '))} ${escapeHtml(prop.zip || '')}</p>` : ''}
      <p class="who">${escapeHtml(company)}${dateStr ? ` &middot; ${escapeHtml(dateStr)}` : ''}</p>
    </div>

    <div class="scrim scrim--trail" data-scrim-for="cp-arrival" aria-hidden="true"></div>
    <div class="sc-copy sc-copy--trail" id="cp-arrival" data-sc-copy data-sc-window="${w(0.09, 0.24)}">
      <h2 class="sc-display sc-display--lg">We looked at all of it.</h2>
      <p class="lede">${photosAnalyzed} photograph${photosAnalyzed === 1 ? '' : 's'} of this roof, taken on site and reviewed one at a time. What follows is what they show.</p>
    </div>

    ${summary ? `<div class="scrim scrim--lead" data-scrim-for="cp-summary" aria-hidden="true"></div>
    <div class="sc-copy sc-copy--lead" id="cp-summary" data-sc-copy data-sc-window="${w(0.27, 0.39)}">
      <h2 class="sc-display sc-display--md">What the photographs show.</h2>
      <p class="lede">${escapeHtml(summary.slice(0, 320))}</p>
    </div>` : ''}

    <div class="scrim scrim--center" data-scrim-for="cp-verdict" aria-hidden="true"></div>
    <div class="sc-copy sc-copy--center verdict" id="cp-verdict" data-sc-copy data-sc-window="${w(0.46, 0.68)}">
      <p class="kicker">${escapeHtml(verdict.kicker)}</p>
      <h2 class="sc-display">${escapeHtml(verdict.heading)}</h2>
      <p class="lede">${escapeHtml(verdict.body)}</p>
    </div>

    ${findingsLine ? `<div class="scrim scrim--trail" data-scrim-for="cp-findings" aria-hidden="true"></div>
    <div class="sc-copy sc-copy--trail" id="cp-findings" data-sc-copy data-sc-window="${w(0.72, 0.82)}">
      <h2 class="sc-display sc-display--md">${escapeHtml(findingsLine.heading)}</h2>
      <p class="lede">${escapeHtml(findingsLine.body)}</p>
    </div>` : ''}

    <div class="scrim scrim--lead" data-scrim-for="cp-next" aria-hidden="true"></div>
    <div class="sc-copy sc-copy--lead" id="cp-next" data-sc-copy data-sc-window="${w(0.85, 0.93)}">
      <h2 class="sc-display sc-display--md">${escapeHtml(nextLine.heading)}</h2>
      <p class="lede">${escapeHtml(nextLine.body)}</p>
    </div>

    <div class="plate-bg" data-scrim-for="cp-close" aria-hidden="true"></div>
    <div class="sc-copy sc-copy--center" id="cp-close" data-sc-copy data-sc-window="finale">
      <div class="plate">
        <p class="kicker">Where that leaves you</p>
        <h2 class="sc-display sc-display--md">${escapeHtml(prop.address || 'Your roof')}</h2>
        ${estimateBlock}
        <div class="stats">
          <div class="stat"><b>${photosAnalyzed}</b><span>Photos reviewed</span></div>
          <div class="stat"><b>${report.damageAnalysis?.photosWithDamage ?? 0}</b><span>Showing damage</span></div>
          ${report.damageAnalysis?.roofAge?.estimatedAgeYears ? `<div class="stat"><b>${Math.round(report.damageAnalysis.roofAge.estimatedAgeYears)}</b><span>Years old, est.</span></div>` : ''}
          ${typeof report.damageAnalysis?.roofAge?.remainingLifeYears === 'number' ? `<div class="stat"><b>${Math.round(report.damageAnalysis.roofAge.remainingLifeYears)}</b><span>Years left, est.</span></div>` : ''}
        </div>
        <div class="act">${contact}</div>
        <p class="fine">Findings reflect the conditions visible at the time of the inspection. Figures are an estimate and are confirmed before any work is scheduled.</p>
        ${footBits ? `<p class="sig">${footBits}</p>` : ''}
      </div>
    </div>
  </div>

  <div data-sc-spacer aria-hidden="true"></div>
</div>

<script${nonce}>${SCROLLCRAFT_JS}</script>
<script${nonce}>
(function () {
  ScrollCraft.mount(document.body);

  // The spacer is measured once at mount, and an innerHeight of 0 at that moment
  // silently leaves the page with no scroll track at all. One resize after the
  // window and the fonts have settled makes it re-measure.
  function relayout() { dispatchEvent(new Event('resize')); }
  addEventListener('load', relayout);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(relayout);

  var LEGS = ${nLegs};
  var rail = document.getElementById('rail');
  var nEl = document.getElementById('railN');
  var where = document.getElementById('railWhere');
  var head = document.getElementById('railHead');
  var docks = [].slice.call(document.querySelectorAll('.rail__dock'));

  // The scrims deliberately carry no data-sc-copy: the contrast pass hides every
  // element that has it, so a scrim wearing one is never measured. Mirror the
  // opacity of the block each scrim protects instead.
  var scrims = [].slice.call(document.querySelectorAll('[data-scrim-for]')).map(function (el) {
    return { el: el, of: document.getElementById(el.getAttribute('data-scrim-for')) };
  }).filter(function (s) { return s.of; });

  addEventListener('sc:waypoint', function (e) {
    if (e.detail && e.detail.label) where.textContent = e.detail.label;
    rail.classList.add('is-live');
  });

  var last = -1;
  function frame() {
    for (var s = 0; s < scrims.length; s++) {
      scrims[s].el.style.opacity = getComputedStyle(scrims[s].of).opacity;
    }
    var cs = getComputedStyle(document.documentElement);
    var seg = parseFloat(cs.getPropertyValue('--sc-seg')) || 0;
    var segp = parseFloat(cs.getPropertyValue('--sc-segp')) || 0;
    var t = Math.max(0, Math.min(1, (seg + segp) / LEGS));
    var n = 0;
    for (var i = 0; i < docks.length; i++) {
      var passed = t >= parseFloat(docks[i].getAttribute('data-at'));
      if (passed) n++;
      docks[i].classList.toggle('is-passed', passed);
    }
    if (n !== last) { nEl.textContent = n; last = n; }
    head.style.top = (t * 100).toFixed(2) + '%';
    if (t > 0.004) rail.classList.add('is-live');
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
</script>
</body>
</html>`;
}

/** Scroll track height in viewport-heights, for pacing checks and tests. */
export function flightTrackHeight(report: ComprehensiveRoofReport): number {
  const n = orderPhotosForFlight(report.damageAnalysis?.photos || []).length;
  return +(n * LEG_WEIGHT + 1).toFixed(2);
}
