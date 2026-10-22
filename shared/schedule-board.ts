/**
 * Pure helpers for the availability board (server/calendar/board.ts serves the
 * data, client/src/components/AvailabilityBoard.tsx draws it). Everything is
 * in Charlotte time, whatever timezone the viewer's device is set to.
 */
export const BOARD_TZ = 'America/New_York';
export const DAY_START_HOUR = 7;
export const DAY_END_HOUR = 20;
export const SLOT_MINS = 30;

export interface BoardEventLike { id: string; person: string; start: string; end: string; allDay: boolean; source: 'google' | 'ghl' | 'both'; title: string }

const partsFmt = new Intl.DateTimeFormat('en-US', { timeZone: BOARD_TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/** Charlotte calendar date (YYYY-MM-DD) and minutes after midnight for an instant. */
export function etParts(iso: string | Date): { date: string; minutes: number } {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  const p = Object.fromEntries(partsFmt.formatToParts(d).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
}

/** Today's Charlotte date. */
export function etToday(now: Date = new Date()): string {
  return etParts(now).date;
}

/** The UTC offset (e.g. "-04:00") Charlotte is on at a given local date and time. */
export function etOffset(date: string, time = '12:00'): string {
  // Try both US Eastern offsets; the right one maps back to the same wall time.
  for (const off of ['-04:00', '-05:00']) {
    const p = etParts(new Date(`${date}T${time}:00${off}`));
    if (p.date === date && p.minutes === hhmmToMinutes(time)) return off;
  }
  return '-05:00';
}

/** The instant for a Charlotte date + HH:mm. */
export function etInstant(date: string, time: string): Date {
  return new Date(`${date}T${time}:00${etOffset(date, time)}`);
}

export function hhmmToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + (m || 0);
}

export function minutesToHhmm(m: number): string {
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

export function label12(m: number): string {
  const h = Math.floor(m / 60); const mm = m % 60;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${mm ? `:${String(mm).padStart(2, '0')}` : ''} ${h < 12 ? 'AM' : 'PM'}`;
}

/** Add days to a YYYY-MM-DD date. */
export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * The same appointment often shows up twice: booked in GoHighLevel and pushed
 * to the rep's Google Calendar by GHL's calendar sync. Same person, same start
 * and end (to the minute) is one appointment, shown once and marked "both".
 */
export function mergeDuplicates<T extends BoardEventLike>(events: T[]): T[] {
  const out: T[] = [];
  const minute = (s: string) => Math.round(new Date(s).getTime() / 60000);
  for (const e of events) {
    const twin = out.find((o) => o.person === e.person && o.source !== e.source && o.source !== 'both'
      && minute(o.start) === minute(e.start) && minute(o.end) === minute(e.end));
    if (twin) { twin.source = 'both'; continue; }
    out.push({ ...e });
  }
  return out;
}

export interface PlacedEvent<T> { event: T; top: number; height: number; col: number; cols: number; clippedBefore: boolean; clippedAfter: boolean }

/**
 * Where each timed event sits in one person's column for one day: minutes from
 * the top of the grid, and side-by-side columns when appointments overlap.
 */
export function layoutDay<T extends BoardEventLike>(events: T[], date: string, startHour = DAY_START_HOUR, endHour = DAY_END_HOUR): PlacedEvent<T>[] {
  const gridStart = startHour * 60; const gridEnd = endHour * 60;
  const dayStart = etInstant(date, '00:00').getTime();
  const items = events
    .filter((e) => !e.allDay)
    .map((e) => {
      const s = (new Date(e.start).getTime() - dayStart) / 60000;
      const en = Math.max((new Date(e.end).getTime() - dayStart) / 60000, s + 15);
      return { e, s, en };
    })
    .filter((x) => x.en > gridStart && x.s < gridEnd)
    .sort((a, b) => a.s - b.s || b.en - a.en);

  const placed: PlacedEvent<T>[] = [];
  let cluster: typeof placed = [];
  let clusterEnd = -Infinity;
  const colEnds: number[] = [];
  const flush = () => { const n = Math.max(1, ...cluster.map((p) => p.col + 1)); cluster.forEach((p) => { p.cols = n; }); cluster = []; colEnds.length = 0; };
  for (const x of items) {
    if (x.s >= clusterEnd) { flush(); clusterEnd = -Infinity; }
    let col = colEnds.findIndex((end) => end <= x.s);
    if (col === -1) { col = colEnds.length; colEnds.push(x.en); } else colEnds[col] = x.en;
    const top = Math.max(x.s, gridStart) - gridStart;
    const bottom = Math.min(x.en, gridEnd) - gridStart;
    const p: PlacedEvent<T> = { event: x.e, top, height: Math.max(bottom - top, 15), col, cols: 1, clippedBefore: x.s < gridStart, clippedAfter: x.en > gridEnd };
    placed.push(p); cluster.push(p);
    clusterEnd = Math.max(clusterEnd, x.en);
  }
  flush();
  return placed;
}

/**
 * Timed appointments on this person's calendar that a new booking would
 * overlap. All-day items (holidays, reminders) don't block a slot; the board
 * shows them above the day so the booker still sees "Out of office".
 */
export function conflictsFor<T extends BoardEventLike>(events: T[], person: string, date: string, time: string, durationMins: number): T[] {
  const s = etInstant(date, time).getTime(); const e = s + durationMins * 60000;
  return events.filter((ev) => ev.person === person && !ev.allDay && new Date(ev.start).getTime() < e && new Date(ev.end).getTime() > s);
}

/** Open half-hour slots for a person on a day (inside working hours, not in the past, long enough for the duration). */
export function openSlots<T extends BoardEventLike>(events: T[], person: string, date: string, durationMins: number, now: Date = new Date()): string[] {
  const out: string[] = [];
  const nowMs = now.getTime();
  for (let m = DAY_START_HOUR * 60; m + durationMins <= DAY_END_HOUR * 60; m += SLOT_MINS) {
    const t = minutesToHhmm(m);
    if (etInstant(date, t).getTime() < nowMs) continue;
    if (conflictsFor(events, person, date, t, durationMins).length === 0) out.push(t);
  }
  return out;
}

/**
 * The next few days of a person's real open time: each day with the half-hour
 * starts that are still free on their calendar. Days that are fully booked (or
 * already over) come back with no times rather than being dropped, so the
 * booker sees "Thu — nothing open" instead of a day that silently vanished.
 */
export function openDays<T extends BoardEventLike>(
  events: T[], person: string, fromDate: string, days: number, durationMins: number, now: Date = new Date(),
): Array<{ date: string; times: string[] }> {
  return Array.from({ length: Math.max(days, 0) }, (_, i) => {
    const date = addDays(fromDate, i);
    return { date, times: openSlots(events, person, date, durationMins, now) };
  });
}

/** "Today" / "Tomorrow" / "Fri Sep 19" for a Charlotte date. */
export function dayLabel(date: string, today: string = etToday()): string {
  if (date === today) return 'Today';
  if (date === addDays(today, 1)) return 'Tomorrow';
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

/** "2:30 PM" for an HH:mm. */
export function timeLabel(time: string): string {
  return label12(hhmmToMinutes(time));
}
