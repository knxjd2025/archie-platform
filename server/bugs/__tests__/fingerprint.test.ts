import { describe, it, expect } from 'vitest';
import { fingerprintFor, messageShape, redactSecrets, topFrame } from '../fingerprint';
import { buildDigest, escapeHtml, subjectLine, type DigestRow } from '../notify';

describe('messageShape', () => {
  it('flattens what changes between two occurrences of one bug', () => {
    const a = messageShape('[rep-reminders] banning@bestroofingnow.com: Failed query … params: 2026-10-16T04:00:00.000Z, 812');
    const b = messageShape('[rep-reminders] thomas@bestroofingnow.com: Failed query … params: 2026-10-13T04:00:00.000Z, 97');
    expect(a).toBe(b);
  });

  it('keeps the part that says what broke', () => {
    expect(messageShape('relation "jobtread_archive_steps" does not exist')).toContain('jobtread_archive_steps');
  });

  it('only looks at the first line', () => {
    expect(messageShape('boom\n    at somewhere')).toBe('boom');
  });
});

describe('topFrame', () => {
  it('reads a Chrome frame without its line numbers', () => {
    expect(topFrame('TypeError: x\n    at renderLead (https://app/assets/index-abc.js:10:20)\n    at y (z.js:1:1)')).toBe('renderLead');
  });
  it('reads a Safari frame', () => {
    expect(topFrame('TypeError: x\nrenderLead@https://app/assets/index.js:10:20')).toBe('renderLead');
  });
  it('is empty without a stack', () => {
    expect(topFrame(null)).toBe('');
  });
});

describe('fingerprintFor', () => {
  it('groups the same failure on different ids of one route', () => {
    expect(fingerprintFor('server_error', 'PATCH /api/leads/812', 'Lead 812 not found'))
      .toBe(fingerprintFor('server_error', 'PATCH /api/leads/97', 'Lead 97 not found'));
  });
  it('keeps different failures apart', () => {
    expect(fingerprintFor('server_error', 'GET /api/a', 'boom')).not.toBe(fingerprintFor('server_error', 'GET /api/b', 'boom'));
    expect(fingerprintFor('server_error', 'GET /api/a', 'boom')).not.toBe(fingerprintFor('client_error', 'GET /api/a', 'boom'));
  });
  it('is unchanged by a redeploy that only moves line numbers', () => {
    const before = 'TypeError: x\n    at renderLead (https://app/assets/index-abc.js:10:20)';
    const after = 'TypeError: x\n    at renderLead (https://app/assets/index-def.js:88:4)';
    expect(fingerprintFor('client_error', 'render', 'x', before)).toBe(fingerprintFor('client_error', 'render', 'x', after));
  });
});

describe('buildDigest', () => {
  const row = (over: Partial<DigestRow>): DigestRow => ({
    id: 1, kind: 'server_error', status: 'new', message: 'boom', page: null, user_email: null, occurrences: 1, ...over,
  });

  it('sends nothing when nothing is open', () => {
    expect(buildDigest([])).toBeNull();
  });

  it('counts reports and caught errors separately, busiest error first', () => {
    const d = buildDigest([
      row({ id: 1, kind: 'report', message: 'Save spun forever', user_email: 'rep@x.com' }),
      row({ id: 2, message: 'rare', occurrences: 2 }),
      row({ id: 3, message: 'frequent', occurrences: 500 }),
    ])!;
    expect(d.subject).toContain('1 reported, 2 caught');
    expect(d.html.indexOf('frequent')).toBeLessThan(d.html.indexOf('rare'));
  });

  it('escapes what users typed', () => {
    const d = buildDigest([row({ kind: 'report', message: '<img src=x onerror=alert(1)>' })])!;
    expect(d.html).not.toContain('<img');
    expect(escapeHtml('"<&>')).toBe('&quot;&lt;&amp;&gt;');
  });
});

describe('redactSecrets', () => {
  it('hides credentials in a connection string', () => {
    const out = redactSecrets('connect failed: postgres://app:s3cretPass@db.supabase.co:6543/postgres');
    expect(out).not.toContain('s3cretPass');
    expect(out).toContain('db.supabase.co');
  });
  it('hides bearer tokens and key=value secrets', () => {
    expect(redactSecrets('Authorization: Bearer abcdef1234567890')).not.toContain('abcdef1234567890');
    expect(redactSecrets('upstream said api_key=sk_live_abcdef123')).not.toContain('sk_live_abcdef123');
  });
  it('leaves an ordinary message alone', () => {
    expect(redactSecrets('relation "jobtread_archive" does not exist')).toBe('relation "jobtread_archive" does not exist');
  });
});

describe('subjectLine', () => {
  it('cannot start a new email header', () => {
    expect(subjectLine('Bug\r\nBcc: someone@evil.com')).not.toMatch(/[\r\n]/);
  });
});
