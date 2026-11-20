/**
 * Crews and install dates for a job Archie keeps itself (Stage D,
 * docs/archie/02-roof-lee-link.md, "Crews and install dates").
 *
 * Pure rules, shared by the server (server/crews/) and the screens: what an
 * install booking must hold, which status moves a crew may make, the week a
 * date falls in, and who counts as a crew sign-in.
 *
 * Every date here is a calendar date in the COMPANY's time zone
 * ('YYYY-MM-DD'), never an instant: an install on the 12th is on the 12th
 * wherever the phone that shows it happens to be. Today's date comes from
 * etToday in shared/schedule-board.ts, which reads the company's own zone.
 *
 * Crews never see money. Nothing in this file names a price, and the crew's
 * own screens are built from crewJobView (server/crews/view.ts), an allow-list.
 */
import { atLeast, type TeamRole } from './rbac';

export const CREW_STATUSES = ['scheduled', 'in_progress', 'done'] as const;
export type CrewStatus = (typeof CREW_STATUSES)[number];
export const isCrewStatus = (v: unknown): v is CrewStatus => typeof v === 'string' && (CREW_STATUSES as readonly string[]).includes(v);

/** What a person sees for each status. */
export const CREW_STATUS_LABEL: Record<CrewStatus, string> = {
  scheduled: 'Scheduled',
  in_progress: 'Working on it',
  done: 'Done',
};

/**
 * The moments Roof Lee will later be told about (Stage E, job.milestone).
 * Archie only records them for now.
 */
export const JOB_MILESTONES = ['install_scheduled', 'install_started', 'install_done'] as const;
export type JobMilestone = (typeof JOB_MILESTONES)[number];

/** The milestone a status change records, if any. */
export function milestoneForStatus(to: CrewStatus): JobMilestone | null {
  if (to === 'in_progress') return 'install_started';
  if (to === 'done') return 'install_done';
  return null;
}

/** May a crew member move their own job from one status to another? Forward only, one step at a time. */
export function crewMayMove(from: CrewStatus, to: CrewStatus): boolean {
  if (from === to) return true;
  return (from === 'scheduled' && to === 'in_progress') || (from === 'in_progress' && to === 'done');
}

/** Who may set up crews, book installs and see the crew week: office staff and up, never a salesperson or a crew. */
export function mayScheduleCrews(role: TeamRole | null | undefined): boolean {
  return !!role && role !== 'production' && atLeast(role, 'customer_service');
}

/** A crew member is a team member whose role is Production. */
export const CREW_ROLE: TeamRole = 'production';

/**
 * Does this team member take a crew sign-in? Crew sign-ins are priced on
 * their own (billing is the Archie team's, not here): this is the one
 * question billing asks to count them. Active, allowed to sign in, and on
 * the Production role.
 */
export function isCrewSeat(m: { role: string | null | undefined; active?: boolean | null; canLogin?: boolean | null }): boolean {
  return m.role === CREW_ROLE && m.active !== false && m.canLogin === true;
}

/** How many crew sign-ins a team has (see isCrewSeat). */
export function countCrewSeats(members: Array<Parameters<typeof isCrewSeat>[0]>): number {
  return members.filter(isCrewSeat).length;
}

