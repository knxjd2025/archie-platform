import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import session from 'express-session';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

/**
 * The Google sign-in round trip, through the real routes and a real session.
 *
 * Two holes this pins shut: the callback finished any sign-in it was handed
 * (state was just 'native' or nothing — login CSRF), and signing in kept the
 * session id from before, so a cookie planted or read beforehand was signed in
 * afterwards (session fixation).
 */
const { exchange, member, mint, redeem } = vi.hoisted(() => ({
  exchange: vi.fn(),
  member: vi.fn(),
  mint: vi.fn(),
  redeem: vi.fn(),
}));

vi.mock('../google', async (orig) => ({
  ...(await orig<typeof import('../google')>()),
  exchangeCodeForProfile: (...a: unknown[]) => exchange(...a),
}));
vi.mock('../../storage/team', () => ({
  getTeamMemberByEmail: (...a: unknown[]) => member(...a),
  touchLogin: vi.fn(async () => {}),
}));
vi.mock('../native-handoff', () => ({
  mintHandoff: (...a: unknown[]) => mint(...a),
  redeemHandoff: (...a: unknown[]) => redeem(...a),
  sweepExpiredHandoffs: vi.fn(async () => 0),
  handoffUrl: (t: string) => `brnapp://auth?t=${t}`,
}));

const { registerAuthRoutes } = await import('../routes');
const { clearSessionRevalidationCache } = await import('../middleware');

const EMAIL = 'thomas@bestroofingnow.com';
const ROW = { email: EMAIL, name: 'Thomas', role: 'sales', active: true, canLogin: true };

let server: Server;
let base = '';

beforeAll(async () => {
  process.env.GOOGLE_CLIENT_ID = 'test-client-id';
  process.env.GOOGLE_CLIENT_SECRET = 'test-secret';
  delete process.env.LOGIN_ALLOWLIST;
  const app = express();
  app.use(express.json());
  app.use(session({ secret: 'test-secret', resave: false, saveUninitialized: false }));
  registerAuthRoutes(app);
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

beforeEach(() => {
  clearSessionRevalidationCache();
  exchange.mockReset().mockResolvedValue({ email: EMAIL, name: 'Thomas', sub: 'sub-1' });
  member.mockReset().mockResolvedValue(ROW);
  mint.mockReset().mockResolvedValue('handoff-token');
  redeem.mockReset();
});

const cookieOf = (res: Response): string | null => {
  const c = res.headers.getSetCookie().find((h) => h.startsWith('connect.sid='));
  return c ? c.split(';')[0] : null;
};

async function get(path: string, cookie?: string | null) {
  return fetch(base + path, { redirect: 'manual', headers: cookie ? { cookie } : {} });
}

/** Start a sign-in the way the Login button does; returns the browser's cookie and the state Google was given. */
async function startSignIn(native = false): Promise<{ cookie: string; state: string }> {
  const res = await get(`/api/auth/login/google${native ? '?native=1' : ''}`);
  expect(res.status).toBe(302);
  const google = new URL(res.headers.get('location')!);
  expect(google.hostname).toBe('accounts.google.com');
  expect(google.searchParams.get('code_challenge_method')).toBe('S256');
  const cookie = cookieOf(res);
  expect(cookie).toBeTruthy();
  return { cookie: cookie!, state: google.searchParams.get('state')! };
}

const callback = (state: string, cookie?: string | null) =>
  get(`/api/auth/login/google/callback?code=abc&state=${encodeURIComponent(state)}`, cookie);

describe('Google sign-in callback', () => {
  it('signs in the browser that started the sign-in, on a new session id', async () => {
    const { cookie, state } = await startSignIn();
    const res = await callback(state, cookie);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/');
    const signedIn = cookieOf(res);
    expect(signedIn).toBeTruthy();
    expect(signedIn).not.toBe(cookie);                 // regenerated, not reused

    const me = await get('/api/auth/me', signedIn);
    expect(me.status).toBe(200);
    expect((await me.json()).user.email).toBe(EMAIL);
    // The pre-sign-in cookie is worth nothing afterwards.
    expect((await get('/api/auth/me', cookie)).status).toBe(401);
    // The PKCE verifier from the session went to the token exchange.
    expect(exchange.mock.calls[0][2]).toEqual(expect.any(String));
  });

  it("refuses someone else's sign-in pushed onto this browser", async () => {
    const victim = await startSignIn();
    const attacker = await startSignIn();
    const res = await callback(attacker.state, victim.cookie);
    expect(res.headers.get('location')).toBe('/login?error=auth_failed');
    expect(exchange).not.toHaveBeenCalled();
  });

  it('refuses a callback from a browser that never started one', async () => {
    const { state } = await startSignIn();
    expect((await callback(state, null)).headers.get('location')).toBe('/login?error=auth_failed');
    expect((await callback('native', null)).headers.get('location')).toBe('/login?error=auth_failed');
    expect(exchange).not.toHaveBeenCalled();
  });

  it('will not finish the same sign-in twice', async () => {
    const { cookie, state } = await startSignIn();
    const first = await callback(state, cookie);
    expect(first.headers.get('location')).toBe('/');
    const again = await callback(state, cookieOf(first));
    expect(again.headers.get('location')).toBe('/login?error=auth_failed');
  });

  it('hands a native sign-in back to the app', async () => {
    const { cookie, state } = await startSignIn(true);
    const res = await callback(state, cookie);
    expect(res.headers.get('location')).toBe('brnapp://auth?t=handoff-token');
    expect(mint).toHaveBeenCalledWith(EMAIL);
  });
});

describe('native exchange', () => {
  it('starts a new session id rather than signing in the one it was sent with', async () => {
    // A session that exists before the exchange (here: one with a pending sign-in).
    const { cookie: before } = await startSignIn(true);
    redeem.mockResolvedValue(EMAIL);
    const res = await fetch(`${base}/api/auth/native/exchange`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: before },
      body: JSON.stringify({ token: 'x'.repeat(43) }),
    });
    expect(res.status).toBe(200);
    const after = cookieOf(res);
    expect(after).toBeTruthy();
    expect(after).not.toBe(before);
    expect((await get('/api/auth/me', after)).status).toBe(200);
    expect((await get('/api/auth/me', before)).status).toBe(401);
  });

  it('refuses a spent or unknown token', async () => {
    redeem.mockResolvedValue(null);
    const res = await fetch(`${base}/api/auth/native/exchange`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: 'nope' }),
    });
    expect(res.status).toBe(401);
  });
});
