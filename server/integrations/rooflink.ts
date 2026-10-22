/**
 * RoofLink Public API client
 * Docs: https://developers.rooflink.com/ (index: https://developers.rooflink.com/llms.txt)
 *
 * RoofLink is the company's previous CRM. Every lead that enters GoHighLevel or
 * JobTread is also pushed into RoofLink, so it holds the full historical client
 * list plus a copy of everything current. Read-only here: we pull, never write.
 *
 * Auth: `X-API-KEY` header. Requests run as the company account owner.
 * Envelope: { count, from_index, to_index, next, previous, next_page, results }.
 */

import { assertEnvCredentials } from '../tenant/per-company';

const ROOFLINK_API_URL = 'https://integrate.rooflink.com/roof_link_endpoints/api';
const ROOFLINK_TIMEOUT_MS = 60_000;

export interface RlEmployee { id: number; name: string; email?: string | null; color?: string | null }
export interface RlNamed { id: number; name: string; color?: string | null }

export interface RlCustomer {
  id: number;
  name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  company_name?: string | null;
  cell?: string | null;
  phone?: string | null;
  phone_ext?: string | null;
  email?: string | null;
  cross_ref?: string | null;
}

export interface RlStep { date?: string | null; employee?: RlEmployee | null }

/** One row from GET /light/public/jobs/ (UnifiedJobResponse). Prospects and approved jobs both come back here. */
export interface RlJob {
  id: number;
  number?: string | null;
  name?: string | null;
  job_type?: string | null; // c=Commercial, r=Residential, d=Designer, m=MRP
  bid_type?: string | null; // c=Cash, i=Insurance, r=Repair, f=Finance
  address?: string | null;
  city?: string | null;
  county?: string | null;
  state?: string | null;
  zipcode?: string | null;
  full_address?: string | null;
  date_created: string;
  date_last_edited: string;
  date_signed?: string | null;
  date_completed?: string | null;
  customer?: RlCustomer | null;
  rep?: RlEmployee | null;
  rep_2?: RlEmployee | null;
  project_manager?: RlEmployee | null;
  lead_source?: RlNamed | null;
  region?: RlNamed | null;
  lead_status?: RlNamed | null;
  approved_step?: RlStep | null;
  submitted_step?: RlStep | null;
  rejected_step?: RlStep | null;
  closed_step?: RlStep | null;
  deleted_step?: RlStep | null;
  insurance_claim?: {
    id?: number;
    claim_number?: string | null;
    policy_number?: string | null;
    deductible?: string | null;
    status?: string | null;
    insurance_company?: RlNamed | null;
  } | null;
  estimate?: { id?: number; total?: string | number | null } | null;
  primary_estimate?: { id?: number; total?: string | number | null } | null;
}

export interface RlPage<T> {
  count: number;
  from_index?: number;
  to_index?: number;
  next: string | null;
  previous: string | null;
  next_page: number | null;
  results: T[];
}

export class RoofLinkClient {
  private apiKey: string;

  constructor(apiKey: string = process.env.ROOFLINK_API_KEY || '') {
    this.apiKey = apiKey;
  }

  isConfigured(): boolean {
    return !!this.apiKey;
  }

  async request<T>(path: string, params: Record<string, string | number | boolean | undefined> = {}): Promise<T> {
    assertEnvCredentials('RoofLink');
    if (!this.apiKey) throw new Error('ROOFLINK_API_KEY is not set');
    const url = new URL(`${ROOFLINK_API_URL}${path}`);
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') url.searchParams.set(k, String(v));

    // One retry on 429 — RoofLink rate-limits and an hourly full pull walks many pages.
    for (let attempt = 0; ; attempt++) {
      // A page normally takes ~15s; a stalled one had no limit and held the
      // whole sync until Vercel killed it at 300s. 60s leaves room for a slow page.
      const res = await fetch(url, {
        headers: { 'X-API-KEY': this.apiKey, Accept: 'application/json' },
        signal: AbortSignal.timeout(ROOFLINK_TIMEOUT_MS),
      });
      if (res.status === 429 && attempt < 2) {
        const wait = Number(res.headers.get('retry-after')) || 3;
        await new Promise((r) => setTimeout(r, Math.min(wait, 15) * 1000));
        continue;
      }
      if (!res.ok) throw new Error(`RoofLink ${res.status} ${path}: ${(await res.text()).slice(0, 300)}`);
      return (await res.json()) as T;
    }
  }

  /** GET /light/public/jobs/ — 100 per page, newest first. `editedAfter` narrows to recent edits. */
  listJobs(opts: { page?: number; pageSize?: number; editedAfter?: string; ordering?: string } = {}): Promise<RlPage<RlJob>> {
    return this.request<RlPage<RlJob>>('/light/public/jobs/', {
      page: opts.page ?? 1,
      page_size: opts.pageSize ?? 100,
      date_last_edited_after: opts.editedAfter,
      ordering: opts.ordering ?? '-date_created',
    });
  }

  /**
   * Walk every page of /light/public/jobs/. RoofLink takes ~15s per 100-job
   * page (measured live: 19 pages in 280s), which alone nearly exhausted the
   * 300s the hourly function gets. Pages after the first are fetched a few at
   * a time; order is preserved. `maxPages` is a safety cap, not a target.
   */
  async listAllJobs(opts: { editedAfter?: string; maxPages?: number; concurrency?: number } = {}): Promise<{ jobs: RlJob[]; total: number; truncated: boolean }> {
    const maxPages = opts.maxPages ?? 200; // 20,000 jobs
    const concurrency = Math.max(1, opts.concurrency ?? 4);
    const first = await this.listJobs({ page: 1, editedAfter: opts.editedAfter });
    const pageSize = Math.max(1, first.results?.length || 100);
    const wanted = first.next_page ? Math.ceil(first.count / pageSize) : 1;
    const lastPage = Math.min(wanted, maxPages);
    const pages: RlJob[][] = new Array(lastPage).fill(null).map(() => []);
    pages[0] = first.results || [];

    let next = 2;
    const worker = async () => {
      while (next <= lastPage) {
        const page = next++;
        const r = await this.listJobs({ page, editedAfter: opts.editedAfter });
        pages[page - 1] = r.results || [];
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(0, lastPage - 1)) }, worker));

    return { jobs: pages.flat(), total: first.count, truncated: wanted > maxPages };
  }

  getJob(id: number): Promise<RlJob> {
    return this.request<RlJob>(`/light/public/jobs/${id}/`);
  }

  /** GET /light/customers/ — 25 per page max. */
  listCustomers(page = 1): Promise<RlPage<RlCustomer & { rep?: RlEmployee | null; region?: RlNamed | null }>> {
    return this.request('/light/customers/', { page, page_size: 25 });
  }

  getCustomer(id: number): Promise<RlCustomer> {
    return this.request<RlCustomer>(`/light/customers/${id}/`);
  }

  /** Cheapest possible round-trip: one job. Proves the key works and reports how many jobs RoofLink holds. */
  async healthCheck(): Promise<{ ok: boolean; jobs?: number; error?: string }> {
    if (!this.apiKey) return { ok: false, error: 'ROOFLINK_API_KEY is not set' };
    try {
      const r = await this.request<RlPage<RlJob>>('/light/public/jobs/', { page: 1, page_size: 1 });
      return { ok: true, jobs: r.count };
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) };
    }
  }
}
