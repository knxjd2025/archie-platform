import { describe, it, expect } from 'vitest';
import { buildMimeMessage, buildMimeWithAttachments, parseGmailMessage } from '../gmail-delegated';

const fixture = {
  id: 'm1',
  threadId: 't1',
  internalDate: '1784500000000',
  labelIds: ['INBOX', 'UNREAD'],
  payload: {
    headers: [
      { name: 'From', value: 'Jane Homeowner <jane@gmail.com>' },
      { name: 'Subject', value: 'Roof leak question' },
    ],
  },
  snippet: 'Hi, my roof is leaking near the chimney...',
};

describe('parseGmailMessage', () => {
  it('normalizes a message into a BrainEvent', () => {
    const ev = parseGmailMessage(fixture as any, 'thomas@bestroofingnow.com');
    expect(ev.source).toBe('gmail');
    expect(ev.sourceRef).toBe('t1');
    expect(ev.mailbox).toBe('thomas@bestroofingnow.com');
    expect(ev.direction).toBe('inbound');
    expect(ev.contact?.email).toBe('jane@gmail.com');
    expect(ev.text).toContain('Roof leak question');
  });
});

const decode = (raw: string) => Buffer.from(raw, 'base64url').toString('utf8');
const img = (over: Partial<{ filename: string; contentType: string; base64: string; contentId: string }> = {}) => ({
  filename: 'roof.jpg', contentType: 'image/jpeg', base64: 'AAAA'.repeat(40), ...over,
});

describe('a message with photos', () => {
  it('carries each photo inline, referenced by content id', () => {
    const mime = decode(buildMimeWithAttachments(
      'james@bestroofingnow.com', 'claims@carrier.test', 'Depreciation release',
      '<p>See <img src="cid:p1"></p>', [img({ contentId: 'p1' })],
    ));
    expect(mime).toContain('Content-Type: multipart/related; type="text/html"');
    expect(mime).toContain('Content-ID: <p1>');
    expect(mime).toContain('Content-Disposition: inline; filename="roof.jpg"');
    expect(mime).toContain('Content-Transfer-Encoding: base64');
    expect(mime).toContain('From: james@bestroofingnow.com');
  });

  it('falls back to the plain single-part message when there is nothing to attach', () => {
    const args = ['a@b.test', 'c@d.test', 'Subject', '<p>hi</p>'] as const;
    expect(buildMimeWithAttachments(...args, [])).toBe(buildMimeMessage(...args));
  });

  it('refuses to let a filename or content type forge extra headers', () => {
    const mime = decode(buildMimeWithAttachments(
      'james@bestroofingnow.com', 'claims@carrier.test', 'S', '<p>x</p>',
      [img({ filename: 'a"\r\nBcc: someone@else.test\r\n.jpg', contentType: 'image/jpeg\r\nBcc: x@y.test' })],
    ));
    expect(mime).not.toMatch(/\r\nBcc:/);
    expect(mime).toContain('filename="a_Bcc: someone@else.test_.jpg"');
  });

  it('wraps base64 bodies so no line runs past the RFC limit', () => {
    const mime = decode(buildMimeWithAttachments(
      'a@b.test', 'c@d.test', 'S', '<p>x</p>', [img({ base64: 'Z'.repeat(500), contentId: 'p1' })],
    ));
    const longest = Math.max(...mime.split('\r\n').filter((l) => /^[A-Za-z0-9+/=]+$/.test(l)).map((l) => l.length));
    expect(longest).toBeLessThanOrEqual(76);
  });

  it('strips a data: prefix and stray whitespace a browser upload leaves behind', () => {
    const mime = decode(buildMimeWithAttachments(
      'a@b.test', 'c@d.test', 'S', '<p>x</p>', [img({ base64: 'data:image/jpeg;base64,AAAA\nBBBB' })],
    ));
    expect(mime).toContain('AAAABBBB');
    expect(mime).not.toContain('data:image/jpeg;base64,');
  });
});

describe('a message carrying a document', () => {
  const pdf = { filename: 'Final invoice.pdf', contentType: 'application/pdf', base64: 'JVBERi0='.repeat(20) };

  it('wraps the body in multipart/mixed and hangs the document off it as a download', () => {
    const mime = decode(buildMimeWithAttachments('a@b.test', 'c@d.test', 'S', '<p>x</p>', [pdf]));
    expect(mime).toMatch(/Content-Type: multipart\/mixed; boundary="brn_mix_/);
    expect(mime).toContain('Content-Type: application/pdf; name="Final invoice.pdf"');
    expect(mime).toContain('Content-Disposition: attachment; filename="Final invoice.pdf"');
    expect(mime).not.toContain('Content-ID:');
    // No photos, so there is nothing for a related part to relate.
    expect(mime).not.toContain('multipart/related');
  });

  it('puts photos and a document in the right envelopes at the same time', () => {
    const mime = decode(buildMimeWithAttachments('a@b.test', 'c@d.test', 'S', '<p><img src="cid:p1"></p>', [img({ contentId: 'p1' }), pdf]));
    const mixed = mime.match(/multipart\/mixed; boundary="([^"]+)"/)![1];
    const related = mime.match(/multipart\/related; type="text\/html"; boundary="([^"]+)"/)![1];
    expect(mixed).not.toBe(related);
    // The inline photo sits inside the related part, which closes before the
    // document is attached to the outer mixed part.
    const relatedEnd = mime.indexOf(`--${related}--`);
    expect(mime.indexOf('Content-ID: <p1>')).toBeLessThan(relatedEnd);
    expect(mime.indexOf('Final invoice.pdf')).toBeGreaterThan(relatedEnd);
    expect(mime.trimEnd().endsWith(`--${mixed}--`)).toBe(true);
  });

  it('still uses a plain related message when everything is inline', () => {
    const mime = decode(buildMimeWithAttachments('a@b.test', 'c@d.test', 'S', '<p><img src="cid:p1"></p>', [img({ contentId: 'p1' })]));
    expect(mime).toContain('multipart/related');
    expect(mime).not.toContain('multipart/mixed');
  });
});


describe('parseGmailMessage keeps where the message sits in the mailbox history', () => {
  it('carries the history id that added it, so the cursor can be held there', () => {
    const msg = { id: 'm1', threadId: 't1', internalDate: '1792000000000', payload: { headers: [{ name: 'From', value: 'a@b.com' }] } };
    expect((parseGmailMessage(msg as any, 'james@bestroofingnow.com', '4242').raw as any).historyId).toBe('4242');
  });
});
