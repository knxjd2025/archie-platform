/**
 * Setting a password ends that person's other sessions and cancels their
 * other links, and the session it starts survives. Real routes, the real
 * Postgres session store (connect-pg-simple) and the real database
 * (scripts/test-db.sh): the session table only exists there.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import express from 'express';
import session from 'express-session';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

const url = process.env.DATABASE_URL || '';
const local = /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url);

vi.mock('../password-mail', () => ({ sendPasswordLinkEmail: vi.fn(async () => true), passwordMailConfigured: () => true }));

describe.skipIf(!local)('set-password and other sessions', async () => {
  const { createSessionStore } = await import('../../session-store');
  const { registerAuthRoutes } = await import('../routes');
  const { registerPasswordRoutes } = await import('../password-routes');
  const { tenantFromSession } = await import('../../tenant/middleware');
  const { clearSessionRevalidationCache } = await import('../middleware');
  const { __resetRateLimits } = await import('../../lib/rate-limit');
  const { hashPassword } = await import('../password');
  const { mintPasswordLink, redeemPasswordLink } = await import('../password-links');
  const team = await import('../../storage/team');
  const { makeTestCompany, asCompany } = await import('../../__tests__/helpers/tenant');

  const email = `sessions-${Date.now()}@example.test`;
  const bystander = `bystander-${Date.now()}@example.test`;
  const OLD = 'the old password 1';
  let company = '';
  let server: Server;
  let base = '';

  beforeAll(async () => {
    company = await makeTestCompany('pw-sessions');
    const hash = await hashPassword(OLD);
    await asCompany(company, async () => {
      for (const who of [email, bystander]) {
        await team.createTeamMember({ name: 'Sam Person', email: who, role: 'sales', canLogin: true } as never, 'test');
        await team.setPasswordHash(who, hash);
      }
    });
    const app = express();
    app.use(express.json());
    app.use(session({ store: createSessionStore(), secret: 'test-secret', resave: false, saveUninitialized: false }));
    app.use(tenantFromSession);
    registerAuthRoutes(app);
    registerPasswordRoutes(app);
    server = app.listen(0);
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  const post = (path: string, body: unknown) =>
    fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const cookieOf = (res: Response) => res.headers.getSetCookie().find((h) => h.startsWith('connect.sid='))!.split(';')[0];
  const signIn = async (who: string) => {
    const res = await post('/api/auth/login/password', { email: who, password: OLD });
    expect(res.status).toBe(200);
    return cookieOf(res);
  };
  const me = async (cookie: string) => {
    clearSessionRevalidationCache();
    return (await fetch(`${base}/api/auth/me`, { headers: { cookie } })).status;
  };

  it('ends the other sessions, cancels the other links, and keeps the new session', async () => {
    __resetRateLimits();
    const phone = await signIn(email);
    const laptop = await signIn(email);
    const someoneElse = await signIn(bystander);
    expect(await me(phone)).toBe(200);
    expect(await me(laptop)).toBe(200);

    const welcome = await asCompany(company, () => mintPasswordLink(email, 'welcome'));
    // A second outstanding link: put one in by hand, since minting replaces the older ones.
    const { db } = await import('../../db');
    const { passwordLinks } = await import('../../../shared/schema');
    const crypto = await import('node:crypto');
    const spare = crypto.randomBytes(32).toString('base64url');
    await asCompany(company, () => db.insert(passwordLinks).values({
      tokenHash: crypto.createHash('sha256').update(spare).digest('hex'),
      email,
      purpose: 'reset',
      expiresAt: new Date(Date.now() + 60_000),
    }));

    const res = await post('/api/auth/password/set', { token: welcome, password: 'a brand new password' });
    expect(res.status).toBe(200);
    const fresh = cookieOf(res);

    expect(await me(phone)).toBe(401);
    expect(await me(laptop)).toBe(401);
    expect(await me(fresh)).toBe(200);
    expect(await me(someoneElse)).toBe(200);
    expect(await redeemPasswordLink(spare)).toBeNull();
  });
});
