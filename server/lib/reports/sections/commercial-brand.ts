/**
 * The company itself, on every commercial document: the logo on the cover
 * and at the close, who it is and what it believes, common commercial roof
 * types, how it looks after a roof once it is on, and a short list of roof
 * words in plain English.
 *
 * Written for a building owner who is not a roofer: short sentences,
 * everyday words, about a 5th-grade reading level. Every claim about the
 * company is the company's own (its profile, shared/company.ts); a part it
 * has not filled in is left out rather than invented.
 *
 * Each block comes in two shells — the scroll chapters of the Proposal and
 * Presentation, and the document sections of the Inspection.
 */
import { esc } from '../report-theme.js';
import { companyBrand, companyTel, companyValues } from '../company-brand.js';
import { COMMERCIAL_ROOF_TYPES } from '../packs/roofing-commercial.js';

/** The logo, on a white plate so it reads on a dark page as well as a light one. Nothing when there is no logo. */
export function brandLogo(className = 'bx-logo'): string {
  const p = companyBrand();
  if (!p.logoUrl) return '';
  return `<span class="${esc(className)}"><img src="${esc(p.logoUrl)}" alt="${esc(p.displayName)}" width="309" height="148"></span>`;
}

/* ----------------------------------------------------------- the content --- */

/**
 * `story` adds the company's tagline and values. The scroll documents leave
 * them out: their Who We Are chapter already tells it.
 */
function aboutBody(story: boolean): string {
  const p = companyBrand();
  const values = companyValues('commercial')
    .map(([t, d]) => `<div class="bx-card"><b>${esc(t)}</b><span>${esc(d)}</span></div>`).join('');
  const systems = COMMERCIAL_ROOF_TYPES
    .map((f) => `<div class="bx-card"><b>${esc(f.name)}</b><span>${esc(f.text)}</span></div>`).join('');
  const plans = p.maintenancePlans
    .map((f) => `<div class="bx-card${f.tag ? ' bx-card--pick' : ''}"><b>${esc(f.name)}${f.tag ? ` <em>${esc(f.tag)}</em>` : ''}</b><span>${esc(f.text)}</span></div>`).join('');
  const service = p.serviceFacts.map((t) => `<li>${esc(t)}</li>`).join('');
  const community = p.community.map((t) => `<li>${esc(t)}</li>`).join('');
  const intro = [story && p.tagline ? esc(p.tagline) : '', p.serviceArea ? `We work across ${esc(p.serviceArea)}.` : '']
    .filter(Boolean).join(' ');
  return `${p.promise ? `<blockquote class="bx-promise">&ldquo;${esc(p.promise)}&rdquo;</blockquote>` : ''}
    ${intro ? `<p class="bx-p">${intro}</p>` : ''}
${story && values ? `
    <h3 class="bx-h">What we believe</h3>
    <div class="bx-grid">${values}</div>
` : ''}
    <h3 class="bx-h">Common commercial roof types</h3>
    <div class="bx-grid">${systems}</div>
${plans || service ? `
    <h3 class="bx-h">We stay after the job is done</h3>
    ${plans ? `<p class="bx-p">A flat roof lasts longer when someone checks it. Pick the plan that fits your building.</p>
    <div class="bx-grid">${plans}</div>` : ''}
    ${service ? `<ul class="bx-list">${service}</ul>` : ''}
` : ''}${community ? `
    <h3 class="bx-h">Part of our community</h3>
    <ul class="bx-list">${community}</ul>` : ''}`;
}

