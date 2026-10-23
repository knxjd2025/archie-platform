/**
 * Monday morning, prepared on Sunday.
 *
 * Four meetings run back to back and each one wants different numbers in front
 * of it. The app already holds all of them — leads, the three pipelines,
 * commission, follow-ups — so the pack assembles itself on Sunday evening and
 * is on screen when the room sits down.
 *
 * The times are the company's, written down once here so the page, the cron
 * and the agendas all agree about what Monday looks like.
 *
 * Pure: no imports, no I/O. Shared by the server, the cron and the app.
 */
import { boardTz } from './schedule-board';

export type MeetingKey = 'leadership' | 'claims' | 'sales' | 'payroll';

/** Who is in the room, and therefore who may open its page. */
export type MeetingAudience = 'admin' | 'sales_plus' | 'everyone';

/** One item in a meeting's running order, with the minutes it is given. */
export interface AgendaItem { title: string; minutes: number; note?: string }

export interface MeetingDef {
  key: MeetingKey;
  label: string;
  /** Minutes from midnight, so ordering and length need no date parsing. */
  startMin: number;
  endMin: number;
  audience: MeetingAudience;
  /** One line on what the meeting is for — printed at the top of its page. */
  purpose: string;
  /**
   * The running order. Written down so the meeting has a shape before anybody
   * walks in, and so it is obvious when one item has eaten another's time.
   * The minutes total the meeting's length — `agendaFits` keeps that honest.
   */
  runningOrder: AgendaItem[];
}

const at = (h: number, m = 0) => h * 60 + m;

export const MEETINGS: readonly MeetingDef[] = [
  {
    key: 'leadership',
    label: 'Leadership',
    startMin: at(8), endMin: at(9, 30),
    audience: 'admin',
    purpose: 'Where the company stands, and the handful of things that need a decision today.',
    runningOrder: [
      { title: 'Segue', minutes: 5, note: 'One personal win, one business win — round the room' },
      { title: 'Scorecard', minutes: 5, note: 'Each number against its goal. Off track goes on the issues list, it is not discussed here' },
      { title: 'Rocks', minutes: 5, note: 'This quarter\'s priorities, on or off track. Off track goes on the issues list' },
      { title: 'Headlines', minutes: 5, note: 'Customer and team news, good and bad — headlines only' },
      { title: 'To-dos', minutes: 5, note: 'Last week\'s seven-day commitments. The bar is 90% done' },
      { title: 'IDS — identify, discuss, solve', minutes: 60, note: 'Pick the top three off the issues list and solve them one at a time. Everything the pack flags lands here' },
      { title: 'Conclude', minutes: 5, note: 'Recap the to-dos, agree what cascades to the team, rate the meeting 1–10' },
    ],
  },
  {
    key: 'claims',
    label: 'Claims',
    startMin: at(9, 30), endMin: at(10, 30),
    audience: 'sales_plus',
    purpose: 'Every open claim, what it is waiting on, and which ones have gone quiet.',
    runningOrder: [
      { title: 'Scorecard', minutes: 5, note: 'Filed, approved, still waiting — each against its goal' },
      { title: 'Headlines', minutes: 5, note: 'Carrier news worth the room knowing' },
      { title: 'To-dos', minutes: 5, note: 'Last week\'s commitments on these claims' },
      { title: 'IDS — identify, discuss, solve', minutes: 40, note: 'Gone quiet, stuck with the carrier, disputes — top three, one at a time, each ends in a next step' },
      { title: 'Conclude', minutes: 5, note: 'Recap the to-dos and rate the meeting 1–10' },
    ],
  },
  {
    key: 'sales',
    label: 'Sales',
    startMin: at(10, 30), endMin: at(12),
    audience: 'everyone',
    purpose: 'Last week by rep, what is in the pipeline, and what each person is chasing this week.',
    runningOrder: [
      { title: 'Segue', minutes: 5, note: 'One personal win, one business win — round the room' },
      { title: 'Scorecard', minutes: 10, note: 'Every rep\'s numbers against their goals. Off track goes on the issues list' },
      { title: 'Rocks', minutes: 5, note: 'This quarter\'s sales priorities, on or off track' },
      { title: 'Headlines', minutes: 5, note: 'Customer news, wins and losses — headlines only' },
      { title: 'To-dos', minutes: 5, note: 'Last week\'s seven-day commitments. The bar is 90% done' },
      { title: 'IDS — identify, discuss, solve', minutes: 55, note: 'Empty diaries, overdue follow-ups, customers waiting — top three, one at a time. Sharpening lives here too' },
      { title: 'Conclude', minutes: 5, note: 'Recap the to-dos, agree what cascades, rate the meeting 1–10' },
    ],
  },
  {
    key: 'payroll',
    label: 'Payroll',
    startMin: at(12), endMin: at(13),
    audience: 'admin',
    purpose: 'What is owed, what is approved and unpaid, and what is waiting on a number.',
    runningOrder: [
      { title: 'Approved and unpaid', minutes: 10, note: 'What goes out today' },
      { title: 'Ready to approve', minutes: 15 },
      { title: 'Missing a number', minutes: 15, note: 'No revenue filed, or no lead source — chase the rep' },
      { title: 'Questions from the team', minutes: 15 },
      { title: 'Actions and close', minutes: 5 },
    ],
  },
];

