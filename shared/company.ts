/**
 * Per-company settings that replace what used to be hardcoded for one roofing
 * company. Everything here is optional: the app falls back to neutral wording
 * when a company has not filled something in yet.
 *
 * Code never reads these raw. It reads a CompanyProfile (resolveCompanyProfile
 * below), which has every field filled, so a report or letter never shows
 * "undefined" and never makes a claim the company did not enter.
 */

/** A link shown on documents, e.g. { label: 'Google Reviews', url: 'https://…' }. */
export interface CompanyLink { label: string; url: string }

/** An image shown on documents, e.g. an award badge. */
export interface CompanyImage { src: string; alt: string }

/** How the company presents itself on reports, letters, emails and the app. */
export interface CompanyBranding {
  /** Name on documents, e.g. "Acme Roofing & Exteriors LLC". Defaults to companies.name. */
  legalName?: string;
  /** Short name used in sentences, e.g. "Acme". Defaults to companies.name. */
  shortName?: string;
  logoUrl?: string;
  /** Hex colors, e.g. "#1F3A5F". */
  primaryColor?: string;
  accentColor?: string;
  phone?: string;
  email?: string;
  website?: string;
  /** Street line, e.g. "123 Main St, Suite 4". */
  address?: string;
  city?: string;
  /** Two-letter state, e.g. "NC". */
  state?: string;
  zip?: string;
  /** e.g. ["NC General Contractor #12345"]. Only shown when entered. */
  licenses?: string[];
  /** Year founded, for "serving you since" lines. */
  foundedYear?: number;
  /** One line about the company, e.g. "Family-run roofing in Charlotte". */
  tagline?: string;
  /** Where customers leave a review (Google, etc.). */
  reviewUrl?: string;
  /** Website, social and review profiles, in the order to show them. */
  links?: CompanyLink[];
  /** Award or badge images for the report footer. */
  awards?: CompanyImage[];
}

/** Facts and options the company controls. Every claim here is the company's own. */
export interface CompanySettings {
  /** Short credential lines for the report footer strip, strongest first, e.g. ["GAF Master Elite", "Fully insured"]. */
  credentials?: string[];
  /** Countable claims, e.g. ["5.0★ on Google · 120 reviews", "1,000+ roofs installed"]. */
  trustStats?: string[];
  /** Manufacturer or trade certifications, e.g. ["GAF Master Elite"]. */
  certifications?: string[];
  /** Workmanship warranty in plain words, e.g. "10-year workmanship warranty". */
  workmanshipWarranty?: string;
  /** Years of the company's own workmanship warranty, for warranty badges. */
  workmanshipYears?: number;
  /** e.g. "Financing available · $0 down options". Shown only when entered. */
  financingLine?: string;
  /** The lender the company sends customers to, and its application link. */
  financing?: { partner: string; applyUrl: string };
  /** Maintenance plans the company sells, e.g. [{ name: 'Annual check', text: 'We check it once a year.' }]. */
  maintenancePlans?: Array<{ name: string; text: string; tag?: string }>;
  /** Service promises, e.g. ["Help day or night when a roof leaks."]. */
  serviceFacts?: string[];
  /** The company's promise in its own words, e.g. "We tell the truth, even when it is not a sale." */
  promise?: string;
  /** The company's values: a title and one line each. */
  values?: Array<{ title: string; text: string }>;
  /** The owners' story for the "About us" page of a report. */
  story?: { heading: string; paragraphs: string[]; signature?: string; photoUrl?: string; photoCaption?: string };
  /** Reasons to choose the company, shown on reports ("Why us"). */
  whyUs?: string[];
  /** Groups the company belongs to, e.g. ["Member of the Charlotte Chamber"]. */
  community?: string[];
  /** Service area in plain words, e.g. "Charlotte and 50 miles around". */
  serviceArea?: string;
  /** Feature modules switched on for this company. Unset means the default set. */
  modules?: Partial<Record<ArchieModule, boolean>>;
  /** IANA time zone for schedules and digests. Defaults to America/New_York. */
  timeZone?: string;
}

