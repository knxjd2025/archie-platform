import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../db';
import { deals, invoices, leads } from '../../shared/schema';
import { upsertBySourceId } from './run';
import { mapDeal, mapInvoice, type JtDocument } from './jobtread-map';

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
  // `currentGrant.organization` is null for account-level API keys (verified live);
  // `organizations.nodes[0].id` is the resolution path already proven to work in
  // server/integrations/jobtread.ts's getOrganizationId()/healthCheck().
  const r = await pave<any>({ organizations: { nodes: { id: {} } } });
  const id = r?.organizations?.nodes?.[0]?.id;
  if (!id) throw new Error('JobTread: could not resolve organization id');
  return id;
}

const PAGE_SIZE = 100; // API hard-caps size at 100 (verified live: size:200 → "Expected size of 200 to be no more than 100").

async function fetchDocs(org: string, type: string): Promise<JtDocument[]> {
  const r = await pave<any>({
    organization: { $: { id: org }, docs: { _: 'documents',
      $: { where: ['type', type], size: PAGE_SIZE, sortBy: [{ field: 'issueDate', order: 'desc' }] },
      nodes: { id: {}, number: {}, name: {}, toName: {}, price: {}, balance: {}, issueDate: {}, dueDate: {}, signedAt: {}, status: {}, type: {}, job: { name: {} } },
    } },
  });
  const nodes = (r?.organization?.docs?.nodes ?? []) as JtDocument[];
  if (nodes.length >= PAGE_SIZE) {
    console.warn(
      `JobTread sync: "${type}" documents hit the ${PAGE_SIZE}-doc page cap — results are truncated and older ${type} docs may be missing until pagination is added.`
    );
  }
  return nodes;
}

export async function syncJobtread(): Promise<Record<string, number>> {
  const org = await orgId();
  const orders = await fetchDocs(org, 'customerOrder');
  const custInv = await fetchDocs(org, 'customerInvoice');
  const vendBill = await fetchDocs(org, 'vendorBill');

  // Which proposals were NOT yet signed before this pull — a signature that
  // appears now is the customer approving the work, and the sales and
  // production boards move on it.
  const mapped = orders.map(mapDeal);
  const signedNow = mapped.filter((d) => d.signedAt || String(d.status || '').toLowerCase() === 'approved');
  const prior = signedNow.length
    ? await db.select({ sourceId: deals.sourceId, signedAt: deals.signedAt, status: deals.status }).from(deals).where(inArray(deals.sourceId, signedNow.map((d) => d.sourceId)))
    : [];
  const wasSigned = new Set(prior.filter((p) => p.signedAt || String(p.status || '').toLowerCase() === 'approved').map((p) => p.sourceId));
  const newlySigned = signedNow.filter((d) => !wasSigned.has(d.sourceId));

  const dealCount = await upsertBySourceId(deals, mapped);
  const invCount = await upsertBySourceId(invoices, [...custInv, ...vendBill].map(mapInvoice));

  let proposalsApproved = 0;
  if (newlySigned.length) {
    const names = Array.from(new Set(newlySigned.map((d) => d.jobRef).filter((x): x is string => !!x)));
    const jobs = names.length ? await db.select({ id: leads.externalId, name: leads.jobName }).from(leads).where(and(eq(leads.source, 'jobtread'), inArray(leads.jobName, names))) : [];
    const byName = new Map(jobs.filter((j) => j.id && j.name).map((j) => [j.name!, j.id!]));
    const { onProposalSigned } = await import('../pipelines/automation');
    for (const d of newlySigned) {
      const id = d.jobRef ? byName.get(d.jobRef) : undefined;
      if (!id) continue;
      const moved = await onProposalSigned(id, 'system:jobtread-sync');
      if (moved.length) proposalsApproved++;
    }
  }
  return { deals: dealCount, invoices: invCount, proposalsApproved };
}
