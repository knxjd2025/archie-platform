import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import session from 'express-session';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

/**
 * Password sign-in, forgot and set-password, through the real routes and a
 * real session. Storage, the company lookup and the mailer are faked; the
 * lockout counter is kept in the fake member row so the route's reading of it
 * is what is under test.
 */
const CO = '11111111-1111-4111-8111-111111111111';
const { state, mintReset, redeem, sendMail, dropLinks, endSessions, pending } = vi.hoisted(() => ({
  state: { row: null as null | Record<string, unknown>, company: {} as Record<string, unknown>, calls: [] as string[] },
  mintReset: vi.fn(),
  redeem: vi.fn(),
  sendMail: vi.fn(),
  dropLinks: vi.fn(),
  endSessions: vi.fn(),
  pending: [] as Promise<unknown>[],
}));

vi.mock('../../storage/team', () => ({
  getTeamMemberByEmail: async () => state.row,
  findSignInMember: async (email: string) =>
    state.row && state.row.email === email ? { member: state.row, company: state.company } : undefined,
  touchLogin: vi.fn(async (...a: unknown[]) => { state.calls.push(`touch:${a.length}`); }),
  setPasswordHash: vi.fn(async (_e: string, hash: string) => {
    state.calls.push('set-hash');
    if (state.row) Object.assign(state.row, { passwordHash: hash, failedLogins: 0, lockedUntil: null });
  }),
  clearFailedLogins: vi.fn(async () => {
    if (!state.row || (state.row.lockedUntil as Date | null)?.getTime()! > Date.now()) return false;
    state.row.failedLogins = 0;
    return true;
  }),
  recordFailedLogin: vi.fn(async () => {
    if (!state.row || (state.row.lockedUntil as Date | null)?.getTime()! > Date.now()) return;
    const n = (state.row.failedLogins as number) + 1;
    if (n >= 5) Object.assign(state.row, { failedLogins: 0, lockedUntil: new Date(Date.now() + 15 * 60_000) });
    else state.row.failedLogins = n;
  }),
}));
vi.mock('../../tenant/companies', () => ({
  getCurrentCompany: async () => ({ id: CO, status: 'active', name: 'Test Co', slug: 'test', trade: 'roofing', branding: {} }),
}));
vi.mock('../password-mail', () => ({ sendPasswordLinkEmail: (...a: unknown[]) => sendMail(...a) }));
vi.mock('../password-links', async (orig) => ({
  ...(await orig<typeof import('../password-links')>()),
  mintResetLinkUnlessRecent: (...a: unknown[]) => mintReset(...a),
  redeemPasswordLink: (...a: unknown[]) => redeem(...a),
  deletePasswordLinksFor: (...a: unknown[]) => dropLinks(...a),
}));
vi.mock('../sessions', () => ({ endSessionsFor: (...a: unknown[]) => endSessions(...a) }));
// Work the forgot route finishes after answering; collected so tests can wait for it.
vi.mock('@vercel/functions', () => ({ waitUntil: (p: Promise<unknown>) => { pending.push(p); } }));
const settle = async () => { await Promise.all(pending.splice(0)); };

const { registerPasswordRoutes, forgotFloorMs } = await import('../password-routes');
const { registerAuthRoutes } = await import('../routes');
const { hashPassword } = await import('../password');
const { tenantFromSession } = await import('../../tenant/middleware');
const { clearSessionRevalidationCache } = await import('../middleware');
const { __resetRateLimits } = await import('../../lib/rate-limit');

const EMAIL = 'thomas@bestroofingnow.com';
const PASSWORD = 'correct horse battery';
let HASH = '';
let server: Server;
let base = '';