export const ARCHIE_MODULES = [
  'crm',
  'inbox',
  'calendar',
  'pipeline',
  'reviews',
  'ai_agent',
  'automations',
  'forms',
  'payments',
  'reports',
  'inspections',
  'projects',
  'canvass',
  'signatures',
] as const;
export type ArchieModule = (typeof ARCHIE_MODULES)[number];

/** Report and email colors, derived from the company's brand colors. */
export interface CompanyColors {
  primary: string;
  primaryDark: string;
  accent: string;
  surface: string;
  muted: string;
  text: string;
  subtext: string;
  success: string;
  warning: string;
  danger: string;
}

/**
 * Everything documents, letters, emails and AI prompts need to know about a
 * company, with every field filled. Lists are empty, not invented, when the
 * company has not entered them.
 */
export interface CompanyProfile {
  id: string;
  slug: string;
  trade: string;
  /** Name in sentences ("Acme Roofing"). */
  displayName: string;
  /** Name at the top of documents ("Acme Roofing LLC"). */
  legalName: string;
  tagline: string;
  phone: string;
  /** Phone digits only, for tel: links. */
  phoneDigits: string;
  email: string;
  /** Full URL, or '' when none. */
  website: string;
  /** Website without the scheme, for display. */
  websiteLabel: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  /** "City, ST" or whichever part is known. */
  cityState: string;
  licenses: string[];
  foundedYear: number | null;
  logoUrl: string;
  reviewUrl: string;
  links: CompanyLink[];
  awards: CompanyImage[];
  colors: CompanyColors;
  credentials: string[];
  trustStats: string[];
  certifications: string[];
  workmanshipWarranty: string;
  workmanshipYears: number | null;
  financingLine: string;
  financing: { partner: string; applyUrl: string } | null;
  maintenancePlans: Array<{ name: string; text: string; tag?: string }>;
  serviceFacts: string[];
  promise: string;
  values: Array<{ title: string; text: string }>;
  story: { heading: string; paragraphs: string[]; signature: string; photoUrl: string; photoCaption: string } | null;
  whyUs: string[];
  community: string[];
  serviceArea: string;
  timeZone: string;
}

const DEFAULT_PRIMARY = '#1F3A5F';

const HEX_RE = /^#[0-9a-f]{6}$/i;

/** Darken a #rrggbb color by `amount` (0–1). */
export function darken(hex: string, amount: number): string {
  if (!HEX_RE.test(hex)) return hex;
  const n = parseInt(hex.slice(1), 16);
  const ch = (shift: number) => Math.max(0, Math.round(((n >> shift) & 255) * (1 - amount)));
  return `#${[16, 8, 0].map((s) => ch(s).toString(16).padStart(2, '0')).join('')}`;
}

const clean = (s: unknown): string => (typeof s === 'string' ? s.trim() : '');
const cleanList = (l: unknown): string[] => (Array.isArray(l) ? l.map(clean).filter(Boolean) : []);

