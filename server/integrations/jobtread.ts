/**
 * JobTread API Client
 * Documentation: https://app.jobtread.com/docs
 *
 * JobTread uses the Pave query language (https://pavejs.org)
 * API endpoint: https://api.jobtread.com/pave
 *
 * JobTread is a construction management platform that handles:
 * - Jobs/Projects
 * - Estimates and Proposals
 * - Invoices and Payments
 * - Contacts (customers, vendors)
 * - Tasks and Scheduling
 * - Daily Logs
 */

import { fetchWithTimeout } from '../lib/fetch-timeout';
import { assertEnvCredentials } from '../tenant/per-company';

const JOBTREAD_API_URL = 'https://api.jobtread.com/pave';

/** A file PUT to JobTread's upload URL; photos from a phone are slow. */
const UPLOAD_TIMEOUT_MS = 60_000;

/** JobTread's largest page. */
const PAGE_SIZE = 100;
/**
 * The most records one list call will read while filtering. Well past the
 * company's job and invoice counts, and a stop for a query that would
 * otherwise walk the whole account on every dashboard load.
 */
const SCAN_CAP = 3000;

export interface PagedNodes {
  nodes: any[];
  /** JobTread's own count for the query, before any in-memory filter. */
  count: number | null;
  /** True when every page was read, so a filtered count is the real one. */
  exhausted: boolean;
}

/**
 * Read pages of a connection until `want` nodes pass `keep`, the pages run
 * out, or `maxScan` records have been read. `fetchPage` is handed the page
 * cursor (undefined for the first) and returns the connection.
 */
export async function collectPages(
  fetchPage: (page: string | undefined) => Promise<{ nodes?: any[]; nextPage?: string | null; count?: number | null } | null | undefined>,
  opts: { want: number; maxScan?: number; keep?: (node: any) => boolean },
): Promise<PagedNodes> {
  const maxScan = opts.maxScan ?? SCAN_CAP;
  const kept: any[] = [];
  let count: number | null = null;
  let scanned = 0;
  let page: string | undefined;
  do {
    const conn = await fetchPage(page);
    if (count === null && conn?.count != null) count = Number(conn.count);
    const batch = conn?.nodes || [];
    scanned += batch.length;
    for (const n of batch) if (!opts.keep || opts.keep(n)) kept.push(n);
    page = conn?.nextPage || undefined;
    if (!batch.length) page = undefined;
  } while (page && kept.length < opts.want && scanned < maxScan);
  return { nodes: kept.slice(0, opts.want), count, exhausted: !page };
}

// JobTread custom-field ids (stable per org 22PCvVuPJywg; verified live via the
// Pave schema). Used by the write-back methods.
export const JT_STATUS_FIELD = '22PCvVv9LFXi'; // job "Status" (pipeline stage)
export const JT_SALES_REP_FIELD = '22PCvciFkpGi'; // job "Sales Rep"

// The valid options for the job "Status" field — a write must be one of these.
export const JT_STATUS_OPTIONS: readonly string[] = [
  'New Lead', 'Appt Set', 'Estimating', 'Sales Closing Meeting', 'Follow Up Close',
  'Claim Filed', 'Pre-Supplementing', 'Adj Meeting', 'Waiting Decision', 'Denied Disputing',
  'Partial Approval Disputing', 'NTS Needed', 'NTS Sent', 'Insurance Approved', 'Post-Supplementing',
  'Buyer Approved', 'Permitting', 'Schedule', 'Pre-Construction', 'Roof Construction',
  'Other Construction Work', 'Complete', 'PIF File Warranties', 'Closed', 'Lost',
];
const JT_STATUS_SET = new Set(JT_STATUS_OPTIONS);
export const isValidJobStatus = (s: string): boolean => JT_STATUS_SET.has(s);

// customerContact custom-field ids (verified live) — email/phone live here on the
// account's primary contact.
export const JT_CONTACT_EMAIL_FIELD = '22PCvVv9EHB7';
export const JT_CONTACT_MOBILE_FIELD = '22PCvcnxBADh';

