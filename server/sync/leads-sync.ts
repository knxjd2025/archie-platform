import { db } from '../db';
import { leads, teamMembers, repAssignments, kpiEvents } from '../../shared/schema';
import { and, eq, inArray } from 'drizzle-orm';
import { ownerOf } from '../access/rep-scope';
import { ensureJobCommission } from '../job-commissions/service';
import { isSoldJob } from '../../shared/job-commission';

const JOBTREAD_API_URL = 'https://api.jobtread.com/pave';

async function pave<T>(query: Record<string, any>): Promise<T> {
  // A stalled JobTread call with no timeout held the hourly sync until Vercel
  // killed the whole function at 300s. 20s.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const res = await fetch(JOBTREAD_API_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.JOBTREAD_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`JobTread ${res.status}: ${await res.text()}`);
    const json: any = await res.json();
    if (json.errors?.length) throw new Error(`JobTread Pave: ${json.errors.map((e: any) => e.message).join(', ')}`);
    return json;
  } finally {
    clearTimeout(timer);
  }
}

async function orgId(): Promise<string> {
  const r = await pave<any>({ organizations: { nodes: { id: {} } } });
  const id = r?.organizations?.nodes?.[0]?.id;
  if (!id) throw new Error('JobTread: could not resolve organization id');
  return id;
}

interface CustomFieldValue {
  value?: string | boolean | null;
  customField?: { name?: string };
}
export interface JtJob {
  id: string;
  name?: string;
  number?: string;
  status?: string;
  createdAt?: string;
  closedOn?: string | null;
  projectedPriceWithTax?: number | null;
  customFieldValues?: { nodes?: CustomFieldValue[] };   // job-level fields: Status, Sales Rep, Project Manager, Insurance Claim
  taskSummary?: { startDate?: string | null; endDate?: string | null; progress?: number | null };
  location?: {
    address?: string;
    account?: {
      name?: string;
      primaryContact?: { customFieldValues?: { nodes?: CustomFieldValue[] } } | null;
    };
  };
}

const PAGE = 25; // now that we also pull JOB-level custom fields (Status/Sales Rep/PM/
                 // insurance) + taskSummary, size 50 413s ("Request Entity Too Large");
                 // 25 is safe (verified live).
const MAX_PAGES = 30; // ~750 jobs — a safety cap while pagination walks all pages.

// Use the SINGULAR organization.<id>.jobs form (the plural form 413s). Email/phone
// live on the account's primaryContact as customFieldValues ("Email"/"Mobile"/"Phone").
// `truncated` is true when the cap stopped the walk with pages still left.
async function fetchAllJobs(org: string): Promise<{ jobs: JtJob[]; truncated: boolean }> {
  const all: JtJob[] = [];
  let page: string | undefined;
  for (let i = 0; i < MAX_PAGES; i++) {
    const r = await pave<any>({
      organization: {
        $: { id: org },
        jobs: {
          $: { size: PAGE, ...(page ? { page } : {}), sortBy: [{ field: 'createdAt', order: 'desc' }] },
          nodes: {
            id: {}, name: {}, number: {}, status: {}, createdAt: {}, closedOn: {}, projectedPriceWithTax: {},
            customFieldValues: { nodes: { value: {}, customField: { name: {} } } },
            taskSummary: { startDate: {}, endDate: {}, progress: {} },
            location: {
              address: {},
              account: {
                name: {},
                primaryContact: { customFieldValues: { nodes: { value: {}, customField: { name: {} } } } },
              },
            },
          },
          nextPage: {},
        },
      },
    });
    const conn = r?.organization?.jobs;
    all.push(...((conn?.nodes ?? []) as JtJob[]));
    page = conn?.nextPage || undefined;
    if (!page) return { jobs: all, truncated: false };
  }
  console.warn(`[leads-sync] hit MAX_PAGES (${MAX_PAGES}) with more jobs left — older JobTread leads are kept as they were, not refreshed.`);
  return { jobs: all, truncated: true };
}

/**
 * Which JobTread leads a sync may delete before inserting what it fetched.
 * A complete fetch replaces them all (a job deleted in JobTread disappears).
 * A capped one may only replace the jobs it actually fetched: deleting every
 * JobTread lead and inserting the newest 750 made every older job vanish
 * from the app each hour.
 */
export function leadReplaceScope(fetchedIds: string[], truncated: boolean): { all: true } | { all: false; ids: string[] } {
  return truncated ? { all: false, ids: fetchedIds } : { all: true };
}

