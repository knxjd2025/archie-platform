/**
 * Tracerfy — property data, owner skip tracing and Lead Builder.
 * REST, bearer token, pay per hit (misses and previews are free).
 * Docs: https://www.tracerfy.com/skip-tracing-api-documentation/
 *
 * TRACERFY_API_KEY   the account's API key (Vercel env)
 * TRACERFY_BASE_URL  override; https://mock.tracerfy.com/v1/api is the free
 *                    sandbox (deterministic fake data, any token) used by tests.
 */

const DEFAULT_BASE = 'https://tracerfy.com/v1/api';

export class TracerfyError extends Error {
  constructor(message: string, public status: number, public body?: any) { super(message); }
}

export interface TracerfyPhone { number: string; type: string | null; carrier: string | null; dnc: boolean; tcpa: boolean; rank?: number }
export interface TracerfyEmail { email: string; rank?: number }

/** What the app keeps from a Tracerfy property row or lookup. Same shape for both. */
export interface EnrichedProperty {
  address: string; city: string | null; state: string | null; zip: string | null;
  lat: number | null; lng: number | null; apn: string | null;
  ownerName: string | null; owner2Name: string | null; mailingAddress: string | null;
  phones: TracerfyPhone[]; emails: TracerfyEmail[];
  litigator: boolean; contactClean: boolean;
  propertyType: string | null; yearBuilt: number | null; buildingSqft: number | null; stories: number | null;
  roofMaterial: string | null; roofConstruction: string | null;
  estimatedValue: number | null; equityPercent: number | null; yearsOwned: number | null; lastSaleDate: string | null;
  ownerOccupied: boolean | null; absenteeOwner: boolean | null; highEquity: boolean | null; freeClear: boolean | null;
  vacant: boolean | null; mlsActive: boolean | null;
  roofScore: number | null; sellScore: number | null; roofScoreFactors: Array<{ name: string; points: number; reason: string }>;
}

