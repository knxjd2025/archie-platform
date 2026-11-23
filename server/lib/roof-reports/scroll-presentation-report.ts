/**
 * scroll-presentation-report.ts — a roof report as a presented, chaptered scroll.
 *
 * This is Archie's standard presentation. Where `formal` is a document you read
 * and `flight` is one unbroken descent through the photographs, a presentation is
 * something you are *walked through*: numbered chapters down a fixed rail with a
 * running clock, so whoever is presenting knows where they are and can jump, and
 * the homeowner reading it alone still gets a sense of how much is left.
 *
 * Built on the vendored scroll-craft engine in `act` mode — a sequence of acts,
 * each a `pin` (copy holds over one photograph), a `pan` (a rail of frames
 * travelling sideways) or a `flow` (ordinary document flow, which a table or a
 * schedule needs). The engine is the mechanism and is never edited: this module
 * writes markup, themes it with CSS custom properties and drives it with
 * `data-sc-*` attributes.
 *
 * THE PRICE COMES LATE, DELIBERATELY. Nobody should be asked what they think of
 * a number before they have been shown what is inside it, so the estimate sits
 * second from the end, after the condition, the findings, the evidence and the
 * storm history. `CHAPTER_ORDER` is the whole of that decision.
 *
 * STILLS ONLY, for the same reason the flight is: there is no ffmpeg in Archie's
 * render runtime, and a homeowner on cell data should not be sent tens of
 * megabytes of video. No act here scrubs a clip.
 *
 * EVERY CHAPTER IS EARNED BY DATA. A report with no storm events has no storm
 * chapter; one with no measurements has no measurement chapter. Nothing is
 * padded, and — because this renders for 20-odd different roofing companies —
 * nothing is claimed on a tenant's behalf. There are no invented warranties,
 * crew promises or process guarantees in here: the copy describes what the
 * report found and what happens next, and everything else comes from the
 * company's own brand record.
 *
 * Multi-tenant: every colour, name and phone number comes from that brand
 * record. Nothing about any one roofing company is hard-coded.
 *
 * No Node-only or browser-only imports, so this is safe in both the Vite
 * frontend bundle and the Render server (same contract as report-motion.ts).
 * It pulls in ~78KB of vendored engine, so import it lazily.
 */

import { SCROLLCRAFT_CSS, SCROLLCRAFT_JS } from '../reports/scrollcraft-engine.js';
import { escapeHtml } from './escape-html';
import { safeColor, safeHttpUrl, isSafeId, boundedNumber, jsonForScript } from './html-safety';
import { normalizeReportNumbers } from './report-normalize';
import {
  BASE_CHAPTER_IDS,
  chaptersToRender,
  packChapterHtml,
  type ChapterPack,
  type TenantChapterContext,
} from './presentation-chapters';
import type {
  AnalyzedPhoto,
  ComprehensiveRoofReport,
  NarrativeFinding,
} from './comprehensive-roof-report';

/** Brand fields this renderer reads. A subset of the shared BrandColors shape. */
export interface PresentationBrandColors {
  brandPrimaryColor?: string;
  brandSecondaryColor?: string;
  companyName?: string;
  companyPhone?: string;
  companyEmail?: string;
  companyWebsite?: string;
  companyLogo?: string;
}

/**
 * A presentation needs enough substance to be worth walking through. Below this
 * many chapters it is a document with extra steps, and the caller should render
 * the document instead.
 */
export const MIN_PRESENTATION_CHAPTERS = 4;

/** Photographs on the evidence rail. Beyond this the pan runs too long to hold. */
const MAX_RAIL_PHOTOS = 10;

/** Findings written out in full. The rest are summarised as a count. */
const MAX_DETAILED_FINDINGS = 6;

const DEFAULT_PRIMARY = '#EA580C';
const DEFAULT_SECONDARY = '#1F2937';

/** Telephone hrefs keep digits and a leading +, and nothing else. */
const telHref = (phone: string): string => phone.replace(/[^\d+]/g, '');

const money = (n: number): string => '$' + Math.round(n).toLocaleString('en-US');
const num = (n: number): string => Math.round(n).toLocaleString('en-US');

const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);

type Tone = 'good' | 'watch' | 'urgent';

const SEVERITY_TONE: Record<string, Tone> = {
  none: 'good',
  low: 'good',
  cosmetic: 'good',
  advisory: 'good',
  minor: 'good',
  medium: 'watch',
  moderate: 'watch',
  high: 'urgent',
  critical: 'urgent',
};

const toneOf = (severity: string | undefined): Tone => SEVERITY_TONE[severity || 'none'] || 'watch';

/**
 * A chapter of the presentation. `minutes` is what the rail's clock adds up, and
 * it is a presenting estimate rather than a measurement — the point of the clock
 * is that the person walking someone through it knows roughly where they are.
 */
export interface PresentationChapter {
  id: string;
  label: string;
  minutes: number;
  html: string;
}

/**
 * Chapter order. This is the argument of the whole page, so it lives in one
 * place: the property, then what was looked at, then what was measured, then the
 * condition, then the findings and the evidence for them, then the context
 * (storm, age), and only then the money, with the next step last.
 */
const CHAPTER_ORDER = BASE_CHAPTER_IDS;

/** Background the page drifts to under each chapter, in `CHAPTER_ORDER` order. */
const DRIFTS: Record<(typeof CHAPTER_ORDER)[number], string> = {
  property: '#12100C',
  looked: '#151209',
  measured: '#171209',
  condition: '#12100C',
  findings: '#151209',
  evidence: '#171209',
  storm: '#141109',
  age: '#151209',
  estimate: '#12100C',
  next: '#171209',
};

/** Backgrounds tenant chapters drift through, alternating so runs of them vary. */
const TENANT_DRIFTS = ['#151209', '#171209', '#141109', '#12100C'];

// ── photo selection ─────────────────────────────────────────────────────────

const usablePhotos = (report: ComprehensiveRoofReport): AnalyzedPhoto[] =>
  (report.damageAnalysis?.photos || [])
    .filter((p) => safeHttpUrl(p?.url) !== '')
    .map((p) => ({ ...p, url: safeHttpUrl(p.url) }));

/**
 * The widest shot available, for the opening frame. An `overview` is what an
 * inspector takes for exactly this purpose; failing that, the first photograph.
 */
const heroPhoto = (photos: AnalyzedPhoto[]): AnalyzedPhoto | undefined =>
  photos.find((p) => p.photoCategory === 'overview') || photos[0];

/** Damage first on the evidence rail — that is what the chapter is there to show. */
function evidencePhotos(photos: AnalyzedPhoto[]): AnalyzedPhoto[] {
  const damaged = photos.filter((p) => (p.damages || []).length > 0);
  const rest = photos.filter((p) => (p.damages || []).length === 0);
  return [...damaged, ...rest].slice(0, MAX_RAIL_PHOTOS);
}

// ── copy helpers ────────────────────────────────────────────────────────────

/**
 * The plain-language verdict. It says the good thing as readily as the bad one:
 * a report that finds nothing wrong is a real result, not a failed sale.
 */
