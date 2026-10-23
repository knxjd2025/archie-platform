/**
 * The availability board: every calendar a person may see, side by side,
 * with what is on it — live from Google Calendar for each company mailbox
 * (falling back to the hourly-synced rows if Google is slow), plus each
 * person's GoHighLevel appointments when a GHL user carries the same email.
 * The point is that someone booking for the team (the cold caller, the
 * office) sees who is free when, and books there with a click.
 */
import { and, gte, inArray, lte } from 'drizzle-orm';
import { db } from '../db';
import { appointments, teamMembers } from '../../shared/schema';
import { getDelegatedCalendar } from '../integrations/google-workspace';
import { GoHighLevelClient } from '../integrations/gohighlevel';
import { classifyKind } from '../sync/calendar-map';
import { visibleCalendarsFor, companyDomain } from './access';
import { mergeDuplicates } from '../../shared/schedule-board';
import type { SessionUser } from '../access/rep-scope';

export interface BoardPerson {
  email: string;
  name: string;
  role: string;
  /** Synced through the Google Workspace delegation (company mailbox). */
  google: boolean;
  /** Matched to a GoHighLevel user by email. */
  ghl: boolean;
  jobtreadSalesRep: string | null;
}

export interface BoardEvent {
  id: string;
  person: string;
  /** 'both' = the same appointment is in GoHighLevel and on the Google calendar. */
  source: 'google' | 'ghl' | 'both';
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  address: string | null;
  kind: string;
  status?: string | null;
}

export interface BoardWarning { person: string; source: 'google' | 'ghl'; message: string }

const GOOGLE_TIMEOUT_MS = 6000;

const SELLING_ROLES = new Set(['sales', 'sales_director', 'manager']);

/** Pure: someone appointments get booked for — a sales role, or anyone (the owner included) who carries a JobTread Sales Rep name. */
export function sells(m: { role: string; jobtreadSalesRep: string | null }): boolean {
  return SELLING_ROLES.has(m.role) || !!(m.jobtreadSalesRep && m.jobtreadSalesRep.trim());
}

/**
 * Pure: which roster members a session sees on the board. null visible =
 * everyone. By default only the people appointments are booked for (the
 * sales reps and James); `everyone` adds the office calendars.
 */
