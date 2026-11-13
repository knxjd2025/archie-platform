import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

/**
 * POST /api/team and the welcome email. Storage, the company lookup, the link
 * minting and the mailer are faked; the route's decisions are what is tested.
 */
const { createMember, updateMember, getMember, mint, sendMail, mailReady } = vi.hoisted(() => ({
  createMember: vi.fn(),
  updateMember: vi.fn(),
  getMember: vi.fn(),
  mint: vi.fn(),
  sendMail: vi.fn(),
  mailReady: vi.fn(),
}));

vi.mock('../middleware', () => ({
  requireRole: () => (req: any, _res: any, next: any) => { req.session = { user: { email: 'admin@example.com', role: 'admin' } }; next(); },
  clearSessionRevalidationCache: vi.fn(),
}));
vi.mock('../../calendar/access', () => ({ calendarSeeAllEmails: async () => [], setCalendarSeeAll: vi.fn() }));
vi.mock('../../sync/jobtread-reps', () => ({ syncSalesRepsFromJobTread: vi.fn() }));
vi.mock('../../sync/jobtread-roles', () => ({ pushRoleToJobTread: vi.fn() }));
vi.mock('../../storage/team', () => ({
  listTeamMembers: vi.fn(async () => []),
  createTeamMember: (...a: unknown[]) => createMember(...a),
  updateTeamMember: (...a: unknown[]) => updateMember(...a),
  memberByJobtreadRep: vi.fn(async () => undefined),
  getTeamMemberById: (...a: unknown[]) => getMember(...a),
}));
vi.mock('../../tenant/companies', () => ({
  getCurrentCompany: async () => ({ id: 'co-1', name: 'Test Co' }),
}));
vi.mock('../password-mail', () => ({
  sendPasswordLinkEmail: (...a: unknown[]) => sendMail(...a),
  passwordMailConfigured: () => mailReady(),
}));
vi.mock('../password-links', () => ({
  mintPasswordLink: (...a: unknown[]) => mint(...a),
  passwordLinkUrl: (t: string) => `https://app.example.com/set-password?token=${t}`,
}));

const { registerTeamRoutes } = await import('../team-routes');

let server: Server;
let base = '';
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  registerTeamRoutes(app);
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const BODY = { name: 'Dana Fox', email: 'dana@example.com', role: 'sales', phone: '555-0100', canLogin: true };
beforeEach(() => {
  createMember.mockReset().mockImplementation(async (v: any) => ({ id: 7, ...v }));
  mint.mockReset().mockResolvedValue('tok');
  sendMail.mockReset().mockResolvedValue(true);
  mailReady.mockReset().mockReturnValue(true);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
const add = (body: unknown) =>
  fetch(`${base}/api/team`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

describe('POST /api/team welcome email', () => {
  it('adding a member with canLogin sends a welcome link', async () => {
    const res = await add(BODY);
    expect(res.status).toBe(201);
    expect((await res.json()).welcomeEmailSent).toBe(true);
    expect(mint).toHaveBeenCalledWith('dana@example.com', 'welcome');
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(sendMail).toHaveBeenCalledWith({
      to: 'dana@example.com',
      name: 'Dana Fox',
      companyName: 'Test Co',
      purpose: 'welcome',
      url: 'https://app.example.com/set-password?token=tok',
    });
  });

  it('adding a member without canLogin sends nothing', async () => {
    const res = await add({ ...BODY, canLogin: false });
    expect(res.status).toBe(201);
    expect((await res.json()).welcomeEmailSent).toBe(false);
    expect(mint).not.toHaveBeenCalled();
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('a mail failure still returns 201 with welcomeEmailSent false', async () => {
    sendMail.mockRejectedValue(new Error('send refused'));
    const res = await add(BODY);
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.welcomeEmailSent).toBe(false);
    expect(json.id).toBe(7);
  });

  it('a mint failure still returns 201 with welcomeEmailSent false', async () => {
    mint.mockRejectedValue(new Error('db down'));
    const res = await add(BODY);
    expect(res.status).toBe(201);
    expect((await res.json()).welcomeEmailSent).toBe(false);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('mail not configured: no link is minted, still 201 with welcomeEmailSent false, and a warning is logged', async () => {
    mailReady.mockReturnValue(false);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const res = await add(BODY);
      expect(res.status).toBe(201);
      expect((await res.json()).welcomeEmailSent).toBe(false);
      expect(mint).not.toHaveBeenCalled();
      expect(sendMail).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('welcome email not sent'));
    } finally {
      warn.mockRestore();
    }
  });

  it('a member without login logs no warning about mail', async () => {
    mailReady.mockReturnValue(false);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await add({ ...BODY, canLogin: false });
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});

describe('PATCH /api/team/:id welcome email', () => {
  const MEMBER = { id: 7, name: 'Dana Fox', email: 'dana@example.com', role: 'sales', active: true, canLogin: false, hasPassword: false };
  const patch = (body: unknown) =>
    fetch(`${base}/api/team/7`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const given = (before: Partial<typeof MEMBER>) => {
    getMember.mockReset().mockResolvedValue({ ...MEMBER, ...before });
    updateMember.mockReset().mockImplementation(async (_id: number, v: any) => ({ ...MEMBER, ...before, ...v }));
  };

  it('turning login on sends the welcome link once', async () => {
    given({});
    const res = await patch({ canLogin: true });
    expect(res.status).toBe(200);
    expect((await res.json()).welcomeEmailSent).toBe(true);
    expect(mint).toHaveBeenCalledTimes(1);
    expect(mint).toHaveBeenCalledWith('dana@example.com', 'welcome');
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: 'dana@example.com', purpose: 'welcome', companyName: 'Test Co' }));
  });

  it('login already on: nothing is sent and the response has no welcomeEmailSent', async () => {
    given({ canLogin: true });
    const res = await patch({ canLogin: true, phone: '555-0101' });
    expect(res.status).toBe(200);
    expect(await res.json()).not.toHaveProperty('welcomeEmailSent');
    expect(mint).not.toHaveBeenCalled();
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('a member who already has a password gets nothing', async () => {
    given({ hasPassword: true });
    const res = await patch({ canLogin: true });
    expect(res.status).toBe(200);
    expect(await res.json()).not.toHaveProperty('welcomeEmailSent');
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('an inactive member gets nothing', async () => {
    given({ active: false });
    await patch({ canLogin: true });
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('other edits send nothing', async () => {
    given({});
    const res = await patch({ phone: '555-0199' });
    expect(await res.json()).not.toHaveProperty('welcomeEmailSent');
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('a mail failure still returns 200 with welcomeEmailSent false', async () => {
    given({});
    sendMail.mockRejectedValue(new Error('send refused'));
    const res = await patch({ canLogin: true });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.welcomeEmailSent).toBe(false);
    expect(json.canLogin).toBe(true);
  });

  it('mail not configured: still 200, welcomeEmailSent false, nothing minted', async () => {
    given({});
    mailReady.mockReturnValue(false);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const res = await patch({ canLogin: true });
      expect(res.status).toBe(200);
      expect((await res.json()).welcomeEmailSent).toBe(false);
      expect(mint).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});