function verdictFor(report: ComprehensiveRoofReport): { heading: string; body: string } {
  const sev = report.damageAnalysis?.overallSeverity || 'none';
  const remaining = report.damageAnalysis?.roofAge?.remainingLifeYears;
  const life =
    typeof remaining === 'number' && remaining > 0
      ? ` We think there is roughly another ${Math.round(remaining)} ${plural(Math.round(remaining), 'year', 'years')} in it.`
      : '';

  if (sev === 'none') {
    return {
      heading: 'This roof is in good shape.',
      body: `We did not find damage that needs putting right.${life} We would rather tell you that than sell you something you do not need.`,
    };
  }
  if (sev === 'low') {
    return {
      heading: 'You do not need a new roof.',
      body: `What we found is minor and worth keeping an eye on rather than acting on today.${life}`,
    };
  }
  if (sev === 'medium') {
    return {
      heading: 'This roof needs work, not replacing.',
      body: 'There is real damage here, and it is worth dealing with before it turns into something bigger and more expensive.',
    };
  }
  if (sev === 'high') {
    return {
      heading: 'This roof has real damage.',
      body: 'The photographs in this presentation show what we saw and where we saw it. What it takes to put right is set out further on.',
    };
  }
  return {
    heading: 'This roof needs attention now.',
    body: 'What we found is serious enough that leaving it is likely to cost more than dealing with it. The evidence is photographed, finding by finding.',
  };
}

/** Damage type names, de-duplicated and made readable. */
function namedDamageTypes(report: ComprehensiveRoofReport): string[] {
  const fromTypes = (report.damageAnalysis?.damageTypes || [])
    .map((d) => String((d as { type?: string }).type || ''))
    .filter(Boolean);
  const fromPhotos = (report.damageAnalysis?.photos || []).flatMap((p) =>
    (p.damages || []).map((d) => String(d.type || '')),
  );
  return [...new Set([...fromTypes, ...fromPhotos].filter(Boolean))].map((t) =>
    t.replace(/_/g, ' '),
  );
}

/** Findings written as narrative, when the report has them. */
const findingsOf = (report: ComprehensiveRoofReport): NarrativeFinding[] =>
  (report.structuredFindings || []).filter((f) => f && f.title);

// ── chapter builders ────────────────────────────────────────────────────────
// Each returns null when the report does not carry what that chapter is about.

interface Ctx {
  report: ComprehensiveRoofReport;
  brand: PresentationBrandColors;
  company: string;
  photos: AnalyzedPhoto[];
  address: string;
  dateStr: string;
  /** Chapter number, assigned after the set is known. */
  n: (id: string) => string;
}

/** `pin`: one photograph held under a column of copy. */
const pinAct = (
  id: string,
  drift: string,
  span: number,
  photo: AnalyzedPhoto | undefined,
  copyId: string,
  copy: string,
): string => `
<section id="${escapeHtml(id)}" data-sc-act="pin" data-sc-span="${span}" data-sc-drift="${drift}">
  <div data-sc-stage>
    ${
      photo
        ? `<img class="sc-stage__poster" src="${escapeHtml(photo.url)}" alt="${escapeHtml(photo.caption || 'Roof inspection photograph')}" data-sc-parallax="0.12">`
        : '<div class="sc-stage__poster stage--blank"></div>'
    }
    <div class="scrimplate scrimplate--lead" aria-hidden="true"></div>
    <div class="sc-copy sc-copy--lead" id="${copyId}" data-sc-cue="0 0.86 0">
      ${copy}
    </div>
  </div>
</section>`;

/** `flow`: ordinary document flow, which anything tabular needs. */
const flowAct = (id: string, drift: string, inner: string): string => `
<section id="${escapeHtml(id)}" class="sc-section" data-sc-act="flow" data-sc-drift="${drift}">
  <div class="wrap">
    ${inner}
  </div>
</section>`;

function chapterProperty(c: Ctx): PresentationChapter {
  const { report, company, address, dateStr } = c;
  const prop = report.property || ({} as ComprehensiveRoofReport['property']);
  const who = report.customerName ? `Prepared for ${escapeHtml(report.customerName)}` : 'Roof inspection';
  const place = [prop.city, prop.state].filter(Boolean).join(', ');

  return {
    id: 'property',
    label: 'The property',
    minutes: 2,
    html: pinAct(
      'property',
      DRIFTS.property,
      2.4,
      heroPhoto(c.photos),
      'cp-property',
      `<p class="kick">${who}</p>
      <h1 class="sc-display sc-display--xl" data-sc-kinetic="lines">${escapeHtml(prop.address || 'Your roof')}</h1>
      ${place ? `<p class="lede">${escapeHtml(place)} ${escapeHtml(prop.zip || '')}</p>` : ''}
      <p class="lede" style="margin-top:16px">This is the whole of what we found on your roof, in order, one chapter at a time. It takes about as long as a coffee. Use the list on the left to jump.</p>
      <p class="who">${escapeHtml(company)}${dateStr ? ` &middot; ${escapeHtml(dateStr)}` : ''}</p>`,
    ),
  };
}

function chapterLooked(c: Ctx): PresentationChapter {
  const { report } = c;
  const analysed = report.damageAnalysis?.totalPhotosAnalyzed || c.photos.length;
  const withDamage = report.damageAnalysis?.photosWithDamage ?? 0;
  const summary = report.executiveSummary || report.damageAnalysis?.aiSummary || '';

  return {
    id: 'looked',
    label: 'What we looked at',
    minutes: 2,
    html: flowAct(
      'looked',
      DRIFTS.looked,
      `<div class="sc-stack" data-sc-in data-sc-stagger="70">
        <p class="chap"><b>${c.n('looked')}</b> &nbsp;What we looked at</p>
        <h2 class="sc-display sc-display--md">We went over all of it, one photograph at a time.</h2>
        <p class="lede">Every photograph below was taken on site and reviewed individually, not skimmed. What follows in this presentation comes out of them.</p>
        ${summary ? `<p class="lede">${escapeHtml(summary.slice(0, 480))}</p>` : ''}
      </div>
      <div class="stats">
        <div class="stat"><div class="v"><span data-sc-count="0 ${analysed}">${analysed}</span></div><div class="k">Photographs reviewed</div></div>
        <div class="stat"><div class="v"><span data-sc-count="0 ${withDamage}">${withDamage}</span></div><div class="k">Showing something</div></div>
        ${
          c.dateStr
            ? `<div class="stat"><div class="v" style="font-size:22px;line-height:1.3">${escapeHtml(c.dateStr)}</div><div class="k">Inspected</div></div>`
            : ''
        }
      </div>`,
    ),
  };
}

