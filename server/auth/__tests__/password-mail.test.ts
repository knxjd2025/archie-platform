import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { sendPasswordLinkEmail } from '../password-mail';

/** What goes out to Resend for the welcome and reset emails. fetch is faked. */
const sent: Array<{ subject: string; html: string; to: string[] }> = [];
const ENV = { RESEND_API_KEY: 're_test', ARCHIE_MAIL_FROM: 'Archie <hi@example.test>', APP_BASE_URL: 'https://app.example.test' };
let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  sent.length = 0;
  saved = Object.fromEntries(Object.keys(ENV).map((k) => [k, process.env[k]]));
  Object.assign(process.env, ENV);
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
    sent.push(JSON.parse(String(init.body)));
    return new Response('{}', { status: 200 });
  }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});

const base = { to: 'dana@example.test', name: '<b>Dana</b> Fox', companyName: 'Fox & Sons "Roofing"', url: 'https://app.example.test/set-password#t=abc' };

describe('password link email', () => {
  it('the welcome email says what to do when the link has expired', async () => {
    expect(await sendPasswordLinkEmail({ ...base, purpose: 'welcome' })).toBe(true);
    const html = sent[0].html;
    expect(html).toContain('Forgot password?');
    expect(html).toContain('https://app.example.test/login');
    expect(html).not.toMatch(/\u2014/);
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
});
