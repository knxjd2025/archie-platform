/**
 * Due dates that are really calendar days, held in a timestamp column.
 *
 * A claim's next-action due date is picked as a day ("2026-10-16"), but the
 * column is a timestamp. Rows written before the server learned to store a
 * bare date as noon Eastern time hold UTC midnight, which every US zone
 * shows as the evening before — the card read "due Oct 15" and went red at
 * 8pm on the 15th. Read every stored value back as the Eastern day it means
 * (etToday, shared/schedule-board — the zone the server stores days in).
 */
import { etToday } from '../../../shared/schedule-board';

const UTC_MIDNIGHT = /^\d{4}-\d{2}-\d{2}T00:00:00(\.000)?Z$/;

/** The YYYY-MM-DD day a stored due value stands for, or null if unreadable. */
export function dueDay(iso: string | null | undefined): string | null {
  if (!iso) return null;
  // A bare date, or a legacy UTC-midnight row: the date written is the day meant.
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso) || UTC_MIDNIGHT.test(iso)) return iso.slice(0, 10);
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return etToday(d);
}

/** Overdue only once the due day has passed in Eastern time — due today is not late. */
export function isDueDayPast(iso: string | null | undefined, now: Date = new Date()): boolean {
  const day = dueDay(iso);
  return !!day && day < etToday(now);
}