function chapterMeasured(c: Ctx): PresentationChapter | null {
  const m = c.report.measurementReport;
  if (!m || !(m.totalSquares > 0)) return null;

  const e = m.edgeLengths || ({} as typeof m.edgeLengths);
  const edges: [string, number][] = [
    ['Ridge', e.ridge],
    ['Hip', e.hip],
    ['Valley', e.valley],
    ['Eave', e.eave],
    ['Rake', e.rake],
  ];
  const shown = edges.filter(([, v]) => typeof v === 'number' && v > 0);

  return {
    id: 'measured',
    label: 'Your roof, measured',
    minutes: 2,
    html: flowAct(
      'measured',
      DRIFTS.measured,
      `<div class="sc-stack" data-sc-in data-sc-stagger="70">
        <p class="chap"><b>${c.n('measured')}</b> &nbsp;Your roof, measured</p>
        <h2 class="sc-display sc-display--md">This is the size of the job.</h2>
        <p class="lede">These are the numbers every figure later in this presentation is built from. Nothing here is a guess at the size of your roof: it is measured${
          m.dataSource === 'eagleview'
            ? ' from an aerial survey'
            : m.dataSource === 'google-solar-api'
              ? ' from aerial imagery'
              : ''
        }, and it is the same number the material order is placed against.</p>
      </div>
      <div class="stats">
        <div class="stat"><div class="v"><span data-sc-count="0 ${Math.round(m.totalSquares)}">${Math.round(m.totalSquares)}</span></div><div class="k">Squares</div></div>
        ${m.averagePitch ? `<div class="stat"><div class="v">${escapeHtml(m.averagePitch)}</div><div class="k">Average pitch</div></div>` : ''}
        ${m.totalAdjustedSqFt > 0 ? `<div class="stat"><div class="v"><span data-sc-count="0 ${Math.round(m.totalAdjustedSqFt)}">${num(m.totalAdjustedSqFt)}</span><span class="u"> sq ft</span></div><div class="k">Roof area</div></div>` : ''}
        ${typeof m.wastePercentage === 'number' && m.wastePercentage > 0 ? `<div class="stat"><div class="v"><span data-sc-count="0 ${Math.round(m.wastePercentage)}">${Math.round(m.wastePercentage)}</span><span class="u">%</span></div><div class="k">Waste allowance</div></div>` : ''}
      </div>
      ${
        shown.length
          ? `<table>
        <thead><tr><th>Edge</th><th>Length</th></tr></thead>
        <tbody>${shown.map(([k, v]) => `<tr><td>${k}</td><td>${num(v)} ft</td></tr>`).join('')}</tbody>
      </table>`
          : ''
      }`,
    ),
  };
}

function chapterCondition(c: Ctx): PresentationChapter | null {
  const rci = c.report.roofConditionIndex;
  if (!rci || typeof rci.overallScore !== 'number') return null;

  const score = Math.round(rci.overallScore);
  const verdict = verdictFor(c.report);
  const components = (rci.components || []).filter((k) => k && typeof k.score === 'number');

  return {
    id: 'condition',
    label: 'The condition',
    minutes: 2,
    html: flowAct(
      'condition',
      DRIFTS.condition,
      `<div class="sc-stack" data-sc-in data-sc-stagger="70">
        <p class="chap"><b>${c.n('condition')}</b> &nbsp;The condition</p>
        <h2 class="sc-display sc-display--lg">${escapeHtml(verdict.heading)}</h2>
        <p class="lede">${escapeHtml(verdict.body)}</p>
      </div>
      <div class="score">
        <div class="score__n"><span data-sc-count="0 ${score}">${score}</span><span class="score__d">/100</span></div>
        <div class="score__g">Grade ${escapeHtml(rci.grade || '')}</div>
      </div>
      ${
        components.length
          ? `<div class="bars">${components
              .map(
                (k) => `<div class="bar" data-tone="${toneOf(k.condition === 'excellent' || k.condition === 'good' ? 'low' : k.condition === 'fair' ? 'medium' : 'high')}" title="${escapeHtml(k.notes || '')}">
          <div class="bar__k">${escapeHtml(String(k.name || '').replace(/_/g, ' '))}</div>
          <div class="bar__t"><span style="width:${Math.max(0, Math.min(100, Math.round(k.score)))}%"></span></div>
          <div class="bar__v">${Math.round(k.score)}</div>
        </div>`,
              )
              .join('')}</div>`
          : ''
      }`,
    ),
  };
}

function chapterFindings(c: Ctx): PresentationChapter | null {
  const findings = findingsOf(c.report);
  const named = namedDamageTypes(c.report);
  if (!findings.length && !named.length) return null;

  const byId = new Map(c.photos.map((p) => [p.id, p]));

  // Evidence photographs belong inside the finding they prove, not only in a
  // gallery at the end — the reader should not have to hunt for the picture.
  const cards = findings.slice(0, MAX_DETAILED_FINDINGS).map((f) => {
    const evidence = (f.relatedPhotoIds || [])
      .map((id) => byId.get(id))
      .filter((p): p is AnalyzedPhoto => Boolean(p))
      .slice(0, 3);
    return `<article class="find" data-tone="${toneOf(f.severity)}">
      <header>
        <span class="find__sev">${escapeHtml(String(f.severity || ''))}</span>
        <h3>${escapeHtml(f.title)}</h3>
      </header>
      ${f.narrative ? `<p>${escapeHtml(f.narrative)}</p>` : ''}
      ${f.repairAction ? `<p class="find__do"><b>What it takes:</b> ${escapeHtml(f.repairAction)}</p>` : ''}
      ${
        evidence.length
          ? `<div class="find__ev">${evidence
              .map(
                (p) =>
                  `<figure><img src="${escapeHtml(p.url)}" alt="${escapeHtml(p.caption || f.title)}" loading="lazy">${p.caption ? `<figcaption>${escapeHtml(p.caption)}</figcaption>` : ''}</figure>`,
              )
              .join('')}</div>`
          : ''
      }
    </article>`;
  });

  const more = findings.length - cards.length;
  const lead = findings.length
    ? `${findings.length} ${plural(findings.length, 'thing', 'things')} worth your attention.`
    : named.length === 1
      ? 'One thing to deal with.'
      : `${named.length} things to deal with.`;

  return {
    id: 'findings',
    label: 'What we found',
    minutes: 4,
    html: flowAct(
      'findings',
      DRIFTS.findings,
      `<div class="sc-stack" data-sc-in data-sc-stagger="70">
        <p class="chap"><b>${c.n('findings')}</b> &nbsp;What we found</p>
        <h2 class="sc-display sc-display--md">${escapeHtml(lead)}</h2>
        ${
          named.length
            ? `<p class="lede">In plain terms: ${escapeHtml(named.slice(0, 6).join(', '))}. Each one below is described, and photographed where we saw it.</p>`
            : '<p class="lede">Each one below is described, and photographed where we saw it.</p>'
        }
      </div>
      ${cards.join('\n')}
      ${more > 0 ? `<p class="lede" style="margin-top:22px">And ${more} further ${plural(more, 'finding', 'findings')} of lower severity, listed in full in the document version of this report.</p>` : ''}`,
    ),
  };
}

