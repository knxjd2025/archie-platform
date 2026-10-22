/**
 * Day, week and month boundaries in Charlotte time, for every screen that
 * counts "today" or "this week". Production runs on Vercel in UTC, so
 * `new Date(y, m, d)` there is UTC midnight — 8pm the evening before in
 * Charlotte — and anything a rep did after 8pm landed on tomorrow's numbers.
 * These build on the board's Eastern helpers so the two can never disagree.
 */
import { addDays, etInstant, etToday } from './schedule-board';

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** A real calendar date written YYYY-MM-DD ("2026-02-30" is not one). */
export function isIsoDate(v: unknown): v is string {
  if (typeof v !== 'string' || !YMD.test(v)) return false;
  const d = new Date(`${v}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/** 0 = Sunday … 6 = Saturday, for a YYYY-MM-DD date. */
export function dayOfWeek(date: string): number {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}

/** The Monday on or before a date — the playbook's week runs Monday to Sunday. */
export function mondayOf(date: string): string {
  return addDays(date, -((dayOfWeek(date) + 6) % 7));
}

/** The instant Charlotte's day began. */
export function etDayStart(now: Date = new Date()): Date {
  return etInstant(etToday(now), '00:00');
}

/** The Charlotte date of this week's Monday. */
export function etWeekStartDate(now: Date = new Date()): string {
  return mondayOf(etToday(now));
}

/** The instant this Monday-to-Sunday week began in Charlotte. */
export function etWeekStart(now: Date = new Date()): Date {
  return etInstant(etWeekStartDate(now), '00:00');
}

/** The instant this calendar month began in Charlotte. */
export function etMonthStart(now: Date = new Date()): Date {
  return etInstant(`${etToday(now).slice(0, 8)}01`, '00:00');
}

/** Every instant from the start of `fromDate` to the last millisecond of `toDate`, Charlotte days. */
export function etDateRange(fromDate: string, toDate: string): { from: Date; to: Date } {
  return { from: etInstant(fromDate, '00:00'), to: new Date(etInstant(addDays(toDate, 1), '00:00').getTime() - 1) };
}

/** The Charlotte date `n` days from today — a follow-up "due in two days" means two Charlotte days. */
export function etPlusDays(n: number, now: Date = new Date()): string {
  return addDays(etToday(now), n);
}
