/**
 * A company's own credentials for an integration (Current CRM, CompanyCam),
 * kept in company_integrations and sealed with server/tenant/secrets.ts, the
 * same way the GHL connection is.
 *
 * resolveCredentials() is what every client asks for credentials. In order:
 *   1. the current company's saved credentials
 *   2. the deployment's env credentials, only if this company owns them
 *      (ownsEnvCredentials), exactly as before
 *   3. otherwise EnvCredentialsUnavailableError (409 "not connected"), the
 *      same error callers already handle
 *
 * The cache is keyed by company id, so one company's credentials can never be
 * handed to another company's request.
 */
import { and, eq } from 'drizzle-orm';
import { db } from '../db';
import { companyIntegrations } from '../../shared/schema';
import { currentCompanyId, requireCompanyId } from './context';
import { openSecret, sealSecret } from './secrets';
import { EnvCredentialsUnavailableError, ownsEnvCredentials } from './per-company';

export type CredentialSource = 'company' | 'shared';

export interface SavedCredentials<T> { creds: T; meta: Record<string, unknown> }

const TTL_MS = 60_000;
const cache = new Map<string, { value: SavedCredentials<unknown> | null; at: number }>();
const cacheKey = (companyId: string, provider: string) => `${companyId}|${provider}`;

/** The current company's saved credentials for `provider`, or null when it has none. */
export async function loadCompanyCredentials<T>(provider: string): Promise<SavedCredentials<T> | null> {
  const companyId = currentCompanyId();
  if (!companyId) return null;
  const key = cacheKey(companyId, provider);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value as SavedCredentials<T> | null;
  const [row] = await db.select().from(companyIntegrations)
    .where(and(eq(companyIntegrations.companyId, companyId), eq(companyIntegrations.provider, provider)));
  const value = row ? { creds: openSecret<T>(row.credentials), meta: (row.meta ?? {}) as Record<string, unknown> } : null;
  cache.set(key, { value, at: Date.now() });
  return value;
}

/** Save (or replace) the current company's credentials for `provider`. Callers verify them first. */
export async function saveCompanyCredentials(provider: string, creds: unknown, meta: Record<string, unknown> = {}): Promise<void> {
  const companyId = requireCompanyId();
  const credentials = sealSecret(creds);
  await db.insert(companyIntegrations)
    .values({ provider, credentials, meta })
    .onConflictDoUpdate({
      target: [companyIntegrations.companyId, companyIntegrations.provider],
      set: { credentials, meta, updatedAt: new Date() },
    });
  cache.delete(cacheKey(companyId, provider));
}

/** Remove the current company's saved credentials for `provider`. */
export async function deleteCompanyCredentials(provider: string): Promise<void> {
  const companyId = requireCompanyId();
  await db.delete(companyIntegrations)
    .where(and(eq(companyIntegrations.companyId, companyId), eq(companyIntegrations.provider, provider)));
  cache.delete(cacheKey(companyId, provider));
}

/** Forget cached credentials (after a change elsewhere, or between tests). */
export function clearCompanyCredentialsCache(companyId?: string): void {
  if (!companyId) { cache.clear(); return; }
  for (const key of [...cache.keys()]) if (key.startsWith(`${companyId}|`)) cache.delete(key);
}

/**
 * The credentials the current company's calls to `service` must use.
 * `fromEnv` reads the deployment's env credentials (null when unset); it is
 * only consulted for the company that owns them.
 */
export async function resolveCredentials<T>(
  provider: string,
  service: string,
  fromEnv: () => T | null,
): Promise<{ creds: T; source: CredentialSource; meta: Record<string, unknown> }> {
  if (!currentCompanyId()) throw new EnvCredentialsUnavailableError(service);
  const saved = await loadCompanyCredentials<T>(provider);
  if (saved) return { creds: saved.creds, source: 'company', meta: saved.meta };
  if (ownsEnvCredentials()) {
    const env = fromEnv();
    if (env) return { creds: env, source: 'shared', meta: {} };
  }
  throw new EnvCredentialsUnavailableError(service);
}

/** What the Integrations screen is told: never a secret. */
export interface ConnectionStatus { connected: boolean; source: CredentialSource | null; accountName?: string }

export async function connectionStatus(provider: string, service: string, fromEnv: () => unknown): Promise<ConnectionStatus> {
  try {
    const { source, meta } = await resolveCredentials(provider, service, fromEnv);
    const accountName = typeof meta.accountName === 'string' && meta.accountName ? meta.accountName : undefined;
    return { connected: true, source, ...(accountName ? { accountName } : {}) };
  } catch (e) {
    if (e instanceof EnvCredentialsUnavailableError) return { connected: false, source: null };
    throw e;
  }
}
