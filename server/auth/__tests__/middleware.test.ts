import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The roster lookup is the only thing the middleware reads; stub it so each
// test decides who is on the team and in what state.
const getTeamMemberByEmail = vi.fn();
vi.mock('../../storage/team', () => ({ getTeamMemberByEmail: (email: string) => getTeamMemberByEmail(email) }));

import { requireAuth, requireRole, clearSessionRevalidationCache } from '../middleware';

function mockRes() {
  return {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) { this.statusCode = code; return this; },
    json(payload: unknown) { this.body = payload; return this; },
  };
}

function mockReq(user?: { email: string; name: string; role: string }) {
  const req: any = { session: { user } };
  req.session.destroy = vi.fn((cb: () => void) => { req.session.user = undefined; cb(); });
  return req;
}

const member = (over: Record<string, unknown> = {}) => ({
  email: 'a@b.com', name: 'A', role: 'admin', active: true, canLogin: true, ...over,
});

/** The middleware finishes asynchronously; wait for it to call next or respond. */
async function run(mw: (req: any, res: any, next: any) => unknown, req: any) {
  const res: any = mockRes();
  const next = vi.fn();
  mw(req, res, next);
  await vi.waitFor(() => { if (!next.mock.calls.length && !res.statusCode) throw new Error('pending'); });
  return { res, next };
}

beforeEach(() => {
  clearSessionRevalidationCache();
  getTeamMemberByEmail.mockReset();
});
afterEach(() => { delete process.env.LOGIN_ALLOWLIST; });

