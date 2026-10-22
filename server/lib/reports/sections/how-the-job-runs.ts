/**
 * What actually happens on install day.
 *
 * Extracted from render-presentation-scrollcraft.ts chProcess. Copy is
 * verbatim — it is already reviewed, customer-tested prose, and the decking
 * promise in step 2 is a commitment BRN makes, not marketing.
 *
 * Renders `ig-row` / `ig-rows`, which BOTH scrollcraft pages already style.
 */
import { esc } from '../report-theme.js';
import type { SectionStyle } from './style.js';

const STEPS: Array<[string, string]> = [
  ['Protect', 'We cover landscaping, walkways, and anything else on the ground before a single shingle comes off.'],
  ['Tear off', 'The old roof comes off and the deck is inspected. Anything soft or rotten is photographed and priced before we go further &mdash; nothing gets covered up without you seeing it first.'],
  ['Dry in', "Underlayment goes down the same day the deck is exposed, so your home is protected from weather overnight no matter what stage we're at."],
  ['Install', 'Underlayment, starter, the roof itself, and flashing go on to the manufacturer&rsquo;s full system spec, every time &mdash; not just on the parts that show.'],
  ['Clean up', 'We run magnets over the driveway and yard for stray nails, and haul away every bit of the old roof before we leave.'],
];

export function howTheJobRuns(style: SectionStyle): string {
  // Step descriptions are authored HTML (&mdash;) — not escaped. Titles are.
  const rows = STEPS
    .map(([t, d], i) => `<div class="ig-row"><b>${i + 1} &middot; ${esc(t)}</b><span>${d}</span></div>`)
    .join('');
  return `
    <p class="${style.body}">Most roofs are a single day, start to finish; a larger or more complex roof can run longer. Either way, the sequence is the same, and we photograph the job as we go &mdash; the deck, the flashings, the parts that get covered by the end of the day &mdash; so there's a real record of what went into your roof, not just a before-and-after picture.</p>
    <div class="ig-rows">${rows}</div>`;
}
