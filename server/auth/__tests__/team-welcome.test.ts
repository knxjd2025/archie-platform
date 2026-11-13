import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

/**
 * POST /api/team and the welcome email. Storage, the company lookup, the link
 * minting and the mailer are faked; the route's decisions are what is tested.
 */
const { createMember, mint, sendMail, mailReady } = vi.hoisted(() => ({
  createMember: vi.fn(),
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
  updateTeamMember: vi.fn(),
  memberByJobtreadRep: vi.fn(async () => undefined),
  getTeamMemberById: vi.fn(),
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
    sendMail.mockRejectedValue(new Error('Resend 500'));
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
