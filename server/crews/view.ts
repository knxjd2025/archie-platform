/**
 * What a crew member is shown about a job: an ALLOW-LIST, built field by
 * field, so nothing a job carries reaches a crew unless it is named here.
 *
 * Crews never see money (docs/archie/02-roof-lee-link.md, "Crews and install
 * dates"): no projected value, estimate, price, invoice, deposit, payment
 * tick or commission. The board's own checks (invoice sent, final payment
 * received) are left out too, and so are the lead's notes, which office staff
 * may have written a price into. The homeowner's phone and email are left out
 * until the owner decides crews may see them (open question D9).
 *
 * Pure: unit tested in ./__tests__/view.test.ts.
 */
import type { CrewAssignment, Lead } from '../../shared/schema';
import { CREW_STATUS_LABEL, isCrewStatus, type CrewStatus } from '../../shared/crews';
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
}

/** The exact keys a crew job carries. A test holds the view to this list. */
export const CREW_JOB_KEYS: readonly (keyof CrewJobView)[] = [
  'jobKey', 'customer', 'jobName', 'jobType', 'address', 'city', 'state', 'zip', 'crewName',
  'installDate', 'endDate', 'startTime', 'status', 'statusLabel', 'notes', 'trades', 'currentTrade',
];

const tradeLabel = (key: string) => TRADES.find((t) => t.key === key)?.label ?? key;

/** A whole name from a lead: Archie's own leads keep it in firstName. */
export function customerName(lead: Pick<Lead, 'firstName' | 'lastName'>): string | null {
  const first = lead.firstName?.trim() || '';
  const last = lead.lastName?.trim() || '';
  if (!first && !last) return null;
  return last && !first.toLowerCase().endsWith(last.toLowerCase()) ? `${first} ${last}`.trim() : first || last;
}

export function crewJobView(
  lead: Pick<Lead, 'firstName' | 'lastName' | 'jobName' | 'jobType' | 'serviceType' | 'address' | 'city' | 'state' | 'zip'>,
  assignment: Pick<CrewAssignment, 'jobKey' | 'installDate' | 'endDate' | 'startTime' | 'status' | 'notes'>,
  crewName: string | null,
  trades: Array<{ key: string; done: boolean }> | null,
): CrewJobView {
  const status: CrewStatus = isCrewStatus(assignment.status) ? assignment.status : 'scheduled';
  // The same order and the same "current" the board uses, so a tick here is the tick the board expects.
  const steps = normalizeTrades((trades ?? []).map((t) => t.key), (trades ?? []) as TradeStep[]);
  const list = steps.map((t) => ({ key: t.key, label: tradeLabel(t.key), done: t.done }));
  return {
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
}
