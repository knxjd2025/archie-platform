/**
 * The Pave queries the JobTread archive runs, and how each answer becomes
 * archive rows. Kept free of I/O so the shapes can be tested.
 *
 * "Verified" means the same shape is already used against the live API
 * elsewhere in the app (leads-sync, jobtread-sync, the JobTread client).
 * "Unverified" shapes follow JobTread's naming but have never run; each one is
 * isolated, so if JobTread rejects a field that part records the error on the
 * status screen and everything else carries on.
 */

export interface ArchiveRow { entityType: string; jtId: string; jobId: string | null; data: unknown }
export interface Page { rows: ArchiveRow[]; nextPage: string | null }

/** JobTread pages at 100 at most (verified live). */
export const MAX_PAGE = 100;
/** A job listing with custom fields 413s above 25 per page (verified live). */
export const JOB_PAGE = 25;

export const DOCUMENT_TYPES = ['customerOrder', 'customerInvoice', 'vendorOrder', 'vendorBill'] as const;

const cfv = (size: number) => ({ $: { size }, nodes: { id: {}, value: {}, customField: { id: {}, name: {} } } });

/** Every field the archive keeps for a job. Superset of leads-sync's (verified) selection. */
export const JOB_NODE = {
  id: {}, name: {}, number: {}, status: {}, description: {}, createdAt: {}, closedOn: {}, projectedPriceWithTax: {},
  taskSummary: { startDate: {}, endDate: {}, progress: {} },
  location: {
    id: {}, address: {},
    account: { id: {}, name: {}, primaryContact: { id: {}, name: {} } },
  },
};

const pageArgs = (size: number, page: string | null, sortField = 'createdAt') => ({
  size, ...(page ? { page } : {}), sortBy: [{ field: sortField, order: 'asc' }],
});

const idOf = (n: any): string | null => (n && n.id != null ? String(n.id) : null);

function toRows(entityType: string, nodes: unknown, jobIdOf: (n: any) => string | null): ArchiveRow[] {
  if (!Array.isArray(nodes)) return [];
  return nodes
    .filter((n) => idOf(n))
    .map((n) => ({ entityType, jtId: idOf(n)!, jobId: jobIdOf(n), data: n }));
}

// ---------------------------------------------------------------- org-wide lists

export interface PagedStep {
  name: string;
  query: (org: string, page: string | null) => Record<string, unknown>;
  read: (result: any) => Page;
}

export const PAGED_STEPS: PagedStep[] = [
  {
    // Verified (leads-sync), without its 750-job cap. Custom fields are pulled
    // in full per job in the detail step — asking for them here 413s.
    name: 'jobs',
    query: (org, page) => ({ organization: { $: { id: org }, jobs: { $: pageArgs(JOB_PAGE, page), nodes: JOB_NODE, nextPage: {} } } }),
    read: (r) => ({ rows: toRows('job', r?.organization?.jobs?.nodes, idOf), nextPage: r?.organization?.jobs?.nextPage || null }),
  },
  {
    // Unverified: the organization's custom-field definitions, all targets.
    name: 'customFields',
    query: (org, page) => ({
      organization: { $: { id: org }, customFields: { $: pageArgs(MAX_PAGE, page, 'name'), nodes: { id: {}, name: {}, type: {}, targetType: {}, options: {} }, nextPage: {} } },
    }),
    read: (r) => ({ rows: toRows('customField', r?.organization?.customFields?.nodes, () => null), nextPage: r?.organization?.customFields?.nextPage || null }),
  },
  // Verified (jobtread-sync): the organization's documents by type, now paged.
  ...DOCUMENT_TYPES.map((type): PagedStep => ({
    name: `documents:${type}`,
    query: (org, page) => ({
      organization: {
        $: { id: org },
        docs: {
          _: 'documents',
          $: { where: ['type', type], ...pageArgs(MAX_PAGE, page) },
          nodes: {
            id: {}, number: {}, name: {}, toName: {}, type: {}, status: {}, price: {}, cost: {}, balance: {},
            issueDate: {}, dueDate: {}, signedAt: {}, createdAt: {}, job: { id: {}, name: {} },
          },
          nextPage: {},
        },
      },
    }),
    read: (r) => ({ rows: toRows('document', r?.organization?.docs?.nodes, (n) => idOf(n?.job)), nextPage: r?.organization?.docs?.nextPage || null }),
  })),
  {
    // Unverified: every payment recorded against a document.
    name: 'payments',
    query: (org, page) => ({
      organization: {
        $: { id: org },
        payments: { $: pageArgs(MAX_PAGE, page), nodes: { id: {}, amount: {}, description: {}, createdAt: {}, document: { id: {}, job: { id: {} } } }, nextPage: {} },
      },
    }),
    read: (r) => ({ rows: toRows('payment', r?.organization?.payments?.nodes, (n) => idOf(n?.document?.job)), nextPage: r?.organization?.payments?.nextPage || null }),
  },
];

