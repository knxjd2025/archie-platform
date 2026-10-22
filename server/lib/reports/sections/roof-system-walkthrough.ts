/**
 * "How your roof goes together" — the package, one layer at a time, with the
 * manufacturer's picture of each part.
 *
 * Shared by the Proposal and Presentation (scroll shell) and the Estimate
 * (document shell). Not the Inspection: an inspection reports what is on the
 * roof today. It shows manufacturer photos only as labelled examples of a
 * part (sections/anatomy-examples.ts), never as a product being sold.
 *
 * A step whose manufacturer publishes no image gets a labelled card in the
 * photo's place — never a photo of a different product standing in.
 */
import { esc } from '../report-theme.js';
import { assetUrl, type RoofSystem, type RoofSystemComponent } from '../roof-systems.js';
import type { SectionStyle } from './style.js';

export interface WalkthroughOptions {
  /** Print the "Step N" ordinal on each card (default true). */
  numbered?: boolean;
  /** Show the whole-system illustration above the steps when the system has one (default true). */
  cutaway?: boolean;
}

function media(c: RoofSystemComponent): string {
  if (c.image) {
    return `<figure class="rsw-media"><img src="${esc(assetUrl(c.image))}" alt="${esc(stripEntities(c.name))}" loading="lazy"></figure>`;
  }
  return `<div class="rsw-media rsw-media--none" aria-hidden="true"><span>${c.maker === 'Best Roofing Now' ? 'Supplied by' : 'Made by'}</span><b>${esc(c.maker)}</b></div>`;
}