// ---------------------------------------------------------------- dates

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** A real calendar date written 'YYYY-MM-DD'. */
export function isIsoDate(v: unknown): v is string {
  if (typeof v !== 'string' || !DATE_RE.test(v)) return false;
  const d = new Date(`${v}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/** A start time written 'HH:MM' on a 24 hour clock. */
export const isStartTime = (v: unknown): v is string => typeof v === 'string' && TIME_RE.test(v);

/** The calendar date n days after a date (n may be negative). Pure date arithmetic, no time zone. */
export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Whole days from a to b (b - a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000);
}

/** The Monday of the week a date falls in. */
export function weekStartOf(date: string): string {
  const dow = new Date(`${date}T12:00:00Z`).getUTCDay(); // 0 Sunday .. 6 Saturday
  return addDays(date, dow === 0 ? -6 : 1 - dow);
}

/** The seven dates of the week starting on a Monday. */
export function weekDates(monday: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

/** Every date an install covers, first to last. */
export function installDays(a: { installDate: string; endDate?: string | null }): string[] {
  const last = a.endDate && a.endDate > a.installDate ? a.endDate : a.installDate;
  const n = Math.min(daysBetween(a.installDate, last), MAX_INSTALL_DAYS - 1);
  return Array.from({ length: n + 1 }, (_, i) => addDays(a.installDate, i));
}

/** '07:30' as '7:30 AM'. */
export function startTimeLabel(t: string | null | undefined): string | null {
  if (!isStartTime(t)) return null;
  const [h, m] = t.split(':').map(Number);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

/** 'Mon, Nov 23' for a calendar date, the same wherever the screen is. */
export function installDayLabel(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

/** 'Mon, Nov 23' or 'Mon, Nov 23 to Wed, Nov 25'. */
export function installSpanLabel(a: { installDate: string; endDate?: string | null }): string {
  const first = installDayLabel(a.installDate);
  return a.endDate && a.endDate > a.installDate ? `${first} to ${installDayLabel(a.endDate)}` : first;
}

// ---------------------------------------------------------------- an install booking

/** The longest install one booking covers. */
export const MAX_INSTALL_DAYS = 14;
export const MAX_CREW_NOTES = 1000;
export const MAX_CREW_NAME = 60;

export const PICK_CREW = 'Pick a crew.';
export const PICK_INSTALL_DATE = 'Pick an install date.';
export const END_BEFORE_START = 'The last day can\'t be before the first day.';
export const INSTALL_TOO_LONG = `One install can cover at most ${MAX_INSTALL_DAYS} days.`;
export const PICK_START_TIME = 'Pick a start time, or leave it empty.';
export const CREW_NOTES_TOO_LONG = `Notes for the crew can be at most ${MAX_CREW_NOTES} characters.`;
export const CREW_NAME_NEEDED = 'Give the crew a name.';
export const CREW_NAME_TOO_LONG = `A crew name can be at most ${MAX_CREW_NAME} characters.`;

export interface InstallBooking {
  crewId: string;
  installDate: string;
  endDate: string | null;
  startTime: string | null;
  notes: string | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const isCrewId = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v);

/** Read an install booking an office person sent. Every refusal is one plain sentence. */
export function checkInstallBooking(input: unknown): { ok: true; value: InstallBooking } | { ok: false; error: string } {
  const b = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  if (!isCrewId(b.crewId)) return { ok: false, error: PICK_CREW };
  if (!isIsoDate(b.installDate)) return { ok: false, error: PICK_INSTALL_DATE };
  let endDate: string | null = null;
  if (b.endDate !== undefined && b.endDate !== null && b.endDate !== '') {
    if (!isIsoDate(b.endDate)) return { ok: false, error: END_BEFORE_START };
    if (b.endDate < b.installDate) return { ok: false, error: END_BEFORE_START };
    if (daysBetween(b.installDate, b.endDate) >= MAX_INSTALL_DAYS) return { ok: false, error: INSTALL_TOO_LONG };
    endDate = b.endDate === b.installDate ? null : b.endDate;
  }
  let startTime: string | null = null;
  if (b.startTime !== undefined && b.startTime !== null && b.startTime !== '') {
    if (!isStartTime(b.startTime)) return { ok: false, error: PICK_START_TIME };
    startTime = b.startTime;
  }
  let notes: string | null = null;
  if (b.notes !== undefined && b.notes !== null) {
    if (typeof b.notes !== 'string') return { ok: false, error: CREW_NOTES_TOO_LONG };
    const t = b.notes.trim();
    if (t.length > MAX_CREW_NOTES) return { ok: false, error: CREW_NOTES_TOO_LONG };
    notes = t || null;
  }
  return { ok: true, value: { crewId: b.crewId, installDate: b.installDate, endDate, startTime, notes } };
}

/** Read a crew name. */
export function checkCrewName(v: unknown): { ok: true; value: string } | { ok: false; error: string } {
  const t = typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '';
  if (!t) return { ok: false, error: CREW_NAME_NEEDED };
  if (t.length > MAX_CREW_NAME) return { ok: false, error: CREW_NAME_TOO_LONG };
  return { ok: true, value: t };
}

/** Does a change to a booking count as scheduling it again (a new install_scheduled milestone)? */
export function isReschedule(before: Pick<InstallBooking, 'crewId' | 'installDate' | 'endDate' | 'startTime'> | null, after: Pick<InstallBooking, 'crewId' | 'installDate' | 'endDate' | 'startTime'>): boolean {
  if (!before) return true;
  return before.crewId !== after.crewId || before.installDate !== after.installDate
    || (before.endDate ?? null) !== (after.endDate ?? null) || (before.startTime ?? null) !== (after.startTime ?? null);
}
