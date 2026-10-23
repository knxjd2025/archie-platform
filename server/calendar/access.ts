/**
 * Whose Google Calendar a booking lands on, and whose calendars a person may
 * see on the Schedule tab.
 *
 * Every active roster member's mailbox is synced (sync/calendar-sync.ts), so a
 * rep books onto their OWN calendar; anyone not on the roster with a company
 * mailbox books onto the office calendar. Visibility follows the role's data
 * scope (self / team / all) — plus a per-person "sees all calendars" switch,
 * kept in the settings table, for someone like a cold caller who books
 * appointments for the whole team and needs everyone's free slots.
 */
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { settings } from '../../shared/schema';
import { memberByEmail, visibleEmailsFor } from '../access/team-scope';
import type { SessionUser } from '../access/rep-scope';
import { delegatedDomainForCurrentCompany } from '../integrations/google-workspace';
import { currentProfile } from '../tenant/context';

export const SEE_ALL_KEY = 'calendar.seeAll';

/** The company's Google Workspace domain, when the operator delegated one; '' otherwise. */
export const companyDomain = (): string => delegatedDomainForCurrentCompany() ?? '';

/** The office's own mailbox and calendar: the company email on its profile. */
export const officeMailbox = (): string => currentProfile().email.toLowerCase();

/** Pure: a roster member with a mailbox on the company's domain books on their own calendar. */
export function calendarFor(email: string, isActiveMember: boolean, domain: string, office: string): string {
  const e = (email || '').trim().toLowerCase();
  return isActiveMember && !!domain && e.endsWith(`@${domain}`) ? e : office;
}

/**
 * Who an email from this person goes out as: themselves when they are an
 * active team member, otherwise the office. Whether it goes through Google or
 * the company's GHL is decided when it is sent (integrations/company-mail.ts).
 */
export async function sendingMailboxFor(email: string): Promise<string> {
  const e = (email || '').trim().toLowerCase();
  const me = await memberByEmail(e).catch(() => null);
  return me?.active ? e : officeMailbox();
}

export async function bookingCalendarFor(email: string): Promise<string> {
  const me = await memberByEmail((email || '').toLowerCase()).catch(() => null);
  return calendarFor(email, !!me?.active, companyDomain(), officeMailbox());
}

export async function calendarSeeAllEmails(): Promise<string[]> {
  const [row] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, SEE_ALL_KEY));
  const v = row?.value;
  return Array.isArray(v) ? v.map((x) => String(x).toLowerCase()) : [];
}

export async function setCalendarSeeAll(email: string, on: boolean): Promise<string[]> {
  const e = email.toLowerCase();
  const current = await calendarSeeAllEmails();
  const next = on ? Array.from(new Set([...current, e])) : current.filter((x) => x !== e);
  await db.insert(settings).values({ key: SEE_ALL_KEY, value: next, updatedAt: new Date() })
    .onConflictDoUpdate({ target: [settings.companyId, settings.key], set: { value: next, updatedAt: new Date() } });
  return next;
}

/** Pure: null means every calendar. */
export function visibleCalendars(email: string, seeAll: string[], scoped: string[] | null): string[] | null {
  if (seeAll.includes((email || '').toLowerCase())) return null;
  return scoped;
}

export async function visibleCalendarsFor(user: SessionUser): Promise<string[] | null> {
  const [seeAll, scoped] = await Promise.all([calendarSeeAllEmails().catch(() => []), visibleEmailsFor(user)]);
  return visibleCalendars(user.email, seeAll, scoped);
}
