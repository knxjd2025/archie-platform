/**
 * The report page's motion library is served by Archie itself.
 *
 * A served report page runs only scripts that carry its response's nonce, so
 * the classic document's motion could no longer load from an outside CDN. The
 * exact version the old program used is vendored into the app's own static
 * files and loaded from the app's own address. This test holds that the vendored
 * bytes are the bytes that were recorded (never edited), that the manifest says
 * which version and licence they are, and that the page's code names the same
 * version and hashes.
 */
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { GSAP_VERSION, GSAP_INTEGRITY, ST_INTEGRITY, MOTION_PATH } from '../report-motion';

const DIR = path.resolve(__dirname, '../../../../client/public/roof-reports/motion');
const manifest = JSON.parse(readFileSync(path.join(DIR, 'manifest.json'), 'utf8')) as {
  library: string; version: string; source: string; license: string; bannerKept: boolean; edited: boolean;
  files: Array<{ name: string; bytes: number; sha256: string; sha384: string }>;
};
const sha = (alg: string, b: Buffer) => createHash(alg).update(b).digest(alg === 'sha384' ? 'base64' : 'hex');

describe('the vendored motion library', () => {
  it('records its version, where it came from and its licence, and says it was not edited', () => {
    expect(manifest.library).toBe('gsap');
    expect(manifest.version).toBe(GSAP_VERSION);
    expect(manifest.source).toMatch(/npm package gsap@3\.14\.2/);
    expect(manifest.license).toMatch(/standard "no charge" license/i);
    expect(manifest.bannerKept).toBe(true);
    expect(manifest.edited).toBe(false);
    expect(manifest.files.map((f) => f.name).sort()).toEqual([`ScrollTrigger-${GSAP_VERSION}.min.js`, `gsap-${GSAP_VERSION}.min.js`]);
  });

  for (const f of ['gsap', 'ScrollTrigger'] as const) {
    it(`${f}: the bytes on disk are the bytes that were recorded`, () => {
      const name = `${f}-${GSAP_VERSION}.min.js`;
      const entry = manifest.files.find((x) => x.name === name)!;
      expect(existsSync(path.join(DIR, name))).toBe(true);
      const bytes = readFileSync(path.join(DIR, name));
      expect(bytes.length).toBe(entry.bytes);
      expect(sha('sha256', bytes)).toBe(entry.sha256);
      expect(`sha384-${sha('sha384', bytes)}`).toBe(entry.sha384);
      // The same hashes the page's own code carries for this version.
      expect(entry.sha384).toBe(f === 'gsap' ? GSAP_INTEGRITY : ST_INTEGRITY);
      // The vendor's own banner is still there, with the version.
      expect(bytes.toString('utf8')).toContain(f === 'gsap' ? `GSAP ${GSAP_VERSION}` : `ScrollTrigger ${GSAP_VERSION}`);
      expect(bytes.toString('utf8')).toContain('gsap.com/standard-license');
    });
  }

  it('is served from the app\'s own path, which the page code knows', () => {
    expect(MOTION_PATH).toBe('/roof-reports/motion');
  });
});
