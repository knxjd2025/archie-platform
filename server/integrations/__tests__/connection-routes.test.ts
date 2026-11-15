/**
 * Connecting a company's own Current CRM (JobTread) and CompanyCam accounts,
 * through the real request path: session, company middleware, roster check,
 * route, sealed storage. The providers' HTTP is mocked; nothing real is called.
 *
 * Two companies: A connects; B stays "not connected", and B's calls are
 * refused rather than run with A's key.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import crypto from 'node:crypto';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

const url = process.env.DATABASE_URL || '';
const local = /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url);

describe.skipIf(!local)('integration connections (Current CRM, CompanyCam)', async () => {
  process.env.ARCHIE_SECRETS_KEY ||= crypto.randomBytes(32).toString('base64');
  const { db } = await import('../../db');
  const schema = await import('../../../shared/schema');
  const { eq, and } = await import('drizzle-orm');
  const { runAsCompany, runAsSystem } = await import('../../tenant/context');
  const { createCompany } = await import('../../tenant/companies');
  const { tenantFromSession } = await import('../../tenant/middleware');
  const { clearSessionRevalidationCache } = await import('../../auth/middleware');
  const { clearCompanyCredentialsCache } = await import('../../tenant/company-credentials');
  const { EnvCredentialsUnavailableError } = await import('../../tenant/per-company');
  const { registerConnectionRoutes } = await import('../connection-routes');
  const { JobTreadClient } = await import('../jobtread');
  const { CompanyCamClient } = await import('../companycam');

  const tag = `conn-${process.pid}-${Date.now()}`;
  const adminA = `${tag}-admin-a@example.test`;
  const adminB = `${tag}-admin-b@example.test`;
  const repA = `${tag}-rep-a@example.test`;
  const GOOD_JT_KEY = 'jt-grant-key-of-company-a';
  const GOOD_CC_TOKEN = 'cc-token-of-company-a';
  let a = '';
  let b = '';
  let server: Server;
  let base = '';
  let sessionUser: Record<string, unknown> | undefined;

  // Provider calls the code under test makes (requests to our own server pass through).
  const realFetch = globalThis.fetch;
  const providerCalls: Array<{ url: string; auth: string | null; body: string }> = [];
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const fakeProviders = async (input: any, init?: any): Promise<Response> => {
    const target = String(input instanceof Request ? input.url : input);
    if (target.startsWith(base)) return realFetch(input, init);
    const headers = new Headers(init?.headers);
    const auth = headers.get('authorization');
    providerCalls.push({ url: target, auth, body: String(init?.body ?? '') });
    if (target.startsWith('https://api.jobtread.com/')) {
      if (auth !== `Bearer ${GOOD_JT_KEY}`) return json(401, { message: 'bad grant key' });
      return json(200, { organizations: { nodes: [{ id: 'org-a', name: 'Alpha JobTread' }] } });
    }
    if (target.startsWith('https://api.companycam.com/')) {
      if (auth !== `Bearer ${GOOD_CC_TOKEN}`) return json(401, { error: 'unauthorized' });
      return json(200, { id: 'cc-1', name: 'Alpha Photos' });
    }
    throw new Error(`unexpected outbound call to ${target}`);
  };

  beforeAll(async () => {
    a = (await createCompany({ slug: `${tag}-a`, name: 'Alpha Roofing', status: 'active' })).id;
    b = (await createCompany({ slug: `${tag}-b`, name: 'Bravo Roofing', status: 'active' })).id;
    await runAsCompany(a, () => db.insert(schema.teamMembers).values([
      { name: 'Admin A', email: adminA, role: 'admin', canLogin: true },
      { name: 'Rep A', email: repA, role: 'sales', canLogin: true },
    ]));
    await runAsCompany(b, () => db.insert(schema.teamMembers).values([
      { name: 'Admin B', email: adminB, role: 'admin', canLogin: true },
    ]));

    const app = express();
    app.use(express.json());
    app.use((req: any, _res, next) => {
      req.session = { user: sessionUser, destroy: (cb: () => void) => cb(), regenerate: (cb: () => void) => cb(), save: (cb: () => void) => cb() };
      next();
    });
    app.use(tenantFromSession);
    registerConnectionRoutes(app);
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    vi.stubGlobal('fetch', fakeProviders);
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    server?.close();
    await runAsSystem('test cleanup', async () => {
      for (const id of [a, b]) {
        await db.delete(schema.companyIntegrations).where(eq(schema.companyIntegrations.companyId, id));
        await db.delete(schema.teamMembers).where(eq(schema.teamMembers.companyId, id));
      }
    });
  });

  beforeEach(() => {
    providerCalls.length = 0;
    clearCompanyCredentialsCache();
    delete process.env.ARCHIE_ENV_CREDENTIALS_COMPANY_ID;
    delete process.env.JOBTREAD_API_KEY;
    delete process.env.COMPANYCAM_API_TOKEN;
  });

  const as = (email: string, companyId: string, role = 'admin') => {
    clearSessionRevalidationCache();
    sessionUser = { email, name: 'x', role, companyId };
  };
  const call = (method: string, path: string, body?: unknown) => fetch(`${base}${path}`, {
    method, headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}),
  });

  it('is admin only', async () => {
    as(repA, a, 'sales');
    for (const [method, path] of [
      ['GET', '/api/integrations/crm/connection'], ['PUT', '/api/integrations/crm/connection'], ['DELETE', '/api/integrations/crm/connection'],
      ['GET', '/api/integrations/companycam/connection'], ['PUT', '/api/integrations/companycam/connection'], ['DELETE', '/api/integrations/companycam/connection'],
    ]) {
      expect((await call(method, path, method === 'PUT' ? { grantKey: GOOD_JT_KEY, token: GOOD_CC_TOKEN } : undefined)).status, `${method} ${path}`).toBe(403);
    }
    expect(providerCalls).toHaveLength(0);
    sessionUser = undefined;
    expect((await call('GET', '/api/integrations/crm/connection')).status).toBe(401);
  });

  it('starts not connected', async () => {
    as(adminA, a);
    expect(await (await call('GET', '/api/integrations/crm/connection')).json()).toEqual({ connected: false, source: null });
    expect(await (await call('GET', '/api/integrations/companycam/connection')).json()).toEqual({ connected: false, source: null });
  });

  it('verifies a JobTread grant key with the provider before saving, and saves nothing on a refusal', async () => {
    as(adminA, a);
    const bad = await call('PUT', '/api/integrations/crm/connection', { provider: 'jobtread', grantKey: 'wrong-key' });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toMatch(/refused that grant key/);
    expect(providerCalls[0]).toMatchObject({ url: 'https://api.jobtread.com/pave', auth: 'Bearer wrong-key' });
    expect(await (await call('GET', '/api/integrations/crm/connection')).json()).toMatchObject({ connected: false });

    expect((await call('PUT', '/api/integrations/crm/connection', { provider: 'jobtread', grantKey: '' })).status).toBe(400);
    expect((await call('PUT', '/api/integrations/crm/connection', { provider: 'salesforce', grantKey: GOOD_JT_KEY })).status).toBe(400);
    expect((await call('PUT', '/api/integrations/crm/connection', { grantKey: GOOD_JT_KEY, organizationId: 'org-zzz' })).status).toBe(400);
  });

  it('saves company A\'s JobTread connection sealed, and never returns the key', async () => {
    as(adminA, a);
    const put = await call('PUT', '/api/integrations/crm/connection', { provider: 'jobtread', grantKey: GOOD_JT_KEY });
    expect(put.status).toBe(200);
    const putText = await put.text();
    expect(putText).not.toContain(GOOD_JT_KEY);
    expect(JSON.parse(putText)).toEqual({ connected: true, source: 'company', accountName: 'Alpha JobTread' });

    const getText = await (await call('GET', '/api/integrations/crm/connection')).text();
    expect(getText).not.toContain(GOOD_JT_KEY);
    expect(JSON.parse(getText)).toEqual({ connected: true, source: 'company', accountName: 'Alpha JobTread' });

    const [row] = await runAsSystem('test check', () => db.select().from(schema.companyIntegrations)
      .where(and(eq(schema.companyIntegrations.companyId, a), eq(schema.companyIntegrations.provider, 'jobtread'))));
    expect(row.credentials).not.toContain(GOOD_JT_KEY);
  });

  it('runs company A\'s JobTread calls with A\'s key and organization', async () => {
    await runAsCompany(a, async () => {
      const jt = new JobTreadClient();
      expect(await jt.getOrganizationId()).toBe('org-a');
      await jt.paveQuery({ organizations: { nodes: { id: {} } } });
    });
    expect(providerCalls.map((c) => c.auth)).toEqual([`Bearer ${GOOD_JT_KEY}`]);
  });

  it('leaves company B not connected, and refuses B\'s calls instead of using A\'s key', async () => {
    as(adminB, b);
    expect(await (await call('GET', '/api/integrations/crm/connection')).json()).toEqual({ connected: false, source: null });
    // One client instance used by both companies: it must not carry A's key over.
    const shared = new JobTreadClient();
    await runAsCompany(a, () => shared.getOrganizationId());
    await expect(runAsCompany(b, () => shared.paveQuery({ organizations: { nodes: { id: {} } } }))).rejects.toBeInstanceOf(EnvCredentialsUnavailableError);
    await expect(runAsCompany(b, () => shared.getOrganizationId())).rejects.toBeInstanceOf(EnvCredentialsUnavailableError);
    expect(providerCalls).toHaveLength(0);
  });

  it('a company\'s own key beats the env key; the env key serves only the company that owns it', async () => {
    process.env.ARCHIE_ENV_CREDENTIALS_COMPANY_ID = b;
    process.env.JOBTREAD_API_KEY = 'env-key-owned-by-b';
    as(adminB, b);
    expect(await (await call('GET', '/api/integrations/crm/connection')).json()).toEqual({ connected: true, source: 'shared' });
    as(adminA, a);
    expect(await (await call('GET', '/api/integrations/crm/connection')).json()).toMatchObject({ connected: true, source: 'company' });
    await runAsCompany(a, () => new JobTreadClient().paveQuery({ x: {} }));
    await runAsCompany(b, () => new JobTreadClient().paveQuery({ x: {} })).catch(() => { /* the fake refuses the env key */ });
    expect(providerCalls.map((c) => c.auth)).toEqual([`Bearer ${GOOD_JT_KEY}`, 'Bearer env-key-owned-by-b']);

    // The owner moves: B is refused again, before any call leaves the server.
    process.env.ARCHIE_ENV_CREDENTIALS_COMPANY_ID = a;
    providerCalls.length = 0;
    await expect(runAsCompany(b, () => new JobTreadClient().paveQuery({ x: {} }))).rejects.toBeInstanceOf(EnvCredentialsUnavailableError);
    expect(providerCalls).toHaveLength(0);
  });

  it('the JobTread sync refuses a company that has not connected, even with an env key set', async () => {
    // A sync run by B's admin used to send the env key and pull that account's jobs into B.
    process.env.ARCHIE_ENV_CREDENTIALS_COMPANY_ID = a;
    process.env.JOBTREAD_API_KEY = 'env-key-owned-by-a';
    const { syncJobtread } = await import('../../sync/jobtread-sync');
    await expect(runAsCompany(b, () => syncJobtread())).rejects.toBeInstanceOf(EnvCredentialsUnavailableError);
    expect(providerCalls).toHaveLength(0);
  });

  it('disconnects: DELETE removes only the company\'s saved credentials', async () => {
    as(adminA, a);
    const del = await call('DELETE', '/api/integrations/crm/connection');
    expect(del.status).toBe(200);
    expect(await del.json()).toEqual({ connected: false, source: null });
    await expect(runAsCompany(a, () => new JobTreadClient().paveQuery({ x: {} }))).rejects.toBeInstanceOf(EnvCredentialsUnavailableError);
    // With A owning the env key, A falls back to it: same as before this change.
    process.env.ARCHIE_ENV_CREDENTIALS_COMPANY_ID = a;
    process.env.JOBTREAD_API_KEY = 'env-key';
    expect(await (await call('GET', '/api/integrations/crm/connection')).json()).toEqual({ connected: true, source: 'shared' });
  });

  it('connects CompanyCam per company, verified first, never returning the token', async () => {
    as(adminA, a);
    const bad = await call('PUT', '/api/integrations/companycam/connection', { token: 'nope' });
    expect(bad.status).toBe(400);
    expect(providerCalls[0]).toMatchObject({ url: 'https://api.companycam.com/v2/company', auth: 'Bearer nope' });
    expect(await (await call('GET', '/api/integrations/companycam/connection')).json()).toEqual({ connected: false, source: null });

    const put = await call('PUT', '/api/integrations/companycam/connection', { token: GOOD_CC_TOKEN });
    const putText = await put.text();
    expect(put.status).toBe(200);
    expect(putText).not.toContain(GOOD_CC_TOKEN);
    expect(JSON.parse(putText)).toEqual({ connected: true, source: 'company', accountName: 'Alpha Photos' });
    expect(await (await call('GET', '/api/integrations/companycam/connection')).json()).toEqual({ connected: true, source: 'company', accountName: 'Alpha Photos' });

    providerCalls.length = 0;
    await runAsCompany(a, () => new CompanyCamClient().getCompany());
    expect(providerCalls.map((c) => c.auth)).toEqual([`Bearer ${GOOD_CC_TOKEN}`]);

    as(adminB, b);
    expect(await (await call('GET', '/api/integrations/companycam/connection')).json()).toEqual({ connected: false, source: null });
    await expect(runAsCompany(b, () => new CompanyCamClient().getCompany())).rejects.toBeInstanceOf(EnvCredentialsUnavailableError);
    expect(providerCalls).toHaveLength(1);

    as(adminA, a);
    expect(await (await call('DELETE', '/api/integrations/companycam/connection')).json()).toEqual({ connected: false, source: null });
    await expect(runAsCompany(a, () => new CompanyCamClient().getCompany())).rejects.toBeInstanceOf(EnvCredentialsUnavailableError);
  });
});
