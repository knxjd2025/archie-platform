/**
 * The credibility band: who we are and what backs it.
 *
 * Every claim comes from brand-facts.ts, which carries a source and a
 * verified-on date for each one. Nothing is written inline here — that is how
 * two conflicting credential lists came to exist in the first place.
 */
import { esc } from '../report-theme.js';
import { CREDENTIAL_MARKERS, TRUST_STATS } from '../brand-facts.js';
import { BRN_ASSETS } from '../brn-brand.js';
import type { SectionStyle } from './style.js';

export function whyBRN(style: SectionStyle, opts: { compact?: boolean } = {}): string {
  const creds = CREDENTIAL_MARKERS
    .map((m) => `<span class="${style.chip}">${esc(m)}</span>`)
    .join('');
  if (opts.compact) return `<div class="cred">${creds}</div>`;

  const stats = TRUST_STATS
    .map((f) => `<li>${esc(f.text)}</li>`)
    .join('');
  const badges = BRN_ASSETS.awards
    .map((a) => `<img src="${esc(a.src)}" alt="${esc(a.alt)}" loading="lazy">`)
    .join('');

  return `
    <div class="cred">${creds}</div>
    <ul class="${style.body}">${stats}</ul>
    <div class="award-strip">${badges}</div>`;
}
