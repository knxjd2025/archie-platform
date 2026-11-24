/**
 * A small real request path for the roof report tests: session, company, the
 * routes handed in, the local test database. Companies are fictional (Summit
 * Ridge Roofing in Cedar Falls) and every email is unique to the run.
 *
 * It is not the whole app on purpose: the whole app is walked by
 * route-walk.db.test.ts. Here only the routes under test are mounted, behind
 * the same switch, sign-in check and company context they have in the app.
 */
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';

export type Role = 'admin' | 'customer_service' | 'sales' | 'sales_director' | 'manager' | 'production';
export interface Person { id: number; email: string; name: string; role: Role }
export interface Co { id: string; people: Record<string, Person> }

const url = process.env.DATABASE_URL || '';
export const localDb = process.env.ARCHIE_REHEARSAL === '1' || /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url);

/** An in-memory photo store: nothing here ever reaches Cloudflare. */
export function fakeStore() {
  const objects = new Map<string, Buffer>();
  return {
    objects,
    put: async (key: string, body: Buffer) => { objects.set(key, Buffer.from(body)); },
    get: async (key: string) => { const b = objects.get(key); return b ? { body: Readable.from(b), length: b.length } : null; },
    delete: async (key: string) => { objects.delete(key); },
  };
}

export async function startRoofApp(tag: string, mount: (app: express.Express) => void) {
  const { db } = await import('../../db');
  const schema = await import('../../../shared/schema');
  const { runAsCompany } = await import('../../tenant/context');
  const { createCompany } = await import('../../tenant/companies');
  const { tenantFromSession } = await import('../../tenant/middleware');
  const { clearSessionRevalidationCache } = await import('../../auth/middleware');

  let sessionUser: Record<string, unknown> | undefined;
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use((req: any, _res, next) => {
    req.session = { user: sessionUser, destroy: (cb: () => void) => { req.session.user = undefined; cb(); } };
    next();
  });
  app.use(tenantFromSession);
  mount(app);
  const server: Server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  async function company(name: string, people: Array<[string, Role]>): Promise<Co> {
    const c = await createCompany({ slug: `${tag}-${name.toLowerCase().replace(/\W+/g, '-')}-${randomUUID().slice(0, 6)}`, name, status: 'active' });
    const made: Record<string, Person> = {};
    for (const [key, role] of people) {
      const email = `${tag}-${c.id.slice(0, 8)}-${key}@example.test`.toLowerCase();
      const display = `${key[0].toUpperCase()}${key.slice(1)} ${name.split(' ')[0]}`;
      const [row] = await runAsCompany(c.id, () => db.insert(schema.teamMembers).values({ name: display, email, role, canLogin: true, active: true, jobtreadSalesRep: `Rep ${key}` }).returning());
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
  const signedOut = () => { sessionUser = undefined; };

  const send = async (method: string, path: string, body?: unknown, opts: { raw?: Buffer; contentType?: string; headers?: Record<string, string> } = {}) => {
    const headers: Record<string, string> = { ...(opts.headers ?? {}) };
    let payload: any;
    if (opts.raw !== undefined) { headers['content-type'] = opts.contentType ?? 'image/jpeg'; payload = opts.raw; }
    else if (body !== undefined) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }
    const r = await fetch(`${base}${path}`, { method, redirect: 'manual', headers, body: payload });
    const buf = Buffer.from(await r.arrayBuffer());
    const text = buf.toString('utf8');
    let parsed: any = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = null; }
    return { status: r.status, body: parsed, text, bytes: buf, headers: r.headers };
  };

  return {
    db, schema, runAsCompany, server, base, company, as, signedOut, send,
    get: (p: string) => send('GET', p),
    post: (p: string, b?: unknown) => send('POST', p, b),
    put: (p: string, b: unknown) => send('PUT', p, b),
    del: (p: string) => send('DELETE', p),
    upload: (p: string, raw: Buffer, contentType = 'image/jpeg') => send('POST', p, undefined, { raw, contentType }),
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
