/**
 * The class vocabulary a shared section renders into, and the CSS behind it.
 *
 * Reports come in two shells: premiumShell documents (Estimate, Inspection)
 * and scrollcraft pages (Proposal, Presentation). A section's *content* is
 * written once; only its class names and CSS differ. This file is the only
 * place either appears.
 */
import { esc } from '../report-theme.js';

export interface SectionStyle {
  /** Wrapper for a section's heading block. */
  heading: string;
  /** Body paragraph. */
  body: string;
  /** Small eyebrow/label above a heading. */
  label: string;
  /** De-emphasised caveat text. */
  note: string;
  /** Inline chip (a colour name, a credential). */
  chip: string;
  /** The product's selling line — full-brightness, display italic, not a caveat. */
  tagline: string;
}

export const DOCUMENT_STYLE: SectionStyle = {
  heading: 'sec-head', body: '', label: 'n', note: 'muted tiny', chip: 'spec-chip',
  tagline: 'muted',
};

export const SCROLL_STYLE: SectionStyle = {
  heading: 'sc-display sc-display--lg', body: 'sc-body', label: 'sc-label',
  note: 'sc-body tiny', chip: 'spec-chip',
  // Both scrollcraft pages (render-presentation-scrollcraft.ts,
  // render-proposal-scrollcraft.ts) already define .opt-tagline in their own
  // PAGE_CSS — deliberately NOT redeclared in SECTION_CSS_SCROLL.
  tagline: 'opt-tagline',
};

/**
 * Label/value facts. A row with no value is dropped, not rendered blank.
 *
 * Markup is byte-identical to the original in render-presentation-scrollcraft.ts:79
 * because the live `.fact b` / `.fact span` rules target exactly this shape.
 * Takes no style argument: the class names are the same in both shells, only
 * the CSS below differs.
 */
export function factGrid(rows: Array<[string, string | null]>): string {
  const present = rows.filter((r): r is [string, string] => !!r[1]);
  if (!present.length) return '';
  return `<div class="fact-grid">${present.map(([k, v]) => `<div class="fact"><b>${esc(k)}</b><span>${esc(v)}</span></div>`).join('')}</div>`;
}

/**
 * Scrollcraft CSS — lifted verbatim from render-presentation-scrollcraft.ts's
 * PAGE_CSS. Uses --sc-* custom properties, which scrollcraft pages define.
 */
