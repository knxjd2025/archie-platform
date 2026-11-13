import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/** What the welcome and reset emails hand to the company's own email (GHL). The send is faked. */
class GhlNotConnectedError extends Error {}
const sent: Array<{ to: string; toName?: string; subject: string; html: string; from?: string }> = [];
const state = { connected: true };
vi.mock('../../integrations/company-mail', () => ({
  sendCompanyEmail: vi.fn(async (msg: (typeof sent)[number]) => {
    if (!state.connected) throw new GhlNotConnectedError();
    sent.push(msg);
    return { via: 'ghl', messageId: 'm1' };
  }),
}));
vi.mock('../../integrations/ghl/connection', () => ({
  GhlNotConnectedError,
  hasGhlConnection: async () => state.connected,
}));

const { sendPasswordLinkEmail, passwordMailConfigured } = await import('../password-mail');

let savedBase: string | undefined;
beforeEach(() => {
  sent.length = 0;
  state.connected = true;
  savedBase = process.env.APP_BASE_URL;
  process.env.APP_BASE_URL = 'https://app.example.test';
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  if (savedBase === undefined) delete process.env.APP_BASE_URL; else process.env.APP_BASE_URL = savedBase;
});

const base = { to: 'dana@example.test', name: '<b>Dana</b> Fox', companyName: 'Fox & Sons "Roofing"', url: 'https://app.example.test/set-password#t=abc' };

describe('password link email', () => {
  it('goes out through the company email to the member, with no personal sender', async () => {
    expect(await sendPasswordLinkEmail({ ...base, purpose: 'welcome' })).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe('dana@example.test');
    expect(sent[0].toName).toBe(base.name);
    expect(sent[0].from).toBeUndefined();
    expect(sent[0].subject).toBe('Set up your Archie login for Fox & Sons "Roofing"');
  });

  it('the welcome email says what to do when the link has expired', async () => {
    await sendPasswordLinkEmail({ ...base, purpose: 'welcome' });
    const html = sent[0].html;
    expect(html).toContain('Forgot password?');
    expect(html).toContain('https://app.example.test/login');
    expect(html).not.toMatch(/—/);
  });

  it('the welcome email says the link expires in 3 days; the reset email says 1 hour', async () => {
    await sendPasswordLinkEmail({ ...base, purpose: 'welcome' });
    await sendPasswordLinkEmail({ ...base, purpose: 'reset' });
    expect(sent[0].html).toContain('This link works once and expires in 3 days.');
    expect(sent[0].html).not.toContain('1 hour');
    expect(sent[1].html).toContain('This link works once and expires in 1 hour.');
    expect(sent[1].html).not.toContain('3 days');
  });

  it('escapes the name and company name', async () => {
    await sendPasswordLinkEmail({ ...base, purpose: 'welcome' });
    const html = sent[0].html;
    expect(html).not.toContain('<b>');
    expect(html).toContain('&lt;b&gt;Dana&lt;/b&gt;');
    expect(html).toContain('Fox &amp; Sons &quot;Roofing&quot;');
  });

  it('the reset email goes out with the link', async () => {
    await sendPasswordLinkEmail({ ...base, purpose: 'reset' });
    expect(sent[0].subject).toBe('Reset your Archie password');
    expect(sent[0].html).toContain(base.url);
  });

  it('returns false and sends nothing when the company has no email connection', async () => {
    state.connected = false;
    expect(await sendPasswordLinkEmail({ ...base, purpose: 'reset' })).toBe(false);
    expect(sent).toHaveLength(0);
    expect(await passwordMailConfigured()).toBe(false);
  });

  it('returns false and sends nothing without APP_BASE_URL', async () => {
    delete process.env.APP_BASE_URL;
    expect(await sendPasswordLinkEmail({ ...base, purpose: 'reset' })).toBe(false);
    expect(sent).toHaveLength(0);
    expect(await passwordMailConfigured()).toBe(false);
  });

  it('is ready when the company email is connected and APP_BASE_URL is set', async () => {
    expect(await passwordMailConfigured()).toBe(true);
  });
});
