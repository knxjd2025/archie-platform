/**
 * Unit tests for the pure HTML escaper (lib/escape-html.ts).
 *
 * escapeHtml() defends user-controlled string interpolations in the shared
 * roof-analysis report HTML against XSS. These reports are exported to R2 /
 * shared links, so an injected "<script>" must never execute.
 */
import { describe, it, expect } from 'vitest';
import { escapeHtml } from '../escape-html';

describe('escapeHtml', () => {
  it('fully entity-encodes a <script> XSS payload', () => {
    const out = escapeHtml('<script>alert(1)</script>');
    expect(out).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
    // No raw angle brackets survive.
    expect(out).not.toContain('<');
    expect(out).not.toContain('>');
  });

  it('encodes & first so existing entities are not double-encoded', () => {
    // A lone ampersand becomes &amp; — exactly once, never &amp;amp;.
    expect(escapeHtml('Tom & Jerry')).toBe('Tom &amp; Jerry');
    // An ampersand that precedes other special chars is still single-encoded.
    expect(escapeHtml('&<')).toBe('&amp;&lt;');
    expect(escapeHtml('&amp;')).toBe('&amp;amp;');
  });

  it('encodes double quotes and apostrophes', () => {
    expect(escapeHtml('"')).toBe('&quot;');
    expect(escapeHtml("'")).toBe('&#x27;');
    expect(escapeHtml(`say "hi" it's me`)).toBe('say &quot;hi&quot; it&#x27;s me');
  });

  it('encodes all five special characters together', () => {
    expect(escapeHtml(`& < > " '`)).toBe('&amp; &lt; &gt; &quot; &#x27;');
  });

  it('returns "" for null and undefined', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });

  it('coerces non-string values to string', () => {
    expect(escapeHtml(42)).toBe('42');
    expect(escapeHtml(0)).toBe('0');
    expect(escapeHtml(true)).toBe('true');
  });

  it('leaves ordinary text unchanged', () => {
    expect(escapeHtml('123 Main Street, Charlotte NC')).toBe('123 Main Street, Charlotte NC');
    expect(escapeHtml('Acme Roofing Co')).toBe('Acme Roofing Co');
    expect(escapeHtml('')).toBe('');
  });
});
