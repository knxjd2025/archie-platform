/**
 * Per-company settings that replace what used to be hardcoded for one roofing
 * company. Everything here is optional: the app falls back to neutral wording
 * when a company has not filled something in yet.
 */

/** How the company presents itself on reports, letters, emails and the app. */
export interface CompanyBranding {
  /** Name on documents, e.g. "Acme Roofing & Exteriors LLC". Defaults to companies.name. */
  legalName?: string;
  /** Short name used in sentences, e.g. "Acme". */
  shortName?: string;
  logoUrl?: string;
  /** Hex colors, e.g. "#1F3A5F". */
  primaryColor?: string;
  accentColor?: string;
  phone?: string;
  email?: string;
  website?: string;
  /** One line, e.g. "123 Main St, Charlotte, NC 28202". */
  address?: string;
  /** e.g. ["NC General Contractor #12345"]. */
  licenses?: string[];
  /** Year founded, for "serving you since" lines. */
  foundedYear?: number;
  /** Words the company uses for itself, e.g. "family-owned". */
  tagline?: string;
}

/** Facts and options the company controls. */
export interface CompanySettings {
  /** Manufacturer or trade certifications, e.g. ["GAF Master Elite"]. */
  certifications?: string[];
  /** Workmanship warranty in plain words, e.g. "10-year workmanship warranty". */
  workmanshipWarranty?: string;
  /** Reasons to choose the company, shown on reports ("Why us"). */
  whyUs?: string[];
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