export function boardPeople(
  roster: Array<{ email: string; name: string; role: string; active: boolean; jobtreadSalesRep: string | null }>,
  visible: string[] | null,
  ghlEmails: Set<string>,
  everyone = false,
  domain = '',
): BoardPerson[] {
  return roster
    .filter((m) => m.active)
    .filter((m) => everyone || sells(m))
    .filter((m) => visible === null || visible.includes(m.email.toLowerCase()))
    .map((m) => ({
      email: m.email.toLowerCase(), name: m.name, role: m.role,
      google: !!domain && m.email.toLowerCase().endsWith(`@${domain}`), ghl: ghlEmails.has(m.email.toLowerCase()),
      jobtreadSalesRep: m.jobtreadSalesRep,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Pure: does an event overlap the window? */
export function overlaps(ev: { start: string; end: string }, from: Date, to: Date): boolean {
  return new Date(ev.start) < to && new Date(ev.end) > from;
}

/** Pure: a Google event as the board shows it, or null for cancelled/free-time events. */
export function fromGoogleEvent(ev: any, person: string): BoardEvent | null {
  if (!ev?.id || ev.status === 'cancelled' || ev.transparency === 'transparent') return null;
  const startRaw = ev.start?.dateTime || ev.start?.date;
  const endRaw = ev.end?.dateTime || ev.end?.date || startRaw;
  if (!startRaw) return null;
  const allDay = !ev.start?.dateTime;
  return {
    id: `google:${person}:${ev.id}`, person, source: 'google', title: ev.summary || '(busy)',
    start: new Date(startRaw).toISOString(), end: new Date(endRaw).toISOString(), allDay,
    address: ev.location || null, kind: classifyKind(ev.summary || ''),
  };
}

/** Pure: a GoHighLevel appointment as the board shows it. */
export function fromGhlEvent(ev: any, person: string): BoardEvent | null {
  if (!ev?.id || !ev.startTime) return null;
  if (ev.deleted) return null;
  const status = String(ev.appointmentStatus || '').toLowerCase();
  if (status === 'cancelled' || status === 'noshow' || status === 'invalid') return null;
  const start = new Date(ev.startTime); const end = ev.endTime ? new Date(ev.endTime) : new Date(start.getTime() + 3600e3);
  if (isNaN(start.getTime())) return null;
  return {
    id: `ghl:${ev.id}`, person, source: 'ghl', title: ev.title || 'GHL appointment',
    start: start.toISOString(), end: end.toISOString(), allDay: false,
    address: ev.address || null, kind: classifyKind(ev.title || ''), status: ev.appointmentStatus || null,
  };
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

async function googleEventsFor(person: BoardPerson, from: Date, to: Date): Promise<BoardEvent[]> {
  const cal = getDelegatedCalendar(person.email);
  const r = await withTimeout(cal.events.list({ calendarId: person.email, timeMin: from.toISOString(), timeMax: to.toISOString(), singleEvents: true, orderBy: 'startTime', maxResults: 250 }), GOOGLE_TIMEOUT_MS);
  return ((r.data.items ?? []) as any[]).map((ev) => fromGoogleEvent(ev, person.email)).filter((e): e is BoardEvent => !!e);
}

async function syncedEventsFor(emails: string[], from: Date, to: Date): Promise<BoardEvent[]> {
  if (!emails.length) return [];
  const rows = await db.select().from(appointments)
    .where(and(inArray(appointments.calendarSource, emails), gte(appointments.start, from), lte(appointments.start, to)));
  return rows.filter((r) => r.start).map((r) => ({
    id: `google:${r.calendarSource}:${r.sourceId.split(':').slice(1).join(':')}`, person: String(r.calendarSource).toLowerCase(), source: 'google' as const,
    title: r.title || '(busy)', start: r.start!.toISOString(), end: (r.end ?? new Date(r.start!.getTime() + 3600e3)).toISOString(),
    allDay: false, address: r.address, kind: r.kind || 'other',
  }));
}

async function ghlUsersByEmail(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    const r: any = await withTimeout(new GoHighLevelClient().getUsers(), GOOGLE_TIMEOUT_MS);
    for (const u of r?.users ?? []) if (u?.id && u?.email && !u.deleted) map.set(String(u.email).toLowerCase(), String(u.id));
  } catch { /* GHL unavailable → no GHL lanes; the board still works from Google */ }
  return map;
}

export async function loadBoard(user: SessionUser, from: Date, to: Date, everyone = false): Promise<{ people: BoardPerson[]; events: BoardEvent[]; warnings: BoardWarning[]; canSeeEveryone: boolean }> {
  const [visible, roster, ghlUsers] = await Promise.all([
    visibleCalendarsFor(user),
    db.select({ email: teamMembers.email, name: teamMembers.name, role: teamMembers.role, active: teamMembers.active, jobtreadSalesRep: teamMembers.jobtreadSalesRep }).from(teamMembers),
    ghlUsersByEmail(),
  ]);
  const people = boardPeople(roster, visible, new Set(ghlUsers.keys()), everyone, companyDomain());
  // Only worth offering "show office calendars" when there are some to add.
  const canSeeEveryone = boardPeople(roster, visible, new Set(), true).length > boardPeople(roster, visible, new Set(), false).length;
  const warnings: BoardWarning[] = [];
  const events: BoardEvent[] = [];

  const googleResults = await Promise.allSettled(people.filter((p) => p.google).map((p) => googleEventsFor(p, from, to).then((evs) => ({ p, evs }))));
  const fallback: string[] = [];
  googleResults.forEach((r, i) => {
    const p = people.filter((x) => x.google)[i];
    if (r.status === 'fulfilled') events.push(...r.value.evs);
    else { fallback.push(p.email); warnings.push({ person: p.email, source: 'google', message: `Live calendar unavailable (${String((r.reason as any)?.message || r.reason).slice(0, 80)}); showing the last sync.` }); }
  });
  if (fallback.length) events.push(...(await syncedEventsFor(fallback, from, to).catch(() => [])));

  const ghl = new GoHighLevelClient();
  const ghlResults = await Promise.allSettled(people.filter((p) => p.ghl).map(async (p) => {
    const r: any = await withTimeout(ghl.getUserAppointments({ userId: ghlUsers.get(p.email)!, startTime: from.getTime(), endTime: to.getTime() }), GOOGLE_TIMEOUT_MS);
    return { p, evs: ((r?.events ?? []) as any[]).map((ev) => fromGhlEvent(ev, p.email)).filter((e): e is BoardEvent => !!e && overlaps(e, from, to)) };
  }));
  ghlResults.forEach((r, i) => {
    const p = people.filter((x) => x.ghl)[i];
    if (r.status === 'fulfilled') events.push(...r.value.evs);
    else warnings.push({ person: p.email, source: 'ghl', message: 'GoHighLevel appointments unavailable right now.' });
  });

  const merged = mergeDuplicates(events.filter((e) => overlaps(e, from, to)));
  merged.sort((a, b) => a.start.localeCompare(b.start));
  return { people, events: merged, warnings, canSeeEveryone };
}

/** Pure: may this session book on that calendar? Their own always; otherwise it must be one they can see. */
export function canBookOn(user: { email: string }, target: string, visible: string[] | null): boolean {
  const t = target.toLowerCase();
  if (t === user.email.toLowerCase()) return true;
  return visible === null || visible.includes(t);
}
