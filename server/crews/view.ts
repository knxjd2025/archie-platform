/**
 * What a crew member is shown about a job: an ALLOW-LIST, built field by
 * field, so nothing a job carries reaches a crew unless it is named here.
 *
 * Crews never see money (docs/archie/02-roof-lee-link.md, "Crews and install
 * dates"): no projected value, estimate, price, invoice, deposit, payment
 * tick or commission. The board's own checks (invoice sent, final payment
 * received) are left out too, and so are the lead's notes, which office staff
 * may have written a price into. The homeowner's email is never shown.
 *
 * The homeowner's phone (owner's decision D9): shown only for a job booked for
 * the crew (the routes reach this through crewJobFor alone), and only around
 * the install days: on the booking's install days only, through the end
 * of its last day (the first day when there is no last day), in the
 * company's own dates. Outside that window the field is left out entirely.
 *
 * Pure: unit tested in ./__tests__/view.test.ts.
 */
import type { CrewAssignment, Lead } from '../../shared/schema';
import { CREW_STATUS_LABEL, addDays, isIsoDate, isCrewStatus, type CrewStatus } from '../../shared/crews';
import { TRADES, currentTrade, normalizeTrades, type TradeStep } from '../../shared/production-pipeline';

export interface CrewTradeView { key: string; label: string; done: boolean }

export interface CrewJobView {
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
  trades: CrewTradeView[];
  currentTrade: string | null;
  /** Only inside the phone window (see phoneWindowOpen), and only when the job has one. */
  homeownerPhone?: string;
}

/** Days before the booking's first day that the homeowner's phone opens. */
export const PHONE_DAYS_BEFORE = 0;

/** The exact keys a crew job carries. A test holds the view to this list. */
export const CREW_JOB_KEYS: readonly (keyof CrewJobView)[] = [
  'jobKey', 'customer', 'jobName', 'jobType', 'address', 'city', 'state', 'zip', 'crewName',
  'installDate', 'endDate', 'startTime', 'status', 'statusLabel', 'notes', 'trades', 'currentTrade', 'homeownerPhone',
];

/**
 * Is today (the company's date, 'YYYY-MM-DD') inside the window a crew may see
 * the homeowner's phone: the first install day through the last day?
 */
export function phoneWindowOpen(a: { installDate: string; endDate?: string | null }, today: string): boolean {
  if (!isIsoDate(today) || !isIsoDate(a.installDate)) return false;
  const last = a.endDate && isIsoDate(a.endDate) && a.endDate > a.installDate ? a.endDate : a.installDate;
  return today >= addDays(a.installDate, -PHONE_DAYS_BEFORE) && today <= last;
}

const tradeLabel = (key: string) => TRADES.find((t) => t.key === key)?.label ?? key;

/** A whole name from a lead: Archie's own leads keep it in firstName. */
export function customerName(lead: Pick<Lead, 'firstName' | 'lastName'>): string | null {
  const first = lead.firstName?.trim() || '';
  const last = lead.lastName?.trim() || '';
  if (!first && !last) return null;
  return last && !first.toLowerCase().endsWith(last.toLowerCase()) ? `${first} ${last}`.trim() : first || last;
}

export function crewJobView(
  lead: Pick<Lead, 'firstName' | 'lastName' | 'jobName' | 'jobType' | 'serviceType' | 'address' | 'city' | 'state' | 'zip' | 'phone'>,
  assignment: Pick<CrewAssignment, 'jobKey' | 'installDate' | 'endDate' | 'startTime' | 'status' | 'notes'>,
  crewName: string | null,
  trades: Array<{ key: string; done: boolean }> | null,
  /** The company's today ('YYYY-MM-DD', from etToday), which opens or shuts the phone window. */
  today: string,
): CrewJobView {
  const status: CrewStatus = isCrewStatus(assignment.status) ? assignment.status : 'scheduled';
  // The same order and the same "current" the board uses, so a tick here is the tick the board expects.
  const steps = normalizeTrades((trades ?? []).map((t) => t.key), (trades ?? []) as TradeStep[]);
  const list = steps.map((t) => ({ key: t.key, label: tradeLabel(t.key), done: t.done }));
  const phone = lead.phone?.trim() || '';
  const view: CrewJobView = {
    jobKey: assignment.jobKey,
    customer: customerName(lead),
    jobName: lead.jobName ?? null,
    jobType: lead.jobType ?? lead.serviceType ?? null,
    address: lead.address ?? null,
    city: lead.city ?? null,
    state: lead.state ?? null,
    zip: lead.zip ?? null,
    crewName,
    installDate: assignment.installDate,
    endDate: assignment.endDate ?? null,
    startTime: assignment.startTime ?? null,
    status,
    statusLabel: CREW_STATUS_LABEL[status],
    notes: assignment.notes ?? null,
    trades: list,
    currentTrade: currentTrade(steps),
  };
  if (phone && phoneWindowOpen(assignment, today)) view.homeownerPhone = phone;
  return view;
}
