/**
 * Best Roofing Now brand assets and credibility markers for reports.
 *
 * IMPORTANT: BRN is NOT a General Contractor. Do not include any
 * "NC General Contractor License" claim or "Licensed General Contractor"
 * wording anywhere in report output. Use the credibility markers below
 * (insured, warranty, family-run, local).
 */

import { CREDENTIAL_MARKERS } from './brand-facts.js';

export const BRN_BRAND = {
  legalName: 'Best Roofing Now LLC',
  displayName: 'Best Roofing Now',
  tagline: 'Charlotte\'s family-run roofing experts',
  city: 'Charlotte',
  state: 'NC',
  phone: '(704) 605-6047',
  email: 'office@bestroofingnow.com',
  website: 'https://bestroofingnow.com',
  colors: {
    primary: '#C8102E',      // BRN red
    primaryDark: '#8B0A1F',
    accent: '#1F2937',       // slate-800
    surface: '#FFFFFF',
    muted: '#F3F4F6',
    text: '#111827',
    subtext: '#4B5563',
    success: '#059669',
    warning: '#D97706',
    danger: '#DC2626',
  },
  // Approved credibility markers — safe to display on customer-facing reports.
  // DO NOT add "NC General Contractor License" or "Licensed General Contractor".
  // Re-exported from brand-facts.ts — do NOT re-add a literal list here.
  credibilityMarkers: CREDENTIAL_MARKERS,
} as const;

/**
 * Brand media + social links hosted on the reports R2 bucket / official profiles.
 * Used by the shared premium report footer so every report (inspection,
 * proposal, combined) carries the logo, awards, and socials.
 */
export const BRN_ASSETS = {
  logo: 'https://reports.bestroofersnow.com/assets/brn/logo.png',
  awards: [
    { src: 'https://reports.bestroofersnow.com/assets/brn/angi-2021.jpg', alt: 'Angi Super Service Award 2021' },
    { src: 'https://reports.bestroofersnow.com/assets/brn/angi-2022.jpg', alt: 'Angi Super Service Award 2022' },
    { src: 'https://reports.bestroofersnow.com/assets/brn/angi-2023.jpg', alt: 'Angi Super Service Award 2023' },
  ],
  socials: [
    { label: 'Website', url: 'https://bestroofingnow.com' },
    { label: 'Google Reviews', url: 'https://g.page/r/CaUQ2-TmxmVZEAE/review' },
    { label: 'Facebook', url: 'https://www.facebook.com/bestroofingnowllc' },
    { label: 'Instagram', url: 'https://www.instagram.com/bestroofingnow' },
    { label: 'YouTube', url: 'https://www.youtube.com/@bestroofingnowllc' },
    { label: 'TikTok', url: 'https://www.tiktok.com/@bestroofingnow' },
    { label: 'X (Twitter)', url: 'https://x.com/bestroofingnow' },
    { label: 'LinkedIn', url: 'https://www.linkedin.com/company/best-roofing-now-llc/' },
    { label: 'Pinterest', url: 'https://www.pinterest.com/bestroofingnowllc/' },
    { label: 'Yelp', url: 'https://www.yelp.com/biz/best-roofing-now-charlotte-9' },
    { label: 'BBB A+', url: 'https://www.bbb.org/us/nc/charlotte/profile/roofing-contractors/best-roofing-now-0473-908763' },
    { label: 'CertainTeed', url: 'https://www.certainteed.com/profiles/bestroofingnowllc' },
  ],
} as const;

export function brnHeaderHtml(opts: { title: string; subtitle?: string } = { title: '' }): string {
  const { primary, surface, text, subtext } = BRN_BRAND.colors;
  return `
    <header style="
      background: linear-gradient(135deg, ${primary} 0%, ${BRN_BRAND.colors.primaryDark} 100%);
      color: ${surface};
      padding: 28px 36px;
      border-radius: 12px 12px 0 0;
      font-family: -apple-system, 'Segoe UI', Roboto, sans-serif;
    ">
      <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:24px;">
        <div>
          <div style="font-size: 14px; opacity: 0.9; letter-spacing: 2px; text-transform: uppercase;">${BRN_BRAND.displayName}</div>
          <h1 style="margin: 8px 0 4px; font-size: 28px; font-weight: 700;">${escapeHtml(opts.title)}</h1>
          ${opts.subtitle ? `<div style="font-size: 14px; opacity: 0.92;">${escapeHtml(opts.subtitle)}</div>` : ''}
        </div>
        <div style="text-align: right; font-size: 13px; line-height: 1.5;">
          <div style="font-weight:600;">${BRN_BRAND.phone}</div>
          <div style="opacity:0.9;">${BRN_BRAND.email}</div>
          <div style="opacity:0.85;">${BRN_BRAND.city}, ${BRN_BRAND.state}</div>
        </div>
      </div>
    </header>
  `;
}

export function brnFooterHtml(): string {
  const { primary, muted, text, subtext } = BRN_BRAND.colors;
  const markers = BRN_BRAND.credibilityMarkers
    .map(m => `<span style="display:inline-block; padding:4px 10px; background:${muted}; border-radius:999px; font-size:12px; color:${text}; margin:2px;">${m}</span>`)
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
      <div style="margin-bottom: 10px;">${markers}</div>
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
        <div>${BRN_BRAND.legalName} · ${BRN_BRAND.city}, ${BRN_BRAND.state} · ${BRN_BRAND.phone}</div>
        <div style="color:${text}; font-weight:600;">${BRN_BRAND.website.replace('https://', '')}</div>
      </div>
      <div style="margin-top: 10px; font-size: 11px; opacity:0.8;">
        Estimates are provided in good faith based on visible conditions and available data.
        Actual repair scope and pricing may vary after on-site inspection. This report is for
        the homeowner's reference; insurance claim outcomes are determined by the carrier.
      </div>
    </footer>
  `;
}

export function brnDocumentShell(opts: { title: string; subtitle?: string; body: string }): string {
  const { surface } = BRN_BRAND.colors;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(opts.title)} · ${BRN_BRAND.displayName}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
</head>
<body style="margin:0; padding:24px; background:#F9FAFB; font-family:-apple-system,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width: 880px; margin: 0 auto; background:${surface}; border-radius:12px; box-shadow: 0 2px 12px rgba(0,0,0,0.06); overflow:hidden;">
    ${brnHeaderHtml({ title: opts.title, subtitle: opts.subtitle })}
    <main style="padding: 28px 36px; color:${BRN_BRAND.colors.text}; line-height: 1.55;">
      ${opts.body}
    </main>
    ${brnFooterHtml()}
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
