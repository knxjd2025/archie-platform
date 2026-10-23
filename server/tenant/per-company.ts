/**
 * Integration clients and the credentials they use, kept apart per company.
 *
 * perCompany(): a client that holds tokens (QuickBooks, Google OAuth, Plaid)
 * must never be one object for the whole process, or one company's request
 * runs with another's token while the first is between awaits. This gives
 * each company its own instance and refuses to make one with no company.
 *
 * Env credentials: a few integrations still read one account from the
 * environment (JobTread, Everee, Twilio, CompanyCam). Those belong
 * to exactly one company, named by ARCHIE_ENV_CREDENTIALS_COMPANY_ID, and any
 * other company is refused before a request leaves the server. Unset means
 * no company may use them. Each moves to per-company credentials
 * (company_integrations) as it is rebuilt.
 */
import { currentCompanyId } from './context';

export class EnvCredentialsUnavailableError extends Error {
  readonly status = 409;
  constructor(service: string) {
    super(`${service} is not connected for this company.`);
    this.name = 'EnvCredentialsUnavailableError';
  }
}

/** True when the current company owns the deployment's env credentials. */
export function ownsEnvCredentials(): boolean {
  const owner = (process.env.ARCHIE_ENV_CREDENTIALS_COMPANY_ID || '').trim().toLowerCase();
  const company = currentCompanyId();
  return !!owner && !!company && company.toLowerCase() === owner;
}

/** Throw unless the current company owns the deployment's env credentials for `service`. */
export function assertEnvCredentials(service: string): void {
  if (!ownsEnvCredentials()) throw new EnvCredentialsUnavailableError(service);
}

/** A getter that returns the current company's own instance of a client. */
export function perCompany<T>(service: string, make: () => T): () => T {
  const instances = new Map<string, T>();
  return () => {
    const company = currentCompanyId();
    if (!company) throw new Error(`${service} was used with no company in context.`);
    let inst = instances.get(company);
    if (!inst) { inst = make(); instances.set(company, inst); }
    return inst;
  };
}
