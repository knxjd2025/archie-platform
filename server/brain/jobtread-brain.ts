/**
 * JobTread findings for the Ops Brain (Pave API).
 * Org: 22PCvVuPJywg. Token: env JOBTREAD_TOKEN.
 */
import type { BrainEvent } from './types';
import type { LoopInput } from './loop-store';

const ORG_ID = '22PCvVuPJywg';
const DAY_MS = 86_400_000;
const STALE_ESTIMATE_DAYS = 3;
const UNPAID_INVOICE_DAYS = 7;

export interface JtDoc {
  id: string;
  name: string;
  type: string;
  status: string;
  price: number;
  amountPaid: number;
  issueDate: string | null;
}

export function isStaleEstimate(doc: JtDoc, now: Date): boolean {
  if (doc.type !== 'customerOrder' || doc.status !== 'pending' || !doc.issueDate) return false;
  return now.getTime() - new Date(doc.issueDate).getTime() > STALE_ESTIMATE_DAYS * DAY_MS;
}

export function isUnpaidInvoice(doc: JtDoc, now: Date): boolean {
  if (doc.type !== 'customerInvoice' || doc.amountPaid > 0 || !doc.issueDate) return false;
  if (!['pending', 'approved'].includes(doc.status)) return false;
  return now.getTime() - new Date(doc.issueDate).getTime() > UNPAID_INVOICE_DAYS * DAY_MS;
}

export function staleEstimateToEvent(doc: JtDoc, jobName: string): BrainEvent {
  return {
    source: 'jobtread',
    sourceRef: doc.id,
    occurredAt: new Date().toISOString(),
    text: `Estimate "${doc.name}" for job ${jobName} — $${doc.price} — issued ${doc.issueDate}, still pending approval. Follow up with the customer.`,
    raw: doc,
  };
}

export function unpaidInvoiceToEvent(doc: JtDoc, jobName: string): BrainEvent {
  return {
    source: 'jobtread',
    sourceRef: doc.id,
    occurredAt: new Date().toISOString(),
    text: `Invoice "${doc.name}" for job ${jobName} — $${doc.price} — issued ${doc.issueDate}, $0 paid. Chase payment.`,
    raw: doc,
  };
}

/**
 * These findings are rules, not judgement — "pending and older than 3 days" —
 * so they go straight to a loop instead of through LLM triage. Sending them to
 * the model every hour (8 pages of jobs' worth, re-sent each sweep because the
 * condition still held) was most of what pushed the sweep past Vercel's 300s.
 * Owner james: the job system has no mailbox to say whose it is, and james is
 * who triage assigned when unclear.
 *
 * occurredAt is when the document went stale, not now: a loop someone closed
 * stays closed while the same document stays pending, and reopens only if the
 * document is re-issued and goes stale again.
 */
function findingToLoop(kind: 'estimate_stale' | 'invoice_unpaid', doc: JtDoc, ev: BrainEvent, staleAfterDays: number): LoopInput {
  return {
    kind,
    source: 'jobtread',
    sourceRef: doc.id,
    summary: ev.text,
    owner: 'james',
    urgency: 'normal',
    occurredAt: new Date(new Date(doc.issueDate ?? 0).getTime() + staleAfterDays * DAY_MS),
  };
}

export function staleEstimateToLoop(doc: JtDoc, jobName: string): LoopInput {
  return findingToLoop('estimate_stale', doc, staleEstimateToEvent(doc, jobName), STALE_ESTIMATE_DAYS);
}

export function unpaidInvoiceToLoop(doc: JtDoc, jobName: string): LoopInput {
  return findingToLoop('invoice_unpaid', doc, unpaidInvoiceToEvent(doc, jobName), UNPAID_INVOICE_DAYS);
}

async function pave(query: unknown): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const res = await fetch('https://api.jobtread.com/pave', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.JOBTREAD_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`JobTread ${res.status}: ${await res.text()}`);
    return res.json();
  } finally {
    clearTimeout(timer);
  }
}

// JobTread's Pave API caps request/response size — asking for 100 jobs x 30
// documents each in one query trips a 413 (Request Entity Too Large). Page
// through jobs in smaller batches instead, following Pave's cursor-based
// pagination: a connection's `$` accepts `size`/`page`, and the response
// carries a `nextPage` token alongside `nodes` when more pages remain.
const JOBS_PAGE_SIZE = 25;
const MAX_PAGES = 8;

async function fetchJobsPage(page: unknown): Promise<any> {
  return pave({
    organization: {
      $: { id: ORG_ID },
      jobs: {
        $: {
          size: JOBS_PAGE_SIZE,
          sortBy: [{ field: 'createdAt', order: 'desc' }],
          ...(page != null ? { page } : {}),
        },
        nextPage: {},
        nodes: {
          id: {}, name: {}, number: {},
          documents: {
            $: { size: 30 },
            nodes: { id: {}, name: {}, type: {}, status: {}, price: {}, amountPaid: {}, issueDate: {} },
          },
        },
      },
    },
  });
}

export async function fetchJobtreadFindings(now: Date): Promise<LoopInput[]> {
  const loops: LoopInput[] = [];
  let page: unknown = null;
  for (let i = 0; i < MAX_PAGES; i++) {
    const data = await fetchJobsPage(page);
    const jobsConn = data?.organization?.jobs;
    for (const job of jobsConn?.nodes ?? []) {
      const jobName = `${job.name} ${job.number ?? ''}`.trim();
      for (const doc of job.documents?.nodes ?? []) {
        if (isStaleEstimate(doc, now)) loops.push(staleEstimateToLoop(doc, jobName));
        if (isUnpaidInvoice(doc, now)) loops.push(unpaidInvoiceToLoop(doc, jobName));
      }
    }
    const nextPage = jobsConn?.nextPage;
    if (nextPage == null) break;
    page = nextPage;
    if (i === MAX_PAGES - 1) {
      console.error(`[jobtread-brain] hit MAX_PAGES (${MAX_PAGES}) with more jobs remaining — stale estimates/unpaid invoices on older jobs won't be checked this sweep.`);
    }
  }
  return loops;
}
