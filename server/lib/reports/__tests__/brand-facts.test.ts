import { describe, it, expect } from 'vitest';
import { BRAND_FACTS, CREDENTIAL_MARKERS, TRUST_STATS } from '../brand-facts';
import { CRED_MARKERS } from '../certainteed-data';
import { BRN_BRAND } from '../brn-brand';

describe('brand facts', () => {
  it('sources every claim with a parseable verification date', () => {
    expect(BRAND_FACTS.length).toBeGreaterThan(0);
    for (const f of BRAND_FACTS) {
      expect(f.text.trim()).not.toBe('');
      expect(f.source.trim()).not.toBe('');
      expect(f.verifiedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isNaN(Date.parse(f.verifiedOn))).toBe(false);
    }
  });

  it('never claims a general contractor license', () => {
    // BRN is not a GC (brn-brand.ts:4-7). This must hold for every string
    // that can reach a customer document.
    for (const f of BRAND_FACTS) {
      expect(f.text).not.toMatch(/general contractor|GC licen/i);
    }
  });

  it('states the real CertainTeed credential, not the entry tier', () => {
    const joined = CREDENTIAL_MARKERS.join(' | ');
    expect(joined).toContain('ShingleMaster');
    expect(joined).not.toContain('CertainTeed Certified');
  });

  it('drops the rating/grade mashup that was on customer documents', () => {
    // '5★ BBB A+' mashed a Google star rating into a BBB letter grade.
    expect(CREDENTIAL_MARKERS.join(' | ')).not.toContain('5★ BBB A+');
  });

  it('carries the stats James approved on 2026-09-11', () => {
    const all = TRUST_STATS.map((f) => f.text).join(' | ');
    expect(all).toContain('500+');        // roofs installed
    expect(all).toContain('65+');         // Google reviews
    expect(all).toContain('$100,000');    // donated to local charities
    expect(all).toMatch(/Angi/);          // Super Service Award 2021-2023
  });
});

describe('the two old credential lists', () => {
  // This is the whole point of the file: CRED_MARKERS and
  // BRN_BRAND.credibilityMarkers were two different literal lists, both
  // customer-facing, both wrong. This test fails if anyone re-adds a literal.
  it('both resolve to the shared set', () => {
    expect([...CRED_MARKERS]).toEqual([...CREDENTIAL_MARKERS]);
    expect([...BRN_BRAND.credibilityMarkers]).toEqual([...CREDENTIAL_MARKERS]);
  });
});
