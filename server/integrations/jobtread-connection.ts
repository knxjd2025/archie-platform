/**
 * The current company's Current CRM connection, when that CRM is JobTread.
 *
 * Stored per company in company_integrations (provider 'jobtread'), sealed,
 * and verified against JobTread before it is saved. The deployment's env key
 * (JOBTREAD_API_KEY) is still honoured for the one company that owns it
 * (ARCHIE_ENV_CREDENTIALS_COMPANY_ID); every other company must connect its own.
 */
import { connectionStatus, resolveCredentials, type CredentialSource } from '../tenant/company-credentials';

export const JOBTREAD_PROVIDER = 'jobtread';
export const JOBTREAD_SERVICE = 'JobTread';
export const JOBTREAD_API_URL = 'https://api.jobtread.com/pave';

export interface JobTreadCredentials {
  grantKey: string;
  /** The organization the key is used for. Absent only for the shared env key, which uses the first one it opens. */
  organizationId?: string;
}

export function envJobTreadCredentials(): JobTreadCredentials | null {
  const grantKey = (process.env.JOBTREAD_API_KEY || '').trim();
  return grantKey ? { grantKey } : null;
}

/** The credentials this company's JobTread calls use. Throws EnvCredentialsUnavailableError when it has none. */
export async function resolveJobTreadCredentials(): Promise<JobTreadCredentials & { source: CredentialSource }> {
  const { creds, source } = await resolveCredentials<JobTreadCredentials>(JOBTREAD_PROVIDER, JOBTREAD_SERVICE, envJobTreadCredentials);
  return { ...creds, source };
}

export const jobTreadConnectionStatus = () => connectionStatus(JOBTREAD_PROVIDER, JOBTREAD_SERVICE, envJobTreadCredentials);

/**
 * Does this grant key open JobTread, and which organization? The same
 * read-only call the client already makes to find its organization
 * (organizations { id name }). With no organization id the key must open
 * exactly one, so a key that reaches several cannot silently pick the wrong one.
 */
export async function verifyJobTreadCredentials(
  grantKey: string,
  organizationId?: string,
): Promise<{ ok: true; organizationId: string; name: string } | { ok: false; error: string }> {
  let res: Response;
  try {
    res = await fetch(JOBTREAD_API_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${grantKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: { organizations: { nodes: { id: {}, name: {} } } } }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return { ok: false, error: 'Could not reach JobTread. Try again in a minute.' };
  }
  if (res.status === 401 || res.status === 403) return { ok: false, error: 'JobTread refused that grant key. Check it and try again.' };
  if (!res.ok) return { ok: false, error: `JobTread answered ${res.status} for that grant key.` };
  const body: any = await res.json().catch(() => null);
  if (body?.errors?.length) return { ok: false, error: 'JobTread refused that grant key. Check it and try again.' };
  const orgs: Array<{ id: string; name?: string }> = body?.organizations?.nodes ?? [];
  if (!orgs.length) return { ok: false, error: 'That grant key does not open any JobTread organization.' };
  if (organizationId) {
    const org = orgs.find((o) => o.id === organizationId);
    if (!org) return { ok: false, error: 'That grant key does not open that organization. Check the Organization ID.' };
    return { ok: true, organizationId: org.id, name: String(org.name ?? '') };
  }
  if (orgs.length > 1) return { ok: false, error: 'That grant key opens more than one organization. Enter the Organization ID to pick one.' };
  return { ok: true, organizationId: orgs[0].id, name: String(orgs[0].name ?? '') };
}