export const MEETING_BY_KEY = new Map(MEETINGS.map((m) => [m.key, m]));
export const isMeetingKey = (v: unknown): v is MeetingKey =>
  typeof v === 'string' && MEETING_BY_KEY.has(v as MeetingKey);

/** "8:00 – 9:30 am" — the way it reads on an agenda, not on a clock face. */
export function meetingTime(m: MeetingDef): string {
  const fmt = (mins: number) => {
    const h24 = Math.floor(mins / 60);
    const h = h24 % 12 === 0 ? 12 : h24 % 12;
    const mm = mins % 60;
    return `${h}${mm ? `:${String(mm).padStart(2, '0')}` : ':00'}`;
  };
  const suffix = (mins: number) => (Math.floor(mins / 60) < 12 ? 'am' : 'pm');
  const a = suffix(m.startMin), b = suffix(m.endMin);
  return a === b ? `${fmt(m.startMin)} – ${fmt(m.endMin)} ${b}` : `${fmt(m.startMin)} ${a} – ${fmt(m.endMin)} ${b}`;
}

export const meetingMinutes = (m: MeetingDef): number => m.endMin - m.startMin;

// ---- Dates -----------------------------------------------------------------

/**
 * The Monday a pack belongs to, as YYYY-MM-DD.
 *
 * Read as a calendar day in the company's timezone rather than an instant:
 * the job runs on Sunday evening in the company's time zone, which is already Monday in UTC,
 * and a pack filed under the wrong day is a pack nobody finds.
 */
export function mondayFor(now: Date, timeZone = boardTz()): string {
  const local = new Date(now.toLocaleString('en-US', { timeZone }));
  const day = local.getDay();                 // 0 Sun … 6 Sat
  // Sunday looks forward to tomorrow; every other day looks back to this
  // week's Monday, so opening the page on Wednesday still shows Monday's pack.
  const delta = day === 0 ? 1 : 1 - day;
  const monday = new Date(local);
  monday.setDate(local.getDate() + delta);
  return ymd(monday);
}

export const ymd = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** The seven days the pack reports on: the Monday-to-Sunday week just finished. */
export function weekBefore(mondayIso: string): { from: string; to: string } {
  const [y, m, d] = mondayIso.split('-').map(Number);
  const monday = new Date(y, m - 1, d);
  const from = new Date(monday); from.setDate(monday.getDate() - 7);
  const to = new Date(monday); to.setDate(monday.getDate() - 1);
  return { from: ymd(from), to: ymd(to) };
}

/** "Monday, 22 September" — for the page heading. */
export function meetingDayLabel(mondayIso: string): string {
  const [y, m, d] = mondayIso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
  });
}

// ---- The shape of a pack ---------------------------------------------------

/** A number worth saying out loud, with last week's for comparison. */
export interface Metric {
  label: string;
  value: string;
  /** The same measure a week earlier, when there is one to compare against. */
  previous?: string;
  /** Positive means the direction people want. Null when direction is meaningless. */
  better?: boolean | null;
  hint?: string;
}

/** Something the meeting has to actually deal with, not just read. */
export interface Attention {
  text: string;
  /** Where to go in the app to deal with it. */
  page?: string;
  count?: number;
  /**
   * Stable name for the FINDING, independent of this week's numbers.
   *
   * The text carries a count ("12 live jobs have no rep…") which moves week to
   * week, so keying an auto-filed issue on the text would raise a brand new
   * issue every Monday and reset its age — destroying the one thing that makes
   * a chronic problem visible.
   */
  key?: string;
}

export interface MeetingSection {
  heading: string;
  metrics?: Metric[];
  attention?: Attention[];
  /** Free rows: rep names, claim lists, anything tabular. */
  rows?: { label: string; value: string; note?: string }[];
  /** Said when there is genuinely nothing to report, rather than showing an empty box. */
  empty?: string;
}

