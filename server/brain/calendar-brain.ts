/**
 * Calendar watcher for the Ops Brain. Reads each team member's primary Google
 * calendar via the same domain-wide-delegated service account as Gmail (the
 * Workspace admin authorized the calendar scope alongside the gmail ones).
 *
 * Unlike gmail/ghl ingest, calendar findings are DETERMINISTIC — like the claims
 * sweep, they bypass LLM triage and upsert loops directly:
 *   - appointment_conflict: two timed events on the same calendar overlap (7-day window)
 *   - appointment_stale_confirmed: a customer-facing appointment starts within 36h —
 *     nudge the owner to confirm it with the customer
 * Loops self-close when the signal resolves (event moved, cancelled, or passed).
 */
import { google } from 'googleapis';
import { TEAM, type Person, type Urgency } from './types';
import { upsertLoop, closeLoopByKey, makeDedupeKey, getOpenLoops, type LoopInput } from './loop-store';
import { GOOGLE_TIMEOUT_MS } from './gmail-delegated';

const HOUR_MS = 3_600_000;
const CONFLICT_WINDOW_MS = 7 * 24 * HOUR_MS;
const CONFIRM_WINDOW_MS = 36 * HOUR_MS;
const TEAM_DOMAIN = '@bestroofingnow.com';
const CUSTOMER_KEYWORDS = /estimate|inspection|roof|appt|appointment|install|adjuster|repair|claim/i;

export function getDelegatedCalendar(mailbox: string) {
  const key = Buffer.from(process.env.GOOGLE_SA_KEY || '', 'base64').toString('utf8');
  const jwt = new google.auth.JWT({
    email: process.env.GOOGLE_SA_EMAIL,
    key,
    // Must exactly match a scope string authorized in the Workspace admin
    // delegation grant — calendar.readonly is NOT in that grant, /auth/calendar is.
    scopes: ['https://www.googleapis.com/auth/calendar'],
    subject: mailbox,
  });
  // Same per-request cap as Gmail (see GOOGLE_TIMEOUT_MS): calendar reads run
  // inside the hourly sweep and sync, and googleapis has no default timeout.
  return google.calendar({ version: 'v3', auth: jwt, timeout: GOOGLE_TIMEOUT_MS });
}

export interface CalEvent {
  id: string;
  mailbox: string;
  title: string;
  start: Date;
  end: Date;
  allDay: boolean;
  location?: string;
  /** attendee emails outside the company domain */
  externalAttendees: string[];
  /** true when the event has at least one attendee (internal or external) */
  hasAttendees: boolean;
}

interface GoogleApiEvent {
  id?: string | null;
  status?: string | null;
  summary?: string | null;
  location?: string | null;
  transparency?: string | null;
  start?: { date?: string | null; dateTime?: string | null } | null;
  end?: { date?: string | null; dateTime?: string | null } | null;
  attendees?: Array<{ email?: string | null; responseStatus?: string | null; self?: boolean | null }> | null;
}

/** null = event doesn't participate in any finding (cancelled, declined by the
 *  owner, marked free/transparent, or missing times). */
export function normalizeGoogleEvent(raw: GoogleApiEvent, mailbox: string): CalEvent | null {
  if (!raw.id || raw.status === 'cancelled') return null;
  if (raw.transparency === 'transparent') return null; // "free" — FYI/holiday, not a commitment
  const self = (raw.attendees ?? []).find((a) => a.self);
  if (self?.responseStatus === 'declined') return null;
  const startStr = raw.start?.dateTime ?? raw.start?.date;
  const endStr = raw.end?.dateTime ?? raw.end?.date;
  if (!startStr || !endStr) return null;
  const attendees = raw.attendees ?? [];
  return {
    id: raw.id,
    mailbox,
    title: raw.summary?.trim() || '(untitled)',
    start: new Date(startStr),
    end: new Date(endStr),
    allDay: !raw.start?.dateTime,
    location: raw.location ?? undefined,
    externalAttendees: attendees
      .map((a) => (a.email ?? '').toLowerCase())
      .filter((e) => e && !e.endsWith(TEAM_DOMAIN) && !e.endsWith('.calendar.google.com')),
    hasAttendees: attendees.length > 0,
  };
}

/** Overlapping pairs of timed events on the same calendar. All-day events are
 *  excluded — they "overlap" everything without meaning a double-booking. Only
 *  events that look like real commitments (attendees or a location) participate:
 *  live-data testing showed bare-titled blocks ("Payday Reminder", "Site Sprint")
 *  are self-organization, and flagging overlaps against them is pure noise. */
export function findConflicts(events: CalEvent[]): Array<[CalEvent, CalEvent]> {
  const timed = events
    .filter((e) => !e.allDay && (e.hasAttendees || Boolean(e.location)))
    .sort((a, b) => a.start.getTime() - b.start.getTime());
  const pairs: Array<[CalEvent, CalEvent]> = [];
  for (let i = 0; i < timed.length; i++) {
    for (let j = i + 1; j < timed.length; j++) {
      if (timed[j].start.getTime() >= timed[i].end.getTime()) break; // sorted — no later event can overlap i
      if (timed[i].id !== timed[j].id) pairs.push([timed[i], timed[j]]);
    }
  }
  return pairs;
}

/** An appointment worth confirming with a customer: someone outside the company
 *  is invited, or an attendee-less event whose title says roofing work. Location
 *  alone is deliberately NOT a signal — live data showed personal appointments
 *  (gym, massage) carry locations and made "confirm this" nudges pure noise. */