beforeAll(async () => {
  process.env.PASSWORD_FORGOT_MIN_MS = '0';
  delete process.env.LOGIN_ALLOWLIST;
  delete process.env.LOGIN_BLOCKLIST;
  HASH = await hashPassword(PASSWORD);
  const app = express();
  app.use(express.json());
  app.use(session({ secret: 'test-secret', resave: false, saveUninitialized: false }));
  app.use(tenantFromSession);
  registerAuthRoutes(app);
  registerPasswordRoutes(app);
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

beforeEach(() => {
  __resetRateLimits();
  clearSessionRevalidationCache();
  delete process.env.LOGIN_ALLOWLIST;
  delete process.env.LOGIN_BLOCKLIST;
  state.calls = [];
  state.company = { id: CO, status: 'active', name: 'Test Co' };
  state.row = { email: EMAIL, name: 'Thomas Reed', role: 'sales', active: true, canLogin: true, passwordHash: HASH, failedLogins: 0, lockedUntil: null };
  mintReset.mockReset().mockResolvedValue('minted-token');
  redeem.mockReset();
  sendMail.mockReset().mockResolvedValue(true);
  dropLinks.mockReset().mockImplementation(async () => { state.calls.push('drop-links'); });
  endSessions.mockReset().mockImplementation(async () => { state.calls.push('end-sessions'); });
  pending.length = 0;
});

const cookieOf = (res: Response): string | null => {
  const c = res.headers.getSetCookie().find((h) => h.startsWith('connect.sid='));
  return c ? c.split(';')[0] : null;
};
const post = (path: string, body: unknown, cookie?: string | null) =>
  fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
const login = (email: string, password: string) => post('/api/auth/login/password', { email, password });
const WRONG = { error: 'Email or password is wrong.' };

describe('POST /api/auth/login/password', () => {
  it('signs in with the right password', async () => {
    const res = await login(EMAIL, PASSWORD);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const cookie = cookieOf(res);
    expect(cookie).toBeTruthy();
    const me = await fetch(`${base}/api/auth/me`, { headers: { cookie: cookie! } });
    expect(me.status).toBe(200);
    expect((await me.json()).user.email).toBe(EMAIL);
    // lastLoginAt is recorded without a Google sub to overwrite.
    expect(state.calls).toContain('touch:1');
  });

  it('email with capitals and spaces still signs in', async () => {
    expect((await login('  Thomas@BestRoofingNow.com ', PASSWORD)).status).toBe(200);
  });

  it('wrong password and unknown email get the same 401 body', async () => {
    const wrong = await login(EMAIL, 'not the password');
    const unknown = await login('nobody@example.com', 'not the password');
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(await wrong.json()).toEqual(WRONG);
    expect(await unknown.json()).toEqual(WRONG);
  });

  it('member with no password gets 401 and it counts as a failed try', async () => {
    state.row!.passwordHash = null;
    const res = await login(EMAIL, PASSWORD);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual(WRONG);
    expect(state.row!.failedLogins).toBe(1);
  });

  it('fifth wrong try locks; the right password then gets the same 401 as a wrong one', async () => {
    for (let i = 0; i < 5; i++) expect((await login(EMAIL, 'wrong password!')).status).toBe(401);
    const locked = await login(EMAIL, PASSWORD);
    expect(locked.status).toBe(401);
    expect(await locked.json()).toEqual(WRONG);
    expect(cookieOf(locked)).toBeNull();
    // Once the lock runs out the right password works again.
    state.row!.lockedUntil = new Date(Date.now() - 1000);
    expect((await login(EMAIL, PASSWORD)).status).toBe(200);
  });

  it('a lock set after the lock check but before the clear still refuses the sign-in', async () => {
    // The route read "not locked", then a parallel guess locked the account.
    const { clearFailedLogins } = await import('../../storage/team');
    vi.mocked(clearFailedLogins).mockImplementationOnce(async () => false);
    const res = await login(EMAIL, PASSWORD);
    expect(res.status).toBe(401);
    expect(cookieOf(res)).toBeNull();
  });

  it('a successful sign-in clears earlier failed tries', async () => {
    await login(EMAIL, 'wrong password!');
    expect(state.row!.failedLogins).toBe(1);
    await login(EMAIL, PASSWORD);
    expect(state.row!.failedLogins).toBe(0);
  });

  it.each([
    ['blocked', () => { process.env.LOGIN_BLOCKLIST = EMAIL; }],
    ['not on the allowlist', () => { process.env.LOGIN_ALLOWLIST = 'someone@else.com'; }],
    ['canLogin false', () => { state.row!.canLogin = false; }],
    ['inactive', () => { state.row!.active = false; }],
    ['paused company', () => { state.company.status = 'paused'; }],
  ])('%s members get 401', async (_name, setup) => {
    setup();
    const res = await login(EMAIL, PASSWORD);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual(WRONG);
    expect(cookieOf(res)).toBeNull();
  });
});

describe('POST /api/auth/password/forgot', () => {
  const forgot = (email: unknown) => post('/api/auth/password/forgot', { email });

  it('sends the reset email inside the member company context, so it goes out through that company', async () => {
    const { currentCompanyId } = await import('../../tenant/context');
    let sentAs: string | null = null;
    sendMail.mockImplementation(async () => { sentAs = currentCompanyId(); return true; });
    await forgot(EMAIL);
    await settle();
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(sentAs).toBe(state.company.id);
  });

  it('always returns 200 and only sends mail for a member who passes the gate', async () => {
    const ok = await forgot(' Thomas@BestRoofingNow.com ');
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true });
    await settle();
    expect(mintReset).toHaveBeenCalledWith(EMAIL);
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(sendMail.mock.calls[0][0]).toMatchObject({ to: EMAIL, name: 'Thomas Reed', companyName: 'Test Co', purpose: 'reset' });

    mintReset.mockClear(); sendMail.mockClear();
    __resetRateLimits(); // the limiter is 5 an hour; this test makes more calls than that
    const responses = [await forgot('nobody@example.com'), await forgot(undefined)];
    state.row!.canLogin = false;
    responses.push(await forgot(EMAIL));
    state.row!.canLogin = true; state.company.status = 'paused';
    responses.push(await forgot(EMAIL));
    state.company.status = 'active'; process.env.LOGIN_BLOCKLIST = EMAIL;
    responses.push(await forgot(EMAIL));
    for (const r of responses) {
      expect(r.status).toBe(200);
      expect(await r.json()).toEqual({ ok: true });
    }
    await settle();
    expect(mintReset).not.toHaveBeenCalled();
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('answers the same when minting or sending fails, and logs it', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      mintReset.mockRejectedValue(new Error('db down'));
      const a = await forgot(EMAIL);
      await settle();
      mintReset.mockResolvedValue('t'); sendMail.mockRejectedValue(new Error('resend down'));
      const b = await forgot(EMAIL);
      await settle();
      for (const r of [a, b]) { expect(r.status).toBe(200); expect(await r.json()).toEqual({ ok: true }); }
      expect(logged).toHaveBeenCalledTimes(2);
    } finally {
      logged.mockRestore();
    }
  });

  it('sends nothing when a link went to this email in the last 2 minutes, and answers the same', async () => {
    mintReset.mockResolvedValue(null);
    const res = await forgot(EMAIL);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    await settle();
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('answers at the same fixed time whether or not the email is on a roster, however slow the mail', async () => {
    process.env.PASSWORD_FORGOT_MIN_MS = '200';
    try {
      sendMail.mockImplementation(() => new Promise((r) => setTimeout(() => r(true), 1200)));
      const timed = async (email: string) => {
        const t = Date.now();
        const res = await forgot(email);
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ ok: true });
        return Date.now() - t;
      };
      const member = await timed(EMAIL);
      const stranger = await timed('nobody@example.com');
      for (const ms of [member, stranger]) {
        expect(ms).toBeGreaterThanOrEqual(190);
        expect(ms).toBeLessThan(700);
      }
      // The slow send was not dropped: it finishes after the answer.
      expect(sendMail).toHaveBeenCalledTimes(1);
      await settle();
    } finally {
      process.env.PASSWORD_FORGOT_MIN_MS = '0';
    }
  });

  it('the answer time falls back to the default when PASSWORD_FORGOT_MIN_MS is not a usable number', () => {
    const prev = process.env.PASSWORD_FORGOT_MIN_MS;
    try {
      for (const bad of ['', '  ', 'abc', '-5', 'NaN', 'Infinity']) {
        process.env.PASSWORD_FORGOT_MIN_MS = bad;
        expect(forgotFloorMs()).toBe(1500);
      }
      delete process.env.PASSWORD_FORGOT_MIN_MS;
      expect(forgotFloorMs()).toBe(1500);
      process.env.PASSWORD_FORGOT_MIN_MS = '250';
      expect(forgotFloorMs()).toBe(250);
      process.env.PASSWORD_FORGOT_MIN_MS = '0';
      expect(forgotFloorMs()).toBe(0);
    } finally {
      process.env.PASSWORD_FORGOT_MIN_MS = prev;
    }
  });
});