export interface MeetingAgenda {
  key: MeetingKey;
  sections: MeetingSection[];
}

export interface MeetingAction {
  id: number;
  meeting: MeetingKey;
  text: string;
  ownerEmail: string | null;
  ownerName?: string | null;
  dueDate: string | null;
  doneAt: string | null;
  createdBy: string;
  /** Set when the item came from an earlier week and is still open. */
  fromWeek?: string | null;
}

/** Everything the spine holds for one room, for the page that runs the meeting. */
export interface RepScorecardView {
  rep: { email: string; name: string };
  rows: ScorecardRow[];
}

export interface MeetingSpine {
  /**
   * The company's numbers. Admin only — total revenue closed is leadership's
   * business, not the whole room's — so this is empty for everyone else
   * rather than hidden by the page.
   */
  scorecard: ScorecardRow[];
  /**
   * Per-rep scorecards. An admin gets every rep; a rep gets exactly one, their
   * own. The scoping is done on the server, so a rep is never sent a colleague's
   * numbers for the page to decide not to draw.
   */
  repScorecards: RepScorecardView[];
  rocks: Rock[];
  /** Open issues, oldest-picked first. The room's work for the hour. */
  issues: MeetingIssue[];
  /** What the room picked to solve today. */
  top: MeetingIssue[];
  rating: { mine: number | null; average: number | null; count: number };
  todos: { done: number; total: number; pct: number | null; meetsBar: boolean };
}

export interface MeetingPack {
  mondayIso: string;
  generatedAt: string | null;
  weekFrom: string;
  weekTo: string;
  agendas: MeetingAgenda[];
  notes: Partial<Record<MeetingKey, string>>;
  actions: MeetingAction[];
  /** Still-open items from previous weeks, so nothing quietly drops. */
  carriedOver: MeetingAction[];
  /** Scorecard, rocks, issues and rating per room. Absent for payroll. */
  spine: Partial<Record<MeetingKey, MeetingSpine>>;
}

/** Which meetings this role may open. */
export function visibleMeetings(role: string): MeetingDef[] {
  const isAdmin = role === 'admin' || role === 'sales_director';
  const isSalesPlus = role !== 'production';
  return MEETINGS.filter((m) =>
    m.audience === 'everyone'
      ? true
      : m.audience === 'sales_plus'
        ? isSalesPlus
        : isAdmin);
}

export const canOpenMeeting = (role: string, key: MeetingKey): boolean =>
  visibleMeetings(role).some((m) => m.key === key);

/**
 * Does the running order fit the meeting?
 *
 * An agenda that adds up to more time than the meeting has is the commonest
 * way a meeting overruns, and it is checkable rather than a matter of opinion.
 */
export const agendaMinutes = (m: MeetingDef): number =>
  m.runningOrder.reduce((sum, i) => sum + i.minutes, 0);

export const agendaFits = (m: MeetingDef): boolean => agendaMinutes(m) <= meetingMinutes(m);

// ============================================================
// THE SPINE: SCORECARD, ROCKS, ISSUES, RATING
//
// The four meetings above are the meeting pulse; this is what runs inside
// them. Borrowed from EOS because the shape works, kept honest against the
// way this company already runs:
//
//  - a Scorecard number is only useful with a goal and one owner. "Down from
//    last week" cannot be argued with OR acted on; "6 against a goal of 10,
//    Dana's number" can be both.
//  - Rocks give the room a horizon past seven days. Everything else the pack
//    computes is this week or last week.
//  - Issues PERSIST. The pack recomputes its findings every Monday, so an
//    unsolved problem was never solved — it was just read out again. An issue
//    carries the week it first appeared, which is what makes a chronic one
//    impossible to keep nodding at.
//
// Still pure: no imports, no I/O.
// ============================================================

/** Which way a number is supposed to go. */
export type ScorecardDirection = 'at_least' | 'at_most';

export type ScorecardStatus = 'on' | 'off' | 'unset' | 'nodata';

/** A weekly measurable, as configured. */
export interface ScorecardMetricDef {
  key: string;
  label: string;
  meeting: MeetingKey;
  ownerEmail: string | null;
  /** Null until somebody sets one — which is a finding, not a default. */
  goal: number | null;
  direction: ScorecardDirection;
  unit: 'count' | 'money' | 'days';
  sortOrder: number;
}

/** A weekly measurable with this week's reading against it. */
export interface ScorecardRow extends ScorecardMetricDef {
  ownerName?: string | null;
  actual: number | null;
  previous?: number | null;
  status: ScorecardStatus;
}