// ---------------------------------------------------------------- per job

export interface JobPart {
  name: string;
  /** null page = first page. Parts that aren't paged ignore it. */
  query: (jobId: string, page: string | null) => Record<string, unknown>;
  read: (result: any, jobId: string) => Page;
}

const jobConn = (jobId: string, key: string, page: string | null, size: number, nodes: Record<string, unknown>, sortField = 'createdAt') => ({
  job: { $: { id: jobId }, [key]: { $: pageArgs(size, page, sortField), nodes, nextPage: {} } },
});

const readJobConn = (entityType: string, key: string) => (r: any, jobId: string): Page => ({
  rows: toRows(entityType, r?.job?.[key]?.nodes, () => jobId),
  nextPage: r?.job?.[key]?.nextPage || null,
});

export const JOB_PARTS: JobPart[] = [
  {
    // The whole job again, now with every custom field (Status, Sales Rep,
    // PM, insurance…) — replaces the listing's row with the complete one.
    name: 'job',
    query: (jobId) => ({ job: { $: { id: jobId }, ...JOB_NODE, customFieldValues: cfv(100) } }),
    read: (r, jobId) => ({ rows: r?.job ? [{ entityType: 'job', jtId: jobId, jobId, data: r.job }] : [], nextPage: null }),
  },
  {
    // Unverified: every contact on the customer's account, with email/phone fields.
    name: 'contacts',
    query: (jobId) => ({
      job: { $: { id: jobId }, location: { account: { id: {}, contacts: { $: { size: MAX_PAGE }, nodes: { id: {}, name: {}, customFieldValues: { $: { size: 50 }, nodes: { value: {}, customField: { name: {} } } } } } } } },
    }),
    read: (r, jobId) => {
      const account = r?.job?.location?.account;
      return {
        rows: toRows('contact', account?.contacts?.nodes, () => jobId).map((row) => ({ ...row, data: { ...(row.data as object), accountId: account?.id ?? null } })),
        nextPage: null,
      };
    },
  },
  {
    // Verified (getJobFiles). Both links: `url` is the viewable size, `originalUrl` the actual file.
    name: 'files',
    query: (jobId, page) => jobConn(jobId, 'files', page, MAX_PAGE, {
      id: {}, name: {}, type: {}, size: {}, folder: {}, description: {}, createdAt: {},
      url: { $: { size: 1600 } }, originalUrl: { _: 'url', $: { original: true } },
    }),
    read: readJobConn('file', 'files'),
  },
  {
    // Verified (getJobComments).
    name: 'comments',
    query: (jobId, page) => jobConn(jobId, 'comments', page, 50, {
      id: {}, message: {}, name: {}, createdAt: {}, isFromEmail: {}, createdByUser: { id: {}, name: {} },
    }),
    read: readJobConn('comment', 'comments'),
  },
  {
    // Verified (getJobDailyLogs).
    name: 'dailyLogs',
    query: (jobId, page) => jobConn(jobId, 'dailyLogs', page, 50, {
      id: {}, date: {}, createdAt: {}, notes: {}, weatherCondition: {}, minTemperature: {}, maxTemperature: {}, user: { id: {}, name: {} },
    }, 'date'),
    read: readJobConn('dailyLog', 'dailyLogs'),
  },
  {
    // Unverified: the job's schedule tasks.
    name: 'tasks',
    query: (jobId, page) => jobConn(jobId, 'tasks', page, MAX_PAGE, {
      id: {}, name: {}, description: {}, startDate: {}, endDate: {}, progress: {}, createdAt: {},
    }),
    read: readJobConn('task', 'tasks'),
  },
];

// ---------------------------------------------------------------- per document

/** Unverified: a document's line items (the input side, costItem, is verified). */
export function documentLinesQuery(documentId: string, page: string | null): Record<string, unknown> {
  return {
    document: {
      $: { id: documentId },
      costItems: {
        $: pageArgs(MAX_PAGE, page),
        nodes: {
          id: {}, name: {}, description: {}, quantity: {}, unitPrice: {}, unitCost: {}, isTaxable: {},
          costCode: { name: {} }, costType: { name: {} },
        },
        nextPage: {},
      },
    },
  };
}

export function readDocumentLines(r: any, documentId: string, jobId: string | null): Page {
  return {
    rows: toRows('documentLine', r?.document?.costItems?.nodes, () => jobId)
      .map((row) => ({ ...row, data: { ...(row.data as object), documentId } })),
    nextPage: r?.document?.costItems?.nextPage || null,
  };
}
