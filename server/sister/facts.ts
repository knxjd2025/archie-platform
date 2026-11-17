/**
 * What Archie takes from a Roof Lee company's confirmed facts.
 *
 * Roof Lee sends only what the company has confirmed about itself, grouped
 * under ten headings. The names under each heading are the company's own
 * (free text, tidied), so there is no fixed list to map. This takes the few it
 * can place without guessing and leaves the rest as data (the whole set is
 * kept on the company, see ./companies.ts).
 *
 * Two rules:
 *   - Archie never words a claim. A credential or warranty is shown only in
 *     the company's own confirmed words. A bare yes, or a number, is a fact
 *     but not a sentence, so it is not turned into one.
 *   - Anything that is not the shape expected is ignored, never an error.
 */
import type { CompanyBranding, CompanySettings } from '../../shared/company';

export interface FactsInput {
  city: string | null | undefined;
  state: string | null | undefined;
  timezone: string | null | undefined;
  facts: Record<string, unknown> | undefined;
}

export interface MappedFacts {
  branding: Partial<CompanyBranding>;
  settings: Partial<CompanySettings>;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[\d\s()+.x-]{7,30}$/i;
const WEBSITE_RE = /^(https?:\/\/)?[a-z0-9-]+(\.[a-z0-9-]+)+(\/[^\s]*)?$/i;
const MAX_CREDENTIALS = 12;

/** Trimmed text of at most `max` characters, or undefined. */
function text(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const t = value.trim();
  return t && t.length <= max ? t : undefined;
}

/** One heading's facts as a plain name-to-value map, or {} when it is anything else. */
function group(facts: Record<string, unknown> | undefined, heading: string): Record<string, unknown> {
  const g = facts && Object.hasOwn(facts, heading) ? facts[heading] : undefined;
  return g && typeof g === 'object' && !Array.isArray(g) ? (g as Record<string, unknown>) : {};
}

/** The first of these names the group holds a value for. */
function pick(g: Record<string, unknown>, ...names: string[]): unknown {
  for (const name of names) if (Object.hasOwn(g, name) && g[name] != null) return g[name];
  return undefined;
}

function year(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : typeof value === 'string' && /^\d{4}$/.test(value.trim()) ? Number(value.trim()) : NaN;
  return Number.isInteger(n) && n > 1800 && n <= new Date().getFullYear() ? n : undefined;
}

/** True for an IANA zone name this runtime knows. */
export function isTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || !value.trim() || value.length > 64) return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: value }); return true; } catch { return false; }
}

/** Every piece of confirmed text in a group: text values, and text inside lists. */
function sentences(g: Record<string, unknown>, max: number): string[] {
  const out: string[] = [];
  for (const value of Object.values(g)) {
    for (const item of Array.isArray(value) ? value : [value]) {
      const t = text(item, max);
      if (t && !out.includes(t)) out.push(t);
    }
  }
  return out;
}

export function mapCompanyFacts(input: FactsInput): MappedFacts {
  const branding: Partial<CompanyBranding> = {};
  const settings: Partial<CompanySettings> = {};

  const city = text(input.city, 120);
  if (city) branding.city = city;
  const state = text(input.state, 2);
  if (state && /^[a-z]{2}$/i.test(state)) branding.state = state.toUpperCase();

  const identity = group(input.facts, 'identity');
  const legalName = text(pick(identity, 'legal_name'), 200);
  if (legalName) branding.legalName = legalName;
  const shortName = text(pick(identity, 'short_name'), 80);
  if (shortName) branding.shortName = shortName;
  const tagline = text(pick(identity, 'tagline'), 200);
  if (tagline) branding.tagline = tagline;
  const founded = year(pick(identity, 'founded_year', 'founded', 'year_founded'));
  if (founded) branding.foundedYear = founded;

  const contact = group(input.facts, 'contact');
  const phone = text(pick(contact, 'phone', 'office_phone', 'main_phone'), 30);
  if (phone && PHONE_RE.test(phone)) branding.phone = phone;
  const email = text(pick(contact, 'email', 'office_email'), 200);
  if (email && EMAIL_RE.test(email)) branding.email = email.toLowerCase();
  const website = text(pick(contact, 'website', 'url'), 200);
  if (website && WEBSITE_RE.test(website)) branding.website = website;

  const credentials = sentences(group(input.facts, 'credentials'), 200).slice(0, MAX_CREDENTIALS);
  if (credentials.length) settings.credentials = credentials;

  const warranties = group(input.facts, 'warranties');
  const workmanship = text(pick(warranties, 'workmanship', 'workmanship_warranty'), 200);
  if (workmanship) settings.workmanshipWarranty = workmanship;
  const years = pick(warranties, 'workmanship_years');
  if (typeof years === 'number' && Number.isInteger(years) && years > 0 && years <= 100) settings.workmanshipYears = years;

  const area = group(input.facts, 'service_area');
  const summary = text(pick(area, 'summary', 'description'), 300);
  const towns = pick(area, 'towns', 'cities');
  const townList = Array.isArray(towns) ? towns.map((t) => text(t, 80)).filter((t): t is string => !!t) : [];
  const serviceArea = summary ?? (townList.length ? text(townList.join(', '), 300) : undefined);
  if (serviceArea) settings.serviceArea = serviceArea;

  if (isTimeZone(input.timezone)) settings.timeZone = input.timezone;

  return { branding, settings };
}