describe('POST /api/auth/password/set', () => {
  const TOKEN = 'x'.repeat(43);
  const set = (password: string, cookie?: string | null) => post('/api/auth/password/set', { token: TOKEN, password }, cookie);
  const EXPIRED = { error: 'This link has expired. Ask for a new one.' };

  it('with a weak password returns 400 and does not spend the link', async () => {
    const res = await set('short');
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/at least 10/);
    expect(redeem).not.toHaveBeenCalled();
  });

  it('with a spent link returns the expired message', async () => {
    redeem.mockResolvedValue(null);
    const res = await set('a perfectly fine password');
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual(EXPIRED);
  });

  it('for a member removed after the link was sent returns the expired message and no session', async () => {
    redeem.mockResolvedValue({ email: EMAIL, companyId: CO, purpose: 'reset' });
    state.row = null;
    const res = await set('a perfectly fine password');
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual(EXPIRED);
    expect(cookieOf(res)).toBeNull();
  });

  it('ends nobody\'s sessions when the link is spent or the person no longer passes', async () => {
    redeem.mockResolvedValue(null);
    await set('a perfectly fine password');
    redeem.mockResolvedValue({ email: EMAIL, companyId: CO, purpose: 'reset' });
    state.row!.canLogin = false;
    await set('a perfectly fine password');
    expect(endSessions).not.toHaveBeenCalled();
  });

  it('when ending the other sessions fails, the password is left unchanged and the error says so', async () => {
    redeem.mockResolvedValue({ email: EMAIL, companyId: CO, purpose: 'reset' });
    endSessions.mockRejectedValue(new Error('db down'));
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const res = await set('a perfectly fine password');
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: 'Could not save your password. Try again.' });
      expect(cookieOf(res)).toBeNull();
      expect(state.row!.passwordHash).toBe(HASH);
      expect(state.calls).not.toContain('set-hash');
    } finally {
      logged.mockRestore();
    }
  });

  it('for a link minted by another company returns the expired message', async () => {
    redeem.mockResolvedValue({ email: EMAIL, companyId: '22222222-2222-4222-8222-222222222222', purpose: 'reset' });
    const res = await set('a perfectly fine password');
    expect(res.status).toBe(400);
    expect(state.row!.passwordHash).toBe(HASH);
  });

  it('success starts a session on a new session id', async () => {
    redeem.mockResolvedValue({ email: EMAIL, companyId: CO, purpose: 'welcome' });
    state.row!.failedLogins = 3;
    const planted = 'connect.sid=s%3Aplanted.invalid';
    const res = await set('a perfectly fine password', planted);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const after = cookieOf(res);
    expect(after).toBeTruthy();
    expect(after).not.toBe(planted);
    expect(state.row!.passwordHash).not.toBe(HASH);
    expect(state.row!.failedLogins).toBe(0);
    expect(state.calls).toContain('touch:1');
    // The person's other sessions and other links end, before the new session starts.
    expect(endSessions).toHaveBeenCalledWith(EMAIL);
    expect(dropLinks).toHaveBeenCalledWith(EMAIL);
    // Sessions end before the password changes, so a failure there leaves it unchanged.
    expect(state.calls.indexOf('end-sessions')).toBeLessThan(state.calls.indexOf('set-hash'));
    const me = await fetch(`${base}/api/auth/me`, { headers: { cookie: after! } });
    expect(me.status).toBe(200);
    // And the new password signs in.
    expect((await login(EMAIL, 'a perfectly fine password')).status).toBe(200);
  });
});
