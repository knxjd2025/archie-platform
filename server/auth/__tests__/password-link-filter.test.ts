import { describe, it, expect } from 'vitest';
import {
  isPasswordLinkMessage, isPasswordLinkGhlMessage, withoutPasswordLinkMessages, withoutPasswordLinkMessagesIn,
  redactPasswordLinkSnippet, redactGhlConversation, PASSWORD_LINK_SNIPPET,
} from '../password-link-filter';

const URL = 'https://app.example.com/set-password#t=AbC123_-xyz';

describe('isPasswordLinkMessage', () => {
  it('matches the plain link in a body', () => {
    expect(isPasswordLinkMessage({ body: `Hi, click ${URL} to continue` })).toBe(true);
  });

  it('matches the link inside an HTML href', () => {
    expect(isPasswordLinkMessage({ body: `<a href="${URL}">Set my password</a>` })).toBe(true);
  });

  it('matches HTML-escaped forms', () => {
    expect(isPasswordLinkMessage({ body: 'href="https://a.example.com/set-password&#35;t=abc"' })).toBe(true);
    expect(isPasswordLinkMessage({ body: 'https:&#x2F;&#x2F;a.example.com&#x2F;set-password&#x23;t&#x3D;abc' })).toBe(true);
    expect(isPasswordLinkMessage({ body: 'https://a.example.com/set-password&num;t&equals;abc' })).toBe(true);
    expect(isPasswordLinkMessage({ body: 'https:\\/\\/a.example.com\\/set-password#t=abc' })).toBe(true);
  });

  it('matches URL-encoded forms, including double encoding in a tracking redirect', () => {
    expect(isPasswordLinkMessage({ body: 'https://track.example.com/c?u=https%3A%2F%2Fa.example.com%2Fset-password%23t%3Dabc' })).toBe(true);
    expect(isPasswordLinkMessage({ body: 'https://track.example.com/c?u=https%253A%252F%252Fa.example.com%252Fset-password%2523t%253Dabc' })).toBe(true);
    expect(isPasswordLinkMessage({ body: 'HTTPS%3A%2F%2FA.EXAMPLE.COM%2FSET-PASSWORD%23T%3DABC' })).toBe(true);
  });

  it('matches the two subjects', () => {
    expect(isPasswordLinkMessage({ subject: 'Reset your Archie password', body: '' })).toBe(true);
    expect(isPasswordLinkMessage({ subject: '  reset your archie password ' })).toBe(true);
    expect(isPasswordLinkMessage({ subject: 'Set up your Archie login for Best Roofing', body: 'x' })).toBe(true);
  });

  it('does not match ordinary messages that mention passwords', () => {
    for (const m of [
      { subject: 'Wifi password', body: 'The password for the shop wifi is roof2026' },
      { subject: 'Re: Reset your Archie password please', body: 'Can you reset my password?' },
      { body: 'Forgot my password again, can you help?' },
      { body: 'Go to https://app.example.com/set-password to see the page' },
      { body: 'Your appointment is set. #t=1 on the list' },
      { subject: 'Set up your Archie login', body: 'Not the real subject' },
      { body: '50% off reroofs this week %zz' },
      {},
    ]) {
      expect(isPasswordLinkMessage(m)).toBe(false);
    }
  });

  it('tolerates non-string fields', () => {
    expect(isPasswordLinkMessage({ subject: 42, body: null })).toBe(false);
  });
});

describe('isPasswordLinkGhlMessage / withoutPasswordLinkMessages', () => {
  it('reads the link from any body field and the subject from meta', () => {
    expect(isPasswordLinkGhlMessage({ html: `<a href="${URL}">x</a>` })).toBe(true);
    expect(isPasswordLinkGhlMessage({ message: URL })).toBe(true);
    expect(isPasswordLinkGhlMessage({ meta: { email: { subject: 'Reset your Archie password' } }, body: 'Hi' })).toBe(true);
    expect(isPasswordLinkGhlMessage({ body: 'See you at 3' })).toBe(false);
    expect(isPasswordLinkGhlMessage(null)).toBe(false);
  });

  it('drops only the set-password messages', () => {
    const list = [
      { id: 'a', body: 'Roof looks great' },
      { id: 'b', subject: 'Set up your Archie login for Test Co', body: `<a href="${URL}">Set my password</a>` },
      { id: 'c', body: 'What is the password for the lockbox?' },
    ];
    expect(withoutPasswordLinkMessages(list).map((m) => m.id)).toEqual(['a', 'c']);
  });
});

describe('redactPasswordLinkSnippet', () => {
  it('replaces a snippet with the link, a subject, or the email opening lines', () => {
    expect(redactPasswordLinkSnippet(`Hi Dana, ${URL}`)).toBe(PASSWORD_LINK_SNIPPET);
    expect(redactPasswordLinkSnippet('Reset your Archie password')).toBe(PASSWORD_LINK_SNIPPET);
    expect(redactPasswordLinkSnippet('Hi Dana, You have been added to Test Co on Archie. Choose a password to sign in. Set my password')).toBe(PASSWORD_LINK_SNIPPET);
    expect(redactPasswordLinkSnippet('Hi Dana, Someone asked to reset the password for your Archie login. Choose a new one below.')).toBe(PASSWORD_LINK_SNIPPET);
    expect(redactPasswordLinkSnippet('Hi', 'Set up your Archie login for Test Co')).toBe(PASSWORD_LINK_SNIPPET);
  });

  it('leaves ordinary snippets alone', () => {
    expect(redactPasswordLinkSnippet('Can you reset the password on the gate code?')).toBe('Can you reset the password on the gate code?');
    expect(redactPasswordLinkSnippet('')).toBe('');
  });

  it('never leaves the link in a redacted snippet', () => {
    expect(redactPasswordLinkSnippet(`Set my password ${URL}`)).not.toContain('set-password');
  });
});

describe('redactGhlConversation', () => {
  it('replaces the last-message body and keeps everything else', () => {
    const c = { id: 'c1', contactId: 'k1', lastMessageBody: `Hi ${URL}`, unreadCount: 1 };
    expect(redactGhlConversation(c)).toEqual({ id: 'c1', contactId: 'k1', lastMessageBody: PASSWORD_LINK_SNIPPET, unreadCount: 1 });
  });

  it('returns an ordinary conversation unchanged', () => {
    const c = { id: 'c2', lastMessageBody: 'On my way' };
    expect(redactGhlConversation(c)).toBe(c);
  });
});

describe('withoutPasswordLinkMessagesIn', () => {
  const pw = { id: 'pw', body: `<a href="${URL}">x</a>` };
  const ok = { id: 'ok', body: 'On my way' };
  it('filters both GHL response shapes and keeps the rest', () => {
    expect(withoutPasswordLinkMessagesIn({ messages: [ok, pw] })).toEqual({ messages: [ok] });
    expect(withoutPasswordLinkMessagesIn({ messages: { messages: [pw, ok], lastMessageId: 'ok', nextPage: false } }))
      .toEqual({ messages: { messages: [ok], lastMessageId: 'ok', nextPage: false } });
  });
  it('passes through anything else', () => {
    expect(withoutPasswordLinkMessagesIn(null)).toBe(null);
    const odd = { nothing: true };
    expect(withoutPasswordLinkMessagesIn(odd)).toBe(odd);
  });
});