/** alt text can't carry &reg; entities as literal markup. */
function stripEntities(s: string): string {
  return s.replace(/&[a-z]+;|&#\d+;/gi, '').replace(/\s+/g, ' ').trim();
}

export function roofSystemWalkthrough(system: RoofSystem, style: SectionStyle, opts: WalkthroughOptions = {}): string {
  const { numbered = true, cutaway = true } = opts;
  const steps = system.components.map((c, i) => `
      <li class="rsw-step" data-role="${esc(c.role)}">
        ${media(c)}
        <div class="rsw-text">
          ${numbered ? `<span class="rsw-n">Step ${i + 1}</span>` : ''}
          <span class="rsw-step-name">${esc(c.step)}</span>
          <b class="rsw-name">${c.name}</b>
          ${c.image ? `<span class="rsw-maker">${c.maker === 'Best Roofing Now' ? 'Supplied by' : 'Made by'} ${esc(c.maker)}</span>` : ''}
          <p class="rsw-plain">${c.plain}</p>
          ${c.spec ? `<p class="rsw-spec">${c.spec}</p>` : ''}
        </div>
      </li>`).join('');

  const illustration = cutaway && system.cutaway
    ? `<figure class="rsw-cutaway"><img src="${esc(assetUrl(system.cutaway))}" alt="${esc(stripEntities(system.systemName))} illustrated" loading="lazy"><figcaption class="${style.note}">${system.systemName} &mdash; manufacturer's illustration.</figcaption></figure>`
    : '';

  const makers = [...new Set(system.components.map((c) => c.maker).filter((m) => m !== 'Best Roofing Now'))];

  return `<div class="rsw">
    <p class="${style.body}">${system.lede}</p>
    ${illustration}
    <ol class="rsw-steps">${steps}</ol>
    <p class="${style.note}">Specifications are the manufacturers' own published figures. Product photography courtesy of ${makers.map(esc).join(', ')}; the actual roof is installed to the manufacturer's current instructions.</p>
  </div>`;
}

/**
 * Scroll shell (Proposal, Presentation). Uses the --sc-* variables those
 * pages define. Lives here, not in SECTION_CSS_SCROLL, so the rules ship
 * only to the pages that render a walkthrough.
 */
export const ROOF_SYSTEM_CSS_SCROLL = `
.rsw-cutaway { margin: var(--sc-6) 0 0; }
.rsw-cutaway img { display: block; width: 100%; max-width: 900px; border-radius: var(--sc-r-md); border: 1px solid var(--sc-hairline); background: #fff; }
.rsw-cutaway figcaption { margin-top: var(--sc-2); }
.rsw-steps { list-style: none; margin: var(--sc-7) 0 0; padding: 0; display: grid; gap: var(--sc-4); counter-reset: rsw; }
.rsw-step { display: grid; grid-template-columns: 220px 1fr; gap: var(--sc-5); align-items: start; background: var(--sc-surface); border: 1px solid var(--sc-hairline); border-radius: var(--sc-r-md); padding: var(--sc-4); }
.ch--dark .rsw-step { background: color-mix(in oklab, var(--sc-surface, #fff) 8%, transparent); }
.rsw-media { margin: 0; aspect-ratio: 4 / 3; border-radius: var(--sc-r-sm); overflow: hidden; background: #fff; border: 1px solid var(--sc-hairline); }
.rsw-media img { display: block; width: 100%; height: 100%; object-fit: cover; }
.rsw-media--none { display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: var(--sc-3); background: color-mix(in oklab, var(--sc-ink, #17130F) 6%, transparent); }
.rsw-media--none span { font-size: var(--sc-t-xs); text-transform: uppercase; letter-spacing: var(--sc-track-wide); color: var(--sc-ink-soft); }
.rsw-media--none b { font-family: var(--sc-font-display); font-size: var(--sc-t-sm); margin-top: 0.3em; }
.rsw-text { display: flex; flex-direction: column; gap: 0.2em; min-width: 0; }
.rsw-n { font-size: var(--sc-t-xs); text-transform: uppercase; letter-spacing: var(--sc-track-wide); color: var(--sc-accent); font-weight: 600; }
.rsw-step-name { font-family: var(--sc-font-display); font-size: var(--sc-t-lg, 1.35rem); line-height: 1.15; }
.rsw-name { font-size: var(--sc-t-sm); font-weight: 600; margin-top: 0.4em; }
.rsw-maker { font-size: var(--sc-t-xs); color: var(--sc-ink-soft); }
.rsw-plain { margin: 0.6em 0 0; font-size: var(--sc-t-sm); line-height: 1.55; }
.rsw-spec { margin: 0.5em 0 0; font-size: var(--sc-t-xs); color: var(--sc-ink-soft); line-height: 1.5; }
@media (max-width: 720px) {
  .rsw-step { grid-template-columns: 1fr; }
  .rsw-media { max-width: 320px; }
  .rsw-spec { font-size: 13px; }
}
`;

/** Document shell (Estimate): premiumShell variables only, no --sc-*. */
export const ROOF_SYSTEM_CSS_DOCUMENT = `
.rsw { margin: 14px 0 6px; }
.rsw-cutaway { margin: 12px 0 0; }
.rsw-cutaway img { display: block; width: 100%; max-width: 620px; border-radius: 10px; border: 1px solid var(--line); background: #fff; margin: 0 auto; }
.rsw-cutaway figcaption { text-align: center; margin-top: 6px; }
.rsw-steps { list-style: none; margin: 14px 0 0; padding: 0; display: grid; gap: 10px; }
.rsw-step { display: grid; grid-template-columns: 150px 1fr; gap: 14px; align-items: start; border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; background: var(--card); break-inside: avoid; page-break-inside: avoid; }
.rsw-media { margin: 0; aspect-ratio: 4 / 3; border-radius: 8px; overflow: hidden; background: #fff; border: 1px solid var(--line); }
.rsw-media img { display: block; width: 100%; height: 100%; object-fit: cover; }
.rsw-media--none { display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 8px; background: var(--paper); }
.rsw-media--none span { font-size: 10px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); }
.rsw-media--none b { font-size: 12px; margin-top: 2px; }
.rsw-text { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.rsw-n { font-size: 10px; text-transform: uppercase; letter-spacing: .06em; color: var(--red); font-weight: 700; }
.rsw-step-name { font-size: 15px; font-weight: 700; line-height: 1.2; }
.rsw-name { font-size: 13px; font-weight: 600; margin-top: 4px; }
.rsw-maker { font-size: 11px; color: var(--muted); }
.rsw-plain { margin: 6px 0 0; font-size: 12.5px; line-height: 1.5; }
.rsw-spec { margin: 4px 0 0; font-size: 11px; color: var(--muted); line-height: 1.45; }
@media (max-width: 600px) { .rsw-step { grid-template-columns: 1fr; } .rsw-media { max-width: 260px; } .rsw-spec { font-size: 13px; } }
`;