/**
 * On track, off track, or neither.
 *
 * A metric with no goal is `unset` rather than on track: an unset goal is the
 * thing to fix, and defaulting it to a pass would hide exactly that.
 */
export function scorecardStatus(
  actual: number | null,
  goal: number | null,
  direction: ScorecardDirection,
): ScorecardStatus {
  if (goal === null || !Number.isFinite(goal)) return 'unset';
  if (actual === null || !Number.isFinite(actual)) return 'nodata';
  return direction === 'at_least'
    ? (actual >= goal ? 'on' : 'off')
    : (actual <= goal ? 'on' : 'off');
}

export type RockStatus = 'on_track' | 'off_track' | 'done';

/** A priority for the quarter, owned by exactly one person. */
export interface Rock {
  id: number;
  meeting: MeetingKey;
  title: string;
  ownerEmail: string | null;
  ownerName?: string | null;
  quarter: string;              // '2026-Q3'
  status: RockStatus;
  dueDate: string | null;
  notes: string | null;
}

/** '2026-Q3' for the quarter a date falls in. */
export function quarterOf(iso: string): string {
  const [y, m] = iso.split('-').map(Number);
  return `${y}-Q${Math.floor((m - 1) / 3) + 1}`;
}

export type IssueSource = 'manual' | 'scorecard' | 'rock' | 'pack';

/**
 * Something the room has to solve. Survives between Mondays: the pack will
 * happily recompute the same finding next week, and an issue that keeps
 * coming back is a different problem from one raised for the first time.
 */
export interface MeetingIssue {
  id: number;
  meeting: MeetingKey;
  title: string;
  detail: string | null;
  source: IssueSource;
  /** Stable per finding, so an auto-filed issue is raised once, not weekly. */
  sourceKey: string | null;
  raisedBy: string | null;
  raisedAt: string | null;
  /** The Monday this first appeared — the age that makes a chronic issue obvious. */
  firstSeenWeek: string | null;
  /** 1..3 once the room has picked it for this week. */
  priority: number | null;
  solvedAt: string | null;
  solvedNote: string | null;
  droppedAt: string | null;
}

export const isOpenIssue = (i: MeetingIssue): boolean => !i.solvedAt && !i.droppedAt;

/** Whole weeks an issue has been open by the given Monday. */
export function weeksOpen(firstSeenWeek: string | null, mondayIso: string): number {
  if (!firstSeenWeek) return 0;
  const [fy, fm, fd] = firstSeenWeek.split('-').map(Number);
  const [my, mm, md] = mondayIso.split('-').map(Number);
  if ([fy, fm, fd, my, mm, md].some((n) => !Number.isFinite(n))) return 0;
  const days = (Date.UTC(my, mm - 1, md) - Date.UTC(fy, fm - 1, fd)) / 86400000;
  return days <= 0 ? 0 : Math.floor(days / 7);
}

/**
 * What to work on: the room's own picks first, then the longest-suffering.
 * EOS takes three — more than that and none of them get solved.
 */
export function topIssues(issues: MeetingIssue[], mondayIso: string, take = 3): MeetingIssue[] {
  return issues
    .filter(isOpenIssue)
    .slice()
    .sort((a, b) => {
      const pa = a.priority ?? Infinity, pb = b.priority ?? Infinity;
      if (pa !== pb) return pa - pb;
      const wa = weeksOpen(a.firstSeenWeek, mondayIso), wb = weeksOpen(b.firstSeenWeek, mondayIso);
      if (wa !== wb) return wb - wa;
      return a.id - b.id;
    })
    .slice(0, take);
}

/** How many of last week's commitments actually landed. EOS calls 90% the bar. */
export const TODO_BAR = 0.9;

export function todoCompletion(actions: { doneAt: string | null }[]): {
  done: number; total: number; pct: number | null; meetsBar: boolean;
} {
  const total = actions.length;
  const done = actions.filter((a) => !!a.doneAt).length;
  const pct = total === 0 ? null : done / total;
  return { done, total, pct, meetsBar: pct === null ? true : pct >= TODO_BAR };
}

/** One person's score for one meeting. */
export interface MeetingRating { meeting: MeetingKey; monday: string; raterEmail: string; score: number; note: string | null }

export const isValidRating = (n: unknown): boolean =>
  typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 10;

/** The room's average, to one decimal. Null when nobody has rated it. */
export function averageRating(scores: number[]): number | null {
  const valid = scores.filter(isValidRating);
  if (!valid.length) return null;
  return Math.round((valid.reduce((s, n) => s + n, 0) / valid.length) * 10) / 10;
}

