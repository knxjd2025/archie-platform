/**
 * PERMANENT. Never delete, skip or weaken this file.
 *
 * The scroll engine is vendored and never edited: pages are themed with CSS
 * custom properties and driven with data-sc-* attributes. These are the
 * SHA-256 fingerprints of its script and its stylesheet (carriage returns
 * removed, so a line-ending change alone does not matter), recorded on
 * 2026-11-24 from the copy at server/lib/reports/scrollcraft-engine.ts, which
 * is byte-for-byte the copy the old roof reports program shipped once its CRLF
 * line endings are removed. A change to the engine fails this test on purpose:
 * re-vendor it from upstream and record the new fingerprints in the same
 * change, never edit it by hand.
 */
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { SCROLLCRAFT_CSS, SCROLLCRAFT_JS } from '../../reports/scrollcraft-engine.js';

const sha = (text: string) => createHash('sha256').update(text.replace(/\r/g, '')).digest('hex');

/** SHA-256 of SCROLLCRAFT_JS with \r removed. */
const ENGINE_JS_SHA256 = '9246fbe4e240a63cdaf33111edd724ee66118da87dc44af86039b0d1619164a1';
/** SHA-256 of SCROLLCRAFT_CSS with \r removed. */
const ENGINE_CSS_SHA256 = 'e19eb3aa73b0944626ca56e6e427c76f44753481e04d60f4bac20e8cf1d7758a';

describe('the vendored scroll engine', () => {
  it('script is unchanged', () => {
    expect(sha(SCROLLCRAFT_JS)).toBe(ENGINE_JS_SHA256);
  });
  it('stylesheet is unchanged', () => {
    expect(sha(SCROLLCRAFT_CSS)).toBe(ENGINE_CSS_SHA256);
  });
  it('both presentation renderers use that one copy, not a second', async () => {
    const { readFileSync } = await import('node:fs');
    const path = await import('node:path');
    for (const f of ['scroll-presentation-report.ts', 'scroll-flight-report.ts']) {
      const text = readFileSync(path.resolve(__dirname, '..', f), 'utf8');
      expect(text, f).toContain("from '../reports/scrollcraft-engine.js'");
    }
  });
});
