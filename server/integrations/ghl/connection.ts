/**
 * The current company's GHL connection: its sub-account (location) and the
 * token to call GHL with. Every GHL call in Archie goes through this, so a
 * company only ever reaches its own sub-account. There is no app-wide GHL
 * token: a company that has not connected GHL gets GhlNotConnectedError.
 *
 * Stored in company_integrations (provider 'ghl'), sealed with
 * server/tenant/secrets.ts. Two kinds:
 *   { kind: 'pit', token }  a Private Integration Token for the sub-account
 *   { kind: 'oauth', accessToken, refreshToken, expiresAt }  from the Archie
 *     GHL Marketplace app (token refresh lands with the Marketplace app)
 */
import { and, eq } from 'drizzle-orm';
import { db } from '../../db';
import { companies, companyIntegrations } from '../../../shared/schema';
import { currentCompanyId, requireCompanyId, runAsSystem } from '../../tenant/context';
import { openSecret, sealSecret } from '../../tenant/secrets';

export const GHL_API_BASE = 'https://services.leadconnectorhq.com';

export type GhlCredentials =
  | { kind: 'pit'; token: string }
  | { kind: 'oauth'; accessToken: string; refreshToken: string; expiresAt: number };

export interface GhlConnection { locationId: string; token: string }

export class GhlNotConnectedError extends Error {
  constructor(detail = 'This company has not connected its GHL sub-account yet.') {
    super(detail);
    this.name = 'GhlNotConnectedError';
  }
}

export class GhlLocationTakenError extends Error {
  constructor() {
    super('That GHL sub-account is already connected to another company.');
    this.name = 'GhlLocationTakenError';
  }
}

/**
 * Do these credentials open this location? Checked before saving, so a
 * company can only claim a sub-account it really controls.
 */
export async function verifyGhlCredentials(locationId: string, token: string): Promise<{ ok: true; name: string } | { ok: false; error: string }> {
  if (!/^[A-Za-z0-9]{10,40}$/.test(locationId)) return { ok: false, error: 'That does not look like a GHL location id.' };
  try {
    const res = await fetch(`${GHL_API_BASE}/locations/${encodeURIComponent(locationId)}`, {
      headers: ghlHeaders({ locationId, token }, '2021-07-28'),
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 401 || res.status === 403) return { ok: false, error: 'GHL refused that token for this location. Check the token and its scopes.' };
    if (!res.ok) return { ok: false, error: `GHL answered ${res.status} for that location.` };
    const data = await res.json();
    const loc = data.location ?? data;
    if (loc?.id && loc.id !== locationId) return { ok: false, error: 'That token belongs to a different GHL location.' };
    return { ok: true, name: String(loc?.name ?? '') };
  } catch {
    return { ok: false, error: 'Could not reach GHL. Try again in a minute.' };
  }
}

const TTL_MS = 60_000;
const cache = new Map<string, { conn: GhlConnection; at: number }>();

/** The current company's GHL connection. Throws GhlNotConnectedError when it has none. */
export async function ghlConnection(): Promise<GhlConnection> {
  const companyId = currentCompanyId();
  if (!companyId) throw new GhlNotConnectedError('GHL was called with no company in context.');
  const hit = cache.get(companyId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.conn;

  const [company] = await db.select({ locationId: companies.ghlLocationId }).from(companies).where(eq(companies.id, companyId));
  const [row] = await db.select().from(companyIntegrations)
    .where(and(eq(companyIntegrations.companyId, companyId), eq(companyIntegrations.provider, 'ghl')));
  if (!company?.locationId || !row) throw new GhlNotConnectedError();

  const creds = openSecret<GhlCredentials>(row.credentials);
  let token: string;
  if (creds.kind === 'pit') token = creds.token;
  else {
    if (creds.expiresAt <= Date.now() + 60_000) throw new GhlNotConnectedError('The GHL connection has expired; reconnect the Archie app in GHL.');
    token = creds.accessToken;
  }
  if (!token) throw new GhlNotConnectedError();
  const conn = { locationId: company.locationId, token };
  cache.set(companyId, { conn, at: Date.now() });
  return conn;
}

/** True when the current company has a GHL connection (no network call). */
export async function hasGhlConnection(): Promise<boolean> {
  try { await ghlConnection(); return true; } catch (e) { if (e instanceof GhlNotConnectedError) return false; throw e; }
}

/** Save the current company's GHL credentials (and its location on the company row). */
export async function saveGhlConnection(locationId: string, creds: GhlCredentials): Promise<void> {
  const companyId = requireCompanyId();
  // A company cannot write its own companies row (row level security); the
  // location is set as system work, for exactly this company. Callers verify
  // first that the credentials really open this location (verifyGhlCredentials).
  try {
    await runAsSystem('save GHL location for a company', () =>
      db.update(companies).set({ ghlLocationId: locationId, updatedAt: new Date() }).where(eq(companies.id, companyId)));
  } catch (e: any) {
    if (e?.code === '23505' || e?.cause?.code === '23505') throw new GhlLocationTakenError();
    throw e;
  }
  await db.insert(companyIntegrations)
    .values({ provider: 'ghl', credentials: sealSecret(creds), meta: { kind: creds.kind } })
    .onConflictDoUpdate({
      target: [companyIntegrations.companyId, companyIntegrations.provider],
      set: { credentials: sealSecret(creds), meta: { kind: creds.kind }, updatedAt: new Date() },
    });
  cache.delete(companyId);
}

/** Forget cached connections (after a reconnect, or between tests). */
export function clearGhlConnectionCache(companyId?: string): void {
  if (companyId) cache.delete(companyId);
  else cache.clear();
}

/**
 * Where people open GHL in a browser. The white-label app domain (e.g.
 * https://app.kynexpro.com) when ARCHIE_GHL_APP_URL is set, so nobody sees
 * GHL's own name; GHL's default domain otherwise.
 */
export const ghlAppBase = (): string => (process.env.ARCHIE_GHL_APP_URL || 'https://app.gohighlevel.com').replace(/\/+$/, '');

/** The current company's GHL location id, or null when it has not connected GHL. */
export async function currentGhlLocationId(): Promise<string | null> {
  try { return (await ghlConnection()).locationId; } catch (e) { if (e instanceof GhlNotConnectedError) return null; throw e; }
}

/** Standard GHL request headers for a connection. */
export function ghlHeaders(conn: GhlConnection, version = '2021-07-28'): Record<string, string> {
  return {
    Authorization: `Bearer ${conn.token}`,
    Version: version,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}