function chapterEvidence(c: Ctx): PresentationChapter | null {
  const rail = evidencePhotos(c.photos);
  if (rail.length < 3) return null;

  return {
    id: 'evidence',
    label: 'The evidence',
    minutes: 3,
    html: `
<section id="evidence" data-sc-act="pan" data-sc-span="${(2.2 + rail.length * 0.22).toFixed(1)}" data-sc-drift="${DRIFTS.evidence}">
  <div data-sc-stage>
    <div class="rail2" data-sc-pan="0.06">
      <div class="sc-stack" style="flex:none;width:min(78vw,440px)">
        <p class="chap"><b>${c.n('evidence')}</b> &nbsp;The evidence</p>
        <h2 class="sc-display sc-display--md">Every one of these is your roof.</h2>
        <p class="lede">Not a stock photograph and not an illustration. Scroll sideways through what we actually saw, in the order we worked.</p>
      </div>
      ${rail
        .map(
          (p) => `<figure><img src="${escapeHtml(p.url)}" alt="${escapeHtml(p.caption || 'Roof inspection photograph')}" loading="lazy"><figcaption>${escapeHtml(p.caption || p.aiSummary || '').slice(0, 180)}</figcaption></figure>`,
        )
        .join('\n      ')}
      <div class="rail2__end" aria-hidden="true"></div>
    </div>
  </div>
</section>`,
  };
}

function chapterStorm(c: Ctx): PresentationChapter | null {
  const s = c.report.stormHistory;
  if (!s || !(s.totalEvents > 0)) return null;

  const recent = s.mostRecentHailStorm || s.mostRecentWindStorm;

  return {
    id: 'storm',
    label: 'What has hit it',
    minutes: 2,
    html: flowAct(
      'storm',
      DRIFTS.storm,
      `<div class="sc-stack" data-sc-in data-sc-stagger="70">
        <p class="chap"><b>${c.n('storm')}</b> &nbsp;What has hit it</p>
        <h2 class="sc-display sc-display--md">The weather this roof has already taken.</h2>
        <p class="lede">Storm events recorded near this address over the last ${s.yearsAnalyzed} ${plural(s.yearsAnalyzed, 'year', 'years')}, within ${s.searchRadiusMiles} miles, from the public NOAA storm database.${
          recent
            ? ` The most recent was ${escapeHtml(recent.type)} on ${escapeHtml(recent.date)}, ${escapeHtml(recent.magnitude)}, about ${recent.distanceMiles.toFixed(1)} miles away.`
            : ''
        }</p>
      </div>
      <div class="stats">
        <div class="stat"><div class="v"><span data-sc-count="0 ${s.totalEvents}">${s.totalEvents}</span></div><div class="k">Recorded events</div></div>
        <div class="stat"><div class="v"><span data-sc-count="0 ${s.hailEvents}">${s.hailEvents}</span></div><div class="k">Hail</div></div>
        <div class="stat"><div class="v"><span data-sc-count="0 ${s.windEvents}">${s.windEvents}</span></div><div class="k">Wind</div></div>
        ${typeof s.largestHailInches === 'number' && s.largestHailInches > 0 ? `<div class="stat"><div class="v">${s.largestHailInches.toFixed(2)}<span class="u">&quot;</span></div><div class="k">Largest hail</div></div>` : ''}
        ${typeof s.highestWindMph === 'number' && s.highestWindMph > 0 ? `<div class="stat"><div class="v"><span data-sc-count="0 ${Math.round(s.highestWindMph)}">${Math.round(s.highestWindMph)}</span><span class="u"> mph</span></div><div class="k">Highest wind</div></div>` : ''}
      </div>`,
    ),
  };
}

function chapterAge(c: Ctx): PresentationChapter | null {
  const a = c.report.damageAnalysis?.roofAge;
  if (!a || (a.estimatedAgeYears == null && a.remainingLifeYears == null)) return null;

  const age = a.estimatedAgeYears;
  const left = a.remainingLifeYears;
  const life = a.expectedLifespanYears;

  return {
    id: 'age',
    label: 'How much life is left',
    minutes: 2,
    html: flowAct(
      'age',
      DRIFTS.age,
      `<div class="sc-stack" data-sc-in data-sc-stagger="70">
        <p class="chap"><b>${c.n('age')}</b> &nbsp;How much life is left</p>
        <h2 class="sc-display sc-display--md">${
          typeof left === 'number' && left > 0
            ? `Roughly ${Math.round(left)} more ${plural(Math.round(left), 'year', 'years')}, on what we can see.`
            : 'Where this roof is in its life.'
        }</h2>
        <p class="lede">This is an estimate read off the condition of the material, not a manufacture date. It moves with how the roof is looked after and with what the weather does next.${
          a.roofMaterial ? ` The covering is ${escapeHtml(a.roofMaterial)}.` : ''
        }</p>
        ${
          (a.indicators || []).length
            ? `<p class="lede">What it is based on: ${escapeHtml(a.indicators.slice(0, 4).join(', '))}.</p>`
            : ''
        }
      </div>
      <div class="stats">
        ${typeof age === 'number' ? `<div class="stat"><div class="v"><span data-sc-count="0 ${Math.round(age)}">${Math.round(age)}</span></div><div class="k">Years old, est.</div></div>` : ''}
        ${typeof life === 'number' ? `<div class="stat"><div class="v"><span data-sc-count="0 ${Math.round(life)}">${Math.round(life)}</span></div><div class="k">Expected lifespan</div></div>` : ''}
        ${typeof left === 'number' ? `<div class="stat"><div class="v"><span data-sc-count="0 ${Math.round(left)}">${Math.round(left)}</span></div><div class="k">Years left, est.</div></div>` : ''}
        ${a.materialCondition ? `<div class="stat"><div class="v" style="font-size:24px;text-transform:capitalize">${escapeHtml(a.materialCondition)}</div><div class="k">Material condition</div></div>` : ''}
      </div>`,
    ),
  };
}

function chapterEstimate(c: Ctx): PresentationChapter | null {
  const est = c.report.repairEstimate;
  if (!est || !(est.total > 0)) return null;

  const items = (est.lineItems || []).slice(0, 14) as {
    description?: string;
    item?: string;
    total?: number;
    cost?: number;
  }[];

  return {
    id: 'estimate',
    label: 'What it costs',
    minutes: 3,
    html: flowAct(
      'estimate',
      DRIFTS.estimate,
      `<div class="sc-stack" data-sc-in data-sc-stagger="70">
        <p class="chap"><b>${c.n('estimate')}</b> &nbsp;What it costs</p>
        <h2 class="sc-display sc-display--md">Now that you have seen what is in it.</h2>
        <p class="lede">This is what it takes to put right the work described in this presentation. It is confirmed on site before anything is scheduled, and nothing starts without your say so.</p>
      </div>
      <div class="price">
        <div class="pcard pcard--sum">
          <div class="k">To put right</div>
          <div class="n">${money(est.total)}</div>
          <div class="d">Covers the findings set out above.</div>
        </div>
        ${
          est.subtotal > 0 && est.subtotal !== est.total
            ? `<div class="pcard"><div class="k">Before adjustment</div><div class="n">${money(est.subtotal)}</div><div class="d">Adjusted for this market and this roof.</div></div>`
            : ''
        }
      </div>
      ${
        items.length
          ? `<table>
        <thead><tr><th>Item</th><th>Amount</th></tr></thead>
        <tbody>${items
          .map(
            (i) =>
              `<tr><td>${escapeHtml(String(i.description || i.item || 'Repair item'))}</td><td>${typeof (i.total ?? i.cost) === 'number' ? money(Number(i.total ?? i.cost)) : '-'}</td></tr>`,
          )
          .join('')}</tbody>
      </table>`
          : ''
      }
      ${
        (est.notes || []).length
          ? `<div class="note">${(est.notes || []).slice(0, 4).map((nte) => escapeHtml(nte)).join('<br>')}</div>`
          : ''
      }`,
    ),
  };
}