// ============================================================
// THE CLOCK
//
// An L10 is time-boxed or it is not an L10. The running order says IDS gets
// sixty of the ninety minutes; without something showing the room where it
// actually is, that stays an intention. This works out the position once, from
// the agenda and the current time, so the bar at the top of the page and any
// test can agree about it.
//
// Still pure: the caller supplies `now`.
// ============================================================

/** Minutes since midnight in the company's timezone, wherever the viewer is. */
export function minutesOfDay(now: Date, timeZone = boardTz()): number {
  const local = new Date(now.toLocaleString('en-US', { timeZone }));
  return local.getHours() * 60 + local.getMinutes() + local.getSeconds() / 60;
}

export interface ClockSegment {
  item: AgendaItem;
  /** Minutes from the meeting's start at which this item begins and ends. */
  startMin: number;
  endMin: number;
  /** Share of the bar's width, 0..1. The shares sum to 1. */
  share: number;
}

export interface MeetingClock {
  state: 'before' | 'running' | 'over';
  /** Minutes since the start time. Negative before the meeting begins. */
  elapsed: number;
  /** Minutes left in the meeting. Negative once it has overrun. */
  remaining: number;
  /** Where the running order says the room should be, or null outside the meeting. */
  currentIndex: number | null;
  currentItem: AgendaItem | null;
  /** Minutes spent in the current item, and minutes it has left. */
  intoItem: number;
  itemRemaining: number;
  /** How far through the meeting, clamped to 0..1, for the filled bar. */
  progress: number;
  segments: ClockSegment[];
}

/**
 * Where a meeting is right now.
 *
 * The timeline is the AGENDA's total rather than the meeting's wall-clock
 * length. They are equal for every meeting here — a test enforces it — but if
 * a running order is ever edited short, the segments should still fill the bar
 * rather than leaving a gap that looks like a rendering fault.
 */
export function meetingClock(m: MeetingDef, now: Date, timeZone = boardTz()): MeetingClock {
  const total = agendaMinutes(m) || meetingMinutes(m);
  let at = 0;
  const segments: ClockSegment[] = m.runningOrder.map((item) => {
    const startMin = at;
    at += item.minutes;
    return { item, startMin, endMin: at, share: total > 0 ? item.minutes / total : 0 };
  });

  const elapsed = minutesOfDay(now, timeZone) - m.startMin;
  const remaining = meetingMinutes(m) - elapsed;

  if (elapsed < 0) {
    return {
      state: 'before', elapsed, remaining, currentIndex: null, currentItem: null,
      intoItem: 0, itemRemaining: 0, progress: 0, segments,
    };
  }
  if (elapsed >= total) {
    const last = segments[segments.length - 1];
    return {
      state: 'over', elapsed, remaining, currentIndex: null, currentItem: null,
      intoItem: last ? elapsed - last.startMin : 0, itemRemaining: 0, progress: 1, segments,
    };
  }

  const currentIndex = segments.findIndex((s) => elapsed >= s.startMin && elapsed < s.endMin);
  const seg = segments[currentIndex];
  return {
    state: 'running',
    elapsed,
    remaining,
    currentIndex,
    currentItem: seg?.item ?? null,
    intoItem: seg ? elapsed - seg.startMin : 0,
    itemRemaining: seg ? seg.endMin - elapsed : 0,
    progress: total > 0 ? Math.min(1, Math.max(0, elapsed / total)) : 0,
    segments,
  };
}

/** "53m", "1h 04m" — for the countdown, which is read at a glance. */
export function shortDuration(mins: number): string {
  const n = Math.max(0, Math.round(mins));
  return n < 60 ? `${n}m` : `${Math.floor(n / 60)}h ${String(n % 60).padStart(2, '0')}m`;
}

/**
 * How hard the bar should push: calm, nearly out of time, or over.
 *
 * The warning is a PROPORTION of the item's own box, not a flat five minutes.
 * Six of the seven items in an L10 are five minutes long, so a flat threshold
 * held them amber from the moment they started — a warning that is always on
 * is not a warning. A fifth of the box, and never less than a minute: IDS goes
 * amber with twelve minutes left, a five-minute item with one.
 */
export function clockUrgency(c: MeetingClock): 'idle' | 'ok' | 'soon' | 'over' {
  if (c.state === 'before') return 'idle';
  if (c.state === 'over' || c.remaining < 0) return 'over';
  if (!c.currentItem) return 'ok';
  return c.itemRemaining <= Math.max(1, c.currentItem.minutes * 0.2) ? 'soon' : 'ok';
}
