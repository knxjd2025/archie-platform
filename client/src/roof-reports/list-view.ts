/**
 * What the roof report list shows and asks for, decided in plain functions so
 * it can be tested without a screen: the address the list is fetched from, what
 * one row says, which buttons a row offers (from the written access table), and
 * how the paging reads. The server decides who sees which report; these only
 * decide what to draw for what it sent.
 */
import { REPORT_KINDS, decisionFor, type ReportKindValue } from '../../../shared/roof-reports';
import type { TeamRole } from '../../../shared/rbac';
import { fmtDate } from '../lib/format';
import { RR, kindsLabel, plainMessage, statusLabel } from './words';

export type ReportStatus = 'generating' | 'ready' | 'failed' | 'archived';

/** One report as GET /api/roof-reports lists it. */
export interface ReportRow {
  id: string;
  title: string | null;
  address: string;
  city: string | null;
  status: ReportStatus | string;
  problem: string | null;
  reportTypes: string[];
  template: string;
  createdAt: string;
  customerName: string | null;
  jobExternalId: string | null;
  totalEstimate: number | null;
}

export interface ListFilters { search: string; kind: '' | ReportKindValue; status: '' | ReportStatus; page: number }
export interface Paging { page: number; pageSize: number; total: number; hasMore: boolean }

export const KIND_FILTERS: { value: '' | ReportKindValue; label: string }[] = [
  { value: '', label: 'All kinds' },
  ...REPORT_KINDS.map((k) => ({ value: k.value, label: k.label })),
];

/** The address to fetch a page of the list from. Only what was chosen is sent. */
export function listPath(f: ListFilters): string {
  const q = new URLSearchParams();
  const search = f.search.trim();
  if (search) q.set('search', search);
  if (f.kind) q.set('kind', f.kind);
  if (f.status) q.set('status', f.status);
  const page = Math.floor(f.page);
  if (Number.isFinite(page) && page > 1) q.set('page', String(page));
  const s = q.toString();
  return s ? `/api/roof-reports?${s}` : '/api/roof-reports';
}

/** The status choices for a role. Archived reports are listed only to a role that sees them. */
export function statusOptions(role: TeamRole): { value: '' | ReportStatus; label: string }[] {
  const options: { value: '' | ReportStatus; label: string }[] = [
    { value: '', label: 'All' },
    { value: 'generating', label: statusLabel('generating') },
    { value: 'ready', label: statusLabel('ready') },
    { value: 'failed', label: statusLabel('failed') },
  ];
  if (decisionFor(role, 'see_archived') !== 'no') options.push({ value: 'archived', label: statusLabel('archived') });
  return options;
}

export interface RowView {
  id: string;
  headline: string;
  place: string;
  customer: string;
  kinds: string;
  statusLabel: string;
  tone: 'good' | 'busy' | 'bad' | 'quiet';
  date: string;
  /** A plain sentence under the row: why it is not ready. */
  note: string | null;
  canOpen: boolean;
  canArchive: boolean;
  /** A finished report the person may see can be picked for a comparison. */
  canCompare: boolean;
  openHref: string;
}

/** What one row says and offers for this role. */
export function rowView(r: ReportRow, role: TeamRole): RowView {
  const status = String(r.status);
  const may = (action: 'see' | 'archive') => decisionFor(role, action) !== 'no';
  const note =
    status === 'generating' ? RR.list.beingMade
    : status === 'failed' ? plainMessage({ message: r.problem ?? '' }, RR.list.couldNotFinish)
    : null;
  return {
    id: r.id,
    headline: r.address,
    place: r.city ?? '',
    customer: r.customerName || RR.list.noCustomer,
    kinds: kindsLabel(r.reportTypes),
    statusLabel: statusLabel(status),
    tone: status === 'ready' ? 'good' : status === 'generating' ? 'busy' : status === 'failed' ? 'bad' : 'quiet',
    date: fmtDate(r.createdAt) ?? '',
    note,
    canOpen: status === 'ready' && may('see'),
    canArchive: (status === 'ready' || status === 'failed') && may('archive'),
    canCompare: status === 'ready' && may('see'),
    openHref: `/api/roof-reports/${r.id}/html`,
  };
}

/** "Showing 26 to 50 of 90". Empty when there is nothing to show. */
export function pagingText(p: Pick<Paging, 'page' | 'pageSize' | 'total'>): string {
  if (p.total <= 0) return '';
  const from = (p.page - 1) * p.pageSize + 1;
  const to = Math.min(p.total, p.page * p.pageSize);
  return from >= to ? `Showing ${to} of ${p.total}` : `Showing ${from} to ${to} of ${p.total}`;
}
