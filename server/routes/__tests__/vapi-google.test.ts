import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { voiceMailbox, voiceGoogleReady } from '../vapi-google';
import { buildMimeMessage } from '../../integrations/google-workspace';

const ENV = ['VOICE_MAILBOX', 'GOOGLE_SA_EMAIL', 'GOOGLE_SA_KEY'];
const saved: Record<string, string | undefined> = {};

beforeEach(() => { for (const k of ENV) { saved[k] = process.env[k]; delete process.env[k]; } });
afterEach(() => {
  for (const k of ENV) {
    delete process.env[k];
    if (saved[k] !== undefined) process.env[k] = saved[k];
  }
});

const decode = (raw: string) => Buffer.from(raw, 'base64url').toString('utf8');

describe('voiceMailbox', () => {
  it("defaults to the owner's mailbox", () => {
    // A phone call has no signed-in user, so unlike every other Google path in
    // the app the voice agent cannot scope to "the caller".
    expect(voiceMailbox()).toBe('james@bestroofingnow.com');
  });

  it('can be pointed at another mailbox by env', () => {
    process.env.VOICE_MAILBOX = 'admin@bestroofingnow.com';
    expect(voiceMailbox()).toBe('admin@bestroofingnow.com');
  });

  it('normalises case and stray whitespace', () => {
    // Delegation matches the subject exactly; " James@... " would 400.
    process.env.VOICE_MAILBOX = '  James@BestRoofingNow.com ';
    expect(voiceMailbox()).toBe('james@bestroofingnow.com');
  });

  it('falls back when the env var is blank', () => {
    process.env.VOICE_MAILBOX = '';
    expect(voiceMailbox()).toBe('james@bestroofingnow.com');
  });
});

describe('voiceGoogleReady', () => {
  it('is false until delegation is configured', () => {
    expect(voiceGoogleReady()).toBe(false);
    process.env.GOOGLE_SA_EMAIL = 'sa@x.iam.gserviceaccount.com';
    expect(voiceGoogleReady()).toBe(false);
    process.env.GOOGLE_SA_KEY = 'a2V5';
    expect(voiceGoogleReady()).toBe(true);
  });
});

describe('buildMimeMessage', () => {
  it('includes Cc only when one is given', () => {
    expect(decode(buildMimeMessage('me@x.com', 'you@x.com', 'Hi', '<p>b</p>'))).not.toMatch(/^Cc:/m);
    expect(decode(buildMimeMessage('me@x.com', 'you@x.com', 'Hi', '<p>b</p>', 'boss@x.com')))
      .toMatch(/^Cc: boss@x\.com$/m);
  });

  it('strips CR/LF from headers so a transcript cannot inject one', () => {
    // These values originate in a spoken phone transcript. A newline in the
    // recipient or subject would otherwise append arbitrary headers — a Bcc to
    // a stranger, or a forged From — to a message sent from the real mailbox.
    const raw = decode(
      buildMimeMessage(
        'me@x.com',
        'you@x.com\r\nBcc: attacker@evil.com',
        'Invoice\r\nX-Injected: yes',
        '<p>body</p>',
      ),
    );
    expect(raw).not.toMatch(/^Bcc:/m);
    expect(raw).not.toMatch(/^X-Injected:/m);
    expect(raw).toMatch(/^To: you@x\.com Bcc: attacker@evil\.com$/m);
  });

  it('strips injection from the Cc too', () => {
    const raw = decode(buildMimeMessage('me@x.com', 'you@x.com', 'Hi', '<p>b</p>', 'a@x.com\r\nBcc: b@evil.com'));
    expect(raw).not.toMatch(/^Bcc:/m);
  });

  it('keeps the body intact below the header break', () => {
    // Only headers are sanitised — the HTML body legitimately contains newlines.
    const raw = decode(buildMimeMessage('me@x.com', 'you@x.com', 'Hi', '<p>line one</p>\n<p>line two</p>'));
    expect(raw).toContain('<p>line one</p>\n<p>line two</p>');
    expect(raw).toMatch(/Content-Type: text\/html; charset=utf-8\r\n\r\n/);
  });
});
