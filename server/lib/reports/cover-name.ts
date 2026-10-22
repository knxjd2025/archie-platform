/**
 * The customer's name on the cover of a scroll document.
 *
 * The cover's <h1> used to carry `data-sc-cue="0 0.85 0"`. A cue is driven by
 * the scroll progress of the act it sits in — and the cover is an ordinary
 * flow section, not an act. The engine's stylesheet starts every cue at
 * opacity 0 and nothing ever raised this one, so every Proposal and
 * Presentation, residential and commercial, went out with the customer's name
 * invisible on its first page: "Prepared for", a gap, then the address.
 *
 * A flow section's entrance is `data-sc-in`, which the engine reveals as the
 * element comes on screen. The templates use COVER_NAME_ATTRS; documents
 * already stored with the old markup are repaired as they are served.
 */
export const COVER_NAME_ATTRS = 'data-sc-in';

const BROKEN = /(class="sc-display sc-display--xl title-name") data-sc-cue="0 0\.85 0" data-sc-kinetic="lines"/g;

/** Rewrite a stored document's cover so the name shows. Idempotent; untouched when there is nothing to fix. */
export function repairCoverName(html: string): string {
  if (!html.includes('title-name" data-sc-cue=')) return html;
  return html.replace(BROKEN, `$1 ${COVER_NAME_ATTRS}`);
}