/** Roof words a building owner will see in this document, in plain English. */
export const ROOF_WORDS: Array<[string, string]> = [
  ['Deck', 'The flat base of the roof, made of metal, wood or concrete. Everything else sits on it.'],
  ['Insulation', 'Foam boards on top of the deck. They keep heat in during winter and out during summer.'],
  ['Cover board', 'A thin, hard board on top of the insulation. It gives the roof a smooth, strong top to build on.'],
  ['Membrane', 'The waterproof top layer you walk on. It is the part that keeps the rain out.'],
  ['Seam', 'The place where two pieces of membrane overlap and are joined. Seams are where leaks often start.'],
  ['Flashing', 'Extra pieces that seal the roof where it meets a wall, a vent or a pipe.'],
  ['Edge metal', 'The metal trim around the outside edge of the roof. It holds the roof down in strong wind.'],
  ['Ponding', 'Water that is still sitting on the roof two days after it rains.'],
  ['Core cut', 'A small sample we cut out of the roof, like a slice of cake, to see every layer inside. We patch it right away.'],
  ['Moisture survey', 'A test, often with a heat camera, that finds wet insulation you cannot see from the top.'],
  ['Square', 'How roofers measure size. One square is 100 square feet.'],
  ['Coating (restore)', 'A thick layer painted over a roof that is still in good shape, to seal it and add years.'],
  ['Recover (layover)', 'A new roof put right on top of the old one. The building code only allows this over one old roof that is dry.'],
  ['Tear-off (replace)', 'Taking the old roof all the way off down to the deck and putting on a brand-new one.'],
  ['R-value', 'A number for how well insulation holds heat. A bigger number means better.'],
  ['Warranty', 'A written promise to fix the roof if something goes wrong. The maker covers the materials; we cover our work.'],
];

function wordsBody(): string {
  return `<p class="bx-p">Roofers use a lot of special words. Here is what the ones in this report mean.</p>
    <dl class="bx-words">${ROOF_WORDS.map(([t, d]) => `<div><dt>${esc(t)}</dt><dd>${esc(d)}</dd></div>`).join('')}</dl>`;
}

/* ---------------------------------------------------- scroll (Proposal) --- */

/** Who we are, for the Proposal and Presentation. */
export function chapterAboutCompany(): string {
  return `<section class="sc-section ch ch--paper" id="ch-about-company">
    <div class="sc-wrap sc-stack" data-sc-in data-sc-stagger="50">
      <p class="sc-label">Chapter {{CH}}</p>
      <h2 class="sc-display sc-display--lg">Why Building Owners Choose Us</h2>
      ${brandLogo()}
      <div class="bx">${aboutBody(false)}</div>
    </div>
  </section>`;
}

export function chapterRoofWords(): string {
  return `<section class="sc-section ch ch--paper" id="ch-words">
    <div class="sc-wrap sc-stack" data-sc-in data-sc-stagger="40">
      <p class="sc-label">Chapter {{CH}}</p>
      <h2 class="sc-display sc-display--lg">Roof Words, Made Simple</h2>
      <div class="bx">${wordsBody()}</div>
    </div>
  </section>`;
}

/** The logo and how to reach us, at the very end of a scroll document. */
export function brandCloser(): string {
  const p = companyBrand();
  const awards = p.awards.map((a) => `<img src="${esc(a.src)}" alt="${esc(a.alt)}" loading="lazy">`).join('');
  const tel = companyTel();
  const contact = [
    p.phone && tel ? `<a href="${tel}">${esc(p.phone)}</a>` : '',
    p.email ? `<a href="mailto:${esc(p.email)}">${esc(p.email)}</a>` : '',
    p.website ? `<a href="${esc(p.website)}">${esc(p.websiteLabel)}</a>` : '',
  ].filter(Boolean).join(' &middot; ');
  return `<footer class="bx-close">
    ${brandLogo()}
    <p class="bx-close-line">${esc(p.promise || p.displayName)}</p>
    ${contact ? `<p class="bx-close-contact">${contact}</p>` : ''}
    ${awards ? `<div class="bx-awards">${awards}</div>` : ''}
  </footer>`;
}

/* -------------------------------------------------- document (Inspection) --- */

function docSection(title: string, inner: string): string {
  return `<section><div class="sec-head"><h2>${title}</h2></div><div class="bx bx--doc">${inner}</div></section>`;
}

export function aboutCompanySectionDocument(): string {
  return docSection('Why Building Owners Choose Us', aboutBody(true));
}

/** Folded on screen: the Inspection's roof drawing already teaches the words; this is the reference. */
export function roofWordsSectionDocument(): string {
  return docSection('Roof Words, Made Simple', `<details class="fold"><summary>Show ${ROOF_WORDS.length} roof words in plain English</summary><div class="fold-body">${wordsBody()}</div></details>`);
}