export interface JobTreadContact {
  id: string;
  type: 'customer' | 'vendor' | 'subcontractor';
  firstName?: string;
  lastName?: string;
  companyName?: string;
  email?: string;
  phone?: string;
  address?: {
    street1?: string;
    street2?: string;
    city?: string;
    state?: string;
    zip?: string;
  };
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface JobTreadJob {
  id: string;
  name: string;
  number?: string;
  status: 'lead' | 'estimate' | 'proposal' | 'in_progress' | 'completed' | 'cancelled';
  customerId: string;
  customer?: JobTreadContact;
  address?: {
    street1?: string;
    city?: string;
    state?: string;
    zip?: string;
  };
  description?: string;
  estimatedValue?: number;
  actualValue?: number;
  startDate?: string;
  endDate?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface JobTreadInvoice {
  id: string;
  jobId: string;
  number?: string;
  status: 'draft' | 'sent' | 'viewed' | 'paid' | 'partial' | 'overdue';
  amount: number;
  amountPaid: number;
  amountDue: number;
  dueDate?: string;
  sentDate?: string;
  paidDate?: string;
  createdAt?: string;
}

export interface JobTreadTask {
  id: string;
  jobId?: string;
  title: string;
  description?: string;
  status: 'pending' | 'in_progress' | 'completed';
  dueDate?: string;
  assignedTo?: string;
  priority?: 'low' | 'medium' | 'high';
  createdAt?: string;
}

export interface JobTreadEstimate {
  id: string;
  jobId: string;
  number?: string;
  status: 'draft' | 'sent' | 'accepted' | 'declined';
  totalAmount: number;
  items: Array<{
    description: string;
    quantity: number;
    unitPrice: number;
    total: number;
  }>;
  createdAt?: string;
}

/** One line on a JobTread document or job budget. `unitPrice` is what the
 *  customer pays; `unitCost` is our cost (drives budget/vendor orders). */
/**
 * JobTread only accepts document names from a fixed template list — a free
 * name 400s with the full list. These are the ones this app creates.
 */
export const JT_DOC_TEMPLATES = {
  insuranceProposal: 'Insurance Claim Proposal',
  retailProposal: 'Retail Roofing Proposal',
  repair: 'Residential Repair',
  supplement: 'Supplement Request',
  completion: 'Certificate of Completion',
  // vendorOrder has its own, shorter list: Purchase Order | Work Order.
  workOrder: 'Work Order',
  purchaseOrder: 'Purchase Order',
} as const;
export type JtDocTemplate = typeof JT_DOC_TEMPLATES[keyof typeof JT_DOC_TEMPLATES];

/**
 * The document types a job carries. `customerOrder` and `customerInvoice` are
 * what the homeowner owes us; `vendorOrder` and `vendorBill` are what we owe a
 * supplier or a crew.
 */
export type JtDocumentType = 'customerOrder' | 'customerInvoice' | 'vendorOrder' | 'vendorBill';

export interface JobTreadDocumentSummary {
  id: string;
  name: string;
  number?: string;
  status: string;
  /** What the customer pays. Zero on vendor documents. */
  price: number;
  /** What we pay. Zero on customer documents. */
  cost: number;
  /** The money that document actually represents — see documentAmount. */
  amount: number;
  issueDate?: string;
  type: JtDocumentType | '';
}

/**
 * The money on a document.
 *
 * JobTread keeps a customer document's value in `price` and a vendor
 * document's in `cost`, and leaves the other field at zero. Reading `price`
 * for everything makes every purchase order and work order look like it was
 * worth nothing — which, on a commission worked out from those documents,
 * quietly turns a job's costs into zero and doubles what the rep is owed.
 */
export function documentAmount(type: string, price: number, cost: number): number {
  if (type === 'vendorOrder' || type === 'vendorBill') return cost || 0;
  if (type === 'customerOrder' || type === 'customerInvoice') return price || 0;
  // Unknown type: whichever side carries a figure, preferring cost, since a
  // zero here is the failure mode worth avoiding.
  return price || cost || 0;
}

export interface JobTreadDocLine {
  name: string;
  /** JobTread cost code. Defaults to the org's "Roofing" code. */
  costCodeId?: string;
  /** JobTread cost type. Defaults to "Labor w/Materials" — a roof is both. */
  costTypeId?: string;
  description?: string;
  quantity: number;
  unitPrice: number;
  unitCost?: number;
  isTaxable?: boolean;
}

export interface JobTreadComment {
  id: string;
  message: string;
  name?: string;
  createdAt: string;
  isFromEmail: boolean;
  author: string;
  jobName: string;
  accountName: string;
}

export interface JobTreadLeadSnapshot {
  id: string;
  name: string;
  status: string;
  createdAt: string;
  closedOn?: string | null;
  projectedPriceWithTax: number;
  customerName: string;
  address: string;
}

export interface JobTreadLeadKpis {
  period: {
    key: 'month' | 'year' | 'custom';
    label: string;
    startDate: string;
    endDate: string;
  };
  totals: {
    leads: number;
    open: number;
    won: number;
    paid: number;
    priced: number;
  };
  rates: {
    winRate: number;
    paidRate: number;
  };
  values: {
    totalProjected: number;
    wonProjected: number;
    paidProjected: number;
    averageProjected: number;
    averageWonProjected: number;
  };
  byStatus: Record<string, {
    count: number;
    projectedValue: number;
  }>;
  recentLeads: Array<{
    id: string;
    name: string;
    customerName: string;
    status: string;
    createdAt: string;
    projectedPriceWithTax: number;
    address: string;
  }>;
}

export class JobTreadClient {
  private apiKey: string;
  private companyId: string;
  private organizationId?: string;

  constructor() {
    this.apiKey = process.env.JOBTREAD_API_KEY || '';
    this.companyId = process.env.JOBTREAD_COMPANY_ID || '';

    if (!this.apiKey) {
      console.warn('JOBTREAD_API_KEY not set - JobTread integration will be limited');
    }
  }

  /**
   * Execute a Pave query against the JobTread API
   * Pave is a query language similar to GraphQL but with different syntax
   * See: https://pavejs.org
   *
   * IMPORTANT: The Pave API requires:
   * 1. Authorization via Bearer token header
   * 2. Queries wrapped in a "query" object: {query: {...}}
   * 3. Arguments passed via "$" key, e.g., job: { $: { id: "123" }, name: {} }
   */
  /**
   * Escape hatch for callers that need to run their own Pave query (the report
   * engine reads job files/documents this way). Same auth + error handling.
   */
  async paveQuery<T>(query: Record<string, any>): Promise<T> {
    return this.pave<T>(query);
  }

  private async pave<T>(query: Record<string, any>): Promise<T> {
    assertEnvCredentials('JobTread');
    // This backs virtually the entire JobTread integration (leads, stage
    // changes, notes, documents, reports) and had no timeout — a stalled
    // call blocked that request indefinitely.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    let response: Response;
    try {
      response = await fetch(JOBTREAD_API_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`JobTread API Error (${response.status}): ${error}`);
    }

    const result = await response.json();

    // Pave returns errors in the response body
    if (result.errors && result.errors.length > 0) {
      throw new Error(`JobTread Pave Error: ${result.errors.map((e: any) => e.message).join(', ')}`);
    }

    return result;
  }

  // ==================== CONTACTS ====================

  async getContacts(params?: {
    type?: 'customer' | 'vendor' | 'subcontractor';
    limit?: number;
    offset?: number;
    search?: string;
  }): Promise<{ contacts: JobTreadContact[]; total: number }> {
    try {
      // JobTread `contact` nodes expose id/name/firstName/lastName/title/createdAt
      // and a related `account` — but NOT email/phone/address directly (verified
      // live). Use the SINGULAR organization.<id>.contacts form; the old query
      // requested fields that don't exist (HTTP 400) and the plural
      // organizations.nodes.contacts form 413s at size 50.
      const orgId = await this.getOrganizationId();
      const limit = params?.limit || 50;
      const result = await this.pave<any>({
        organization: {
          $: { id: orgId },
          contacts: {
            $: { size: limit, sortBy: [{ field: 'createdAt', order: 'desc' }] },
            nodes: {
              id: {},
              name: {},
              firstName: {},
              lastName: {},
              createdAt: {},
              account: { id: {}, name: {} },
            },
            count: {},
          },
        },
      });

      const conn = result?.organization?.contacts;
      const allContacts: any[] = conn?.nodes || [];
      const total = conn?.count || allContacts.length;

      return {
        contacts: allContacts.slice(0, limit).map((c: any): JobTreadContact => ({
          id: c.id,
          type: 'customer',
          firstName: c.firstName || undefined,
          lastName: c.lastName || undefined,
          // Show the person's name when present; otherwise fall back to the company.
          companyName: (c.firstName || c.lastName) ? undefined : (c.account?.name || c.name || undefined),
          createdAt: c.createdAt,
        })),
        total,
      };
    } catch (error: any) {
      console.warn('JobTread: Cannot list contacts -', error.message);
      throw new Error(`JobTread API error: ${error.message}`);
    }
  }

  /**
   * Recent JobTread comments (the per-job activity/message feed) across the
   * whole organization, newest first. Used by the unified Conversations screen.
   * `account.name` is the customer the comment hangs off; `isFromEmail` flags
   * comments that arrived as inbound email vs. internal team notes.
   */
  async getRecentComments(limit: number = 40): Promise<{ comments: JobTreadComment[] }> {
    try {
      const org = await this.getOrganizationId();
      const size = Math.min(Math.max(limit, 1), 100);
      const data = await this.pave<any>({
        organization: {
          $: { id: org },
          comments: {
            $: { size, sortBy: [{ field: 'createdAt', order: 'desc' }] },
            nodes: {
              id: {},
              message: {},
              name: {},
              createdAt: {},
              isFromEmail: {},
              createdByUser: { name: {} },
              job: { name: {} },
              account: { name: {} },
            },
          },
        },
      });

      const nodes = data?.organization?.comments?.nodes || [];
      return {
        comments: nodes.map((c: any): JobTreadComment => ({
          id: c.id,
          message: c.message || '',
          name: c.name || undefined,
          createdAt: c.createdAt || '',
          isFromEmail: !!c.isFromEmail,
          author: c.createdByUser?.name || '',
          jobName: c.job?.name || '',
          accountName: c.account?.name || '',
        })),
      };
    } catch (error: any) {
      console.warn('JobTread: Cannot list comments -', error.message);
      throw new Error(`JobTread API error: ${error.message}`);
    }
  }

  /** Insurance-claim fields for a job (from its custom fields). Empty on failure. */
  async getJobInsurance(jobId: string): Promise<Record<string, string | boolean | null>> {
    try {
      const data = await this.pave<any>({
        job: { $: { id: jobId }, customFieldValues: { $: { size: 40 }, nodes: { value: {}, customField: { name: {} } } } },
      });
      const nodes = data?.job?.customFieldValues?.nodes || [];
      const get = (name: string): string | null => {
        const n = nodes.find((x: any) => (x.customField?.name || '').toLowerCase() === name.toLowerCase());
        const v = n?.value;
        if (v === undefined || v === null || v === '' || v === 'null') return null;
        return typeof v === 'boolean' ? (v ? 'true' : 'false') : String(v);
      };
      return {
        isClaim: get('Insurance Claim') === 'true',
        carrier: get('Insurance Carrier'),
        claimNumber: get('Claim Number'),
        policyNumber: get('Policy Number'),
        dateOfLoss: get('Date of Loss'),
        typeOfLoss: get('Type of Loss'),
        adjusterName: get('Adjuster Name'),
        adjusterPhone: get('Adjuster Phone'),
        adjusterEmail: get('Adjuster Email'),
        claimsEmail: get('Claims Email'),
      };
    } catch {
      return {};
    }
  }

  /** Comments on a single job (its activity/message feed), newest first. */
  async getJobComments(jobId: string, limit = 20): Promise<{ comments: JobTreadComment[] }> {
    try {
      const size = Math.min(Math.max(limit, 1), 50);
      const data = await this.pave<any>({
        job: {
          $: { id: jobId },
          comments: {
            $: { size, sortBy: [{ field: 'createdAt', order: 'desc' }] },
            nodes: {
              id: {}, message: {}, name: {}, createdAt: {}, isFromEmail: {},
              createdByUser: { name: {} },
              job: { name: {} },
              account: { name: {} },
            },
          },
        },
      });
      const nodes = data?.job?.comments?.nodes || [];
      return {
        comments: nodes.map((c: any): JobTreadComment => ({
          id: c.id, message: c.message || '', name: c.name || undefined,
          createdAt: c.createdAt || '', isFromEmail: !!c.isFromEmail,
          author: c.createdByUser?.name || '', jobName: c.job?.name || '', accountName: c.account?.name || '',
        })),
      };
    } catch (error: any) {
      console.warn('JobTread: Cannot list job comments -', error.message);
      return { comments: [] };
    }
  }

  /**
   * A job's estimates/proposals — JobTread models these as `documents` of type
   * `customerOrder` (verified live; same documents collection as invoices).
   */
  async getJobEstimates(jobId: string, limit = 10): Promise<{ estimates: Array<{ id: string; name: string; number?: string; status: string; price: number; issueDate?: string }> }> {
    const { documents } = await this.getJobDocuments(jobId, { type: 'customerOrder', limit });
    return { estimates: documents.map(({ type, ...d }) => d) };
  }

  /**
   * A job's documents. `customerOrder` is what the customer signs — estimates,
   * proposals, change orders; `vendorOrder` is what we commit to pay out —
   * supplier purchase orders and crew work orders. Omit `type` for both, which
   * is what the commission screen wants: one call, every document on the job,
   * and the caller decides which belongs on which line.
   *
   * `price` on a vendor order is what we owe that vendor, so it is the cost
   * figure, not a customer-facing price.
   */
  async getJobDocuments(jobId: string, opts: { type?: JtDocumentType; limit?: number } = {}): Promise<{
    documents: JobTreadDocumentSummary[];
  }> {
    try {
      const size = Math.min(Math.max(opts.limit ?? 10, 1), 50);
      const data = await this.pave<any>({
        job: {
          $: { id: jobId },
          documents: {
            $: {
              ...(opts.type ? { where: ['type', opts.type] } : {}),
              size, sortBy: [{ field: 'issueDate', order: 'desc' }],
            },
            nodes: { id: {}, number: {}, name: {}, status: {}, price: {}, cost: {}, issueDate: {}, type: {} },
          },
        },
      });
      const nodes = data?.job?.documents?.nodes || [];
      return {
        documents: nodes.map((d: any) => {
          const type = (d.type || opts.type || '') as JtDocumentType | '';
          const price = Number(d.price || 0);
          const cost = Number(d.cost || 0);
          return {
            id: d.id, name: d.name || 'Document',
            number: d.number != null ? String(d.number) : undefined,
            status: d.status || '', price, cost, amount: documentAmount(type, price, cost),
            issueDate: d.issueDate || undefined, type,
          };
        }),
      };
    } catch (error: any) {
      console.warn('JobTread: Cannot list documents -', error.message);
      return { documents: [] };
    }
  }

  /**
   * A job's attached files (photos, PDFs, docs). `url` is a signed CDN link that
   * is publicly fetchable without auth (verified), so image URLs can be handed
   * straight to the Reports API for damage analysis. `size` returns the closest
   * resized version for images (null for non-resizable files).
   */
  async getJobFiles(jobId: string, limit = 60, imageWidth = 1600): Promise<{
    files: Array<{ id: string; name: string; type: string; size: number; folder: string | null; description: string | null; createdAt: string | null; url: string | null; originalUrl: string | null }>;
    total: number;
  }> {
    try {
      // JobTread pages at 100. Real jobs carry more than that, and asking for
      // 400 silently returned only the first 100 — so page until we have what
      // was asked for.
      const want = Math.max(limit, 1);
      const nodes: any[] = [];
      let total = 0;
      let page: string | undefined;
      do {
        const data = await this.pave<any>({
          job: {
            $: { id: jobId },
            files: {
              $: { size: Math.min(want - nodes.length, 100), sortBy: [{ field: 'createdAt', order: 'desc' }], ...(page ? { page } : {}) },
              count: {},
              nextPage: {},
              nodes: {
                id: {}, name: {}, type: {}, size: {}, folder: {}, description: {}, createdAt: {},
                url: { $: { size: imageWidth } },
                // `url` with a size renders a PDF to a JPEG — asking for a
                // measurement report that way returns an image with JPEG magic
                // bytes under an application/pdf type, which no PDF parser can
                // read. The original is the actual file.
                originalUrl: { _: 'url', $: { original: true } },
              },
            },
          },
        });
        const conn = data?.job?.files;
        total = Number(conn?.count ?? 0);
        nodes.push(...(conn?.nodes || []));
        page = conn?.nextPage || undefined;
      } while (page && nodes.length < want);

      return {
        total: total || nodes.length,
        files: nodes.map((f: any) => ({
          id: f.id, name: f.name || 'file', type: f.type || '', size: Number(f.size || 0),
          folder: f.folder || null, description: f.description || null,
          createdAt: f.createdAt || null, url: f.url || null,
          originalUrl: f.originalUrl || null,
        })),
      };
    } catch (error: any) {
      console.warn('JobTread: Cannot list job files -', error.message);
      return { files: [], total: 0 };
    }
  }

  /**
   * Create a JobTread document on a job — `customerOrder` for a customer
   * proposal/estimate, `vendorOrder` for a material or work order. Verified
   * against the live schema (documentType, lineItems.newCostItem, requireSignature).
   *
   * Always lands as a DRAFT: nothing reaches a customer or vendor until someone
   * explicitly activates/sends it.
   */
  /**
   * One document line, in the shape JobTread's `lineItems` oneOf actually
   * accepts: FLAT, discriminated by the `_type` constant.
   *
   * It was previously wrapped as `{ newCostItem: {...} }`, which the API
   * rejects with "does not resolve to existingCostGroup, existingCostItem,
   * newCostGroup, or newCostItem" — so every report push failed. Verified
   * against the live API before changing.
   */
  private static costLinePayload(l: JobTreadDocLine, costCodeId?: string, costTypeId?: string) {
    return {
      _type: 'costItem' as const,
      // Required by the API. Every line this app writes is roofing work, so a
      // single resolved code is correct; a caller can override per line.
      ...(l.costCodeId || costCodeId ? { costCodeId: l.costCodeId || costCodeId } : {}),
      ...(l.costTypeId || costTypeId ? { costTypeId: l.costTypeId || costTypeId } : {}),
      name: String(l.name).slice(0, 250),
      ...(l.description ? { description: l.description.slice(0, 4096) } : {}),
      quantity: Number(l.quantity) || 1,
      unitPrice: Number(l.unitPrice) || 0,
      ...(l.unitCost != null ? { unitCost: Number(l.unitCost) } : {}),
      isTaxable: l.isTaxable !== false,
    };
  }

  async createJobDocument(params: {
    jobId: string;
    type: 'customerOrder' | 'vendorOrder';
    name: string;
    fromName: string;
    toName: string;
    toEmailAddress?: string;
    toAddress?: string;
    toPhoneNumber?: string;
    lines: JobTreadDocLine[];
    taxRate?: number;              // 0..1
    requireSignature?: boolean;
    signatureDisclaimer?: string;
    description?: string;
    /** Existing job file ids to attach (e.g. the report's photos). */
    attachFileIds?: string[];
    /** Payment terms in days. JobTread demands a due date OR due days. */
    dueDays?: number;
  }): Promise<{ ok: boolean; documentId?: string; error?: string }> {
    // JobTread requires a location on the document itself — without one the
    // create 400s with "A job location name or address is required", which is
    // the second reason report pushes were failing.
    try {
      const [defaultCode, defaultType] = await Promise.all([this.getDefaultCostCodeId(), this.getDefaultCostTypeId()]);
      const lineItems = params.lines.slice(0, 200).map((l) => JobTreadClient.costLinePayload(l, defaultCode, defaultType));

      const data = await this.pave<any>({
        createDocument: {
          $: {
            jobId: params.jobId,
            type: params.type,
            name: params.name,
            fromName: params.fromName.slice(0, 128),
            toName: params.toName.slice(0, 128),
            ...(params.toEmailAddress ? { toEmailAddress: params.toEmailAddress } : {}),
            ...(params.toAddress ? { toAddress: params.toAddress, jobLocationAddress: params.toAddress } : {}),
            jobLocationName: (params.toName || 'Job site').slice(0, 128),
            // "Either a due date or due days must be provided, but not both" —
            // a proposal has no invoice due date, so due days it is.
            dueDays: params.dueDays ?? 30,
            ...(params.toPhoneNumber ? { toPhoneNumber: params.toPhoneNumber } : {}),
            ...(params.description ? { description: params.description.slice(0, 32768) } : {}),
            // Required and non-nullable: omitting it 400s the whole create.
            taxRate: params.taxRate != null ? Math.min(Math.max(params.taxRate, 0), 1) : 0,
            ...(params.requireSignature ? { requireSignature: true } : {}),
            ...(params.signatureDisclaimer ? { signatureDisclaimer: params.signatureDisclaimer.slice(0, 1000) } : {}),
            ...(params.attachFileIds?.length
              ? { files: params.attachFileIds.slice(0, 100).map((id) => ({ copyFromFileId: id })) }
              : {}),
            lineItems,
          },
          createdDocument: { id: {}, name: {}, status: {}, price: {} },
        },
      });
      const doc = data?.createDocument?.createdDocument;
      return doc?.id ? { ok: true, documentId: doc.id } : { ok: false, error: 'JobTread did not return a document id' };
    } catch (error: any) {
      return { ok: false, error: error?.message || 'JobTread document creation failed' };
    }
  }

  private roofingCostCodeId: string | null = null;
  private defaultCostTypeId: string | null = null;

  /**
   * The org's "Roofing" cost code id, resolved once and cached.
   * Codes are per-organization, so hard-coding one would break on any other
   * account; falling back to "Uncategorized" keeps a push working rather than
   * failing outright when the code has been renamed.
   */
  async getDefaultCostCodeId(): Promise<string | undefined> {
    if (this.roofingCostCodeId) return this.roofingCostCodeId;
    try {
      const org = await this.getOrganizationId();
      const r = await this.pave<any>({
        organization: { $: { id: org }, costCodes: { $: { size: 60 }, nodes: { id: {}, name: {} } } },
      });
      const nodes: Array<{ id: string; name: string }> = r?.organization?.costCodes?.nodes || [];
      const pick = nodes.find((c) => /^roofing$/i.test(c.name)) || nodes.find((c) => /^uncategorized$/i.test(c.name));
      this.roofingCostCodeId = pick?.id ?? null;
      return this.roofingCostCodeId ?? undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * The org's default cost TYPE. A re-roof is labour and materials together,
   * so "Labor w/Materials" is the honest default; falls back to "Materials".
   * Per-organization, so resolved at run time like the cost code.
   */
  async getDefaultCostTypeId(): Promise<string | undefined> {
    if (this.defaultCostTypeId) return this.defaultCostTypeId;
    try {
      const org = await this.getOrganizationId();
      const r = await this.pave<any>({
        organization: { $: { id: org }, costTypes: { $: { size: 40 }, nodes: { id: {}, name: {} } } },
      });
      const nodes: Array<{ id: string; name: string }> = r?.organization?.costTypes?.nodes || [];
      const pick = nodes.find((c) => /labor\s*w\/?\s*materials/i.test(c.name))
        || nodes.find((c) => /^materials$/i.test(c.name))
        || nodes[0];
      this.defaultCostTypeId = pick?.id ?? null;
      return this.defaultCostTypeId ?? undefined;
    } catch {
      return undefined;
    }
  }

  /** A document's current status — the gate on whether it may be rewritten. */
  async getDocumentStatus(documentId: string): Promise<{ status: string | null; name?: string | null }> {
    try {
      const data = await this.pave<any>({
        document: { $: { id: documentId }, id: {}, status: {}, name: {} },
      });
      return { status: data?.document?.status ?? null, name: data?.document?.name ?? null };
    } catch {
      return { status: null };
    }
  }

  /**
   * Replace a DRAFT document's line items in place.
   *
   * Only ever called for a draft. A document that has been sent for signature
   * or signed is a document the customer is relying on — rewriting its pricing
   * underneath them is not an update, it is a different document, and the
   * caller creates a new version instead.
   */
  async updateJobDocumentLines(
    documentId: string,
    lines: JobTreadDocLine[],
    opts: { name?: string; taxRate?: number } = {},
  ): Promise<{ ok: boolean; error?: string }> {
    try {
      const [defaultCode, defaultType] = await Promise.all([this.getDefaultCostCodeId(), this.getDefaultCostTypeId()]);
      const lineItems = lines.slice(0, 200).map((l) => JobTreadClient.costLinePayload(l, defaultCode, defaultType));
      await this.pave<any>({
        updateDocument: {
          $: {
            id: documentId,
            ...(opts.name ? { name: opts.name.slice(0, 128) } : {}),
            ...(opts.taxRate != null ? { taxRate: Math.min(Math.max(opts.taxRate, 0), 1) } : {}),
            // lineItems is a full replacement, which is what we want: the
            // report is the source of truth for scope and price.
            lineItems,
          },
          document: { $: { id: documentId }, id: {} },
        },
      });
      return { ok: true };
    } catch (error: any) {
      return { ok: false, error: error?.message || 'JobTread document update failed' };
    }
  }

  /** Add cost items to a job's BUDGET (the internal cost plan, not a document). */
  async addJobBudgetItems(jobId: string, lines: JobTreadDocLine[]): Promise<{ ok: boolean; created: number; error?: string }> {
    let created = 0;
    try {
      for (const l of lines.slice(0, 100)) {
        await this.pave<any>({
          createCostItem: {
            $: {
              jobId,
              name: String(l.name).slice(0, 250),
              ...(l.description ? { description: l.description.slice(0, 4096) } : {}),
              quantity: Number(l.quantity) || 1,
              ...(l.unitCost != null ? { unitCost: Number(l.unitCost) } : {}),
              unitPrice: Number(l.unitPrice) || 0,
              isTaxable: l.isTaxable !== false,
            },
            createdCostItem: { id: {} },
          },
        });
        created++;
      }
      return { ok: true, created };
    } catch (error: any) {
      return { ok: created > 0, created, error: error?.message || 'JobTread budget write failed' };
    }
  }

  /** Flip a draft document to `pending` — this is what activates click-to-sign. */
  /**
   * Which job does this document belong to? Needed to authorize document
   * actions — the document id alone says nothing about who owns the work, so
   * without this any signed-in user could act on any document.
   */
  async getDocumentJobId(documentId: string): Promise<string | null> {
    try {
      const data = await this.pave<any>({
        document: { $: { id: documentId }, id: {}, job: { id: {} } },
      });
      return data?.document?.job?.id ?? null;
    } catch {
      return null;
    }
  }

  async setDocumentStatus(documentId: string, status: 'draft' | 'pending' | 'approved' | 'denied'): Promise<{ ok: boolean; error?: string }> {
    try {
      await this.pave<any>({
        updateDocument: { $: { id: documentId, status }, document: { $: { id: documentId }, id: {} } },
      });
      return { ok: true };
    } catch (error: any) {
      return { ok: false, error: error?.message || 'JobTread status update failed' };
    }
  }

  /**
   * Email a document to the customer for signature. Two steps: add them as a
   * signing recipient, then send. Only ever called from an explicit user action.
   */
  async sendDocumentToCustomer(
    documentId: string,
    to: { name: string; email: string },
    emailMessage?: string,
  ): Promise<{ ok: boolean; error?: string }> {
    try {
      const rec = await this.pave<any>({
        createDocumentRecipient: {
          $: {
            documentId,
            requireSignature: true,
            assignee: { user: { name: to.name.slice(0, 128), emailAddress: to.email } },
          },
          createdDocumentRecipient: { id: {} },
        },
      });
      const recipientId = rec?.createDocumentRecipient?.createdDocumentRecipient?.id;
      if (!recipientId) return { ok: false, error: 'JobTread did not return a recipient id' };

      await this.pave<any>({
        sendDocument: {
          $: { documentRecipientId: recipientId, ...(emailMessage ? { emailMessage: emailMessage.slice(0, 10000) } : {}) },
          document: { $: { id: documentId }, id: {} },
        },
      });
      return { ok: true };
    } catch (error: any) {
      return { ok: false, error: error?.message || 'JobTread send failed' };
    }
  }

  /**
   * Attach a file (usually a job-site photo) to a JobTread job.
   *
   * JobTread's documented two-step upload: `createUploadRequest` returns a
   * url/method/headers to send the bytes to, then `createFile` attaches that
   * upload to the job. Verified against the live schema.
   */
  async uploadJobFile(
    jobId: string,
    params: { name: string; contentType: string; data: Buffer; description?: string; folder?: string },
  ): Promise<{ ok: boolean; fileId?: string; error?: string }> {
    try {
      // organizationId is required. Without it JobTread still returns an
      // upload request and still accepts the bytes — then createFile rejects
      // it with "A valid upload request ID is required to create a new file
      // from an upload request". Every photo upload in the app failed this
      // way, and the two successful steps made it look like a save had worked.
      const orgId = await this.getOrganizationId();
      const reqData = await this.pave<any>({
        createUploadRequest: {
          $: { organizationId: orgId, size: params.data.length, type: params.contentType },
          createdUploadRequest: { id: {}, url: {}, method: {}, headers: {} },
        },
      });
      const ur = reqData?.createUploadRequest?.createdUploadRequest;
      if (!ur?.url || !ur?.id) return { ok: false, error: 'JobTread did not return an upload URL' };

      // A photo upload from a phone on a weak signal is the slow case, so it
      // gets longer than an API call — but not forever: a stalled PUT held the
      // whole request until the function was killed, and the rep saw nothing.
      const put = await fetchWithTimeout(ur.url, {
        method: ur.method || 'PUT',
        headers: (ur.headers || {}) as Record<string, string>,
        body: new Uint8Array(params.data),
      }, UPLOAD_TIMEOUT_MS);
      if (!put.ok) {
        const t = await put.text().catch(() => '');
        return { ok: false, error: `Upload failed (${put.status}) ${t.slice(0, 120)}`.trim() };
      }

      const created = await this.pave<any>({
        createFile: {
          $: {
            uploadRequestId: ur.id,
            name: params.name.slice(0, 128),
            targetType: 'job',
            targetId: jobId,
            ...(params.description ? { description: params.description.slice(0, 500) } : {}),
            ...(params.folder ? { folder: params.folder.slice(0, 100) } : {}),
          },
          createdFile: { id: {}, name: {} },
        },
      });
      return { ok: true, fileId: created?.createFile?.createdFile?.id };
    } catch (error: any) {
      console.warn('JobTread: file upload failed -', error.message);
      return { ok: false, error: error?.message || 'JobTread upload failed' };
    }
  }

  /**
   * A job's daily logs (production progress). Verified `dailyLog` fields:
   * date, notes, weatherCondition, min/maxTemperature, user.
   */
  async getJobDailyLogs(jobId: string, limit = 20): Promise<{ logs: Array<{ id: string; date?: string; notes: string; weather?: string; minTemp?: number | null; maxTemp?: number | null; author?: string }> }> {
    try {
      const size = Math.min(Math.max(limit, 1), 50);
      const data = await this.pave<any>({
        job: {
          $: { id: jobId },
          dailyLogs: {
            $: { size, sortBy: [{ field: 'date', order: 'desc' }] },
            nodes: { id: {}, date: {}, createdAt: {}, notes: {}, weatherCondition: {}, minTemperature: {}, maxTemperature: {}, user: { name: {} } },
          },
        },
      });
      const nodes = data?.job?.dailyLogs?.nodes || [];
      return {
        logs: nodes.map((l: any) => ({
          id: l.id, date: l.date || l.createdAt || undefined, notes: l.notes || '',
          weather: l.weatherCondition || undefined,
          minTemp: l.minTemperature ?? null, maxTemp: l.maxTemperature ?? null,
          author: l.user?.name || undefined,
        })),
      };
    } catch (error: any) {
      console.warn('JobTread: Cannot list daily logs -', error.message);
      return { logs: [] };
    }
  }

  // ==================== WRITE-BACK ====================

  /**
   * Move a job's pipeline stage — writes the "Status" custom field. `updateJob`
   * is a write op that returns `root`, so we re-select `job` to read it back.
   */
  async setJobStage(jobId: string, stage: string): Promise<{ ok: boolean; stage?: string; error?: string }> {
    if (!isValidJobStatus(stage)) return { ok: false, error: `Invalid stage "${stage}"` };
    try {
      const data = await this.pave<any>({
        updateJob: {
          $: { id: jobId, customFieldValues: { [JT_STATUS_FIELD]: stage } },
          job: {
            $: { id: jobId },
            id: {},
            customFieldValues: { $: { size: 30 }, nodes: { value: {}, customField: { id: {} } } },
          },
        },
      });
      const nodes = data?.updateJob?.job?.customFieldValues?.nodes || [];
      const after = nodes.find((n: any) => n.customField?.id === JT_STATUS_FIELD)?.value;
      return { ok: true, stage: typeof after === 'string' ? after : stage };
    } catch (error: any) {
      return { ok: false, error: error?.message || 'JobTread stage update failed' };
    }
  }

  /**
   * The choices in JobTread's job "Sales Rep" dropdown — the names a job can
   * be attributed to. The app's team roster maps each person to one of these
   * (teamMembers.jobtreadSalesRep); this is how the roster learns a rep
   * JobTread already has.
   */
  async getSalesRepOptions(): Promise<string[]> {
    const r = await this.pave<any>({ customField: { $: { id: JT_SALES_REP_FIELD }, id: {}, name: {}, options: {} } });
    const opts = r?.customField?.options;
    return Array.isArray(opts) ? opts.map((o: unknown) => String(o).trim()).filter(Boolean) : [];
  }

  /** Push a Sales Rep assignment back to JobTread's "Sales Rep" custom field. */
  async setJobSalesRep(jobId: string, repName: string): Promise<{ ok: boolean; error?: string }> {
    try {
      await this.pave<any>({
        updateJob: { $: { id: jobId, customFieldValues: { [JT_SALES_REP_FIELD]: repName } }, job: { $: { id: jobId }, id: {} } },
      });
      return { ok: true };
    } catch (error: any) {
      return { ok: false, error: error?.message || 'JobTread sales-rep update failed' };
    }
  }

  /**
   * The organization's JOB custom fields (id, name, type, dropdown options),
   * so a field can be written by the name everyone knows it by rather than by
   * an id copied out of JobTread's settings.
   */
  async getJobCustomFieldDefs(): Promise<Array<{ id: string; name: string; type: string | null; options: string[] }>> {
    const org = await this.getOrganizationId();
    const r = await this.pave<any>({
      organization: {
        $: { id: org },
        customFields: { $: { size: 100 }, nodes: { id: {}, name: {}, type: {}, targetType: {}, options: {} } },
      },
    });
    const nodes = r?.organization?.customFields?.nodes || [];
    return nodes
      .filter((n: any) => n?.targetType === 'job' && n?.id && n?.name)
      .map((n: any) => ({
        id: String(n.id),
        name: String(n.name),
        type: n.type ? String(n.type) : null,
        options: Array.isArray(n.options) ? n.options.map((o: unknown) => String(o).trim()).filter(Boolean) : [],
      }));
  }

  /**
   * Correct a job's account details: the customer (account) name, the job
   * name, the location's address, and any job custom fields by name (null
   * clears one). A dropdown field is checked against its options first, so a
   * bad value comes back as a plain message instead of a half-applied save.
   */
  async updateJobAccount(
    jobId: string,
    edit: { customer?: string; jobName?: string; address?: string; customFields?: Record<string, string | boolean | null> },
  ): Promise<{ ok: boolean; error?: string }> {
    try {
      const cfv: Record<string, string | boolean | null> = {};
      const wanted = Object.entries(edit.customFields || {});
      if (wanted.length) {
        const defs = await this.getJobCustomFieldDefs().catch(() => [] as Awaited<ReturnType<JobTreadClient['getJobCustomFieldDefs']>>);
        const find = (name: string) => defs.find((d) => d.name.toLowerCase() === name.toLowerCase());
        // Fallback: a field this job already has a value in names its own id.
        if (wanted.some(([name]) => !find(name))) {
          const r = await this.pave<any>({
            job: { $: { id: jobId }, customFieldValues: { $: { size: 60 }, nodes: { customField: { id: {}, name: {} } } } },
          });
          for (const n of r?.job?.customFieldValues?.nodes || []) {
            if (n?.customField?.id && n?.customField?.name && !find(n.customField.name)) {
              defs.push({ id: String(n.customField.id), name: String(n.customField.name), type: null, options: [] });
            }
          }
        }
        for (const [name, value] of wanted) {
          const def = find(name);
          if (!def) return { ok: false, error: `JobTread has no job field called "${name}".` };
          if (typeof value === 'string' && def.options.length && !def.options.includes(value)) {
            return { ok: false, error: `"${value}" isn't a choice for ${def.name}. Pick one of: ${def.options.join(', ')}.` };
          }
          // A yes/no kept as a dropdown takes the words, a checkbox the boolean.
          cfv[def.id] = typeof value === 'boolean' && def.options.length ? String(value) : value;
        }
      }

      if (edit.customer !== undefined || edit.address !== undefined) {
        const r = await this.pave<any>({ job: { $: { id: jobId }, location: { id: {}, account: { id: {} } } } });
        const locationId = r?.job?.location?.id;
        const accountId = r?.job?.location?.account?.id;
        if (edit.customer !== undefined) {
          if (!accountId) return { ok: false, error: 'This job has no customer account in JobTread.' };
          await this.pave<any>({ updateAccount: { $: { id: accountId, name: edit.customer }, account: { $: { id: accountId }, id: {} } } });
        }
        if (edit.address !== undefined) {
          if (!locationId) return { ok: false, error: 'This job has no location in JobTread.' };
          await this.pave<any>({ updateLocation: { $: { id: locationId, address: edit.address }, location: { $: { id: locationId }, id: {} } } });
        }
      }

      if (edit.jobName !== undefined || Object.keys(cfv).length) {
        await this.pave<any>({
          updateJob: {
            $: {
              id: jobId,
              ...(edit.jobName !== undefined ? { name: edit.jobName } : {}),
              ...(Object.keys(cfv).length ? { customFieldValues: cfv } : {}),
            },
            job: { $: { id: jobId }, id: {} },
          },
        });
      }
      return { ok: true };
    } catch (error: any) {
      return { ok: false, error: error?.message || 'JobTread account update failed' };
    }
  }

  /**
   * Update a job's customer contact info (email/phone). Resolves the job's
   * account primaryContact, then writes the Email/Mobile custom fields. Returns
   * the applied values (so callers can mirror them locally).
   */
  async updateJobContact(
    jobId: string,
    fields: { email?: string; phone?: string },
  ): Promise<{ ok: boolean; contactId?: string; error?: string }> {
    const cfv: Record<string, string> = {};
    if (fields.email !== undefined) cfv[JT_CONTACT_EMAIL_FIELD] = fields.email;
    if (fields.phone !== undefined) cfv[JT_CONTACT_MOBILE_FIELD] = fields.phone;
    if (Object.keys(cfv).length === 0) return { ok: false, error: 'Nothing to update' };
    try {
      // Resolve the primary contact id for this job.
      const r = await this.pave<any>({
        job: { $: { id: jobId }, location: { account: { primaryContact: { id: {} } } } },
      });
      const contactId = r?.job?.location?.account?.primaryContact?.id;
      if (!contactId) return { ok: false, error: 'No contact on this job' };
      await this.pave<any>({
        updateContact: {
          $: { id: contactId, customFieldValues: cfv },
          contact: { $: { id: contactId }, id: {} },
        },
      });
      return { ok: true, contactId };
    } catch (error: any) {
      return { ok: false, error: error?.message || 'JobTread contact update failed' };
    }
  }

  /**
   * Create a full JobTread lead: account → contact → location → job, with
   * Status="New Lead" and (optionally) the Sales Rep set. Sequential — if a
   * later step fails, returns what was created plus the error.
   */
  async createLead(lead: {
    firstName?: string; lastName?: string; name?: string;
    email?: string; phone?: string; address?: string; salesRep?: string;
  }): Promise<{ ok: boolean; jobId?: string; accountId?: string; error?: string }> {
    const displayName = (lead.name || `${lead.firstName || ''} ${lead.lastName || ''}`.trim() || 'New Lead').slice(0, 128);
    try {
      const org = await this.getOrganizationId();

      const a = await this.pave<any>({
        createAccount: {
          $: { organizationId: org, name: displayName, type: 'customer', suffixIfNecessary: true },
          createdAccount: { id: {} },
        },
      });
      const accountId = a?.createAccount?.createdAccount?.id;
      if (!accountId) return { ok: false, error: 'JobTread: account not created' };

      const contactFields: Record<string, string> = {};
      if (lead.email) contactFields[JT_CONTACT_EMAIL_FIELD] = lead.email;
      if (lead.phone) contactFields[JT_CONTACT_MOBILE_FIELD] = lead.phone;
      const c = await this.pave<any>({
        createContact: {
          $: { accountId, name: displayName, ...(Object.keys(contactFields).length ? { customFieldValues: contactFields } : {}) },
          createdContact: { id: {} },
        },
      });
      const contactId = c?.createContact?.createdContact?.id;

      const l = await this.pave<any>({
        createLocation: {
          $: { accountId, ...(lead.address ? { address: lead.address } : {}), ...(contactId ? { contactId } : {}) },
          createdLocation: { id: {} },
        },
      });
      const locationId = l?.createLocation?.createdLocation?.id;
      if (!locationId) return { ok: false, accountId, error: 'JobTread: location not created' };

      const jobCfv: Record<string, string> = { [JT_STATUS_FIELD]: 'New Lead' };
      if (lead.salesRep) jobCfv[JT_SALES_REP_FIELD] = lead.salesRep;
      const j = await this.pave<any>({
        createJob: {
          $: { locationId, name: displayName.slice(0, 30), customFieldValues: jobCfv },
          createdJob: { id: {} },
        },
      });
      const jobId = j?.createJob?.createdJob?.id;
      if (!jobId) return { ok: false, accountId, error: 'JobTread: job not created' };

      return { ok: true, jobId, accountId };
    } catch (error: any) {
      return { ok: false, error: error?.message || 'JobTread createLead failed' };
    }
  }

  /** Add an internal note/comment to a job (the JobTread activity feed). */
  async addJobComment(jobId: string, message: string, name?: string): Promise<{ ok: boolean; id?: string; error?: string }> {
    const msg = String(message || '').trim();
    if (!msg) return { ok: false, error: 'Empty note' };
    try {
      const data = await this.pave<any>({
        createComment: {
          $: {
            message: msg.slice(0, 4096),
            targetType: 'job',
            targetId: jobId,
            isVisibleToInternalRoles: true,
            ...(name ? { name: name.slice(0, 128) } : {}),
          },
          createdComment: { id: {} },
        },
      });
      return { ok: true, id: data?.createComment?.createdComment?.id };
    } catch (error: any) {
      return { ok: false, error: error?.message || 'JobTread comment failed' };
    }
  }

  async getContact(contactId: string): Promise<{ contact: JobTreadContact }> {
    const data = await this.pave<any>({
      contact: {
        $: { id: contactId },
        id: {},
        name: {},
        email: {},
        phone: {},
        address: {
          fullAddress: {},
        },
        createdAt: {},
        updatedAt: {},
      },
    });

    return { contact: this.mapCustomerToContact(data.contact) };
  }

  async createContact(contact: Partial<JobTreadContact>): Promise<{ contact: JobTreadContact }> {
    const data = await this.pave<any>({
      createCustomer: {
        _args: {
          name: contact.companyName || `${contact.firstName || ''} ${contact.lastName || ''}`.trim(),
          firstName: contact.firstName,
          lastName: contact.lastName,
          email: contact.email,
          phoneNumber: contact.phone,
          ...(contact.address ? {
            address: {
              line1: contact.address.street1,
              line2: contact.address.street2,
              city: contact.address.city,
              state: contact.address.state,
              postalCode: contact.address.zip,
            },
          } : {}),
        },
        id: {},
        name: {},
        firstName: {},
        lastName: {},
        email: {},
        phoneNumber: {},
      },
    });

    return { contact: this.mapCustomerToContact(data.createCustomer) };
  }

  async updateContact(
    contactId: string,
    updates: Partial<JobTreadContact>
  ): Promise<{ contact: JobTreadContact }> {
    const data = await this.pave<any>({
      updateCustomer: {
        _args: {
          id: contactId,
          ...(updates.firstName ? { firstName: updates.firstName } : {}),
          ...(updates.lastName ? { lastName: updates.lastName } : {}),
          ...(updates.email ? { email: updates.email } : {}),
          ...(updates.phone ? { phoneNumber: updates.phone } : {}),
        },
        id: {},
        name: {},
        firstName: {},
        lastName: {},
        email: {},
        phoneNumber: {},
      },
    });

    return { contact: this.mapCustomerToContact(data.updateCustomer) };
  }

  // ==================== JOBS ====================

  async getJobs(params?: {
    status?: string;
    customerId?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ jobs: JobTreadJob[]; total: number; truncated?: boolean }> {
    try {
      // A status filter with no limit means "all of them": the CEO's active-job
      // count and the CFO's pipeline value read it, and the old default of 50
      // newest jobs, filtered in memory, put whatever fraction of those 50 were
      // in progress on the dashboard as the company's total.
      const limit = params?.limit || (params?.status ? SCAN_CAP : 50);
      // JobTread jobs expose id/name/status/createdAt/closedOn/projectedPriceWithTax
      // and a related `location` (address + account). Use the SINGULAR
      // organization.<id>.jobs form (like getLeadKpis + the invoices query): the old
      // query requested fields that don't exist (HTTP 400), and the plural
      // organizations.nodes.jobs form 413s ("Request Entity Too Large") at size 50.
      const orgId = await this.getOrganizationId();
      const status = params?.status;
      const paged = await collectPages(async (page) => {
        const result = await this.pave<any>({
          organization: {
            $: { id: orgId },
            jobs: {
              $: { size: PAGE_SIZE, sortBy: [{ field: 'createdAt', order: 'desc' }], ...(page ? { page } : {}) },
              count: {},
              nextPage: {},
              nodes: {
                id: {},
                name: {},
                status: {},
                createdAt: {},
                closedOn: {},
                projectedPriceWithTax: {},
                location: { address: {}, account: { name: {} } },
              },
            },
          },
        });
        return result?.organization?.jobs;
      }, { want: limit, keep: status ? (j) => this.matchesJobStatus(j.status, status) : undefined });

      const filteredJobs = paged.nodes;
      // Unfiltered, JobTread's count is the total. Filtered, only a full scan
      // knows it; a partial one says so rather than passing a floor off as
      // the number.
      const total = status
        ? filteredJobs.length
        : paged.count ?? filteredJobs.length;

      return {
        truncated: status && !paged.exhausted ? true : undefined,
        jobs: filteredJobs.slice(0, limit).map((j: any): JobTreadJob => ({
          id: j.id,
          name: j.name,
          status: j.status || 'lead',
          customerId: '',
          customer: j.location?.account?.name
            ? { id: '', type: 'customer', companyName: j.location.account.name }
            : undefined,
          estimatedValue: Number(j.projectedPriceWithTax || 0),
          startDate: j.createdAt,
          createdAt: j.createdAt,
          address: j.location?.address ? { street1: j.location.address } : undefined,
        })),
        total,
      };
    } catch (error: any) {
      console.warn('JobTread: Cannot list jobs -', error.message);
      throw new Error(`JobTread API error: ${error.message}`);
    }
  }

  /**
   * Voice-friendly job search with customer name and address included.
   * Used by the Vapi assistant's lookup_job tool.
   */
  async searchJobs(
    query?: string,
    limit: number = 5,
    options?: {
      status?: string;
      createdAfter?: string;
      createdBefore?: string;
    }
  ): Promise<Array<{
    id: string;
    name: string;
    status: string;
    customerName: string;
    address: string;
    createdAt?: string;
    projectedPriceWithTax: number;
    closedOn?: string | null;
    /** JobTread "Sales Rep" dropdown value — null when unassigned. */
    salesRep?: string | null;
  }>> {
    const searchTerms = this.buildJobSearchTerms(query);
    const jtQuery: Record<string, any> = {
      size: Math.min(Math.max(limit * 5, 15), 60),
      sortBy: [{ field: 'createdAt', order: 'desc' }],
    };

    const whereClauses: any[] = [];
    if (searchTerms.length > 0) {
      whereClauses.push({
        or: searchTerms.flatMap(term => [
          ['name', 'like', `%${term}%`],
          [['location', 'account', 'name'], 'like', `%${term}%`],
          [['location', 'address'], 'like', `%${term}%`],
        ]),
      });
    }
    if (options?.createdAfter) whereClauses.push(['createdAt', '>=', options.createdAfter]);
    if (options?.createdBefore) whereClauses.push(['createdAt', '<=', options.createdBefore]);
    if (whereClauses.length === 1) jtQuery.where = whereClauses[0];
    if (whereClauses.length > 1) jtQuery.where = { and: whereClauses };

    const result = await this.pave<any>({
      organizations: {
        nodes: {
          jobs: {
            $: jtQuery,
            nodes: {
              id: {},
              name: {},
              status: {},
              createdAt: {},
              closedOn: {},
              projectedPriceWithTax: {},
              location: {
                address: {},
                account: { name: {} },
              },
              // Needed so callers can scope results to the reps a viewer may
              // see — without it this search is unavoidably org-wide.
              customFieldValues: { $: { size: 40 }, nodes: { value: {}, customField: { id: {} } } },
            },
          },
        },
      },
    });

    const flat: Array<{
      id: string;
      name: string;
      status: string;
      customerName: string;
      address: string;
      createdAt?: string;
      projectedPriceWithTax: number;
      closedOn?: string | null;
      salesRep?: string | null;
    }> = [];
    for (const org of result?.organizations?.nodes || []) {
      for (const j of org?.jobs?.nodes || []) {
        const repCfv = (j?.customFieldValues?.nodes || [])
          .find((n: any) => n?.customField?.id === JT_SALES_REP_FIELD);
        flat.push({
          id: j.id,
          name: j.name || '',
          status: j.status || '',
          customerName: j?.location?.account?.name || '',
          address: j?.location?.address || '',
          createdAt: j.createdAt,
          projectedPriceWithTax: Number(j.projectedPriceWithTax || 0),
          closedOn: j.closedOn,
          salesRep: repCfv?.value ?? null,
        });
      }
    }

    const rankedMatches = !query?.trim()
      ? flat
      : (() => {
          const ranked = flat
            .map(job => ({
              job,
              score: this.scoreJobSearchMatch(job, query),
            }))
            .filter(match => match.score > 0)
            .sort((a, b) => b.score - a.score);

          if (ranked.length === 0) return [];

          const topScore = ranked[0].score;
          const minScore = topScore >= 40 ? Math.max(30, topScore / 2) : topScore;
          return ranked
            .filter(match => match.score >= minScore)
            .map(match => match.job);
        })();

    const filteredByStatus = options?.status
      ? rankedMatches.filter(job => this.matchesJobStatus(job.status, options.status!))
      : rankedMatches;

    return filteredByStatus.slice(0, limit);
  }

  /**
   * Lead KPIs based on JobTread jobs created in the requested period.
   * Assumption: each newly created JobTread job represents a lead entry.
   */
  async getLeadKpis(params?: {
    period?: 'month' | 'year';
    startDate?: string;
    endDate?: string;
    limit?: number;
  }): Promise<JobTreadLeadKpis> {
    const period = this.resolveLeadPeriod(params);
    const leads = await this.getLeadSnapshotsForRange(period.startDate, period.endDate);
    const limit = Math.min(Math.max(Number(params?.limit) || 10, 1), 50);

    const openStatuses = new Set(['created', 'pending']);
    const wonStatuses = new Set(['approved', 'paid', 'closed']);

    const byStatus: JobTreadLeadKpis['byStatus'] = {};
    let open = 0;
    let won = 0;
    let paid = 0;
    let priced = 0;
    let totalProjected = 0;
    let wonProjected = 0;
    let paidProjected = 0;

    for (const lead of leads) {
      const status = (lead.status || 'unknown').toLowerCase();
      const value = Number(lead.projectedPriceWithTax || 0);

      if (!byStatus[status]) {
        byStatus[status] = { count: 0, projectedValue: 0 };
      }
      byStatus[status].count += 1;
      byStatus[status].projectedValue += value;

      if (openStatuses.has(status)) open += 1;
      if (wonStatuses.has(status)) {
        won += 1;
        wonProjected += value;
      }
      if (status === 'paid') {
        paid += 1;
        paidProjected += value;
      }
      if (value > 0) {
        priced += 1;
        totalProjected += value;
      }
    }

    return {
      period,
      totals: {
        leads: leads.length,
        open,
        won,
        paid,
        priced,
      },
      rates: {
        winRate: leads.length > 0 ? won / leads.length : 0,
        paidRate: leads.length > 0 ? paid / leads.length : 0,
      },
      values: {
        totalProjected,
        wonProjected,
        paidProjected,
        averageProjected: priced > 0 ? totalProjected / priced : 0,
        averageWonProjected: won > 0 ? wonProjected / won : 0,
      },
      byStatus,
      recentLeads: leads.slice(0, limit).map(lead => ({
        id: lead.id,
        name: lead.name,
        customerName: lead.customerName,
        status: lead.status,
        createdAt: lead.createdAt,
        projectedPriceWithTax: lead.projectedPriceWithTax,
        address: lead.address,
      })),
    };
  }

  private buildJobSearchTerms(query?: string): string[] {
    if (!query?.trim()) return [];

    const normalized = query
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (!normalized) return [];

    const suffixAliases: Record<string, string[]> = {
      avenue: ['ave'],
      ave: ['avenue'],
      boulevard: ['blvd'],
      blvd: ['boulevard'],
      circle: ['cir'],
      cir: ['circle'],
      court: ['ct'],
      ct: ['court'],
      drive: ['dr'],
      dr: ['drive'],
      highway: ['hwy'],
      hwy: ['highway'],
      lane: ['ln'],
      ln: ['lane'],
      parkway: ['pkwy'],
      pkwy: ['parkway'],
      place: ['pl'],
      pl: ['place'],
      road: ['rd'],
      rd: ['road'],
      street: ['st'],
      st: ['street'],
      terrace: ['ter'],
      ter: ['terrace'],
      trail: ['trl'],
      trl: ['trail'],
    };

    const tokens = normalized
      .split(' ')
      .map(token => token.trim())
      .filter(Boolean);

    const terms = new Set<string>([normalized]);
    for (const token of tokens) {
      if (token.length >= 3 || /\d/.test(token)) {
        terms.add(token);
      }
      for (const alias of suffixAliases[token] || []) {
        terms.add(alias);
      }
    }

    return Array.from(terms).slice(0, 8);
  }

  private scoreJobSearchMatch(
    job: {
      name: string;
      status: string;
      customerName: string;
      address: string;
      createdAt?: string;
    },
    query: string
  ): number {
    const normalizedQuery = query
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (!normalizedQuery) return 1;

    const fields = [
      job.name || '',
      job.customerName || '',
      job.address || '',
      job.status || '',
    ].map(value =>
      value
        .toLowerCase()
        .replace(/[^\w\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    );

    const combined = fields.join(' ');
    let score = 0;

    if (combined.includes(normalizedQuery)) score += 100;

    for (const token of this.buildJobSearchTerms(normalizedQuery)) {
      if (!token) continue;
      if (fields[0].includes(token)) score += 30;
      if (fields[1].includes(token)) score += 25;
      if (fields[2].includes(token)) score += 20;
      if (fields[3].includes(token)) score += 10;
    }

    return score;
  }

  private matchesJobStatus(jobStatus: string, requestedStatus: string): boolean {
    const normalizedJobStatus = this.normalizeStatus(jobStatus);
    const normalizedRequested = this.normalizeStatus(requestedStatus);
    if (!normalizedRequested) return true;
    if (normalizedJobStatus === normalizedRequested) return true;

    const aliases: Record<string, string[]> = {
      open: ['created', 'pending', 'estimate', 'proposal', 'in progress', 'in_progress'],
      active: ['created', 'pending', 'estimate', 'proposal', 'in progress', 'in_progress'],
      won: ['approved', 'paid', 'closed'],
      closed: ['approved', 'paid', 'closed', 'completed'],
      sold: ['approved', 'paid', 'closed'],
      unpaid: ['approved'],
      paid: ['paid'],
      approved: ['approved'],
      completed: ['completed', 'closed', 'paid'],
    };

    return (aliases[normalizedRequested] || []).includes(normalizedJobStatus);
  }

  private normalizeStatus(status?: string): string {
    return (status || '')
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private resolveLeadPeriod(params?: {
    period?: 'month' | 'year';
    startDate?: string;
    endDate?: string;
  }): JobTreadLeadKpis['period'] {
    const now = new Date();
    const asDateOnly = (value: Date) => value.toISOString().slice(0, 10);

    if (params?.startDate || params?.endDate) {
      const start = params?.startDate
        ? new Date(`${params.startDate}T00:00:00.000Z`)
        : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      const end = params?.endDate
        ? new Date(`${params.endDate}T23:59:59.999Z`)
        : now;

      return {
        key: 'custom',
        label: `${asDateOnly(start)} to ${asDateOnly(end)}`,
        startDate: start.toISOString(),
        endDate: end.toISOString(),
      };
    }

    if (params?.period === 'year') {
      const start = new Date(Date.UTC(now.getUTCFullYear(), 0, 1, 0, 0, 0, 0));
      return {
        key: 'year',
        label: `${now.getUTCFullYear()} year-to-date`,
        startDate: start.toISOString(),
        endDate: now.toISOString(),
      };
    }

    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
    const label = start.toLocaleDateString('en-US', {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    });

    return {
      key: 'month',
      label: `${label} month-to-date`,
      startDate: start.toISOString(),
      endDate: now.toISOString(),
    };
  }

  private async getLeadSnapshotsForRange(startDate: string, endDate: string): Promise<JobTreadLeadSnapshot[]> {
    const organizationId = await this.getOrganizationId();
    const leads: JobTreadLeadSnapshot[] = [];
    let page: string | undefined;

    do {
      const result = await this.pave<any>({
        organization: {
          $: { id: organizationId },
          jobs: {
            $: {
              size: 100,
              ...(page ? { page } : {}),
              sortBy: [{ field: 'createdAt', order: 'desc' }],
              where: {
                and: [
                  ['createdAt', '>=', startDate],
                  ['createdAt', '<=', endDate],
                ],
              },
            },
            nodes: {
              id: {},
              name: {},
              status: {},
              createdAt: {},
              closedOn: {},
              projectedPriceWithTax: {},
              location: {
                address: {},
                account: { name: {} },
              },
            },
            nextPage: {},
          },
        },
      });

      const connection = result?.organization?.jobs;
      for (const job of connection?.nodes || []) {
        leads.push({
          id: job.id,
          name: job.name || '',
          status: job.status || 'unknown',
          createdAt: job.createdAt || '',
          closedOn: job.closedOn,
          projectedPriceWithTax: Number(job.projectedPriceWithTax || 0),
          customerName: job?.location?.account?.name || '',
          address: job?.location?.address || '',
        });
      }

      page = connection?.nextPage || undefined;
    } while (page);

    return leads;
  }

  async getOrganizationId(): Promise<string> {
    if (this.organizationId) return this.organizationId;

    const result = await this.pave<any>({
      organizations: {
        nodes: {
          id: {},
        },
      },
    });

    const organizationId = result?.organizations?.nodes?.[0]?.id;
    if (!organizationId) {
      throw new Error('Unable to determine JobTread organization id for lead KPIs.');
    }

    this.organizationId = organizationId;
    return organizationId;
  }

  /**
   * Field names checked against JobTread's own schema, not guessed. The
   * original selection asked for `startDate`, `endDate`, `updatedAt`,
   * `customer` and `address` — none of which exist on a job — so every call
   * came back `The field "startDate" does not exist at "job"` and this method
   * had never once returned a job. Dates live on `taskSummary`; the customer
   * and the address both hang off `location`.
   */
  async getJob(jobId: string): Promise<{ job: JobTreadJob }> {
    const data = await this.pave<any>({
      job: {
        $: { id: jobId },
        id: {},
        name: {},
        number: {},
        status: {},
        description: {},
        createdAt: {},
        closedOn: {},
        projectedPriceWithTax: {},
        taskSummary: { startDate: {}, endDate: {} },
        location: {
          address: {},
          account: { id: {}, name: {} },
        },
      },
    });

    if (!data?.job) throw new Error(`JobTread has no job ${jobId}`);

    // Flatten into the shape mapJob already expects, so the one caller (the
    // CFO agent) keeps the fields it reads.
    return {
      job: this.mapJob({
        ...data.job,
        startDate: data.job?.taskSummary?.startDate ?? null,
        endDate: data.job?.taskSummary?.endDate ?? null,
        customer: data.job?.location?.account ?? null,
        address: { fullAddress: data.job?.location?.address ?? '' },
      }),
    };
  }

  async createJob(job: {
    name: string;
    customerId: string;
    description?: string;
    address?: JobTreadJob['address'];
    status?: JobTreadJob['status'];
  }): Promise<{ job: JobTreadJob }> {
    const data = await this.pave<any>({
      createJob: {
        _args: {
          name: job.name,
          customerId: job.customerId,
          ...(job.description ? { description: job.description } : {}),
          ...(job.status ? { status: job.status } : {}),
          ...(job.address ? {
            address: {
              line1: job.address.street1,
              city: job.address.city,
              state: job.address.state,
              postalCode: job.address.zip,
            },
          } : {}),
        },
        id: {},
        name: {},
        number: {},
        status: {},
      },
    });

    return { job: this.mapJob(data.createJob) };
  }

  async updateJobStatus(
    jobId: string,
    status: JobTreadJob['status']
  ): Promise<{ job: JobTreadJob }> {
    const data = await this.pave<any>({
      updateJob: {
        _args: {
          id: jobId,
          status: status,
        },
        id: {},
        name: {},
        number: {},
        status: {},
      },
    });

    return { job: this.mapJob(data.updateJob) };
  }

  // ==================== INVOICES ====================

  async getInvoices(params?: {
    jobId?: string;
    status?: string;
    limit?: number;
    /** Keep only these; paging continues until `limit` pass or the pages run out. */
    keep?: (doc: { balance?: unknown; price?: unknown; status?: unknown }) => boolean;
  }): Promise<{ invoices: JobTreadInvoice[]; total: number; truncated?: boolean }> {
    try {
      // JobTread exposes invoices as `documents` of type customerInvoice — there is
      // no `organization.invoices` collection, so the old memberships query 400'd.
      // Mirror the proven sync query (server/sync/jobtread-sync.ts).
      const org = await this.getOrganizationId();
      const limit = params?.limit || 50;
      // Paged: one request of `size: limit` stopped at JobTread's 100, so a
      // caller asking for more silently got the newest 100.
      const paged = await collectPages(async (page) => {
        const data = await this.pave<any>({
          organization: {
            $: { id: org },
            docs: {
              _: 'documents',
              $: {
                where: ['type', 'customerInvoice'],
                size: Math.min(limit, PAGE_SIZE),
                sortBy: [{ field: 'issueDate', order: 'desc' }],
                ...(page ? { page } : {}),
              },
              count: {},
              nextPage: {},
              nodes: {
                id: {}, number: {}, name: {}, toName: {}, price: {}, balance: {},
                issueDate: {}, dueDate: {}, status: {}, job: { name: {} },
              },
            },
          },
        });
        return data?.organization?.docs;
      }, { want: limit, keep: params?.keep });

      const nodes = paged.nodes;
      const invoices: JobTreadInvoice[] = nodes.map((d: any) => {
        const amount = Number(d.price || 0);
        const amountDue = Number(d.balance ?? d.price ?? 0);
        return {
          id: d.id,
          jobId: d.job?.name || '',
          number: d.number != null ? String(d.number) : undefined,
          status: d.status || 'draft',
          amount,
          amountPaid: Math.max(0, amount - amountDue),
          amountDue,
          dueDate: d.dueDate || undefined,
          createdAt: d.issueDate || undefined,
        };
      });

      // Unfiltered, JobTread's count is the real total; filtered, only a full
      // scan knows it.
      const total = params?.keep ? invoices.length : paged.count ?? invoices.length;
      return {
        invoices,
        total,
        truncated: params?.keep && !paged.exhausted ? true : undefined,
      };
    } catch (error: any) {
      console.warn('JobTread: Cannot list invoices -', error.message);
      throw new Error(`JobTread API error: ${error.message}`);
    }
  }

  async getOutstandingInvoices(): Promise<{ invoices: JobTreadInvoice[]; totalDue: number; truncated?: boolean }> {
    // Every invoice with a balance, not the ones that happened to be among the
    // newest 100 — an unpaid invoice from last spring is exactly the
    // receivable the CFO's total must not leave out.
    const result = await this.getInvoices({
      limit: SCAN_CAP,
      keep: (d) => String(d.status ?? '') !== 'paid' && Number(d.balance ?? d.price ?? 0) > 0,
    });

    const outstanding = result.invoices.filter(inv => {
      if (inv.status === 'paid') return false;
      return inv.amountDue > 0;
    });

    const totalDue = outstanding.reduce((sum, inv) => sum + inv.amountDue, 0);

    return {
      invoices: outstanding,
      totalDue,
      truncated: result.truncated,
    };
  }

  async createInvoice(invoice: {
    jobId: string;
    amount: number;
    dueDate?: string;
    items?: Array<{
      description: string;
      quantity: number;
      unitPrice: number;
    }>;
  }): Promise<{ success: boolean; invoice?: JobTreadInvoice; error?: string }> {
    try {
      const data = await this.pave<any>({
        createInvoice: {
          _args: {
            jobId: invoice.jobId,
            amount: invoice.amount,
            ...(invoice.dueDate ? { dueDate: invoice.dueDate } : {}),
            ...(invoice.items ? { items: invoice.items } : {}),
          },
          id: {},
          number: {},
          status: {},
          amount: {},
          amountDue: {},
          dueDate: {},
        },
      });

      return {
        success: true,
        invoice: this.mapInvoice(data.createInvoice),
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  async sendInvoiceReminder(invoiceId: string): Promise<{ success: boolean; error?: string }> {
    try {
      await this.pave<any>({
        sendInvoiceReminder: {
          _args: { id: invoiceId },
          success: {},
        },
      });
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  // ==================== TASKS ====================


  async createTask(task: {
    title: string;
    description?: string;
    jobId?: string;
    dueDate?: string;
    assignedTo?: string;
    priority?: 'low' | 'medium' | 'high';
    contactId?: string;
  }): Promise<{ success: boolean; taskId?: string; error?: string }> {
    try {
      const data = await this.pave<any>({
        createTask: {
          _args: {
            title: task.title,
            status: 'pending',
            ...(task.description ? { description: task.description } : {}),
            ...(task.jobId ? { jobId: task.jobId } : {}),
            ...(task.dueDate ? { dueDate: task.dueDate } : {}),
            ...(task.assignedTo ? { assignedTo: task.assignedTo } : {}),
            ...(task.priority ? { priority: task.priority } : {}),
          },
          id: {},
        },
      });

      return {
        success: true,
        taskId: data.createTask.id,
      };
    } catch (error: any) {
      console.error('JobTread task creation error:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  async updateTaskStatus(
    taskId: string,
    status: JobTreadTask['status']
  ): Promise<{ task: JobTreadTask }> {
    const data = await this.pave<any>({
      updateTask: {
        _args: {
          id: taskId,
          status: status,
        },
        id: {},
        title: {},
        status: {},
      },
    });

    return { task: this.mapTask(data.updateTask) };
  }

  // ==================== ESTIMATES ====================


  async createEstimate(estimate: {
    jobId: string;
    items: Array<{
      description: string;
      quantity: number;
      unitPrice: number;
    }>;
  }): Promise<{ estimate: JobTreadEstimate }> {
    const data = await this.pave<any>({
      createEstimate: {
        _args: {
          jobId: estimate.jobId,
          items: estimate.items,
        },
        id: {},
        number: {},
        status: {},
        totalAmount: {},
        items: {
          description: {},
          quantity: {},
          unitPrice: {},
          total: {},
        },
      },
    });

    return { estimate: this.mapEstimate(data.createEstimate) };
  }

  // ==================== FINANCIAL REPORTS ====================

  async getRevenueReport(params: {
    startDate: string;
    endDate: string;
  }): Promise<{
    totalRevenue: number;
    invoicesSent: number;
    invoicesPaid: number;
    breakdown: Array<{
      date: string;
      revenue: number;
    }>;
  }> {
    // Get invoices within date range to calculate revenue
    const data = await this.pave<any>({
      invoices: {
        _args: {
          startDate: params.startDate,
          endDate: params.endDate,
          first: 1000,
        },
        id: {},
        status: {},
        amount: {},
        amountPaid: {},
        paidDate: {},
        sentDate: {},
      },
    });

    const invoices = data.invoices || [];
    const paidInvoices = invoices.filter((i: any) => i.status === 'paid');

    const totalRevenue = paidInvoices.reduce((sum: number, i: any) => sum + (i.amountPaid || 0), 0);
    const invoicesSent = invoices.filter((i: any) => i.sentDate).length;
    const invoicesPaid = paidInvoices.length;

    // Group by date for breakdown
    const revenueByDate: Record<string, number> = {};
    for (const inv of paidInvoices) {
      const date = inv.paidDate?.split('T')[0] || 'unknown';
      revenueByDate[date] = (revenueByDate[date] || 0) + (inv.amountPaid || 0);
    }

    const breakdown = Object.entries(revenueByDate).map(([date, revenue]) => ({
      date,
      revenue,
    }));

    return {
      totalRevenue,
      invoicesSent,
      invoicesPaid,
      breakdown,
    };
  }

  async getJobProfitability(jobId: string): Promise<{
    jobId: string;
    revenue: number;
    costs: number;
    profit: number;
    margin: number;
  }> {
    const data = await this.pave<any>({
      job: {
        _args: { id: jobId },
        id: {},
        actualAmount: {},
        estimatedAmount: {},
        costs: {
          amount: {},
        },
      },
    });

    const job = data.job;
    const revenue = job.actualAmount || job.estimatedAmount || 0;
    const costs = (job.costs || []).reduce((sum: number, c: any) => sum + (c.amount || 0), 0);
    const profit = revenue - costs;
    const margin = revenue > 0 ? profit / revenue : 0;

    return {
      jobId,
      revenue,
      costs,
      profit,
      margin,
    };
  }

  // ==================== DAILY LOGS ====================

  async getDailyLogs(jobId: string, params?: {
    startDate?: string;
    endDate?: string;
  }): Promise<{ logs: Array<{
    id: string;
    jobId: string;
    date: string;
    notes: string;
    weather?: string;
    workCompleted?: string;
    crewMembers?: string[];
    photos?: string[];
  }> }> {
    const data = await this.pave<any>({
      dailyLogs: {
        _args: {
          jobId: jobId,
          ...(params?.startDate ? { startDate: params.startDate } : {}),
          ...(params?.endDate ? { endDate: params.endDate } : {}),
        },
        id: {},
        date: {},
        notes: {},
        weather: {},
        workCompleted: {},
        crewMembers: {},
        photos: {},
      },
    });

    const logs = data.dailyLogs || [];
    return {
      logs: logs.map((l: any) => ({
        id: l.id,
        jobId: jobId,
        date: l.date,
        notes: l.notes || '',
        weather: l.weather,
        workCompleted: l.workCompleted,
        crewMembers: l.crewMembers,
        photos: l.photos,
      })),
    };
  }

  // ==================== WEBHOOKS ====================

  async registerWebhook(params: {
    url: string;
    events: string[];
  }): Promise<{ webhook: { id: string } }> {
    const data = await this.pave<any>({
      createWebhook: {
        _args: {
          url: params.url,
          events: params.events,
        },
        id: {},
      },
    });

    return { webhook: { id: data.createWebhook.id } };
  }

  // ==================== UTILITY ====================

  /**
   * Parse incoming webhook payload from JobTread
   */
  parseWebhookPayload(payload: any): {
    eventType: string;
    entityType: string;
    entityId: string;
    data: any;
  } {
    return {
      eventType: payload.event || payload.type || 'unknown',
      entityType: payload.entityType || payload.resource || 'unknown',
      entityId: payload.entityId || payload.id || '',
      data: payload.data || payload,
    };
  }

  /**
   * Convert JobTread contact to our lead format
   */
  contactToLead(contact: JobTreadContact): {
    firstName?: string;
    lastName?: string;
    email?: string;
    phone?: string;
    address?: string;
    city?: string;
    state?: string;
    zip?: string;
    source: string;
    externalId: string;
  } {
    return {
      firstName: contact.firstName,
      lastName: contact.lastName,
      email: contact.email,
      phone: contact.phone,
      address: contact.address?.street1,
      city: contact.address?.city,
      state: contact.address?.state,
      zip: contact.address?.zip,
      source: 'jobtread',
      externalId: contact.id,
    };
  }

  /**
   * Check if API is configured and working
   * Note: The JobTread Pave API requires:
   * - All Organizations grant scope for listing data
   * - Queries wrapped in {query: {...}} format
   * - Arguments via $ key: {job: {$: {id: "xxx"}, name: {}}}
   */
  async healthCheck(): Promise<{ ok: boolean; error?: string; data?: { organizations: number; jobs: number; contacts: number } }> {
    if (!this.apiKey) {
      return {
        ok: false,
        error: 'Missing JOBTREAD_API_KEY',
      };
    }

    try {
      // Query organizations with jobs and contacts count to verify data access
      const result = await this.pave<any>({
        organizations: {
          nodes: {
            id: {},
            name: {},
            jobs: { count: {} },
            contacts: { count: {} },
          },
          count: {},
        },
      });

      const orgs = result?.organizations?.nodes || [];
      const totalJobs = orgs.reduce((sum: number, org: any) => sum + (org.jobs?.count || 0), 0);
      const totalContacts = orgs.reduce((sum: number, org: any) => sum + (org.contacts?.count || 0), 0);

      return {
        ok: true,
        data: {
          organizations: result?.organizations?.count || orgs.length,
          jobs: totalJobs,
          contacts: totalContacts,
        },
      };
    } catch (error: any) {
      return {
        ok: false,
        error: error.message,
      };
    }
  }

  // ==================== MAPPING HELPERS ====================

  private mapCustomerToContact(customer: any): JobTreadContact {
    return {
      id: customer.id,
      type: 'customer',
      firstName: customer.firstName,
      lastName: customer.lastName,
      companyName: customer.name,
      email: customer.email,
      phone: customer.phoneNumber || customer.phone,
      address: customer.address ? {
        street1: customer.address.line1 || customer.address.fullAddress,
        street2: customer.address.line2,
        city: customer.address.city,
        state: customer.address.state,
        zip: customer.address.postalCode,
      } : undefined,
      notes: customer.notes,
      createdAt: customer.createdAt,
      updatedAt: customer.updatedAt,
    };
  }

  private mapJob(job: any): JobTreadJob {
    return {
      id: job.id,
      name: job.name,
      number: job.number,
      status: job.status || 'lead',
      customerId: job.customer?.id || '',
      customer: job.customer ? this.mapCustomerToContact(job.customer) : undefined,
      description: job.description,
      estimatedValue: job.estimatedAmount,
      actualValue: job.actualAmount,
      startDate: job.startDate,
      endDate: job.endDate,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      address: job.address ? {
        street1: job.address.line1 || job.address.fullAddress,
        city: job.address.city,
        state: job.address.state,
        zip: job.address.postalCode,
      } : undefined,
    };
  }

  private mapInvoice(invoice: any): JobTreadInvoice {
    return {
      id: invoice.id,
      jobId: invoice.job?.id || '',
      number: invoice.number,
      status: invoice.status || 'draft',
      amount: invoice.amount || 0,
      amountPaid: invoice.amountPaid || 0,
      amountDue: invoice.amountDue || invoice.amount || 0,
      dueDate: invoice.dueDate,
      sentDate: invoice.sentDate,
      paidDate: invoice.paidDate,
      createdAt: invoice.createdAt,
    };
  }

  private mapTask(task: any): JobTreadTask {
    return {
      id: task.id,
      jobId: task.job?.id,
      title: task.title,
      description: task.description,
      status: task.status || 'pending',
      dueDate: task.dueDate,
      assignedTo: task.assignedTo,
      priority: task.priority,
      createdAt: task.createdAt,
    };
  }

  private mapEstimate(estimate: any): JobTreadEstimate {
    return {
      id: estimate.id,
      jobId: estimate.job?.id || '',
      number: estimate.number,
      status: estimate.status || 'draft',
      totalAmount: estimate.totalAmount || 0,
      items: (estimate.items || []).map((item: any) => ({
        description: item.description || '',
        quantity: item.quantity || 0,
        unitPrice: item.unitPrice || 0,
        total: item.total || 0,
      })),
      createdAt: estimate.createdAt,
    };
  }
}
