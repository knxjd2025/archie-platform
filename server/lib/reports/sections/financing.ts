/**
 * Financing.
 *
 * Deliberately quotes NO APR and NO monthly payment. The real numbers come
 * from HFS Financial's own application; a figure invented in a template is a
 * number a customer will hold us to. (Same decision as the original
 * render-presentation-scrollcraft.ts chFinancing.) The claims that are made —
 * fixed rates, no home equity, no prepayment penalty, a 60-second rate check
 * on a soft credit inquiry — are HFS's own, from the promo page linked here.
 */
import { esc } from '../report-theme.js';
import { FINANCING_FACT } from '../brand-facts.js';
import type { SectionStyle } from './style.js';

export const FINANCING_APPLY_URL = 'https://www.hfsfinancial.net/promo/6a9220ac271898d8cd349096';

export function financing(style: SectionStyle): string {
  return `
    <p class="${style.body}">Most homeowners don't pay for a new roof in cash, and you don't have to either. We partner with HFS Financial, which matches you with lenders for fixed-rate loans that need no home equity and carry no prepayment penalty.</p>
    <p class="cta-tel"><a href="${FINANCING_APPLY_URL}" target="_blank" rel="noopener">Check Your Rate With HFS &rarr;</a></p>
    <p class="${style.note}">${esc(FINANCING_FACT.text)} &middot; Checking your rate takes about 60 seconds and is a soft credit inquiry, so it does not affect your credit score. Ask your rep if you have questions before you apply.</p>`;
}
