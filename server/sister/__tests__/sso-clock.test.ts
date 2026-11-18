/**
 * A sign-in ticket works once whatever time zone the database session is in.
 *
 * The used-ticket row's expiry is written from this process's clock. If the
 * clean-up in the same request compared it with the database's now(), a
 * session east of UTC would read the row just written as long finished and
 * delete it, and the same ticket would sign in a second time. Production's
 * session is UTC today; a single-use promise must not rest on that setting.
 *
 * This file makes its own connections with the session set to Berlin time.
 * The option is read when a connection is opened, so it is set before the
 * database module is first loaded, and only ever for a local server.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import session from 'express-session';
import http, { type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { companyBody, dropSecret, localDb, makeTicket, member, sisterSend, useSecret } from './helpers';
import { SISTER_PREFIX, sisterRawBody } from '../door';

vi.mock('../../seed', () => ({ seedCompany: async () => {}, seedAll: async () => {}, SEED_JOB: 'seed-company', seedVersion: () => 'test' }));
vi.mock('@vercel/functions', () => ({ waitUntil: () => {} }));

describe.skipIf(!localDb)('one sign-in, with the database session east of UTC', async () => {
  const before = process.env.PGOPTIONS;
  process.env.PGOPTIONS = '-c TimeZone=Europe/Berlin';
  const { db } = await import('../../db');
  const { sql } = await import('drizzle-orm');
  const { registerSisterRoutes } = await import('../routes');

  const tag = `sis-sso-clock-${process.pid}-${Date.now()}`;
  let server: Server;
  let base = '';

  beforeAll(async () => {
    const app = express();
    app.use(SISTER_PREFIX, sisterRawBody());
    app.use(express.json());
    app.use(session({ secret: 'test', resave: false, saveUninitialized: false }));
    registerSisterRoutes(app);
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => {
    server?.close();
    if (before === undefined) delete process.env.PGOPTIONS; else process.env.PGOPTIONS = before;
  });
  beforeEach(() => { useSecret(); });
  afterEach(() => { dropSecret(); });

  async function present(ticket: string): Promise<number> {
    const res = await fetch(`${base}/api/sister/v1/sso`, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ ticket }).toString(),
    });
    await res.text();
    return res.status;
  }

  it('really runs on a session whose clock reads ahead of UTC', async () => {
    const r = await db.execute(sql`select current_setting('TimeZone') as tz`);
    expect((r.rows[0] as { tz: string }).tz).toBe('Europe/Berlin');
  });

  it('refuses the second use of a ticket', async () => {
    const owner = member(tag, 'owner');
    const body = companyBody(tag, { members: [owner] });
    const made = await sisterSend(base, { method: 'POST', path: '/api/sister/v1/companies', json: body, version: 1 });
    expect(made.status).toBe(201);
    const ticket = makeTicket({ roofliCompanyId: body.roofliCompanyId as string, authUserId: owner.authUserId });
    expect(await present(ticket)).toBe(303);
    expect(await present(ticket)).toBe(401);
    expect(await present(ticket)).toBe(401);
  });
});