export function isCustomerFacing(ev: CalEvent): boolean {
  if (ev.externalAttendees.length > 0) return true;
  if (ev.hasAttendees) return false; // internal-only meeting
  // Emoji-prefixed titles are James's planning blocks ("🔨 Site Sprint",
  // "💰 Pipeline Harvest") — never customer appointments, even with keywords.
  if (/^[^\x00-\x7F]/.test(ev.title)) return false;
  return CUSTOMER_KEYWORDS.test(ev.title);
}

function fmt(d: Date): string {
  return d.toLocaleString('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

/** Stable regardless of which event Google returns first. */
export function conflictRef(mailbox: string, a: CalEvent, b: CalEvent): string {
  const [x, y] = [a.id, b.id].sort();
  return `${mailbox}:${x}+${y}`;
}

export interface CalendarFindings {
  loops: LoopInput[];
  /** dedupe keys of every finding that currently exists — open calendar loops
   *  NOT in this set have resolved and self-close. */
  keys: Set<string>;
}

export function calendarFindings(byPerson: Partial<Record<Exclude<Person, 'unassigned'>, CalEvent[]>>, now: Date): CalendarFindings {
  const loops: LoopInput[] = [];
  const keys = new Set<string>();

  for (const [person, events] of Object.entries(byPerson) as Array<[Exclude<Person, 'unassigned'>, CalEvent[]]>) {
    const upcoming = events.filter((e) => e.end.getTime() > now.getTime());

    for (const [a, b] of findConflicts(upcoming)) {
      if (a.start.getTime() - now.getTime() > CONFLICT_WINDOW_MS) continue;
      const sourceRef = conflictRef(a.mailbox, a, b);
      loops.push({
        kind: 'appointment_conflict',
        source: 'calendar',
        sourceRef,
        summary: `${person} is double-booked: "${a.title}" (${fmt(a.start)}) overlaps "${b.title}" (${fmt(b.start)})`,
        owner: person,
        urgency: a.start.getTime() - now.getTime() <= 48 * HOUR_MS ? 'urgent' : 'normal',
        dueAt: a.start,
      });
      keys.add(makeDedupeKey('appointment_conflict', 'calendar', sourceRef));
    }

    for (const ev of upcoming) {
      if (ev.allDay || !isCustomerFacing(ev)) continue;
      const untilStart = ev.start.getTime() - now.getTime();
      if (untilStart <= 0 || untilStart > CONFIRM_WINDOW_MS) continue;
      const sourceRef = `${ev.mailbox}:${ev.id}`;
      const urgency: Urgency = untilStart <= 24 * HOUR_MS ? 'urgent' : 'normal';
      const contactEmail = ev.externalAttendees[0];
      loops.push({
        kind: 'appointment_stale_confirmed',
        source: 'calendar',
        sourceRef,
        summary: `Confirm upcoming appointment: "${ev.title}" ${fmt(ev.start)}${ev.location ? ` @ ${ev.location}` : ''}`,
        owner: person,
        urgency,
        dueAt: new Date(ev.start.getTime() - 2 * HOUR_MS),
        contact: contactEmail ? { email: contactEmail } : undefined,
      });
      keys.add(makeDedupeKey('appointment_stale_confirmed', 'calendar', sourceRef));
    }
  }
  return { loops, keys };
}

export interface CalendarSweepResult {
  opened: number;
  closed: number;
  errors: string[];
}

export async function sweepCalendar(now: Date): Promise<CalendarSweepResult> {
  const byPerson: Partial<Record<Exclude<Person, 'unassigned'>, CalEvent[]>> = {};
  const errors: string[] = [];
  const fetchFailed = new Set<Person>();

  for (const person of Object.keys(TEAM) as Array<Exclude<Person, 'unassigned'>>) {
    const mailbox = TEAM[person].email;
    try {
      const cal = getDelegatedCalendar(mailbox);
      const res = await cal.events.list({
        calendarId: 'primary',
        timeMin: now.toISOString(),
        timeMax: new Date(now.getTime() + CONFLICT_WINDOW_MS).toISOString(),
        singleEvents: true,
        orderBy: 'startTime',
        maxResults: 250,
      });
      byPerson[person] = (res.data.items ?? [])
        .map((e) => normalizeGoogleEvent(e as GoogleApiEvent, mailbox))
        .filter((e): e is CalEvent => e !== null);
    } catch (e: any) {
      fetchFailed.add(person);
      errors.push(`calendar ${mailbox}: ${String(e?.message ?? e).slice(0, 150)}`);
    }
  }

  const { loops, keys } = calendarFindings(byPerson, now);
  let opened = 0;
  for (const loop of loops) {
    const { created } = await upsertLoop(loop);
    if (created) opened++;
  }

  // Self-close: a calendar loop whose finding no longer exists has resolved
  // (event moved, cancelled, or already happened). Never self-close loops owned
  // by a person whose calendar fetch FAILED this sweep — absence of data is not
  // absence of the conflict.
  let closed = 0;
  for (const loop of await getOpenLoops()) {
    if (loop.source !== 'calendar') continue;
    if (fetchFailed.has(loop.owner)) continue;
    if (keys.has(loop.dedupeKey)) continue;
    if (await closeLoopByKey(loop.dedupeKey, 'calendar:self-close')) closed++;
  }

  return { opened, closed, errors };
}
