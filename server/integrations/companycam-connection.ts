/**
 * The current company's CompanyCam connection: an API token, stored per
 * company in company_integrations (provider 'companycam'), sealed, and checked
 * against CompanyCam before it is saved. The deployment's COMPANYCAM_API_TOKEN
 * is still honoured for the one company that owns the env credentials.
 */
import { connectionStatus, resolveCredentials, type CredentialSource } from '../tenant/company-credentials';
import { EnvCredentialsUnavailableError } from '../tenant/per-company';

export const COMPANYCAM_PROVIDER = 'companycam';
export const COMPANYCAM_SERVICE = 'CompanyCam';
export const COMPANYCAM_API_BASE = 'https://api.companycam.com/v2';

export interface CompanyCamCredentials { token: string }

export function envCompanyCamCredentials(): CompanyCamCredentials | null {
  const token = (process.env.COMPANYCAM_API_TOKEN || '').trim();
  return token ? { token } : null;
}

export async function resolveCompanyCamCredentials(): Promise<CompanyCamCredentials & { source: CredentialSource }> {
  const { creds, source } = await resolveCredentials<CompanyCamCredentials>(COMPANYCAM_PROVIDER, COMPANYCAM_SERVICE, envCompanyCamCredentials);
  return { ...creds, source };
}

export const companyCamConnectionStatus = () => connectionStatus(COMPANYCAM_PROVIDER, COMPANYCAM_SERVICE, envCompanyCamCredentials);

/** True when the current company can use CompanyCam (its own token, or the env one it owns). */
export async function companyCamConnected(): Promise<boolean> {
  try { await resolveCompanyCamCredentials(); return true; } catch (e) { if (e instanceof EnvCredentialsUnavailableError) return false; throw e; }
}

/** Does this token open a CompanyCam account? The client's own health check call (GET /company). */
export async function verifyCompanyCamToken(token: string): Promise<{ ok: true; name: string } | { ok: false; error: string }> {
  let res: Response;
  try {
    res = await fetch(`${COMPANYCAM_API_BASE}/company`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return { ok: false, error: 'Could not reach CompanyCam. Try again in a minute.' };
  }
  if (res.status === 401 || res.status === 403) return { ok: false, error: 'CompanyCam refused that API token. Check it and try again.' };
  if (!res.ok) return { ok: false, error: `CompanyCam answered ${res.status} for that token.` };
  const body: any = await res.json().catch(() => null);
  return { ok: true, name: String(body?.name ?? '') };
}
