import { and, eq, ne } from 'drizzle-orm';
import { db } from '../db';
import { leads } from '../../shared/schema';
import { RoofLinkClient, type RlCustomer, type RlJob } from '../integrations/rooflink';

/**
 * RoofLink → leads (read model).
 *
 * RoofLink is the old CRM and holds most of the company's clients. Everything
 * that enters GoHighLevel or JobTread is also pushed into RoofLink, so it is a
 * superset with duplicates. This sync brings in only what the app does NOT
 * already have: a RoofLink job whose phone, email or street address matches an
 * existing JobTread/GoHighLevel lead is treated as the same client and skipped.
 * Inside RoofLink itself, jobs sharing a phone/email/address collapse to the
 * most recently edited one.
 *
 * Like the JobTread leads sync, the `rooflink` rows are replaced wholesale
 * each run inside one transaction. RoofLink is never written to.
 */

export const ROOFLINK_SOURCE = 'rooflink';
export const externalIdFor = (id: number | string): string => `rl-${id}`;

// ---- Normalisation (pure, unit-tested) --------------------------------------

/** Last 10 digits of a North American number; null when there aren't 10. */
export function normalizePhone(v?: string | null): string | null {
  const d = String(v || '').replace(/\D/g, '');
  if (d.length < 10) return null;
  return d.slice(-10);
}

export function normalizeEmail(v?: string | null): string | null {
  const e = String(v || '').trim().toLowerCase();
  return e && e.includes('@') ? e : null;
}

const SUFFIX: Record<string, string> = {
  street: 'st', st: 'st', road: 'rd', rd: 'rd', drive: 'dr', dr: 'dr', lane: 'ln', ln: 'ln',
  court: 'ct', ct: 'ct', avenue: 'ave', ave: 'ave', boulevard: 'blvd', blvd: 'blvd', circle: 'cir', cir: 'cir',
  place: 'pl', pl: 'pl', trail: 'trl', trl: 'trl', way: 'way', parkway: 'pkwy', pkwy: 'pkwy', terrace: 'ter', ter: 'ter',
  highway: 'hwy', hwy: 'hwy', north: 'n', n: 'n', south: 's', s: 's', east: 'e', e: 'e', west: 'w', w: 'w',
};

/**
 * Street line → comparable key: "550 Manning Drive, Charlotte, NC" and
 * "550 manning dr" both become "550 manning dr". Needs a leading house
 * number; an address without one is too vague to match on.
 */
export function normalizeAddress(v?: string | null): string | null {
  const street = String(v || '').split(',')[0].toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!/^\d+ /.test(street)) return null;
  const words = street.split(' ').map((w) => SUFFIX[w] ?? w);
  // Drop unit designators and anything after them ("apt 4", "unit b", "#2").
  const cut = words.findIndex((w, i) => i > 0 && ['apt', 'unit', 'ste', 'suite', 'lot'].includes(w));
  return (cut > 0 ? words.slice(0, cut) : words).join(' ');
}

export interface DedupKeys { phone: string | null; email: string | null; address: string | null }

export function keysOf(r: { phone?: string | null; email?: string | null; address?: string | null }): DedupKeys {
  return { phone: normalizePhone(r.phone), email: normalizeEmail(r.email), address: normalizeAddress(r.address) };
}

export class KeyIndex {
  private phones = new Set<string>();
  private emails = new Set<string>();
  private addresses = new Set<string>();
  add(k: DedupKeys) {
    if (k.phone) this.phones.add(k.phone);
    if (k.email) this.emails.add(k.email);
    if (k.address) this.addresses.add(k.address);
  }
  has(k: DedupKeys): boolean {
    return (!!k.phone && this.phones.has(k.phone)) || (!!k.email && this.emails.has(k.email)) || (!!k.address && this.addresses.has(k.address));
  }
}

// ---- Mapping (pure, unit-tested) --------------------------------------------

const JOB_TYPE: Record<string, string> = { c: 'commercial', r: 'residential', d: 'residential', m: 'residential' };

/** RoofLink's lead-status names are company-configured; classify by wording plus the workflow steps. */
export function classifyStatus(job: RlJob): { status: 'new' | 'contacted' | 'won' | 'lost'; stage: string | null } {
  const name = job.lead_status?.name?.trim() || null;
  if (job.rejected_step) return { status: 'lost', stage: name || 'Rejected' };
  if (job.closed_step || job.date_completed) return { status: 'won', stage: 'Closed' };
  if (job.approved_step || job.date_signed) return { status: 'won', stage: name || 'Approved' };
  const n = (name || '').toLowerCase();
  if (/lost|dead|reject|cancel|declin|not interested/.test(n)) return { status: 'lost', stage: name };
  if (/sold|approved|signed|complete|paid|closed|won/.test(n)) return { status: 'won', stage: name };
  if (!n || /prospect|new|lead|unverified/.test(n)) return { status: 'new', stage: name };
  return { status: 'contacted', stage: name };
}

function money(v: string | number | null | undefined): string | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n.toFixed(2) : null;
}

