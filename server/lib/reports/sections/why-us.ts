/**
 * The credibility band: who the company is and what backs it.
 *
 * Every claim is the company's own, from its profile (shared/company.ts):
 * credentials, countable claims, award badges. Nothing is written in here.
 * With nothing entered, the band renders nothing.
 */
import { esc } from '../report-theme.js';
import { companyBrand } from '../company-brand.js';
import type { SectionStyle } from './style.js';

export function whyUs(style: SectionStyle, opts: { compact?: boolean } = {}): string {
  const p = companyBrand();
  const creds = p.credentials
    .map((m) => `<span class="${style.chip}">${esc(m)}</span>`)
    .join('');
  const credStrip = creds ? `<div class="cred">${creds}</div>` : '';
  if (opts.compact) return credStrip;

  const stats = p.trustStats.map((t) => `<li>${esc(t)}</li>`).join('');
  const badges = p.awards
    .map((a) => `<img src="${esc(a.src)}" alt="${esc(a.alt)}" loading="lazy">`)
    .join('');

  return `
    ${credStrip}
    ${stats ? `<ul class="${style.body}">${stats}</ul>` : ''}
    ${badges ? `<div class="award-strip">${badges}</div>` : ''}`;
}
