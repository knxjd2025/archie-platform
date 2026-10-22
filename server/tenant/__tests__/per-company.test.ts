import { describe, it, expect, vi, afterEach } from 'vitest';

const tenant = vi.hoisted(() => ({ companyId: null as string | null }));
vi.mock('../context', () => ({ currentCompanyId: () => tenant.companyId }));

import { assertEnvCredentials, EnvCredentialsUnavailableError, ownsEnvCredentials, perCompany } from '../per-company';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const env = { ...process.env };
afterEach(() => { process.env = { ...env }; tenant.companyId = null; });

describe('env credentials belong to one company', () => {
  it('refuses everyone when no company owns them', () => {
    delete process.env.ARCHIE_ENV_CREDENTIALS_COMPANY_ID;
    tenant.companyId = A;
    expect(ownsEnvCredentials()).toBe(false);
    expect(() => assertEnvCredentials('JobTread')).toThrow(EnvCredentialsUnavailableError);
  });

  it('allows only the owning company, and nothing with no company', () => {
    process.env.ARCHIE_ENV_CREDENTIALS_COMPANY_ID = A;
    tenant.companyId = A;
    expect(() => assertEnvCredentials('JobTread')).not.toThrow();
    tenant.companyId = B;
    expect(() => assertEnvCredentials('JobTread')).toThrow(/not connected for this company/);
    tenant.companyId = null;
    expect(ownsEnvCredentials()).toBe(false);
  });
});

describe('perCompany', () => {
  it('gives each company its own instance, and none without a company', () => {
    let made = 0;
    const get = perCompany('Thing', () => ({ n: ++made }));
    tenant.companyId = A;
    const a1 = get();
    expect(get()).toBe(a1);
    tenant.companyId = B;
    expect(get()).not.toBe(a1);
    tenant.companyId = null;
    expect(() => get()).toThrow(/no company/);
  });
});
