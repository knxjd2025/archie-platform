import { describe, it, expect, vi, afterEach } from 'vitest';

const tenant = vi.hoisted(() => ({ companyId: null as string | null }));
vi.mock('../../tenant/context', () => ({ currentCompanyId: () => tenant.companyId }));

import { buildMimeMessage, buildMimeWithAttachments, canDelegateMailbox, getDelegatedGmail, GoogleWorkspaceUnavailableError } from '../google-workspace';

const runInCompany = (id: string, fn: () => void) => { tenant.companyId = id; try { fn(); } finally { tenant.companyId = null; } };

const decode = (raw: string) => Buffer.from(raw, 'base64url').toString('utf8');
const img = (over: Partial<{ filename: string; contentType: string; base64: string; contentId: string }> = {}) => ({
  filename: 'roof.jpg', contentType: 'image/jpeg', base64: 'AAAA'.repeat(40), ...over,
});

describe('a message with photos', () => {
  it('carries each photo inline, referenced by content id', () => {
    const mime = decode(buildMimeWithAttachments(
      'james@acme-roofing.test', 'claims@carrier.test', 'Depreciation release',
      '<p>See <img src="cid:p1"></p>', [img({ contentId: 'p1' })],
    ));
    expect(mime).toContain('Content-Type: multipart/related; type="text/html"');
    expect(mime).toContain('Content-ID: <p1>');
    expect(mime).toContain('Content-Disposition: inline; filename="roof.jpg"');
    expect(mime).toContain('Content-Transfer-Encoding: base64');
    expect(mime).toContain('From: james@acme-roofing.test');
  });

  it('falls back to the plain single-part message when there is nothing to attach', () => {
    const args = ['a@b.test', 'c@d.test', 'Subject', '<p>hi</p>'] as const;
    expect(buildMimeWithAttachments(...args, [])).toBe(buildMimeMessage(...args));
  });

  it('refuses to let a filename or content type forge extra headers', () => {
    const mime = decode(buildMimeWithAttachments(
      'james@acme-roofing.test', 'claims@carrier.test', 'S', '<p>x</p>',
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


describe('Google delegation is per company and off by default', () => {
  const A = '11111111-1111-4111-8111-111111111111';
  const B = '22222222-2222-4222-8222-222222222222';
  const env = { ...process.env };
  afterEach(() => { process.env = { ...env }; });

  it('refuses every mailbox when the operator has not delegated a domain', () => {
    process.env.GOOGLE_SA_KEY = 'x'; process.env.GOOGLE_SA_EMAIL = 'sa@x.test'; delete process.env.ARCHIE_GOOGLE_DWD;
    runInCompany(A, () => expect(canDelegateMailbox('a@acme.test')).toBe(false));
  });

  it('allows only the delegated company, and only mailboxes on its domain', () => {
    process.env.GOOGLE_SA_KEY = 'x'; process.env.GOOGLE_SA_EMAIL = 'sa@x.test'; process.env.ARCHIE_GOOGLE_DWD = `${A}=acme.test`;
    runInCompany(A, () => {
      expect(canDelegateMailbox('dana@acme.test')).toBe(true);
      expect(canDelegateMailbox('dana@other.test')).toBe(false);
      expect(() => getDelegatedGmail('dana@other.test')).toThrow(GoogleWorkspaceUnavailableError);
    });
    runInCompany(B, () => expect(canDelegateMailbox('dana@acme.test')).toBe(false));
  });
});
