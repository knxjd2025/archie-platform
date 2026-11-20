/**
 * The real request path for the crew tests: session, company, every route
 * Archie registers, the local test database. Each test file mocks JobTread,
 * KynexPro and the seed itself (vi.mock is per file), then calls startCrewApp.
 *
 * Companies are fictional (Summit Ridge Roofing, Cedar Falls) and every
 * email is unique to the run, so the shared test database can hold anything.
 */
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { vi } from 'vitest';

export type Role = 'admin' | 'customer_service' | 'sales' | 'sales_director' | 'manager' | 'production';
export interface Person { id: number; email: string; name: string; role: Role }
export interface Co { id: string; people: Record<string, Person> }

const url = process.env.DATABASE_URL || '';
export const localDb = /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url);

export async function startCrewApp(tag: string) {
  const { db } = await import('../../db');
  const schema = await import('../../../shared/schema');
  const { eq } = await import('drizzle-orm');
  const { runAsCompany, runAsSystem } = await import('../../tenant/context');
  const { createCompany } = await import('../../tenant/companies');
  const { tenantFromSession } = await import('../../tenant/middleware');
  const { clearProfileCache } = await import('../../tenant/profile');
  const { clearSessionRevalidationCache } = await import('../../auth/middleware');
  const { registerRoutes } = await import('../../routes');

  let sessionUser: Record<string, unknown> | undefined;
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use((req: any, _res, next) => {
    req.session = { user: sessionUser, destroy: (cb: () => void) => { req.session.user = undefined; cb(); } };
    next();
  });
  app.use(tenantFromSession);
  registerRoutes(app);
  const server: Server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  async function company(name: string, roofLee: boolean, people: Array<[string, Role]>, settings: Record<string, unknown> = {}): Promise<Co> {
    const c = await createCompany({ slug: `${tag}-${name.toLowerCase().replace(/\W+/g, '-')}-${randomUUID().slice(0, 6)}`, name, status: 'active' });
    await runAsSystem('test: company setup', () => db.update(schema.companies)
      .set({ ...(roofLee ? { roofliCompanyId: randomUUID() } : {}), settings: settings as any })
      .where(eq(schema.companies.id, c.id)));
    clearProfileCache(c.id);
    const made: Record<string, Person> = {};
    for (const [key, role] of people) {
      const email = `${tag}-${c.id.slice(0, 8)}-${key}@example.test`;
      const display = `${key[0].toUpperCase()}${key.slice(1)} ${name.split(' ')[0]}`;
      const [row] = await runAsCompany(c.id, () => db.insert(schema.teamMembers).values({ name: display, email, role, canLogin: true, active: true, jobtreadSalesRep: roofLee ? null : `Rep ${key}` }).returning());
      made[key] = { id: row.id, email, name: display, role };
    }
    return { id: c.id, people: made };
  }

  const as = (c: Co, who: string) => {
    clearSessionRevalidationCache();
    const p = c.people[who];
    sessionUser = { email: p.email, name: p.name, role: p.role, companyId: c.id };
    return p;
  };
  const send = async (method: string, path: string, body?: unknown) => {
    const r = await fetch(`${base}${path}`, {
      method, redirect: 'manual', headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await r.text();
    let parsed: any = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = null; }
    return { status: r.status, body: parsed, text };
  };

  /** Refuse every request leaving Archie, and record it. */
  function blockOutside(): string[] {
    const outside: string[] = [];
    const real = globalThis.fetch;
    vi.spyOn(globalThis, 'fetch').mockImplementation((input: any, init?: any) => {
      const u = String(typeof input === 'string' || input instanceof URL ? input : input.url);
      if (!u.startsWith(base)) { outside.push(u); return Promise.reject(new Error('no outside calls in tests')); }
      return real(input, init);
    });
    return outside;
  }

  return {
    db, schema, runAsCompany, runAsSystem, server, base, company, as, send, blockOutside,
    get: (p: string) => send('GET', p),
    post: (p: string, b: unknown) => send('POST', p, b),
    put: (p: string, b: unknown) => send('PUT', p, b),
    patch: (p: string, b: unknown) => send('PATCH', p, b),
    del: (p: string) => send('DELETE', p),
  };
}

/** Every JobTread or KynexPro client throws if any method is called. */
export function throwingClient(kind: string) {
  return class {
    constructor() {
      return new Proxy(this, {
        get: (_t, prop) => {
          if (typeof prop !== 'string' || prop === 'then') return undefined;
          return () => { throw new Error(`${kind}.${prop} must not be called in the crew tests`); };
        },
      });
    }
  };
}