export const SECTION_CSS_SCROLL = `
.fact-grid { margin-top: var(--sc-5); display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: var(--sc-3); }
.fact { background: var(--sc-surface); border: 1px solid var(--sc-hairline); border-radius: var(--sc-r-md); padding: var(--sc-4); }
.ch--dark .fact { background: color-mix(in oklab, var(--sc-surface, #fff) 8%, transparent); }
.fact b { display: block; font-size: var(--sc-t-xs); text-transform: uppercase; letter-spacing: var(--sc-track-wide); color: var(--sc-ink-soft); margin-bottom: 0.3em; }
.fact span { font-size: var(--sc-t-sm); }
.spec-colors { display: flex; flex-wrap: wrap; gap: var(--sc-2); margin-top: var(--sc-4); }
.spec-chip { font-size: var(--sc-t-xs); background: var(--sc-surface); border: 1px solid var(--sc-hairline); border-radius: var(--sc-r-pill); padding: 0.3rem 0.7rem; }
.ch--dark .spec-chip { background: color-mix(in oklab, var(--sc-surface, #fff) 8%, transparent); }
.roofstrip { margin-top: var(--sc-6); display: grid; grid-template-columns: repeat(4, 1fr); gap: var(--sc-3); }
.roofstrip img { width: 100%; height: 160px; object-fit: cover; border-radius: var(--sc-r-md); border: 1px solid var(--sc-hairline); }
@media (max-width: 860px) { .roofstrip { grid-template-columns: repeat(2, 1fr); } }

/* Scrollcraft's .sc-body is margin:0, and the Presentation's chColors used to
   carry these two gaps as inline style="margin-top:var(--sc-6|--sc-3)". A
   shared builder cannot emit --sc-* inline (premiumShell declares none), so
   they live here instead: without them the color list butts flush against
   the roof photo strip and the caveat against the chips. Scroll bundle only —
   in a premiumShell document a <p> already has its own UA/theme margin. */
.roofstrip + .sc-body { margin-top: var(--sc-6); }
.spec-colors + .sc-body { margin-top: var(--sc-3); }
.cta-tel { margin-top: var(--sc-6); }
.cta-tel a { display: inline-block; background: var(--sc-accent); color: var(--sc-accent-ink); text-decoration: none; padding: 0.8rem 2rem; border-radius: var(--sc-r-pill); font-weight: 600; }
.award-strip { display: flex; gap: var(--sc-3); flex-wrap: wrap; margin-top: var(--sc-4); }
.award-strip img { height: 64px; width: auto; border-radius: var(--sc-r-sm); }

/* .product-panel is new in this refactor and exists in neither scrollcraft
   PAGE_CSS, so it belongs here. "who-photo" is deliberately absent: BOTH
   scrollcraft pages already define it (render-presentation-scrollcraft.ts:611-614,
   render-proposal-scrollcraft.ts), and redeclaring it would collide. */
.product-panel { margin-top: var(--sc-4); }
.product-panel h3 { font-family: var(--sc-font-display); font-size: var(--sc-t-xl); margin: 0 0 var(--sc-2); }
/* assets/scrollcraft.css:169 spaces .sc-stack's DIRECT children only. The
   panel nests the tagline and body one level deeper, so without this they
   sit flush against each other on a live customer page. Same token. */
.product-panel > * + * { margin-top: var(--sc-4); }
/* .fact-grid already carries its own margin-top: var(--sc-5) above, but that
   rule and .product-panel > * + * tie on specificity (0,1,0); source order
   would let the sibling rule win inside a nested .product-panel and collapse
   the fact grid's gap from 24px to 16px. This restores the intended 24px. */
.product-panel > .fact-grid { margin-top: var(--sc-5); }
/* The panel's own margin-top collapses with .opt-tagline's and wins, leaving
   the h2->tagline gap 8px wider than it was before the panel existed.
   Specificity (0,2,0) beats both .sc-stack > * + * and .product-panel. */
.sc-stack > .product-panel { margin-top: var(--sc-2); }

/* .cred is styled in report-theme.ts:96-97 for premiumShell documents but in
   neither scrollcraft PAGE_CSS, and whyBRN renders it on the Proposal. */
.cred { display: flex; flex-wrap: wrap; gap: var(--sc-2); margin-top: var(--sc-4); }
.cred span { background: var(--sc-surface); border: 1px solid var(--sc-hairline); border-radius: var(--sc-r-pill); padding: 0.35rem 0.8rem; font-size: var(--sc-t-xs); font-weight: 600; }
.ch--dark .cred span { background: color-mix(in oklab, var(--sc-surface, #fff) 8%, transparent); }
`;

/**
 * Document CSS — the SAME class names against premiumShell's variables.
 *
 * premiumShell defines --card --fire --gold --green --ink --line --muted
 * --paper --red and NO --sc-* whatsoever. Reusing SECTION_CSS_SCROLL here
 * would render every chip and fact card with no background, border or
 * padding on a customer's estimate.
 */
export const SECTION_CSS_DOCUMENT = `
.fact-grid { margin-top: 14px; display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 10px; }
.fact { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 12px 14px; }
.fact b { display: block; font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); margin-bottom: 0.3em; }
.fact span { font-size: 13px; }
.spec-colors { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
.spec-chip { font-size: 11px; background: var(--card); border: 1px solid var(--line); border-radius: 999px; padding: 0.3rem 0.7rem; }
/* .roofstrip is deliberately NOT redeclared: report-theme.ts:50-51 already
   ships it to every premiumShell page, and folds it into the shared
   max-width:780px breakpoint at :115. Redeclaring it here with different
   values would collide at equal specificity and resize the existing photo
   strip depending on which <style> block loads last. */
.cta-tel { margin-top: 16px; }
.cta-tel a { display: inline-block; background: var(--red); color: #fff; text-decoration: none; padding: 0.8rem 2rem; border-radius: 999px; font-weight: 600; }
.product-panel { border: 1px solid var(--line); border-radius: 10px; padding: 14px 16px; margin-bottom: 14px; }
.product-panel h3 { margin: 0; font-size: 17px; }
.award-strip { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 10px; }
.award-strip img { height: 56px; width: auto; }

/* who-photo is defined in both scrollcraft PAGE_CSS files but NOT in
   report-theme.ts, so a premiumShell document renders the product photo with
   no styling at all unless it is declared here. Not the scrollcraft rule
   copied over — that one is position:sticky with a 600/905 portrait ratio,
   tuned for the founders photo, which is wrong for a product shot. */
.who-photo { margin-top: 14px; }
.who-photo img { display: block; width: 100%; max-width: 460px; border-radius: 10px; border: 1px solid var(--line); margin: 0 auto; }
.who-photo figcaption { margin-top: 8px; font-size: 11px; color: var(--muted); text-align: center; }
`;
