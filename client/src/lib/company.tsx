import { useAuth } from './auth';
import { PRODUCT_NAME } from './brand';
import { resolveCompanyProfile, type CompanyProfile } from '../../../shared/company';

export { PRODUCT_NAME };

/**
 * What the app shows before /api/auth/me has answered, or when the session
 * has no company: neutral words ("Your company"), no contact details, no
 * claims, Archie's colors.
 */
export const NEUTRAL_PROFILE: CompanyProfile = resolveCompanyProfile({ id: '', name: '' });

/**
 * The signed-in person's company. Always a full profile: while loading (or
 * signed out) it is NEUTRAL_PROFILE, so screens can read `displayName`,
 * `phone`, `cityState` and the rest without null checks. Empty strings and
 * empty lists mean the company has not entered that yet, so leave it out.
 */
export function useCompany(): CompanyProfile {
  const { profile } = useAuth();
  return profile ?? NEUTRAL_PROFILE;
}

/** True once a real company is loaded (not the neutral fallback). */
export function useHasCompany(): boolean {
  return !!useAuth().profile;
}

/** Archie's own mark: a rounded square with an "A". Used where there is no company logo. */
export function ArchieMark({ size = 28, className = '', title = PRODUCT_NAME }: { size?: number; className?: string; title?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={className} role="img" aria-label={title}>
      <rect width="64" height="64" rx="14" fill="#1F3A5F" />
      <path d="M32 13 L49 51 H41.5 L38 43 H26 L22.5 51 H15 Z M28.6 37 H35.4 L32 28.6 Z" fill="#FFFFFF" fillRule="evenodd" />
    </svg>
  );
}

/**
 * The company's logo when it has one, otherwise the Archie mark. `alt` is the
 * company's name, so a screen reader says whose app this is.
 */
export function CompanyMark({ profile, className = 'h-7 w-auto', markSize = 28 }: { profile: CompanyProfile; className?: string; markSize?: number }) {
  if (profile.logoUrl) return <img src={profile.logoUrl} alt={profile.displayName} className={className} />;
  return <ArchieMark size={markSize} title={profile.id ? profile.displayName : PRODUCT_NAME} />;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

/**
 * The letterhead for a printed letter, from the company profile: its name, its
 * own tagline, phone and website, each only when entered. `overrides` lets a
 * screen use the details its own form already holds (an office address the
 * rep edited, the phone on the claim). Returns escaped HTML.
 */
export function letterhead(
  profile: CompanyProfile,
  overrides: { name?: string; address?: string; phone?: string } = {},
): { css: string; head: string; foot: string } {
  const name = (overrides.name || '').trim() || profile.legalName || profile.displayName;
  const phone = (overrides.phone || '').trim() || profile.phone;
  const address = (overrides.address || '').trim()
    || [profile.address, [profile.cityState, profile.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  const contact = [phone, profile.websiteLabel].filter(Boolean).map(esc).join(' · ');
  const right = [profile.tagline ? esc(profile.tagline) : '', contact].filter(Boolean).join('<br>');
  const css = `
        .lh { display:flex; align-items:center; justify-content:space-between; gap:16px; border-bottom: 3px solid ${profile.colors.primary}; padding-bottom: 10px; margin-bottom: 22px; }
        .lh b { font: 700 20pt Georgia, serif; color: ${profile.colors.primaryDark}; }
        .lh img { max-height: 54px; max-width: 220px; }
        .lh span { font: 10pt Arial, sans-serif; color: #555; text-align: right; }
        .foot { margin-top: 28px; border-top: 1px solid #ddd; padding-top: 8px; font: 9.5pt Arial, sans-serif; color: #666; }`;
  const brand = profile.logoUrl ? `<img src="${esc(profile.logoUrl)}" alt="${esc(name)}">` : `<b>${esc(name)}</b>`;
  const head = `<div class="lh">${brand}<span>${right}</span></div>`;
  const foot = `<div class="foot">${[name, address, phone].filter(Boolean).map(esc).join(' · ')}</div>`;
  return { css, head, foot };
}
