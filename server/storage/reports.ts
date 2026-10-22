import { and, asc, desc, eq, gt, gte, inArray, lt, lte, type SQL } from 'drizzle-orm';
import { db } from '../db';
import { deals, invoices, appointments, leads } from '../../shared/schema';
import { num } from '../../shared/num';

const iso = (v: unknown): string | null =>
  v instanceof Date ? v.toISOString() : typeof v === 'string' ? v : null;

export interface DealItem {
  customer: string | null;
  amount: number;
  type: string | null;
  status: string | null;
  issueDate: string | null;
  signedAt: string | null;
}
export function shapeDeal(r: any): DealItem {
  return {
    customer: r.customer ?? null,
    amount: num(r.amount),
    type: r.type ?? null,
    status: r.status ?? null,
    issueDate: r.issueDate ?? null,
    signedAt: iso(r.signedAt),
  };
}

export interface InvoiceItem {
  kind: string;
  party: string | null;
  amount: number;
  balance: number;
  dueDate: string | null;
  status: string | null;
  isOverdue: boolean;
}
export function shapeInvoice(r: any): InvoiceItem {
  const balance = num(r.balance);
  const isOverdue = balance > 0 && !!r.dueDate && new Date(r.dueDate) < new Date();
  return {
    kind: r.kind,
    party: r.party ?? null,
    amount: num(r.amount),
    balance,
    dueDate: r.dueDate ?? null,
    status: r.status ?? null,
    isOverdue,
  };
}

export interface AppointmentItem {
  title: string | null;
  start: string | null;
  end: string | null;
  address: string | null;
  kind: string | null;
  /** The mailbox the event was synced from — whose calendar it is. */
  mailbox: string | null;
}
export function shapeAppointment(r: any): AppointmentItem {
  return {
    title: r.title ?? null,
    start: iso(r.start),
    end: iso(r.end),
    address: r.address ?? null,
    kind: r.kind ?? null,
    mailbox: r.calendarSource ?? null,
  };
}

export interface LeadItem {
  name: string;
  status: string | null;
  source: string | null;
  serviceType: string | null;
  city: string | null;
  state: string | null;
}
export function shapeLead(r: any): LeadItem {
  return {
    name: [r.firstName, r.lastName].filter(Boolean).join(' ').trim(),
    status: r.status ?? null,
    source: r.source ?? null,
    serviceType: r.serviceType ?? null,
    city: r.city ?? null,
    state: r.state ?? null,
  };
}

const cap = (n?: number) => Math.min(Math.max(n ?? 25, 1), 50);

export async function fetchPipeline(
  opts: { status?: string; limit?: number } = {},
  jobRefs?: string[] | null, // rep scope: null = all; [] = none; [names] = only those jobs
): Promise<DealItem[]> {
  if (jobRefs && jobRefs.length === 0) return [];
  const clauses = [opts.status ? eq(deals.status, opts.status) : undefined].filter(Boolean) as SQL[];
  if (jobRefs && jobRefs.length) clauses.push(inArray(deals.jobRef, jobRefs));
  const where = clauses.length === 0 ? undefined : clauses.length === 1 ? clauses[0] : and(...clauses);
  const rows = await db
    .select()
    .from(deals)
    .where(where)
    .orderBy(desc(deals.issueDate))
    .limit(cap(opts.limit));
  return rows.map(shapeDeal);
}

export async function fetchInvoicesByKind(
  kind: 'ar' | 'ap',
  opts: { overdueOnly?: boolean; limit?: number } = {},
): Promise<InvoiceItem[]> {
  // Only show what is still owed (balance > 0). Filter overdue in SQL against the
  // yyyy-mm-dd `dueDate` text column, and order by due date ascending so the
  // soonest-due / most-overdue rows come first — BEFORE the limit, so they are
  // never cut off (the earlier "filter after limit" returned wrong/empty AR).
  const today = new Date().toISOString().slice(0, 10);
  const clauses = [eq(invoices.kind, kind), gt(invoices.balance, '0')];
  if (opts.overdueOnly) clauses.push(lt(invoices.dueDate, today));
  const rows = await db
    .select()
    .from(invoices)
    .where(and(...clauses))
    .orderBy(invoices.dueDate)
    .limit(cap(opts.limit));
  return rows.map(shapeInvoice);
}

export async function fetchSchedule(
  opts: { from?: string; to?: string; mailboxes?: string[] | null } = {},
): Promise<AppointmentItem[]> {
  // Default to upcoming only (from now) — the tool is described as "upcoming",
  // so without a start bound we must not surface long-past events.
  const from = opts.from ?? new Date().toISOString();
  const clauses = [gte(appointments.start, new Date(from))];
  if (opts.to) clauses.push(lte(appointments.start, new Date(opts.to)));
  // Rows carry calendarSource = the mailbox they were synced from, so the
  // schedule CAN be scoped per person — it just never was, which is how reps
  // came to see the owner's and the office's calendars, personal entries
  // included. `undefined`/`null` means unrestricted; an empty array means
  // nobody, and must return nothing rather than everything.
  if (opts.mailboxes !== undefined && opts.mailboxes !== null) {
    if (!opts.mailboxes.length) return [];
    clauses.push(inArray(appointments.calendarSource, opts.mailboxes));
  }
  const rows = await db
    .select()
    .from(appointments)
    .where(and(...clauses))
    .orderBy(appointments.start)
    .limit(50);
  return rows.map(shapeAppointment);
}

export async function fetchLeads(
  opts: { status?: string; limit?: number } = {},
  extraWhere?: SQL, // rep scope (from repLeadWhere) merged with the status filter
): Promise<LeadItem[]> {
  const clauses = [opts.status ? eq(leads.status, opts.status as any) : undefined, extraWhere].filter(Boolean) as SQL[];
  const where = clauses.length === 0 ? undefined : clauses.length === 1 ? clauses[0] : and(...clauses);
  const rows = await db
    .select()
    .from(leads)
    .where(where)
    .orderBy(desc(leads.id))
    .limit(cap(opts.limit));
  return rows.map(shapeLead);
}

export interface WatchItem {
  source: string;
  kind: string;
  summary: string;
  urgency: string;
  owner: string;
  state: string;
  contact: string | null;
  openedAt: string | null;
}
export function shapeLoop(r: any): WatchItem {
  const c = r.contact || {};
  return {
    source: r.source,
    kind: r.kind,
    summary: r.summary,
    urgency: r.urgency,
    owner: r.owner,
    state: r.state,
    contact: c.name || c.email || c.phone || null,
    openedAt: iso(r.openedAt),
  };
}

// The BRN ops brain's flagged items. Archie has no brain, so the watchlist is
// empty; kept so the assistant's tool answers "nothing flagged" until it is retired.
export async function fetchWatchlist(
  _opts: { source?: string; urgency?: string; limit?: number } = {},
): Promise<WatchItem[]> {
  return [];
}
