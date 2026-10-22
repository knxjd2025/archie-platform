/**
 * Financing.
 *
 * Shown only when the company has entered a lending partner and its
 * application link (shared/company.ts settings.financing). Deliberately quotes
 * NO APR and NO monthly payment: the real numbers come from the lender's own
 * application, and a figure invented in a template is a number a customer will
 * hold the company to.
 */
import { esc } from '../report-theme.js';
import { companyBrand } from '../company-brand.js';
import type { SectionStyle } from './style.js';

/** True when the company offers financing through a partner, so the section has something to say. */
export const hasFinancing = (): boolean => !!companyBrand().financing;

export function financing(style: SectionStyle): string {
  const p = companyBrand();
  if (!p.financing) return '';
  const { partner, applyUrl } = p.financing;
  return `
    <p class="${style.body}">Most homeowners don't pay for a project like this in cash, and you don't have to either. ${esc(p.displayName)} works with ${esc(partner)} to help you find a loan that fits.</p>
    <p class="cta-tel"><a href="${esc(applyUrl)}" target="_blank" rel="noopener">Check Your Rate With ${esc(partner)} &rarr;</a></p>
    <p class="${style.note}">${p.financingLine ? `${esc(p.financingLine)} &middot; ` : ''}Ask your rep if you have questions before you apply.</p>`;
}