/** A company row (or the parts of one) turned into a full profile. */
export function resolveCompanyProfile(company: {
  id: string;
  slug?: string | null;
  name: string;
  trade?: string | null;
  branding?: CompanyBranding | null;
  settings?: CompanySettings | null;
}): CompanyProfile {
  const b = company.branding ?? {};
  const s = company.settings ?? {};
  const displayName = clean(b.shortName) || clean(company.name) || 'Your company';
  const website = clean(b.website);
  const websiteUrl = website && !/^https?:\/\//i.test(website) ? `https://${website}` : website;
  const city = clean(b.city);
  const state = clean(b.state).toUpperCase();
  const primary = HEX_RE.test(clean(b.primaryColor)) ? clean(b.primaryColor) : DEFAULT_PRIMARY;
  const accent = HEX_RE.test(clean(b.accentColor)) ? clean(b.accentColor) : '#1F2937';
  const phone = clean(b.phone);
  const values = Array.isArray(s.values)
    ? s.values.map((v) => ({ title: clean(v?.title), text: clean(v?.text) })).filter((v) => v.title && v.text)
    : [];
  const story = s.story && clean(s.story.heading) && cleanList(s.story.paragraphs).length
    ? {
      heading: clean(s.story.heading),
      paragraphs: cleanList(s.story.paragraphs),
      signature: clean(s.story.signature),
      photoUrl: /^https?:\/\//i.test(clean(s.story.photoUrl)) ? clean(s.story.photoUrl) : '',
      photoCaption: clean(s.story.photoCaption),
    }
    : null;
  const financing = s.financing && clean(s.financing.partner) && /^https:\/\//i.test(clean(s.financing.applyUrl))
    ? { partner: clean(s.financing.partner), applyUrl: clean(s.financing.applyUrl) }
    : null;
  const plans = Array.isArray(s.maintenancePlans)
    ? s.maintenancePlans.map((p) => ({ name: clean(p?.name), text: clean(p?.text), ...(clean(p?.tag) ? { tag: clean(p?.tag) } : {}) })).filter((p) => p.name && p.text)
    : [];
  return {
    id: company.id,
    slug: clean(company.slug),
    trade: clean(company.trade) || 'roofing',
    displayName,
    legalName: clean(b.legalName) || clean(company.name) || displayName,
    tagline: clean(b.tagline),
    phone,
    phoneDigits: phone.replace(/[^\d+]/g, ''),
    email: clean(b.email),
    website: websiteUrl,
    websiteLabel: websiteUrl.replace(/^https?:\/\//i, '').replace(/\/$/, ''),
    address: clean(b.address),
    city,
    state,
    zip: clean(b.zip),
    cityState: [city, state].filter(Boolean).join(', '),
    licenses: cleanList(b.licenses),
    foundedYear: typeof b.foundedYear === 'number' && b.foundedYear > 1800 ? b.foundedYear : null,
    logoUrl: clean(b.logoUrl),
    reviewUrl: clean(b.reviewUrl),
    links: Array.isArray(b.links) ? b.links.filter((l) => clean(l?.label) && /^https?:\/\//i.test(clean(l?.url))) : [],
    awards: Array.isArray(b.awards) ? b.awards.filter((a) => /^https?:\/\//i.test(clean(a?.src))) : [],
    colors: {
      primary,
      primaryDark: darken(primary, 0.3),
      accent,
      surface: '#FFFFFF',
      muted: '#F3F4F6',
      text: '#111827',
      subtext: '#4B5563',
      success: '#059669',
      warning: '#D97706',
      danger: '#DC2626',
    },
    credentials: cleanList(s.credentials),
    trustStats: cleanList(s.trustStats),
    certifications: cleanList(s.certifications),
    workmanshipWarranty: clean(s.workmanshipWarranty),
    workmanshipYears: typeof s.workmanshipYears === 'number' && s.workmanshipYears > 0 ? Math.round(s.workmanshipYears) : null,
    financingLine: clean(s.financingLine),
    financing,
    maintenancePlans: plans,
    serviceFacts: cleanList(s.serviceFacts),
    promise: clean(s.promise),
    values,
    story,
    whyUs: cleanList(s.whyUs),
    community: cleanList(s.community),
    serviceArea: clean(s.serviceArea),
    timeZone: clean(s.timeZone) || 'America/New_York',
  };
}

/** Display name for a company, preferring the short name when one is set. */
export function companyDisplayName(company: { name: string; branding?: CompanyBranding | null }): string {
  return company.branding?.shortName?.trim() || company.name;
}

/** Name for the top of documents. */
export function companyLegalName(company: { name: string; branding?: CompanyBranding | null }): string {
  return company.branding?.legalName?.trim() || company.name;
}

/** Company statuses that may sign in and run background work. */
export const LIVE_STATUSES = ['trial', 'active'] as const;

export const isLiveCompany = (c: { status: string } | null | undefined): boolean =>
  !!c && (LIVE_STATUSES as readonly string[]).includes(c.status);