/* ------------------------------------------------------------------- css --- */

/** Self-contained: the same rules serve the scroll pages and the document shell. */
export const COMMERCIAL_BRAND_CSS = `
.bx-logo { display: inline-block; background: #fff; border-radius: 14px; padding: 10px 16px; box-shadow: 0 2px 10px rgba(0,0,0,.08); line-height: 0; }
.bx-logo img { height: 64px; width: auto; display: block; }
.title-logo { margin-bottom: 28px; }
.title-logo .bx-logo img { height: 84px; }
.bx { --bx-ink: #17130F; --bx-soft: #5A5149; --bx-line: #E4DCD0; --bx-red: var(--brand, #1F3A5F); color: var(--bx-ink); }
.bx-promise { margin: 18px 0 10px; padding: 14px 20px; border-left: 4px solid var(--bx-red); font-family: 'Fraunces', Georgia, serif; font-size: 22px; line-height: 1.35; font-style: italic; background: #fff; border-radius: 0 12px 12px 0; }
.bx-p { font-size: 17px; line-height: 1.6; max-width: 62ch; margin: 10px 0; }
.bx-h { font-family: 'Fraunces', Georgia, serif; font-size: 21px; margin: 30px 0 10px; }
.bx-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; }
.bx-card { background: #fff; border: 1px solid var(--bx-line); border-radius: 12px; padding: 14px 16px; }
.bx-card b { display: block; font-size: 16px; margin-bottom: 4px; }
.bx-card em { font-style: normal; font-size: 11px; text-transform: uppercase; letter-spacing: .06em; background: var(--bx-red); color: #fff; border-radius: 999px; padding: 2px 8px; margin-left: 6px; vertical-align: middle; }
.bx-card span { display: block; font-size: 15px; line-height: 1.5; color: var(--bx-soft); }
.bx-card--pick { border-color: var(--bx-red); box-shadow: 0 0 0 1px var(--bx-red) inset; }
.bx-chips { display: flex; flex-wrap: wrap; gap: 8px; }
.bx-chip { background: #fff; border: 1px solid var(--bx-line); border-radius: 999px; padding: 6px 13px; font-size: 14px; font-weight: 600; }
.bx-list { margin: 12px 0 0; padding-left: 1.2em; line-height: 1.8; font-size: 16px; }
.bx-words { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 10px; margin: 14px 0 0; }
.bx-words div { background: #fff; border: 1px solid var(--bx-line); border-radius: 12px; padding: 12px 15px; }
.bx-words dt { font-weight: 700; font-size: 16px; color: var(--bx-red); }
.bx-words dd { margin: 4px 0 0; font-size: 15px; line-height: 1.5; color: var(--bx-soft); }
.bx--doc .bx-p { font-size: 15px; }
.bx--doc .bx-h { font-size: 18px; }
.bx-close { background: #17130F; color: #F5EFE6; text-align: center; padding: 56px 20px 64px; }
.bx-close-line { font-family: 'Fraunces', Georgia, serif; font-style: italic; font-size: 20px; margin: 18px auto 8px; max-width: 40ch; }
.bx-close-contact { font-size: 15px; margin: 0; }
.bx-close-contact a { color: #F5EFE6; }
.bx-awards { display: flex; flex-wrap: wrap; justify-content: center; gap: 16px; margin-top: 26px; }
.bx-awards img { height: 84px; width: auto; }
.hero__logo { margin-bottom: 14px; }
.hero__logo .bx-logo { padding: 8px 12px; }
.hero__logo .bx-logo img { height: 52px; }
@media (max-width: 600px) { .bx-promise { font-size: 19px; } .bx-logo img { height: 52px; } .title-logo .bx-logo img { height: 64px; } .bx-awards img { height: 64px; } }
@media print { .bx-card, .bx-words div, .bx-promise { break-inside: avoid; } .bx-close { background: #fff; color: #17130F; } .bx-close-contact a { color: #17130F; } }
`;