export function mapJobToLead(job: RlJob) {
  const c: Partial<RlCustomer> = job.customer || {};
  const first = c.first_name?.trim() || null;
  const last = c.last_name?.trim() || null;
  const fallbackName = c.name?.trim() || c.company_name?.trim() || job.name?.trim() || null;
  const { status, stage } = classifyStatus(job);
  const claim = job.insurance_claim || null;
  const est = job.primary_estimate?.total ?? job.estimate?.total ?? null;
  const closed = job.closed_step?.date || job.date_completed || null;
  const note = [
    job.number ? `RoofLink #${job.number}` : 'RoofLink',
    job.lead_status?.name ? `status: ${job.lead_status.name}` : null,
    job.lead_source?.name ? `source: ${job.lead_source.name}` : null,
    c.company_name && (first || last) ? c.company_name : null,
    claim?.claim_number ? `claim #${claim.claim_number}` : null,
    claim?.insurance_company?.name || null,
    job.region?.name ? `region: ${job.region.name}` : null,
  ].filter(Boolean).join(' · ');

  return {
    externalId: externalIdFor(job.id),
    source: ROOFLINK_SOURCE,
    firstName: first || fallbackName,
    lastName: first ? last : null,
    email: normalizeEmail(c.email) ? c.email!.trim() : null,
    phone: (c.cell || c.phone || '').trim() || null,
    address: job.full_address?.trim() || job.address?.trim() || null,
    city: job.city?.trim() || null,
    state: job.state?.trim() || null,
    zip: job.zipcode?.trim() || null,
    status: status as any,
    propertyType: job.job_type ? JOB_TYPE[job.job_type] ?? null : null,
    serviceType: job.bid_type === 'r' ? 'repair' : null,
    notes: note,
    createdAt: job.date_created ? new Date(job.date_created) : undefined,
    updatedAt: job.date_last_edited ? new Date(job.date_last_edited) : undefined,
    jobName: job.name?.trim() || job.number || null,
    jobNumber: job.number || null,
    stage,
    jtSalesRep: job.rep?.name?.trim() || null,
    projectManager: job.project_manager?.name?.trim() || null,
    projectedValue: money(est),
    scheduleStart: null as Date | null,
    scheduleEnd: null as Date | null,
    closedOn: closed ? new Date(closed) : null,
    insuranceClaim: job.bid_type === 'i' || !!claim,
  };
}

export type RlLeadRow = ReturnType<typeof mapJobToLead>;

/**
 * Split RoofLink jobs into what to import and what to skip.
 *  - deleted in RoofLink → dropped
 *  - matches an existing (non-RoofLink) lead by phone/email/address → skipped, it's already in the app
 *  - matches another RoofLink job → only the most recently edited one is kept
 */
export function partitionJobs(jobs: RlJob[], existing: KeyIndex): { rows: RlLeadRow[]; deleted: number; matchedExisting: number; collapsed: number } {
  let deleted = 0;
  let matchedExisting = 0;
  let collapsed = 0;
  const seen = new KeyIndex();
  const rows: RlLeadRow[] = [];
  const byEdited = [...jobs].sort((a, b) => String(b.date_last_edited || '').localeCompare(String(a.date_last_edited || '')));
  for (const job of byEdited) {
    if (job.deleted_step) { deleted++; continue; }
    const row = mapJobToLead(job);
    const k = keysOf(row);
    if (existing.has(k)) { matchedExisting++; continue; }
    if (seen.has(k)) { collapsed++; continue; }
    seen.add(k);
    rows.push(row);
  }
  return { rows, deleted, matchedExisting, collapsed };
}

// ---- The sync -----------------------------------------------------------------

export async function syncRoofLink(client: RoofLinkClient = new RoofLinkClient()): Promise<Record<string, number>> {
  // No key → quietly a no-op, so the rest of the hourly run is unaffected.
  if (!client.isConfigured()) return { skipped: 1 };

  const { jobs, total, truncated } = await client.listAllJobs();

  // Index every lead that came from somewhere else. Read AFTER the JobTread
  // leads sync so this run's fresh JobTread rows count as "already here".
  const others = await db
    .select({ phone: leads.phone, email: leads.email, address: leads.address })
    .from(leads)
    .where(ne(leads.source, ROOFLINK_SOURCE));
  const existing = new KeyIndex();
  for (const o of others) existing.add(keysOf(o));

  const { rows, deleted, matchedExisting, collapsed } = partitionJobs(jobs, existing);

  const CHUNK = 200;
  await db.transaction(async (tx) => {
    await tx.delete(leads).where(and(eq(leads.source, ROOFLINK_SOURCE)));
    for (let i = 0; i < rows.length; i += CHUNK) {
      await tx.insert(leads).values(rows.slice(i, i + CHUNK));
    }
  });

  return { rooflinkJobs: total, fetched: jobs.length, deleted, matchedExisting, collapsed, imported: rows.length, truncated: truncated ? 1 : 0 };
}
