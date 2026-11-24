/**
 * What a person may type into "Email this report", and the email it makes
 * (no database, no network). The address and the name go into the headers of a
 * real email, so a line break in either is refused; the optional personal
 * message is plain text, cut to length, and escaped wherever it lands in HTML.
 * Fictional: Summit Ridge Roofing in Cedar Falls, the customer Dana Whitfield.
 */
import { describe, expect, it } from 'vitest';
import { BAD_EMAIL, SEND_BAD_NAME, SEND_MESSAGE_TOO_LONG, MAX_SEND_MESSAGE } from '../../../shared/roof-reports';
import { buildReportEmail, parseSendBody, readSendKey } from '../send-input';

const GOOD = { email: 'dana@example.com', customerName: 'Dana Whitfield', message: 'Here is the report we talked about.' };
const LINK = `https://app.example.test/r/roof/${'a'.repeat(64)}`;

describe('the request to send', () => {
  it('takes an address, a name and a message, and trims them', () => {
    const r = parseSendBody({ email: '  Dana@Example.com ', customerName: ' Dana Whitfield ', message: ' Hello. ' });
    expect(r).toEqual({ ok: true, value: { email: 'dana@example.com', customerName: 'Dana Whitfield', message: 'Hello.' } });
  });

  it('needs only the address', () => {
    expect(parseSendBody({ email: 'dana@example.com' })).toEqual({ ok: true, value: { email: 'dana@example.com', customerName: '', message: '' } });
  });

  it('refuses anything that is not a single, plain address, with the one sentence', () => {
    const bad = ['', 'dana', 'dana@', '@example.com', 'dana@example', 'dana@@example.com', 'a b@example.com', 'dana@example.com, joe@example.com', 'dana@example.com;joe@example.com',
      '<dana@example.com>', 'Dana <dana@example.com>', '"dana"@example.com', 'dana@example.com\r\nBcc: x@example.com', 'dana@example.com\nBcc: x@example.com', 'dana\r@example.com',
      'dana@exam\u0000ple.com', `${'a'.repeat(250)}@example.com`, 'dana@example..com', '.dana@example.com', 'dana@-example.com'];
    for (const email of bad) expect(parseSendBody({ ...GOOD, email }), JSON.stringify(email)).toEqual({ ok: false, error: BAD_EMAIL });
    for (const email of [undefined, null, 5, {}, ['dana@example.com']]) expect(parseSendBody({ ...GOOD, email }), String(email)).toEqual({ ok: false, error: BAD_EMAIL });
  });

  it('refuses a name with a line break or a control character in it', () => {
    for (const customerName of ['Dana\r\nBcc: x@example.com', 'Dana\nWhitfield', 'Dana\rWhitfield', 'Dana\u2028Whitfield', 'Dana\u0000', 'Dana\u0007']) {
      expect(parseSendBody({ ...GOOD, customerName }), JSON.stringify(customerName)).toEqual({ ok: false, error: SEND_BAD_NAME });
    }
    expect(parseSendBody({ ...GOOD, customerName: 'x'.repeat(201) })).toEqual({ ok: false, error: SEND_BAD_NAME });
  });

  it('keeps a message as plain text with its line breaks, and refuses one that is too long', () => {
    expect(parseSendBody({ ...GOOD, message: 'Line one.\r\nLine two.\n\n\n\nLine three.' })).toMatchObject({ ok: true, value: { message: 'Line one.\nLine two.\n\nLine three.' } });
    expect(parseSendBody({ ...GOOD, message: 'a\u0000b\u0007c' })).toMatchObject({ ok: true, value: { message: 'abc' } });
    expect(parseSendBody({ ...GOOD, message: 'x'.repeat(MAX_SEND_MESSAGE) }).ok).toBe(true);
    expect(parseSendBody({ ...GOOD, message: 'x'.repeat(MAX_SEND_MESSAGE + 1) })).toEqual({ ok: false, error: SEND_MESSAGE_TOO_LONG });
  });

  it('refuses anything else in the body, so nothing names a company, a report or a sender', () => {
    for (const extra of [{ from: 'boss@example.com' }, { cc: 'x@example.com' }, { subject: 'Hi' }, { companyId: 'x' }, { reportId: 'x' }, { shareToken: 'x' }]) {
      expect(parseSendBody({ ...GOOD, ...extra }).ok, JSON.stringify(extra)).toBe(false);
    }
    expect(parseSendBody(null).ok).toBe(false);
    expect(parseSendBody([]).ok).toBe(false);
  });
});

describe('the request key', () => {
  it('is 8 to 200 plain characters, and is needed', () => {
    expect(readSendKey('send-12345678')).toBe('send-12345678');
    for (const bad of [undefined, '', 'short', 'x'.repeat(201), 'has space 123', 'new\r\nline1234', 'dana@example.com']) expect(readSendKey(bad), String(bad)).toBeNull();
  });
});

describe('the email', () => {
  const make = (over: Partial<Parameters<typeof buildReportEmail>[0]> = {}) => buildReportEmail({ company: 'Summit Ridge Roofing', customerName: 'Dana Whitfield', link: LINK, message: '', phone: '555-0100', ...over });

  it('is short and plain, names the company, and carries the share link', () => {
    const { subject, html } = make();
    expect(subject).toBe('Your roof report from Summit Ridge Roofing');
    expect(html).toContain('Hi Dana,');
    expect(html).toContain(`href="${LINK}"`);
    expect(html).toContain('Summit Ridge Roofing');
    expect(html.length).toBeLessThan(2500);
  });

  it('never holds the report itself or a photo', () => {
    const { html } = make();
    expect(html).not.toMatch(/<img|<iframe|<script|<video|photos\/|executive|finding|estimate|\$\d/i);
    expect([...new Set(html.match(/https?:\/\/[^\s"<]+/g))]).toEqual([LINK]);
  });

  it('has no em dash and no line break in the subject', () => {
    const { subject, html } = make({ message: 'Thanks.' });
    expect(`${subject}${html}`).not.toContain('—');
    expect(subject).not.toMatch(/[\r\n]/);
  });

  it('escapes the name, the company, the phone and the message, and shows the message as plain lines', () => {
    const { html } = make({ company: 'Ridge <b>&</b> Co', customerName: '<script>alert(1)</script>', phone: '"><img src=x>', message: '<img src=x onerror=alert(1)>\nSecond & last' });
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<b>');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;<br>Second &amp; last');
    expect(html).toContain('Ridge &lt;b&gt;&amp;&lt;/b&gt; Co');
  });

  it('greets by the first name only, or plainly when there is no name', () => {
    expect(make({ customerName: 'Dana Whitfield' }).html).toContain('Hi Dana,');
    expect(make({ customerName: '' }).html).toContain('Hello,');
    expect(make({ customerName: '' }).html).not.toContain('Hi ,');
  });

  it('falls back to a plain subject when the company name could not safely go in a header', () => {
    expect(make({ company: 'Summit\r\nBcc: x@example.com' }).subject).toBe('Your roof report');
    expect(make({ company: '' }).subject).toBe('Your roof report');
  });

  it('only ever links to the one address it is given, escaped', () => {
    expect(make({ link: 'https://app.example.test/r/roof/x"onmouseover="alert(1)' }).html).not.toContain('"onmouseover');
  });
});
