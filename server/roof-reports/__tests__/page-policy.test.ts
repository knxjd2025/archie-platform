/**
 * The policy a report page is served under (server/roof-reports/page-policy.ts):
 * a fresh nonce for the scripts it wrote itself, a sandbox without the app's
 * own origin, no connection or form target, and images only from where a
 * report's pictures come from.
 */
import { describe, expect, it } from 'vitest';
import { newNonce, pagePolicy } from '../page-policy';

const directive = (policy: string, name: string): string | undefined =>
  policy.split(';').map((d) => d.trim()).find((d) => d === name || d.startsWith(`${name} `));

describe('newNonce', () => {
  it('is 18 random bytes as base64, and never the same twice', () => {
    const seen = new Set(Array.from({ length: 500 }, () => newNonce()));
    expect(seen.size).toBe(500);
    for (const n of seen) expect(n).toMatch(/^[A-Za-z0-9+/]{24}$/);
  });
});

describe('the policy of a page the app built', () => {
  const nonce = 'AAAAAAAAAAAAAAAAAAAAAAAA';
  const policy = pagePolicy({ kind: 'built', nonce, appOrigin: 'https://app.example.test', logoUrl: '' });

  it('runs only scripts that carry this response\'s nonce', () => {
    expect(directive(policy, 'script-src')).toBe(`script-src 'nonce-${nonce}'`);
    expect(policy).not.toMatch(/script-src[^;]*unsafe-inline/);
    expect(policy).not.toMatch(/script-src[^;]*https?:/);
  });

  it('keeps the sandbox without the app\'s own origin, and no connection or form target', () => {
    expect(directive(policy, 'sandbox')).toBe('sandbox allow-scripts');
    expect(policy).not.toMatch(/allow-same-origin|allow-forms|allow-popups|allow-top-navigation/);
    expect(directive(policy, 'connect-src')).toBe("connect-src 'none'");
    expect(directive(policy, 'form-action')).toBe("form-action 'none'");
    expect(directive(policy, 'default-src')).toBe("default-src 'none'");
    expect(directive(policy, 'base-uri')).toBe("base-uri 'none'");
  });

  it('lets images come from the app (photo links), data and blob, and from no other host', () => {
    expect(directive(policy, 'img-src')).toBe('img-src https://app.example.test data: blob:');
  });

  it('adds the one origin the company\'s logo is on, when it is https and elsewhere', () => {
    const own = pagePolicy({ kind: 'built', nonce, appOrigin: 'https://app.example.test', logoUrl: 'https://app.example.test/logo/abc.png' });
    expect(directive(own, 'img-src')).toBe('img-src https://app.example.test data: blob:');
    const elsewhere = pagePolicy({ kind: 'built', nonce, appOrigin: 'https://app.example.test', logoUrl: 'https://cdn.summitridge.example/logo.png?x=1' });
    expect(directive(elsewhere, 'img-src')).toBe('img-src https://app.example.test https://cdn.summitridge.example data: blob:');
  });

  it('ignores a logo address that is not a plain https origin', () => {
    for (const bad of ['http://cdn.example/logo.png', 'javascript:alert(1)', 'data:image/png;base64,AAAA', 'https://a.example; script-src *', 'https://evil.example/ x', 'not a url', '']) {
      const p = pagePolicy({ kind: 'built', nonce, appOrigin: 'https://app.example.test', logoUrl: bad });
      expect(directive(p, 'img-src'), bad).toBe('img-src https://app.example.test data: blob:');
      expect(p, bad).not.toMatch(/evil|script-src \*/);
    }
  });

  it('refuses a nonce that is not a plain token and an origin that is not one', () => {
    expect(() => pagePolicy({ kind: 'built', nonce: "x'; script-src *", appOrigin: 'https://a.example', logoUrl: '' })).toThrow();
    expect(() => pagePolicy({ kind: 'built', nonce, appOrigin: 'https://a.example; img-src *', logoUrl: '' })).toThrow();
  });
});

describe('the policy of a page a person saved', () => {
  const policy = pagePolicy({ kind: 'saved', appOrigin: 'https://app.example.test', logoUrl: '' });
  it('runs no script at all: a bare sandbox and no script-src', () => {
    expect(directive(policy, 'sandbox')).toBe('sandbox');
    expect(policy).not.toMatch(/allow-scripts|script-src|nonce/);
    expect(directive(policy, 'default-src')).toBe("default-src 'none'");
  });
  it('shows images from the same few places', () => {
    expect(directive(policy, 'img-src')).toBe('img-src https://app.example.test data: blob:');
  });
});

describe('the policy of a page a person saved', () => {
  const policy = pagePolicy({ kind: 'saved', appOrigin: 'https://app.example.test', logoUrl: '' });
  it('takes styles and fonts only from the page itself and from Google Fonts, never from any https address', () => {
    expect(directive(policy, 'style-src')).toBe("style-src 'unsafe-inline' https://fonts.googleapis.com");
    expect(directive(policy, 'font-src')).toBe('font-src https://fonts.gstatic.com data:');
    expect(policy).not.toMatch(/\bhttps:(?!\/\/)/);
  });
  it('still runs no script', () => {
    expect(policy).not.toMatch(/script-src|allow-scripts/);
  });
});
