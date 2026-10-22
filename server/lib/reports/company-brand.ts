/**
 * The company a document is for: its name, contact details, colors, logo and
 * the claims it has entered about itself (shared/company.ts).
 *
 * Every report, letter and email reads the company from here at render time,
 * for the company whose work is running (runAsCompany). Nothing about any one
 * company is written into the code. A claim the company has not entered is
 * not shown: lists come back empty and sections that would be empty are left
 * out by their renderers.
 */
import { currentProfile } from '../../tenant/context.js';
import type { CompanyProfile } from '../../../shared/company.js';

/** The current company's profile. */
export const companyBrand = (): CompanyProfile => currentProfile();

/** Short credential lines for the credibility strip, strongest first. */
export const credentialMarkers = (): readonly string[] => currentProfile().credentials;

/** Countable claims ("5.0★ on Google · 120 reviews"). */
export const trustStats = (): readonly string[] => currentProfile().trustStats;

/** The company's values as [title, text] pairs; commercial documents say "building", not "home". */
export function companyValues(audience: 'residential' | 'commercial' = 'residential'): Array<[string, string]> {
  return currentProfile().values.map(({ title, text }) => [
    title,
    audience === 'commercial' ? text.replace(/\byour home\b/gi, 'your building').replace(/\bhomeowners?\b/gi, (m) => (m.toLowerCase().endsWith('s') ? 'building owners' : 'building owner')) : text,
  ]);
}

/** The owners' story, or null when the company has not written one. */
export function ownersStory(): { heading: string; paragraphs: string[]; signature: string; photoUrl: string; photoCaption: string } | null {
  const p = currentProfile();
  if (!p.story) return null;
  return { ...p.story, signature: p.story.signature || `&mdash; ${escapeHtml(p.displayName)}` };
}

/** "tel:" link for the company phone, or '' when there is none. */
export function companyTel(): string {
  const digits = currentProfile().phoneDigits.replace(/^\+?1?(?=\d{10}$)/, '');
  return digits ? `tel:+1${digits}` : '';
}

/** One line of contact details for a document footer; parts the company has not entered are skipped. */
export function contactLine(sep = ' · '): string {
  const p = currentProfile();
  return [p.legalName, p.cityState, p.phone, p.email, p.websiteLabel].filter(Boolean).join(sep);
}

export function companyHeaderHtml(opts: { title: string; subtitle?: string } = { title: '' }): string {
  const p = currentProfile();
  const { primary, primaryDark, surface } = p.colors;
  return `
    <header style="
      background: linear-gradient(135deg, ${primary} 0%, ${primaryDark} 100%);
      color: ${surface};
      padding: 28px 36px;
      border-radius: 12px 12px 0 0;
      font-family: -apple-system, 'Segoe UI', Roboto, sans-serif;
    ">
      <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:24px;">
        <div>
          <div style="font-size: 14px; opacity: 0.9; letter-spacing: 2px; text-transform: uppercase;">${escapeHtml(p.displayName)}</div>
          <h1 style="margin: 8px 0 4px; font-size: 28px; font-weight: 700;">${escapeHtml(opts.title)}</h1>
          ${opts.subtitle ? `<div style="font-size: 14px; opacity: 0.92;">${escapeHtml(opts.subtitle)}</div>` : ''}
        </div>
        <div style="text-align: right; font-size: 13px; line-height: 1.5;">
          ${p.phone ? `<div style="font-weight:600;">${escapeHtml(p.phone)}</div>` : ''}
          ${p.email ? `<div style="opacity:0.9;">${escapeHtml(p.email)}</div>` : ''}
          ${p.cityState ? `<div style="opacity:0.85;">${escapeHtml(p.cityState)}</div>` : ''}
        </div>
      </div>
    </header>
  `;
}

export function companyFooterHtml(): string {
  const p = currentProfile();
  const { muted, text, subtext } = p.colors;
  const markers = p.credentials
    .map((m) => `<span style="display:inline-block; padding:4px 10px; background:${muted}; border-radius:999px; font-size:12px; color:${text}; margin:2px;">${escapeHtml(m)}</span>`)
    .join('');
  return `
    <footer style="
      background: ${muted};
      padding: 20px 36px;
      border-radius: 0 0 12px 12px;
      font-family: -apple-system, 'Segoe UI', Roboto, sans-serif;
      color: ${subtext};
      font-size: 12px;
      line-height: 1.5;
    ">
      ${markers ? `<div style="margin-bottom: 10px;">${markers}</div>` : ''}
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
        <div>${escapeHtml([p.legalName, p.cityState, p.phone].filter(Boolean).join(' · '))}</div>
        ${p.websiteLabel ? `<div style="color:${text}; font-weight:600;">${escapeHtml(p.websiteLabel)}</div>` : ''}
      </div>
      <div style="margin-top: 10px; font-size: 11px; opacity:0.8;">
        Estimates are provided in good faith based on visible conditions and available data.
        Actual repair scope and pricing may vary after on-site inspection. This report is for
        the homeowner's reference; insurance claim outcomes are determined by the carrier.
      </div>
    </footer>
  `;
}

export function companyDocumentShell(opts: { title: string; subtitle?: string; body: string }): string {
  const p = currentProfile();
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(opts.title)} · ${escapeHtml(p.displayName)}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
</head>
<body style="margin:0; padding:24px; background:#F9FAFB; font-family:-apple-system,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width: 880px; margin: 0 auto; background:${p.colors.surface}; border-radius:12px; box-shadow: 0 2px 12px rgba(0,0,0,0.06); overflow:hidden;">
    ${companyHeaderHtml({ title: opts.title, subtitle: opts.subtitle })}
    <main style="padding: 28px 36px; color:${p.colors.text}; line-height: 1.55;">
      ${opts.body}
    </main>
    ${companyFooterHtml()}
  </div>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * The company's colors for a document's CSS. The stylesheets name the brand
 * color through variables (--red, --sc-accent, --bx-red, --brand); this
 * sets them, and goes last in <head> so it wins.
 */
export function brandStyleTag(): string {
  const { primary, primaryDark } = currentProfile().colors;
  return `<style id="company-brand">:root{--brand:${primary};--brand-dark:${primaryDark};--red:${primary};--sc-accent:${primary}}.bx{--bx-red:${primary}}</style>`;
}

/** Icon, description and link-preview tags for a document's <head>. */
export function documentMetaTags(title: string): string {
  const p = currentProfile();
  const name = escapeHtml(p.displayName);
  const where = p.cityState ? `, ${escapeHtml(p.cityState)}` : '';
  const logo = p.logoUrl ? escapeHtml(p.logoUrl) : '';
  return [
    logo && `<link rel="icon" href="${logo}"/>`,
    logo && `<link rel="apple-touch-icon" href="${logo}"/>`,
    `<meta name="description" content="${escapeHtml(title)} — prepared by ${name}${where}."/>`,
    `<meta property="og:title" content="${escapeHtml(title)}"/>`,
    `<meta property="og:description" content="Prepared by ${name}${p.tagline ? ` — ${escapeHtml(p.tagline)}` : ''}."/>`,
    `<meta property="og:type" content="website"/>`,
    `<meta property="og:site_name" content="${name}"/>`,
    logo && `<meta property="og:image" content="${logo}"/>`,
    logo && `<meta property="og:image:alt" content="${name}"/>`,
    `<meta name="twitter:card" content="summary"/>`,
    `<meta name="twitter:title" content="${escapeHtml(title)}"/>`,
    logo && `<meta name="twitter:image" content="${logo}"/>`,
  ].filter(Boolean).join('\n');
}