const str = (v: any): string | null => (v === undefined || v === null || v === '' ? null : String(v));
const num = (v: any): number | null => (v === undefined || v === null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const bool = (v: any): boolean | null => (typeof v === 'boolean' ? v : v === 'true' ? true : v === 'false' ? false : null);
const digits = (v: any): string => String(v ?? '').replace(/\D/g, '');

/** A Lead Builder row (flat CSV-style columns). */
export function mapLeadRow(r: any): EnrichedProperty {
  const phones: TracerfyPhone[] = [];
  const push = (n: any, type: string, dnc: any, tcpa: any, carrier?: any) => { const d = digits(n); if (d.length >= 10 && !phones.some((p) => p.number === d)) phones.push({ number: d, type, carrier: str(carrier), dnc: !!dnc, tcpa: !!tcpa }); };
  push(r.primary_phone, str(r.primary_phone_type) || 'Primary', r.primary_phone_dnc, r.primary_phone_tcpa, r.primary_phone_carrier);
  for (let i = 1; i <= 3; i++) push(r[`mobile_${i}`], 'Mobile', r[`mobile_${i}_dnc`], r[`mobile_${i}_tcpa`]);
  for (let i = 1; i <= 2; i++) push(r[`landline_${i}`], 'Landline', r[`landline_${i}_dnc`], r[`landline_${i}_tcpa`]);
  const emails: TracerfyEmail[] = [1, 2, 3].map((i) => str(r[`email_${i}`])).filter((e): e is string => !!e).map((email, i) => ({ email, rank: i + 1 }));
  const owner = [r.owner_1_first_name, r.owner_1_last_name].filter(Boolean).join(' ').trim() || null;
  const owner2 = [r.owner_2_first_name, r.owner_2_last_name].filter(Boolean).join(' ').trim() || null;
  return {
    address: String(r.address || '').trim(), city: str(r.city), state: str(r.state), zip: str(r.zip_code ?? r.zip),
    lat: num(r.latitude), lng: num(r.longitude), apn: str(r.apn),
    ownerName: owner, owner2Name: owner2,
    mailingAddress: [r.mail_address, r.mail_city, r.mail_state, r.mail_zip].filter(Boolean).join(', ') || null,
    phones, emails, litigator: !!r.litigator, contactClean: !!r.contact_clean,
    propertyType: str(r.property_type), yearBuilt: num(r.year_built), buildingSqft: num(r.building_size_sqft), stories: num(r.stories),
    roofMaterial: str(r.roof_material), roofConstruction: str(r.roof_construction),
    estimatedValue: num(r.estimated_value), equityPercent: num(r.equity_percent), yearsOwned: num(r.years_owned), lastSaleDate: str(r.last_sale_date),
    ownerOccupied: bool(r.owner_occupied), absenteeOwner: bool(r.absentee_owner), highEquity: bool(r.high_equity), freeClear: bool(r.free_clear),
    vacant: bool(r.vacant), mlsActive: bool(r.mls_active),
    roofScore: num(r.roof_renovate_propensity_score), sellScore: num(r.sell_propensity_score),
    roofScoreFactors: Array.isArray(r.roof_renovate_propensity_factors) ? r.roof_renovate_propensity_factors : [],
  };
}

/**
 * The single-address property lookup. The live docs draw owners / phones /
 * emails inside `property`; the API (and sandbox) actually return them beside
 * it as `owners`, `mailing_address` and `contacts`. Read both.
 */
export function mapPropertyLookup(body: any): EnrichedProperty | null {
  const p = body?.property;
  if (!body?.hit || !p) return null;
  const contacts = body.contacts && typeof body.contacts === 'object' ? body.contacts : {};
  const owners: any[] = Array.isArray(body.owners) ? body.owners : Array.isArray(p.owners) ? p.owners : [];
  const name = (o: any) => [o?.first_name, o?.last_name].filter(Boolean).join(' ').trim() || null;
  const rawPhones: any[] = Array.isArray(contacts.phones) ? contacts.phones : Array.isArray(p.phones) ? p.phones : [];
  const rawEmails: any[] = Array.isArray(contacts.emails) ? contacts.emails : Array.isArray(p.emails) ? p.emails : [];
  const phones: TracerfyPhone[] = rawPhones
    .map((x: any) => ({ number: digits(x.number), type: str(x.type), carrier: str(x.carrier), dnc: !!x.dnc, tcpa: !!x.tcpa, rank: num(x.rank) ?? undefined }))
    .filter((x: TracerfyPhone) => x.number.length >= 10);
  const emails: TracerfyEmail[] = rawEmails.map((x: any) => ({ email: String(x.email || ''), rank: num(x.rank) ?? undefined })).filter((x: TracerfyEmail) => !!x.email);
  const m = body.mailing_address ?? p.mailing_address;
  return {
    address: String(p.address || '').trim(), city: str(p.city), state: str(p.state), zip: str(p.zip_code ?? p.zip),
    lat: num(p.latitude), lng: num(p.longitude), apn: str(p.apn),
    ownerName: name(owners[0]), owner2Name: name(owners[1]),
    mailingAddress: typeof m === 'string' ? m : m ? [m.street ?? m.address, m.city, m.state, m.zip].filter(Boolean).join(', ') || null : null,
    phones, emails, litigator: !!(contacts.litigator ?? p.litigator), contactClean: !!(contacts.contact_clean ?? p.contact_clean),
    propertyType: str(p.property_type), yearBuilt: num(p.year_built), buildingSqft: num(p.building_size_sqft), stories: num(p.stories),
    roofMaterial: str(p.roof_material), roofConstruction: str(p.roof_construction),
    estimatedValue: num(p.estimated_value), equityPercent: num(p.equity_percent), yearsOwned: num(p.years_owned), lastSaleDate: str(p.last_sale_date),
    ownerOccupied: bool(p.owner_occupied), absenteeOwner: bool(p.absentee_owner), highEquity: bool(p.high_equity), freeClear: bool(p.free_clear),
    vacant: bool(p.vacant), mlsActive: bool(p.mls_active),
    roofScore: num(p.roof_renovate_propensity_score), sellScore: num(p.sell_propensity_score),
    roofScoreFactors: Array.isArray(p.roof_renovate_propensity_factors) ? p.roof_renovate_propensity_factors : [],
  };
}

/** The number a rep may dial or text from the app: mobile first, never DNC / TCPA-flagged. */
export function bestCleanPhone(phones: TracerfyPhone[]): TracerfyPhone | null {
  const clean = phones.filter((p) => !p.dnc && !p.tcpa);
  return clean.find((p) => /mobile/i.test(p.type || '')) || clean[0] || null;
}

export class TracerfyClient {
  private base: string;
  private key: string;
  constructor(opts: { apiKey?: string; baseUrl?: string } = {}) {
    this.key = opts.apiKey ?? process.env.TRACERFY_API_KEY ?? '';
    this.base = (opts.baseUrl ?? process.env.TRACERFY_BASE_URL ?? DEFAULT_BASE).replace(/\/+$/, '');
  }
  get configured(): boolean { return !!this.key; }
  get sandbox(): boolean { return /mock\.tracerfy\.com/.test(this.base); }

  private async call<T = any>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    if (!this.key) throw new TracerfyError('Tracerfy is not connected — add TRACERFY_API_KEY.', 503);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    try {
      const r = await fetch(`${this.base}${path}`, {
        method, signal: controller.signal,
        headers: { Authorization: `Bearer ${this.key}`, 'content-type': 'application/json', accept: 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await r.text();
      let json: any = null; try { json = JSON.parse(text); } catch { /* not json */ }
      if (!r.ok) {
        const msg = json?.error || json?.message || json?.detail || text.slice(0, 200) || `HTTP ${r.status}`;
        const friendly = r.status === 402 ? 'Tracerfy has no credits left — top up the account.'
          : r.status === 429 ? 'Tracerfy rate limit hit — wait a minute and try again.'
          : r.status === 401 ? 'Tracerfy rejected the API key.' : `Tracerfy: ${msg}`;
        throw new TracerfyError(friendly, r.status, json);
      }
      return json as T;
    } finally { clearTimeout(timer); }
  }

  analytics() { return this.call<{ balance: number; properties_traced: number }>('GET', '/analytics/'); }
  strategies() { return this.call<{ strategies: Array<{ key: string; label: string; description: string; default_filters: Record<string, unknown> }> }>('GET', '/property-search/filters/'); }

  previewList(input: { geography: unknown; filter_overrides: Record<string, unknown>; requested_count: number; include_pins?: boolean }) {
    return this.call<{ count: number; capped_count: number; requested_count: number; max_credit_cost: number; max_credit_cost_usd: number; pins?: Array<{ latitude: number; longitude: number }> }>(
      'POST', '/property-search/preview/', { strategy: 'custom', ...input });
  }
  executeList(input: { geography: unknown; filter_overrides: Record<string, unknown>; requested_count: number; name?: string }) {
    return this.call<{ id: number; status: string; requested_count: number; max_credit_cost: number; poll_url: string }>(
      'POST', '/property-search/execute/', { strategy: 'custom', ...input });
  }
  listStatus(id: number) {
    return this.call<{ id: number; status: string; progress_percent?: number; progress_stage?: string; actual_count?: number; credits_deducted?: number; error_message?: string }>('GET', `/lead-builder/${id}/`);
  }
  async listRows(id: number): Promise<any[]> {
    const rows: any[] = [];
    for (let page = 1; page <= 20; page++) {
      const r = await this.call<{ rows: any[]; total_pages?: number; page?: number }>('GET', `/lead-builder/${id}/rows/?page=${page}`);
      rows.push(...(r.rows || []));
      if (!r.total_pages || page >= r.total_pages || !(r.rows || []).length) break;
    }
    return rows;
  }
  propertyLookup(addr: { address: string; city?: string | null; state?: string | null; zip?: string | null }) {
    return this.call<any>('POST', '/property-search/lookup/', { address: addr.address, city: addr.city || undefined, state: addr.state || undefined, zip: addr.zip || undefined });
  }
}
