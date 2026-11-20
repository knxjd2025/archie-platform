/**
 * The words and the arranging behind the crew screens (Stage D): the job
 * page's install box, the crew week and the crew's own phone view.
 * Pure, so it is tested without a browser (__tests__/crews-view.test.ts).
 *
 * Dates are the company's calendar dates ('YYYY-MM-DD'), as the server sends
 * them. "Today" is the company's today, which the server sends too.
 */
import { installDays, installSpanLabel, mayScheduleCrews, startTimeLabel, CREW_ROLE, CREW_STATUS_LABEL, type CrewStatus } from '../../../shared/crews';
import type { TeamRole } from '../../../shared/rbac';

export interface CrewJob {
  jobKey: string;
  customer: string | null;
  jobName: string | null;
  jobType: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  crewName: string | null;
  installDate: string;
  endDate: string | null;
  startTime: string | null;
  status: CrewStatus;
  statusLabel: string;
  notes: string | null;
  trades: Array<{ key: string; label: string; done: boolean }>;
  currentTrade: string | null;
}

export interface WeekInstall {
  id: string;
  crewId: string;
  jobKey: string;
  customer: string | null;
  jobName: string | null;
  city: string | null;
  installDate: string;
  endDate: string | null;
  startTime: string | null;
  status: CrewStatus;
}

export const CREW_WORDS = {
  myJobs: 'My jobs',
  noCrew: 'You are not on a crew yet. The office puts you on one.',
  noJobs: 'No jobs booked for your crew right now.',
  today: 'Today',
  comingUp: 'Coming up',
  done: 'Finished lately',
  start: 'Start this job',
  finish: 'Mark job done',
  finishCheck: 'Mark this job done? The office will see it is finished.',
  tradeDone: (label: string) => `${label} finished`,
  photos: 'Photos',
  addPhoto: 'Take or add a photo',
  saving: 'Saving...',
  saved: 'Photo saved',
  notes: 'From the office',
  directions: 'Directions',
  back: 'All my jobs',
  week: 'Crew week',
  board: 'Board',
  unbooked: 'Waiting for an install date',
  noUnbooked: 'Every job on the board has an install booked.',
  book: 'Book install',
  crews: 'Crews',
  newCrew: 'New crew',
  noCrews: 'No crews yet. Make one, then put your Production people on it.',
  noPeople: 'Nobody on the Production role yet. Add crew members on the Team page with the Production role.',
  install: 'Install',
  noInstall: 'No install booked yet.',
  save: 'Save',
  saveDone: 'Install saved',
  clear: 'Take off the schedule',
  clearCheck: 'Take this job off the schedule?',
  cleared: 'Taken off the schedule',
} as const;

/** The address on one line, for the screen and for a map search. */
export function addressLine(j: Pick<CrewJob, 'address' | 'city' | 'state' | 'zip'>): string {
  const town = [j.city, [j.state, j.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  return [j.address, town].filter(Boolean).join(', ');
}

/** A map search for the address, opened by the phone's own map app. Null with no address. */
export function directionsUrl(j: Pick<CrewJob, 'address' | 'city' | 'state' | 'zip'>): string | null {
  const line = addressLine(j);
  return line ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(line)}` : null;
}

/** 'Mon, Nov 23 · 7:30 AM' or 'Mon, Nov 23 to Wed, Nov 25'. */
export function whenLine(j: Pick<CrewJob, 'installDate' | 'endDate' | 'startTime'>): string {
  const t = startTimeLabel(j.startTime);
  return t ? `${installSpanLabel(j)} · starts ${t}` : installSpanLabel(j);
}

/** The crew's jobs in three groups: on today (or still going), coming up, finished lately. */
export function groupCrewJobs(jobs: CrewJob[], today: string): { today: CrewJob[]; comingUp: CrewJob[]; done: CrewJob[] } {
  const out = { today: [] as CrewJob[], comingUp: [] as CrewJob[], done: [] as CrewJob[] };
  for (const j of jobs) {
    if (j.status === 'done') out.done.push(j);
    else if (j.status === 'in_progress' || installDays(j).includes(today) || j.installDate < today) out.today.push(j);
    else out.comingUp.push(j);
  }
  const byDate = (a: CrewJob, b: CrewJob) => a.installDate.localeCompare(b.installDate) || (a.startTime ?? '').localeCompare(b.startTime ?? '');
  out.today.sort(byDate); out.comingUp.sort(byDate); out.done.sort((a, b) => -byDate(a, b));
  return out;
}

/** The installs in one crew's row on one day of the week. */
export function installsOn(installs: WeekInstall[], crewId: string, date: string): WeekInstall[] {
  return installs.filter((i) => i.crewId === crewId && installDays(i).includes(date));
}

/** What a crew member may press next on a job, if anything. */
export function nextCrewStep(status: CrewStatus): 'in_progress' | 'done' | null {
  if (status === 'scheduled') return 'in_progress';
  if (status === 'in_progress') return 'done';
  return null;
}

export const statusLabel = (s: CrewStatus) => CREW_STATUS_LABEL[s];

/** The colour of a status chip. */
export const STATUS_CHIP: Record<CrewStatus, string> = {
  scheduled: 'bg-sky-100 text-sky-800',
  in_progress: 'bg-amber-100 text-amber-800',
  done: 'bg-emerald-100 text-emerald-800',
};

/**
 * Which crew screens a person sees. Only in a company Roof Lee made: every
 * other company sees none of them, whatever the role, so its screens are
 * exactly as before. A crew member lands on their jobs (crewHome); office
 * staff and up get the install box and the crew week.
 */
export function crewScreensFor(madeByRoofli: boolean, role: TeamRole | string | null | undefined): { crewHome: boolean; booking: boolean } {
  if (!madeByRoofli) return { crewHome: false, booking: false };
  return { crewHome: role === CREW_ROLE, booking: mayScheduleCrews(role as TeamRole) };
}