describe('requireAuth', () => {
  it('401s when no session user', () => {
    const req: any = { session: {} };
    const res: any = mockRes();
    const next = vi.fn();
    requireAuth(req, res, next);
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next for an active member with login enabled', async () => {
    getTeamMemberByEmail.mockResolvedValue(member());
    const { next } = await run(requireAuth, mockReq({ email: 'a@b.com', name: 'A', role: 'admin' }));
    expect(next).toHaveBeenCalledOnce();
  });

  it('ends the session of someone switched off on the roster', async () => {
    // Before revalidation, flipping active off did nothing to a session that
    // was already open — the person kept their access until the cookie died.
    getTeamMemberByEmail.mockResolvedValue(member({ active: false }));
    const req = mockReq({ email: 'a@b.com', name: 'A', role: 'admin' });
    const { res, next } = await run(requireAuth, req);
    expect(res.statusCode).toBe(401);
    expect(req.session.destroy).toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it('ends the session when login is disabled', async () => {
    getTeamMemberByEmail.mockResolvedValue(member({ canLogin: false }));
    const req = mockReq({ email: 'a@b.com', name: 'A', role: 'admin' });
    const { res } = await run(requireAuth, req);
    expect(res.statusCode).toBe(401);
    expect(req.session.destroy).toHaveBeenCalled();
  });

  it('ends the session when the person is no longer on the roster', async () => {
    getTeamMemberByEmail.mockResolvedValue(undefined);
    const req = mockReq({ email: 'a@b.com', name: 'A', role: 'admin' });
    const { res } = await run(requireAuth, req);
    expect(res.statusCode).toBe(401);
    expect(req.session.destroy).toHaveBeenCalled();
  });

  it('applies LOGIN_ALLOWLIST the same way sign-in does', async () => {
    process.env.LOGIN_ALLOWLIST = 'someone@else.com';
    getTeamMemberByEmail.mockResolvedValue(member());
    const req = mockReq({ email: 'a@b.com', name: 'A', role: 'admin' });
    const { res } = await run(requireAuth, req);
    expect(res.statusCode).toBe(401);
  });

  it('ends a blocked address without reading the roster', async () => {
    const req = mockReq({ email: 'fred@bestroofingnow.com', name: 'F', role: 'admin' });
    const { res } = await run(requireAuth, req);
    expect(res.statusCode).toBe(401);
    expect(getTeamMemberByEmail).not.toHaveBeenCalled();
  });

  it('refreshes the session role from the roster', async () => {
    getTeamMemberByEmail.mockResolvedValue(member({ role: 'sales', name: 'A New' }));
    const req = mockReq({ email: 'a@b.com', name: 'A', role: 'admin' });
    await run(requireAuth, req);
    expect(req.session.user).toEqual({ email: 'a@b.com', name: 'A New', role: 'sales' });
  });

  it('reads the roster at most once per cache window', async () => {
    getTeamMemberByEmail.mockResolvedValue(member());
    for (let i = 0; i < 3; i++) await run(requireAuth, mockReq({ email: 'a@b.com', name: 'A', role: 'admin' }));
    expect(getTeamMemberByEmail).toHaveBeenCalledTimes(1);
  });

  it('refuses the request but keeps the session when the roster cannot be read', async () => {
    // A database blip must not sign the whole team out.
    getTeamMemberByEmail.mockRejectedValue(new Error('connection reset'));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const req = mockReq({ email: 'a@b.com', name: 'A', role: 'admin' });
    const { res, next } = await run(requireAuth, req);
    errSpy.mockRestore();
    expect(res.statusCode).toBe(503);
    expect(req.session.destroy).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });
});

describe('requireRole', () => {
  it('403s when role too low', async () => {
    getTeamMemberByEmail.mockResolvedValue(member({ role: 'sales' }));
    const { res, next } = await run(requireRole('admin'), mockReq({ email: 'a@b.com', name: 'A', role: 'sales' }));
    expect(res.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('passes when role sufficient', async () => {
    getTeamMemberByEmail.mockResolvedValue(member());
    const { next } = await run(requireRole('manager'), mockReq({ email: 'a@b.com', name: 'A', role: 'admin' }));
    expect(next).toHaveBeenCalledOnce();
  });

  it('judges a demoted admin by the role the roster holds now', async () => {
    // The session still says admin from sign-in; the roster says sales.
    getTeamMemberByEmail.mockResolvedValue(member({ role: 'sales' }));
    const { res, next } = await run(requireRole('admin'), mockReq({ email: 'a@b.com', name: 'A', role: 'admin' }));
    expect(res.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('ends a deactivated session instead of answering 403', async () => {
    getTeamMemberByEmail.mockResolvedValue(member({ active: false }));
    const req = mockReq({ email: 'a@b.com', name: 'A', role: 'admin' });
    const { res } = await run(requireRole('admin'), req);
    expect(res.statusCode).toBe(401);
    expect(req.session.destroy).toHaveBeenCalled();
  });
});

describe('roster lookups under a burst of requests', () => {
  it('parallel requests on a cold cache share one roster query', async () => {
    let resolve!: (v: unknown) => void;
    getTeamMemberByEmail.mockReturnValue(new Promise((r) => { resolve = r; }));
    const runs = Array.from({ length: 5 }, () => run(requireAuth, mockReq({ email: 'a@b.com', name: 'A', role: 'admin' })));
    resolve(member());
    const results = await Promise.all(runs);
    expect(getTeamMemberByEmail).toHaveBeenCalledTimes(1);
    for (const { next } of results) expect(next).toHaveBeenCalledOnce();
  });

  it('a failed lookup is not remembered — the next request asks again', async () => {
    getTeamMemberByEmail.mockRejectedValueOnce(new Error('db blip')).mockResolvedValueOnce(member());
    const first = await run(requireAuth, mockReq({ email: 'a@b.com', name: 'A', role: 'admin' }));
    expect(first.res.statusCode).toBe(503);
    const second = await run(requireAuth, mockReq({ email: 'a@b.com', name: 'A', role: 'admin' }));
    expect(second.next).toHaveBeenCalledOnce();
    expect(getTeamMemberByEmail).toHaveBeenCalledTimes(2);
  });
});
