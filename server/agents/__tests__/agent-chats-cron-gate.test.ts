import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { member } = vi.hoisted(() => ({ member: vi.fn() }));
vi.mock('../../storage/team', () => ({ getTeamMemberByEmail: (...a: unknown[]) => member(...a) }));

const { agentChatsCronGate } = await import('../archie-routes');
const { clearSessionRevalidationCache } = await import('../../auth/middleware');

function res() {
  const r: any = {};
  r.status = vi.fn().mockReturnValue(r);
  r.json = vi.fn().mockReturnValue(r);
  return r;
}
const flush = () => new Promise((r) => setTimeout(r, 0));

// The nightly-summary cron accepted any session whose stored role said admin —
// the role as it was at sign-in. Someone demoted on Team & Roles kept it until
// their cookie expired. The session path now goes through requireRole, which
// re-reads the roster; the CRON_SECRET path is unchanged.
describe('agent-chats cron gate', () => {
  const saved = process.env.CRON_SECRET;
  beforeEach(() => { clearSessionRevalidationCache(); member.mockReset(); process.env.CRON_SECRET = 'cron-secret'; });
  afterEach(() => { process.env.CRON_SECRET = saved; });

  it('lets the cron in with its bearer, no session needed', () => {
    const next = vi.fn();
    agentChatsCronGate({ headers: { authorization: 'Bearer cron-secret' } } as any, res(), next);
    expect(next).toHaveBeenCalled();
    expect(member).not.toHaveBeenCalled();
  });

  it('refuses a session that says admin when the roster now says sales', async () => {
    member.mockResolvedValue({ email: 'x@bestroofingnow.com', name: 'X', role: 'sales', active: true, canLogin: true });
    const r = res();
    const next = vi.fn();
    const session = { user: { email: 'x@bestroofingnow.com', name: 'X', role: 'admin' } };
    agentChatsCronGate({ headers: {}, session } as any, r, next);
    await flush();
    expect(next).not.toHaveBeenCalled();
    expect(r.status).toHaveBeenCalledWith(403);
  });

  it('lets a current admin in', async () => {
    member.mockResolvedValue({ email: 'j@bestroofingnow.com', name: 'J', role: 'admin', active: true, canLogin: true });
    const next = vi.fn();
    const session = { user: { email: 'j@bestroofingnow.com', name: 'J', role: 'admin' } };
    agentChatsCronGate({ headers: {}, session } as any, res(), next);
    await flush();
    expect(next).toHaveBeenCalled();
  });

  it('refuses no session and a wrong bearer', () => {
    const r = res();
    const next = vi.fn();
    agentChatsCronGate({ headers: { authorization: 'Bearer nope' } } as any, r, next);
    expect(next).not.toHaveBeenCalled();
    expect(r.status).toHaveBeenCalledWith(401);
  });
});