// JobTread job status -> our lead_status enum.
const STATUS_MAP: Record<string, string> = {
  created: 'new',
  pending: 'contacted',
  approved: 'won',
  paid: 'won',
  closed: 'won',
  denied: 'lost',
  lost: 'lost',
  dead: 'disqualified',
};

export function parseAddress(addr?: string): { address: string | null; city: string | null; state: string | null; zip: string | null } {
  if (!addr) return { address: null, city: null, state: null, zip: null };
  // Best-effort: "550 Manning Dr, Charlotte, NC 28209, USA"
  const m = addr.match(/,\s*([A-Za-z .'-]+),\s*([A-Z]{2})\s*(\d{5})?/);
  if (m) return { address: addr, city: m[1]?.trim() || null, state: m[2] || null, zip: m[3] || null };
  const parts = addr.split(',').map((s) => s.trim()).filter(Boolean);
  return { address: addr, city: parts.length >= 2 ? parts[1] : null, state: null, zip: null };
}

// Read a JOB-level custom field by name (case-insensitive) from job.customFieldValues.
// Returns the trimmed string value, or null when absent/blank. Booleans (e.g.
// "Insurance Claim") are coerced to "true"/"false".
export function jobField(job: JtJob, name: string): string | null {
  const nodes = job.customFieldValues?.nodes || [];
  const want = name.toLowerCase();
  for (const n of nodes) {
    if ((n.customField?.name || '').toLowerCase() !== want) continue;
    const v = n.value;
    if (v === undefined || v === null || v === 'null') return null;
    if (typeof v === 'boolean') return v ? 'true' : 'false';
    const t = String(v).trim();
    return t || null;
  }
  return null;
}

// Email/phone are stored as customFieldValues on the account's primary contact
// (field names "Email", "Mobile", "Phone"). Prefer Mobile, fall back to Phone.
export function extractContact(job: JtJob): { email: string | null; phone: string | null } {
  const nodes = job.location?.account?.primaryContact?.customFieldValues?.nodes || [];
  let email: string | null = null;
  let mobile: string | null = null;
  let phone: string | null = null;
  for (const n of nodes) {
    const name = (n.customField?.name || '').toLowerCase();
    const val = typeof n.value === 'string' && n.value !== 'null' ? n.value.trim() : '';
    if (!val) continue;
    if (name === 'email' && !email) email = val;
    else if (name === 'mobile' && !mobile) mobile = val;
    else if (name === 'phone' && !phone) phone = val;
  }
  return { email, phone: mobile || phone };
}

export function mapJobToLead(job: JtJob) {
  const a = parseAddress(job.location?.address);
  const c = extractContact(job);
  const status = STATUS_MAP[(job.status || '').toLowerCase()] || 'new';
  const note = [
    job.name || null,
    job.status ? `JobTread status: ${job.status}` : null,
    job.projectedPriceWithTax ? `Projected: $${Number(job.projectedPriceWithTax).toLocaleString()}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const pv = job.projectedPriceWithTax;
  const start = job.taskSummary?.startDate;
  const end = job.taskSummary?.endDate;
  return {
    externalId: job.id,
    source: 'jobtread' as const,
    firstName: job.location?.account?.name ?? null,
    lastName: null as string | null,
    email: c.email,
    phone: c.phone,
    address: a.address,
    city: a.city,
    state: a.state,
    zip: a.zip,
    status: status as any,
    notes: note || null,
    createdAt: job.createdAt ? new Date(job.createdAt) : undefined,
    // JobTread job mirror
    jobName: job.name ?? null,
    jobNumber: job.number ?? null,
    stage: jobField(job, 'Status'),
    jtSalesRep: jobField(job, 'Sales Rep'),
    projectManager: jobField(job, 'Project Manager'),
    projectedValue: pv !== undefined && pv !== null ? String(pv) : null,
    scheduleStart: start ? new Date(start) : null,
    scheduleEnd: end ? new Date(end) : null,
    closedOn: job.closedOn ? new Date(job.closedOn) : null,
    insuranceClaim: jobField(job, 'Insurance Claim') === 'true',
  };
}

/**
 * "Leads run" KPI: a lead moving into `contacted` for the first time. Detected
 * as a diff against the status this same job had *before* this sync — since
 * the row that comes back out of the next sync will already say `contacted`,
 * it naturally never re-fires while a lead stays in that status.
 */
async function logNewlyContactedLeads(
  before: Map<string, string | null>,
  rows: ReturnType<typeof mapJobToLead>[],
): Promise<void> {
  const newlyContacted = rows.filter((r) => r.externalId && r.status === 'contacted' && before.get(r.externalId) !== 'contacted');
  if (!newlyContacted.length) return;

  try {
    const [members, overrides] = await Promise.all([
      db.select({ id: teamMembers.id, repName: teamMembers.jobtreadSalesRep }).from(teamMembers),
      db.select({ jobExternalId: repAssignments.jobExternalId, teamMemberId: repAssignments.teamMemberId, role: repAssignments.role }).from(repAssignments),
    ]);
    const repNameToId = new Map(members.filter((m) => m.repName).map((m) => [m.repName as string, m.id]));
    // A job can be shared by up to 3 reps — only the primary gets credit for this event.
    const overridesMap = new Map(overrides.filter((o) => o.role === 'primary').map((o) => [o.jobExternalId, o.teamMemberId]));

    await db.insert(kpiEvents).values(
      newlyContacted.map((r) => ({
        teamMemberId: ownerOf({ externalId: r.externalId!, jtSalesRep: r.jtSalesRep }, overridesMap, repNameToId),
        repName: r.jtSalesRep,
        type: 'lead_contacted' as const,
        refTable: 'leads',
        refId: r.externalId!,
      })),
    );
  } catch (e: any) {
    console.error('[leads-sync] failed to log lead_contacted KPI events:', e?.message || e);
  }
}

/**
 * A job that was not sold at the last sync and is now: open its commission
 * record. Diffed against the prior snapshot the same way lead_contacted is,
 * so a job stays quiet on every later sync. A brand-new job that first
 * appears already sold counts as newly sold.
 */
async function openCommissionsForNewlySold(
  before: Map<string, { status: string | null; stage: string | null }>,
  rows: ReturnType<typeof mapJobToLead>[],
): Promise<number> {
  const newlySold = rows.filter((r) => r.externalId && isSoldJob(r) && !isSoldJob(before.get(r.externalId) || {}));
  let created = 0;
  for (const r of newlySold) {
    try {
      const { created: c } = await ensureJobCommission({ ...r, externalId: r.externalId! }, 'system:sync');
      if (c) created++;
    } catch (e: any) {
      console.error(`[leads-sync] failed to open commission record for ${r.externalId}:`, e?.message || e);
    }
  }
  return created;
}

export async function syncLeads(): Promise<Record<string, number>> {
  const org = await orgId();
  const { jobs, truncated } = await fetchAllJobs(org);
  const rows = jobs.map(mapJobToLead);
  const scope = leadReplaceScope(rows.map((r) => r.externalId), truncated);

  // Snapshot prior status per job before replacing the read model, so a
  // status transition into "contacted" can be detected (see logNewlyContactedLeads).
  const priorRows = await db.select({ externalId: leads.externalId, status: leads.status, stage: leads.stage }).from(leads).where(eq(leads.source, 'jobtread'));
  const priorStatus = new Map<string, string | null>();
  const priorSold = new Map<string, { status: string | null; stage: string | null }>();
  for (const r of priorRows) if (r.externalId) { priorStatus.set(r.externalId, r.status); priorSold.set(r.externalId, { status: r.status, stage: r.stage }); }

  // Replace the JobTread-sourced leads (read model). Other sources are untouched.
  // Delete + re-insert run in one transaction — a crash between them must not
  // leave the leads table missing every JobTread lead.
  const CHUNK = 200;
  await db.transaction(async (tx) => {
    if (scope.all) {
      await tx.delete(leads).where(eq(leads.source, 'jobtread'));
    } else {
      for (let i = 0; i < scope.ids.length; i += CHUNK) {
        await tx.delete(leads).where(and(eq(leads.source, 'jobtread'), inArray(leads.externalId, scope.ids.slice(i, i + CHUNK))));
      }
    }
    for (let i = 0; i < rows.length; i += CHUNK) {
      if (rows.length) await tx.insert(leads).values(rows.slice(i, i + CHUNK));
    }
  });

  await logNewlyContactedLeads(priorStatus, rows);
  const commissionsOpened = await openCommissionsForNewlySold(priorSold, rows);
  return { leads: rows.length, commissionsOpened, truncated: truncated ? 1 : 0 };
}
