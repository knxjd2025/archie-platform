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
import { currentCompanyId, requireCompanyId } from '../../tenant/context';
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
  await db.update(companies).set({ ghlLocationId: locationId, updatedAt: new Date() }).where(eq(companies.id, companyId));
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

/** Standard GHL request headers for a connection. */
export function ghlHeaders(conn: GhlConnection, version = '2021-07-28'): Record<string, string> {
  return {
    Authorization: `Bearer ${conn.token}`,
    Version: version,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}
