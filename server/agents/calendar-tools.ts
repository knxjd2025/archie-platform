/**
 * Live Google Calendar access for the team assistant.
 *
 * Reads the signed-in user's OWN primary calendar through the same
 * domain-wide-delegated service account that backs Gmail and Drive. Always
 * scoped to the caller's mailbox, so a rep can ask about their own day without
 * seeing anyone else's calendar.
 *
 * This is deliberately separate from get_schedule, which reads the
 * `appointments` mirror table and is therefore a TEAM-WIDE view (manager+).
 * The mirror is also only as fresh as the last sync; this is live.
 */
import { getDelegatedCalendar } from '../integrations/google-workspace';

const DAY_MS = 864e5;
const DEFAULT_DAYS = 7;
const MAX_RESULTS = 50;

/** Parse an ISO-ish date, returning null rather than an Invalid Date. */
function parseDate(v: string | undefined): Date | null {
  if (!v || typeof v !== 'string') return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Resolve the query window — defaults to "now through a week out".
 *
 * An unparseable date falls back to the default rather than throwing: a model
 * that passes "next Tuesday" should get a sane week of events, not an error.
 * A backwards window (to before from) would return nothing from Google, which
 * reads as "you have no appointments" — the most dangerous wrong answer this
 * tool can give — so it is widened forward instead.
 */
export function calendarWindow(
  from: string | undefined,
  to: string | undefined,
  now: Date = new Date(),
): { timeMin: string; timeMax: string } {
  const start = parseDate(from) ?? now;
  const end = parseDate(to);
  const fallbackEnd = new Date(start.getTime() + DEFAULT_DAYS * DAY_MS);
  const safeEnd = end && end.getTime() > start.getTime() ? end : fallbackEnd;
  return { timeMin: start.toISOString(), timeMax: safeEnd.toISOString() };
}

export interface RawEvent {
  summary?: string | null;
  location?: string | null;
  status?: string | null;
  start?: { dateTime?: string | null; date?: string | null } | null;
  end?: { dateTime?: string | null; date?: string | null } | null;
  attendees?: Array<{ email?: string | null; responseStatus?: string | null }> | null;
}

export interface CalendarItem {
  title: string;
  start: string;
  end: string;
  /** date-only events (no time component) — "all day" on the calendar */
  allDay: boolean;
  location?: string;
  attendees: string[];
}

/**
 * Normalize one Google event. Returns null for events the assistant should not
 * report: cancelled ones, and anything with no start time (malformed).
 */
export function shapeEvent(ev: RawEvent): CalendarItem | null {
  if (!ev || ev.status === 'cancelled') return null;
  const startRaw = ev.start?.dateTime || ev.start?.date;
  if (!startRaw) return null;
  return {
    title: ev.summary || '(no title)',
    start: startRaw,
    end: ev.end?.dateTime || ev.end?.date || '',
    // A date-only start means Google is describing an all-day event.
    allDay: !ev.start?.dateTime,
    location: ev.location || undefined,
    attendees: (ev.attendees || []).map((a) => a?.email).filter((e): e is string => !!e),
  };
}

/**
 * Read the signed-in user's OWN Google Calendar (live, via delegation).
 * Fails soft to {error} so a calendar outage degrades the answer instead of
 * breaking the whole chat turn.
 */
export async function readCalendar(
  mailbox: string,
  opts: { from?: string; to?: string; limit?: number } = {},
): Promise<CalendarItem[] | { error: string }> {
  try {
    if (!mailbox) return { error: 'no mailbox for the signed-in user' };
    const { timeMin, timeMax } = calendarWindow(opts.from, opts.to);
    const cal = getDelegatedCalendar(mailbox);
    const res = await cal.events.list({
      // 'primary' resolves to the impersonated user's own calendar.
      calendarId: 'primary',
      timeMin,
      timeMax,
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: Math.min(Math.max(opts.limit || 25, 1), MAX_RESULTS),
    });
    return ((res.data.items || []) as RawEvent[])
      .map(shapeEvent)
      .filter((e): e is CalendarItem => !!e);
  } catch (e: any) {
    return { error: e?.message || 'could not read the calendar' };
  }
}