function chapterNext(c: Ctx): PresentationChapter {
  const { brand, company, report } = c;
  const phone = brand.companyPhone || '';
  const nothingToDo = !((report.repairEstimate?.total ?? 0) > 0);

  const contact = [
    phone
      ? `<a class="cta" href="tel:${escapeHtml(telHref(phone))}">Call ${escapeHtml(phone)}</a>`
      : '',
    brand.companyEmail
      ? `<a class="${phone ? 'alt' : 'cta'}" href="mailto:${escapeHtml(brand.companyEmail)}">Email ${escapeHtml(company)}</a>`
      : '',
  ]
    .filter(Boolean)
    .join('');

  const foot = [
    brand.companyName ? escapeHtml(brand.companyName) : '',
    phone ? escapeHtml(phone) : '',
    brand.companyEmail ? escapeHtml(brand.companyEmail) : '',
    brand.companyWebsite ? escapeHtml(brand.companyWebsite.replace(/^https?:\/\//, '')) : '',
  ]
    .filter(Boolean)
    .join(' &middot; ');

  return {
    id: 'next',
    label: 'Where we go from here',
    minutes: 1,
    html: flowAct(
      'next',
      DRIFTS.next,
      `<div class="sc-stack" data-sc-in data-sc-stagger="70">
        <p class="chap"><b>${c.n('next')}</b> &nbsp;Where we go from here</p>
        <h2 class="sc-display sc-display--md">${
          nothingToDo
            ? 'Nothing needs doing today.'
            : 'Whenever you are ready, and not before.'
        }</h2>
        <p class="lede">${
          nothingToDo
            ? 'We have not priced any work, because we did not find any that needs doing. Keep this presentation: it is the baseline for the next time anyone looks at this roof.'
            : 'Questions first, always. We would rather spend twenty minutes on the phone going through this than have you agree to something you are not sure about.'
        }</p>
        <div class="acts">${contact}</div>
        <p class="foot">Findings reflect the conditions visible at the time of the inspection${c.dateStr ? ` on ${escapeHtml(c.dateStr)}` : ''}${c.address ? `, at ${escapeHtml(c.address)}` : ''}. Any figures shown are an estimate and are confirmed before work is scheduled.${foot ? `<br><br>${foot}` : ''}</p>
      </div>`,
    ),
  };
}

/**
 * Build the chapter set for a report, in `CHAPTER_ORDER`, dropping every chapter
 * the report has no data for. Exported so tests and the wizard can reason about
 * what a given report would actually produce without rendering it.
 */
export function presentationChapters(
  rawReport: ComprehensiveRoofReport,
  brand: PresentationBrandColors = {},
  pack: ChapterPack | null = null,
): PresentationChapter[] {
  const report = normalizeReportNumbers(rawReport);
  const photos = usablePhotos(report);
  const prop = report.property || ({} as ComprehensiveRoofReport['property']);
  const dateStr = (() => {
    const raw = report.inspectionDate || report.generatedAt;
    const d = new Date(raw);
    return Number.isNaN(d.getTime())
      ? ''
      : d.toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' });
  })();

  // Chapter numbers are only knowable once the set is known, and the copy needs
  // them, so the set is built twice: once to learn the order, once to number it.
  const order: string[] = [];
  const ctx = (n: (id: string) => string): Ctx => ({
    report,
    brand,
    company: brand.companyName || 'Your roofer',
    photos,
    address: [prop.address, [prop.city, prop.state].filter(Boolean).join(', '), prop.zip]
      .filter(Boolean)
      .join('  '),
    dateStr,
    n,
  });

  const build = (n: (id: string) => string): PresentationChapter[] => {
    const c = ctx(n);
    const byId: Record<string, PresentationChapter | null> = {
      property: chapterProperty(c),
      looked: chapterLooked(c),
      measured: chapterMeasured(c),
      condition: chapterCondition(c),
      findings: chapterFindings(c),
      evidence: chapterEvidence(c),
      storm: chapterStorm(c),
      age: chapterAge(c),
      estimate: chapterEstimate(c),
      next: chapterNext(c),
    };
    const base = CHAPTER_ORDER.map((id) => byId[id]).filter(
      (ch): ch is PresentationChapter => ch !== null,
    );

    // A company's own chapters (how the crew works, what the warranty covers)
    // are spliced in after the base chapter each one names. They are never in
    // the base set, because the base set renders for every tenant and must not
    // promise anything on a roofer's behalf.
    const tctx: TenantChapterContext = {
      n,
      company: c.company,
      phone: brand.companyPhone || '',
      hasWork: (report.repairEstimate?.total ?? 0) > 0,
      report,
    };
    const out = [...base];
    // The pack's chapters anchor to each other, so a dropped one would strand
    // everything behind it. Follow the chain back through skipped chapters to
    // the nearest anchor that did render.
    const all = pack?.chapters ?? [];
    const anchorOf = new Map(all.map((t) => [t.id, t.after]));
    const resolveAnchor = (id: string): number => {
      const seen = new Set<string>();
      let cursor: string | undefined = id;
      while (cursor && !seen.has(cursor)) {
        seen.add(cursor);
        const at = out.findIndex((ch) => ch.id === cursor);
        if (at >= 0) return at;
        cursor = anchorOf.get(cursor);
      }
      return -1;
    };
    // A pack is data somebody typed. Whatever it says, the id becomes an HTML id
    // and a link target, so it has to be a plain id, and it must not take the
    // place of a chapter that already exists.
    const taken = new Set<string>(BASE_CHAPTER_IDS);
    for (const t of chaptersToRender(pack, tctx)) {
      if (!isSafeId(t.id) || taken.has(t.id)) continue;
      taken.add(t.id);
      const at = resolveAnchor(t.after);
      // Nothing in the chain rendered, so there is no sensible place for it.
      if (at < 0) continue;
      out.splice(at + 1, 0, {
        id: t.id,
        label: t.label,
        minutes: Math.round(boundedNumber(t.minutes, 0, 120, 1)),
        html: flowAct(t.id, TENANT_DRIFTS[out.length % TENANT_DRIFTS.length], packChapterHtml(tctx, t)),
      });
    }
    return out;
  };

  // Pass one: which chapters exist.
  build(() => '00').forEach((ch) => order.push(ch.id));
  const numberOf = (id: string): string => {
    const i = order.indexOf(id);
    return i < 0 ? '00' : String(i + 1).padStart(2, '0');
  };
  // Pass two: the same set, numbered.
  return build(numberOf);
}

/**
 * Whether this report has enough to be worth presenting. A presentation of two
 * chapters is a document with a sidebar, and the caller should render the
 * document rather than ship something worse than what it replaced.
 */
export function canRenderPresentation(report: ComprehensiveRoofReport): boolean {
  // The base set only: a company's own chapters never make a thin report presentable.
  return presentationChapters(report).length >= MIN_PRESENTATION_CHAPTERS;
}

/** Total presenting time in minutes, for the rail clock and for pacing tests. */
export function presentationMinutes(
  report: ComprehensiveRoofReport,
  brand: PresentationBrandColors = {},
  pack: ChapterPack | null = null,
): number {
  return presentationChapters(report, brand, pack).reduce((a, ch) => a + ch.minutes, 0);
}

/**
 * Render the report as a chaptered scroll presentation. Returns a complete,
 * standalone HTML document with the engine inlined: no network dependency beyond
 * the photo URLs and the webfont, so a saved copy still works months later.
 */
export function generateScrollPresentationHTML(
  report: ComprehensiveRoofReport,
  brand: PresentationBrandColors = {},
  pack: ChapterPack | null = null,
): string {
  const primary = safeColor(brand.brandPrimaryColor, DEFAULT_PRIMARY);
  const secondary = safeColor(brand.brandSecondaryColor, DEFAULT_SECONDARY);
  const company = brand.companyName || 'Your roofer';
  const phone = brand.companyPhone || '';

  const chapters = presentationChapters(report, brand, pack);
  const totalMin = chapters.reduce((a, ch) => a + ch.minutes, 0);

  const prop = report.property || ({} as ComprehensiveRoofReport['property']);
  const addrLines = [
    escapeHtml(prop.address || ''),
    escapeHtml([[prop.city, prop.state].filter(Boolean).join(', '), prop.zip].filter(Boolean).join(' ')),
  ].filter(Boolean);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<title>Roof Report${prop.address ? `, ${escapeHtml(prop.address)}` : ''}</title>
<meta name="description" content="Roof inspection presentation${prop.address ? ` for ${escapeHtml(prop.address)}` : ''}${brand.companyName ? `, prepared by ${escapeHtml(brand.companyName)}` : ''}.">
<meta name="theme-color" content="#12100E">
<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='7' fill='#12100E'/><path d='M6 19 16 9l10 10' stroke='${primary}' stroke-width='3' fill='none'/></svg>`)}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&family=Geist:wght@400;500;600;700&display=swap">
<style>
${SCROLLCRAFT_CSS}

:root{
  --sc-canvas:#12100E; --sc-surface:#1D1A16;
  --sc-ink:#F7F2E9; --sc-ink-soft:#B6A895;
  --railw:270px;
  --sc-accent:${primary}; --sc-accent-ink:#FFFFFF;
  --brand-2:${secondary};
  --sc-font-display:"Fraunces",Georgia,serif;
  --sc-font-text:"Geist",system-ui,-apple-system,sans-serif;
  --tone-good:#6FBF95; --tone-watch:#C8A24C; --tone-urgent:#FF7A66;
}
body{background:var(--sc-canvas);color:var(--sc-ink)}

/* ── the presentation rail: the signature move ─────────────────────────────
   A fixed chapter list with a running clock, so whoever is walking someone
   through this knows where they are, and a homeowner reading it alone can see
   how much is left. It collapses to a button below 1080. */
.rail{position:fixed;left:0;top:0;bottom:0;width:270px;z-index:70;
  background:linear-gradient(90deg,rgba(10,8,5,.94),rgba(10,8,5,.80));
  border-right:1px solid rgba(247,242,233,.10);
  display:flex;flex-direction:column;padding:22px 0 16px;
  font-family:var(--sc-font-text);backdrop-filter:blur(6px)}
.rail__head{padding:0 22px 16px;border-bottom:1px solid rgba(247,242,233,.10)}
.rail__mark{font-size:10.5px;font-weight:700;letter-spacing:.24em;text-transform:uppercase;color:var(--sc-accent)}
.rail__mark img{height:22px;width:auto;display:block}
.rail__who{font-family:var(--sc-font-display);font-size:19px;font-weight:600;margin-top:7px;line-height:1.2}
.rail__addr{font-size:11.5px;color:var(--sc-ink-soft);margin-top:3px;line-height:1.4}
.rail__clock{display:flex;align-items:baseline;gap:6px;padding:12px 22px 10px;border-bottom:1px solid rgba(247,242,233,.10)}
.rail__now{font-family:var(--sc-font-display);font-size:27px;font-weight:600;font-variant-numeric:tabular-nums;line-height:1}
.rail__of{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--sc-ink-soft);font-weight:600}
.rail__list{flex:1;overflow-y:auto;padding:10px 0;scrollbar-width:thin}
.rail a{display:flex;align-items:baseline;gap:10px;padding:7px 22px;text-decoration:none;
  color:var(--sc-ink-soft);font-size:12.5px;line-height:1.35;border-left:2px solid transparent;
  transition:color .18s var(--sc-ease-out),border-color .18s var(--sc-ease-out)}
.rail a:hover{color:var(--sc-ink)}
.rail a:focus-visible{outline:2px solid var(--sc-accent);outline-offset:-2px}
.rail a[aria-current="true"]{color:var(--sc-ink);border-left-color:var(--sc-accent);font-weight:600}
.rail a[data-done="1"]:not([aria-current="true"]){color:rgba(182,168,149,.55)}
.rail .n{font-variant-numeric:tabular-nums;font-size:10.5px;opacity:.7;min-width:16px}
.rail .m{margin-left:auto;font-size:10.5px;opacity:.6;font-variant-numeric:tabular-nums}
.rail__foot{padding:12px 22px 0;border-top:1px solid rgba(247,242,233,.10);font-size:11.5px;color:var(--sc-ink-soft);line-height:1.5}
.rail__foot a{display:inline;padding:0;border:none;color:var(--sc-ink);font-weight:600}
.railtoggle{position:fixed;left:12px;top:12px;z-index:71;display:none;background:var(--sc-accent);
  color:var(--sc-accent-ink);border:none;border-radius:8px;padding:9px 13px;font:600 12px/1 var(--sc-font-text);cursor:pointer}
body.has-rail{padding-left:var(--railw)}
@media (max-width:1080px){
  :root{--railw:0px}
  body.has-rail{padding-left:0}
  .rail{transform:translateX(-100%);transition:transform .28s var(--sc-ease-out);width:250px}
  .rail.is-open{transform:none}
  .railtoggle{display:block}
}
@media print{.rail,.railtoggle{display:none!important}body.has-rail{padding-left:0}}

/* ── copy ──────────────────────────────────────────────────────────────── */
.kick{font-family:var(--sc-font-text);font-size:11px;font-weight:700;letter-spacing:.22em;
  text-transform:uppercase;color:var(--sc-ink-soft);margin-bottom:14px}
.chap{font-family:var(--sc-font-text);font-size:11px;font-weight:700;letter-spacing:.22em;
  text-transform:uppercase;color:var(--sc-ink-soft);margin-bottom:10px}
.chap b{color:var(--sc-accent)}
.lede{font-family:var(--sc-font-text);font-size:clamp(15.5px,1.3vw,18px);line-height:1.68;
  color:var(--sc-ink-soft);max-width:60ch}
.lede strong{color:var(--sc-ink);font-weight:600}
.lede + .lede{margin-top:14px}
.who{font-family:var(--sc-font-text);font-size:13px;font-weight:500;letter-spacing:.13em;
  text-transform:uppercase;color:var(--sc-ink-soft);margin-top:18px}
h1,h2,h3{text-wrap:balance}

/* Scrims are siblings of the copy and never carry data-sc-copy: the upstream
   contrast pass hides every element that has it to photograph the frame
   underneath, so a scrim wearing one is hidden with the text and never
   measured — the page reports ~1.1:1 while looking perfectly fine. */
.scrimplate{position:absolute;inset:0;pointer-events:none}
.scrimplate--lead{background:linear-gradient(90deg,rgba(6,4,2,.975) 0%,rgba(6,4,2,.95) 34%,rgba(6,4,2,.76) 54%,rgba(6,4,2,.30) 76%,rgba(6,4,2,0) 92%)}
@media (max-width:860px){
  .scrimplate--lead{background:linear-gradient(180deg,rgba(6,4,2,.97) 0%,rgba(6,4,2,.94) 32%,rgba(6,4,2,.88) 60%,rgba(6,4,2,.93) 100%)}
}
.stage--blank{background:linear-gradient(160deg,#1D1A16,#12100E)}

/* ── blocks ────────────────────────────────────────────────────────────── */
.wrap{max-width:1060px;margin:0 auto;padding:0 clamp(18px,4vw,40px)}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:14px;margin-top:26px}
.stat{background:var(--sc-surface);border:1px solid rgba(247,242,233,.10);border-radius:14px;padding:18px 20px}
.stat .v{font-family:var(--sc-font-display);font-size:34px;font-weight:600;line-height:1;font-variant-numeric:tabular-nums}
/* data-sc-count overwrites the element's whole textContent, so the unit has to
   live in a sibling span or it is destroyed on the first frame. */
.stat .v .u{font-size:20px;color:var(--sc-ink-soft);margin-left:2px;font-weight:500}
.stat .k{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--sc-ink-soft);margin-top:8px;font-family:var(--sc-font-text);font-weight:600}

.score{display:flex;align-items:baseline;gap:18px;margin-top:28px}
.score__n{font-family:var(--sc-font-display);font-size:clamp(3.4rem,9vw,6rem);font-weight:700;line-height:.9;font-variant-numeric:tabular-nums}
.score__d{font-size:.36em;color:var(--sc-ink-soft);font-weight:500}
.score__g{font-family:var(--sc-font-text);font-size:13px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:var(--sc-accent)}
.bars{margin-top:26px;display:grid;gap:10px;max-width:620px}
.bar{display:grid;grid-template-columns:150px 1fr 34px;align-items:center;gap:14px;font-family:var(--sc-font-text);font-size:12.5px}
.bar__k{color:var(--sc-ink-soft);text-transform:capitalize}
.bar__t{height:6px;background:rgba(247,242,233,.10);border-radius:99px;overflow:hidden}
.bar__t span{display:block;height:100%;background:var(--sc-accent);border-radius:99px}
.bar[data-tone="good"] .bar__t span{background:var(--tone-good)}
.bar[data-tone="urgent"] .bar__t span{background:var(--tone-urgent)}
.bar__v{text-align:right;font-variant-numeric:tabular-nums;color:var(--sc-ink)}
@media (max-width:620px){.bar{grid-template-columns:110px 1fr 30px;gap:10px;font-size:11.5px}}

.find{background:var(--sc-surface);border:1px solid rgba(247,242,233,.12);border-left:4px solid var(--tone-watch);
  border-radius:16px;padding:24px 26px;margin-top:18px}
.find[data-tone="good"]{border-left-color:var(--tone-good)}
.find[data-tone="urgent"]{border-left-color:var(--tone-urgent)}
.find header{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap}
.find__sev{font-family:var(--sc-font-text);font-size:10.5px;font-weight:700;letter-spacing:.18em;
  text-transform:uppercase;color:var(--sc-ink-soft)}
.find h3{font-family:var(--sc-font-display);font-size:21px;font-weight:600;margin:0;line-height:1.25}
.find p{font-family:var(--sc-font-text);font-size:14.5px;line-height:1.7;color:var(--sc-ink-soft);margin:12px 0 0;max-width:72ch}
.find__do b{color:var(--sc-ink)}
/* Evidence sits inside the finding it proves, not only in a gallery at the end. */
.find__ev{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-top:18px}
.find__ev figure{margin:0;min-width:0;width:100%;max-width:100%}
.find__ev img{width:100%;height:170px;object-fit:cover;border-radius:10px;border:1px solid rgba(247,242,233,.14);display:block}
.find__ev figcaption{font-family:var(--sc-font-text);font-size:11.5px;color:var(--sc-ink-soft);margin-top:7px;line-height:1.45}

/* The sideways evidence rail. A 1fr or flex child sized from an image's intrinsic
   width overflows its track, so every figure is pinned to its own width. */
.rail2{display:flex;gap:16px;padding:0 4vw;align-items:flex-end}
/* The engine pans a rail by scrollWidth - innerWidth. With a fixed 270px chapter
   rail the stage is that much narrower, so without this trailing spacer every
   pan stops 270px short and clips its last frame off screen. Any new pan act
   needs one. */
.rail2__end{flex:none;width:var(--railw);height:1px}
.rail2 figure{margin:0;flex:none;width:min(38vw,440px);min-width:0}
.rail2 img{width:100%;height:300px;object-fit:cover;border-radius:14px;border:1px solid rgba(247,242,233,.14);display:block}
.rail2 figcaption{font-family:var(--sc-font-text);font-size:12.5px;color:var(--sc-ink-soft);margin-top:10px;line-height:1.5;max-width:44ch}

.price{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:26px}
@media (max-width:760px){.price{grid-template-columns:1fr}}
.pcard{background:var(--sc-surface);border:1px solid rgba(247,242,233,.12);border-radius:16px;padding:26px 28px}
.pcard--sum{border-color:var(--sc-accent);background:linear-gradient(160deg,rgba(255,255,255,.06),rgba(28,24,19,.9))}
.pcard .k{font-family:var(--sc-font-text);font-size:11px;font-weight:700;letter-spacing:.2em;text-transform:uppercase;color:var(--sc-ink-soft)}
.pcard .n{font-family:var(--sc-font-display);font-size:clamp(2rem,4.2vw,3rem);font-weight:700;line-height:1.02;margin:10px 0 4px;font-variant-numeric:tabular-nums}
.pcard .d{font-family:var(--sc-font-text);font-size:13.5px;color:var(--sc-ink-soft);line-height:1.6}

table{width:100%;border-collapse:collapse;background:var(--sc-surface);border:1px solid rgba(247,242,233,.12);
  border-radius:14px;overflow:hidden;font-size:14px;margin-top:22px;font-family:var(--sc-font-text)}
thead th{background:rgba(247,242,233,.07);color:var(--sc-ink);padding:12px 16px;text-align:left;font-weight:600;font-size:12px;letter-spacing:.1em;text-transform:uppercase}
tbody td{padding:12px 16px;border-top:1px solid rgba(247,242,233,.09);color:var(--sc-ink-soft);vertical-align:top}
tbody td:first-child{color:var(--sc-ink);font-weight:600}
tbody tr:nth-child(even){background:rgba(247,242,233,.025)}

/* Numbered steps and Q&A, used by the per-tenant chapters. */
.steps{counter-reset:s;margin-top:24px}
.step{display:grid;grid-template-columns:auto 1fr;gap:18px;padding:16px 0;border-top:1px solid rgba(247,242,233,.10)}
.step__n{counter-increment:s;font-family:var(--sc-font-display);font-size:15px;font-weight:700;color:var(--sc-accent);
  width:34px;height:34px;border:1px solid currentColor;border-radius:50%;display:flex;align-items:center;justify-content:center;flex:none}
.step__n::before{content:counter(s)}
.step h3{font-family:var(--sc-font-display);font-size:18px;font-weight:600;margin:4px 0 6px}
.step p{font-family:var(--sc-font-text);font-size:14px;line-height:1.65;color:var(--sc-ink-soft);margin:0;max-width:68ch}
.qa{border-top:1px solid rgba(247,242,233,.12);padding:20px 0}
.qa h3{font-family:var(--sc-font-display);font-size:19px;font-weight:600;margin:0 0 8px;line-height:1.3}
.qa p{font-family:var(--sc-font-text);font-size:14.5px;line-height:1.7;color:var(--sc-ink-soft);margin:0;max-width:72ch}

.note{background:rgba(200,162,76,.09);border:1px solid rgba(200,162,76,.32);border-left:4px solid var(--tone-watch);
  border-radius:12px;padding:18px 22px;margin-top:24px;font-family:var(--sc-font-text);font-size:14.5px;line-height:1.7;color:#E8DCC6;max-width:74ch}
.acts{display:flex;flex-wrap:wrap;gap:18px;align-items:center;margin-top:28px}
.cta{display:inline-block;background:var(--sc-accent);color:var(--sc-accent-ink);font-family:var(--sc-font-text);font-weight:700;
  font-size:15.5px;padding:15px 30px;border-radius:11px;text-decoration:none;transition:filter .14s,transform .14s}
.cta:hover{filter:brightness(1.1)}
.cta:active{transform:translateY(1px)}
.cta:focus-visible{outline:2px solid var(--sc-ink);outline-offset:3px}
.alt{font-family:var(--sc-font-text);font-size:14px;color:var(--sc-ink-soft);text-decoration:none;border-bottom:1px solid rgba(247,242,233,.3);padding-bottom:2px}
.alt:hover{color:var(--sc-ink)}
.foot{font-family:var(--sc-font-text);font-size:12px;color:var(--sc-ink-soft);line-height:1.7;margin-top:30px;
  padding-top:18px;border-top:1px solid rgba(247,242,233,.12);max-width:80ch}
</style>
</head>
<body class="has-rail">

<span data-sc-progress></span>
<div class="sc-grain" aria-hidden="true"></div>

<button class="railtoggle" id="railToggle" aria-expanded="false" aria-controls="rail">Chapters</button>
<nav class="rail" id="rail" aria-label="Chapters">
  <div class="rail__head">
    <div class="rail__mark">${
      safeHttpUrl(brand.companyLogo)
        ? `<img src="${escapeHtml(safeHttpUrl(brand.companyLogo))}" alt="${escapeHtml(company)}">`
        : escapeHtml(company)
    }</div>
    ${report.customerName ? `<div class="rail__who">${escapeHtml(report.customerName)}</div>` : ''}
    ${addrLines.length ? `<div class="rail__addr">${addrLines.join('<br>')}</div>` : ''}
  </div>
  <div class="rail__clock">
    <span class="rail__now" id="railNow">1</span>
    <span class="rail__of">of ${chapters.length} &middot; about ${totalMin} min</span>
  </div>
  <div class="rail__list">
    ${chapters
      .map(
        (ch, i) =>
          `<a href="#${escapeHtml(ch.id)}" data-ch="${escapeHtml(ch.id)}"><span class="n">${String(i + 1).padStart(2, '0')}</span><span>${escapeHtml(ch.label)}</span><span class="m">${escapeHtml(ch.minutes)}m</span></a>`,
      )
      .join('\n    ')}
  </div>
  ${
    phone || brand.companyEmail
      ? `<div class="rail__foot">${escapeHtml(company)}<br>${
          phone
            ? `<a href="tel:${escapeHtml(telHref(phone))}">${escapeHtml(phone)}</a>`
            : `<a href="mailto:${escapeHtml(brand.companyEmail || '')}">${escapeHtml(brand.companyEmail || '')}</a>`
        }</div>`
      : ''
  }
</nav>

<main>
${chapters.map((ch) => ch.html).join('\n')}
</main>

<script>${SCROLLCRAFT_JS}</script>
<script>
(function () {
  ScrollCraft.mount(document.body);

  // The engine measures its spacers once at mount, and an innerHeight of 0 at
  // that moment leaves the page with no scroll track at all. One resize after
  // the window and the fonts have settled makes it re-measure.
  function relayout() { dispatchEvent(new Event('resize')); }
  addEventListener('load', relayout);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(relayout);

  // ── the presentation rail ────────────────────────────────────────────────
  var CH = ${jsonForScript(chapters.map((ch) => ({ id: ch.id })))};
  var rail = document.getElementById('rail');
  var toggle = document.getElementById('railToggle');
  var now = document.getElementById('railNow');
  var links = {};
  CH.forEach(function (c) { links[c.id] = rail.querySelector('[data-ch="' + c.id + '"]'); });

  toggle.addEventListener('click', function () {
    var open = rail.classList.toggle('is-open');
    toggle.setAttribute('aria-expanded', String(open));
  });
  rail.addEventListener('click', function (e) {
    if (e.target.closest('a') && window.innerWidth <= 1080) {
      rail.classList.remove('is-open');
      toggle.setAttribute('aria-expanded', 'false');
    }
  });

  var current = null;
  function frame() {
    // whichever chapter owns the middle of the screen
    var mid = innerHeight * 0.45, found = null;
    for (var j = 0; j < CH.length; j++) {
      var sec = document.getElementById(CH[j].id);
      if (!sec) continue;
      if (sec.getBoundingClientRect().top <= mid) found = j;
    }
    if (found !== null && found !== current) {
      current = found;
      now.textContent = String(found + 1);
      CH.forEach(function (c, k) {
        var a = links[c.id];
        if (!a) return;
        a.setAttribute('aria-current', String(k === found));
        a.setAttribute('data-done', k < found ? '1' : '0');
      });
      var active = links[CH[found].id];
      if (active && active.offsetTop < rail.scrollTop) active.scrollIntoView({ block: 'nearest' });
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
</script>
</body>
</html>`;
}
