/**
 * Test helpers for Roof Lee's endpoints: an app wired the way both entry files
 * wire it, and a sender that signs the way Roof Lee does.
 */
import express from 'express';
import http, { type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { sign, signRequest } from '../verify';
import { registerSisterRoutes } from '../routes';
import { SISTER_PREFIX, SISTER_SECRET_ENV, sisterRawBody } from '../door';

export const TEST_SECRET = 'sister-test-pair-secret';

const url = process.env.DATABASE_URL || '';
/** These tests need the local test database (scripts/test-db.sh). */
export const localDb = /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url);

export async function startSisterApp(): Promise<{ server: Server; base: string }> {
  const app = express();
  app.use(SISTER_PREFIX, sisterRawBody());
  app.use(express.json());
  registerSisterRoutes(app);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, base: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}

export function useSecret(): void { process.env[SISTER_SECRET_ENV] = TEST_SECRET; }
export function dropSecret(): void { delete process.env[SISTER_SECRET_ENV]; }

export interface Sent {
  method?: string;
  path: string;
  /** Sent as JSON. */
  json?: unknown;
  /** Version 1 covers the timestamp and body; version 2 the method and address too. */
  version: 1 | 2;
  secret?: string;
  headers?: Record<string, string>;
}

/** Sends one request signed as Roof Lee signs it. */
export async function sisterSend(base: string, o: Sent): Promise<{ status: number; body: any; text: string; retryAfter: string | null }> {
  const method = o.method ?? 'GET';
  const body = o.json === undefined ? undefined : JSON.stringify(o.json);
  const at = Date.now();
  const secret = o.secret ?? TEST_SECRET;
  const signature = o.version === 2 ? signRequest(method, o.path, body ?? '', at, secret) : sign(body ?? '', at, secret);
  const res = await fetch(`${base}${o.path}`, {
    method,
    body,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      'x-roofli-timestamp': String(at),
      'x-roofli-signature': signature,
      ...o.headers,
    },
  });
  const text = await res.text();
  let parsed: any = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = null; }
  return { status: res.status, body: parsed, text, retryAfter: res.headers.get('retry-after') };
}

export interface TestMember { authUserId: string; email: string; fullName: string | null; role: string }

/** A member of the fictional Summit Ridge Roofing team, with an email no other test uses. */
export function member(tag: string, role: string, name = 'Dana Whitfield'): TestMember {
  return { authUserId: randomUUID(), email: `${tag}-${randomUUID().slice(0, 8)}@example.test`, fullName: name, role };
}

/** The body Roof Lee sends to make a company. Fictional: Summit Ridge Roofing in Cedar Falls. */
export function companyBody(tag: string, over: Record<string, unknown> = {}) {
  return {
    roofliCompanyId: randomUUID(),
    name: 'Summit Ridge Roofing',
    // Roof Lee's slugs are unique across Roof Lee; so are these.
    slug: `${tag}-summit-ridge-${randomUUID().slice(0, 8)}`,
    city: 'Cedar Falls',
    state: 'IA',
    members: [member(tag, 'owner')],
    facts: {
      identity: {}, contact: {}, service_area: {}, services: {}, credentials: {},
      warranties: {}, offers: {}, voice: {}, audiences: {}, preferences: {},
    },
    ...over,
  };
}

/** What a sign-in ticket says (docs/sisters/contract-v2.md, "The ticket"). */
export interface TestTicket {
  v?: unknown; jti?: string; product?: string; roofliCompanyId: string; authUserId: string;
  email?: string; role?: string; iat?: number; exp?: number;
}

/** A ticket written and signed the way Roof Lee writes one. Fields are in the contract's order. */
export function makeTicket(t: TestTicket, secret: string = TEST_SECRET): string {
  const iat = t.iat ?? Math.floor(Date.now() / 1000);
  const text = JSON.stringify({
    v: t.v ?? 2,
    jti: t.jti ?? randomBytes(16).toString('hex'),
    product: t.product ?? 'archie',
    roofliCompanyId: t.roofliCompanyId,
    authUserId: t.authUserId,
    email: t.email ?? 'dana@example.test',
    role: t.role ?? 'owner',
    iat,
    exp: t.exp ?? iat + 60,
  });
  return `${Buffer.from(text, 'utf8').toString('base64url')}.${createHmac('sha256', secret).update(text).digest('hex')}`;
}
