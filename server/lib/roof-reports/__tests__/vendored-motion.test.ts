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
 *
 * The files are checked against the npm package, not against a hash computed from
 * themselves: gsap is a pinned devDependency (an exact version, with the
 * registry's own sha512 in package-lock.json), `npm ci` verifies the package
 * against that sha512, and each vendored file must equal the file inside the
 * installed package, byte for byte. The manifest records the package's name,
 * version and that same integrity string, and must agree with package-lock.json.
 */
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { GSAP_VERSION, GSAP_INTEGRITY, ST_INTEGRITY, MOTION_PATH } from '../report-motion';

const DIR = path.resolve(__dirname, '../../../../client/public/roof-reports/motion');
const ROOT = path.resolve(__dirname, '../../../..');
const manifest = JSON.parse(readFileSync(path.join(DIR, 'manifest.json'), 'utf8')) as {
  library: string; version: string; source: string; license: string; bannerKept: boolean; edited: boolean;
  package: { name: string; version: string; integrity: string; tarball: string };
  files: Array<{ name: string; bytes: number; sha256: string; sha384: string; packagePath: string }>;
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

  it('records the npm package it came from: its name, version and the package\'s own integrity string', () => {
    expect(manifest.package.name).toBe('gsap');
    expect(manifest.package.version).toBe(GSAP_VERSION);
    expect(manifest.package.integrity).toMatch(/^sha512-[A-Za-z0-9+/]{86}==$/);
    expect(manifest.package.tarball).toBe(`https://registry.npmjs.org/gsap/-/gsap-${GSAP_VERSION}.tgz`);
  });

  it('agrees with package-lock.json: the same package, the same version, the same integrity, and the version is pinned exactly', () => {
    const lock = JSON.parse(readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8')) as { packages: Record<string, { version?: string; integrity?: string; resolved?: string }> };
    const entry = lock.packages['node_modules/gsap'];
    expect(entry, 'gsap is not in package-lock.json').toBeTruthy();
    expect(entry.version).toBe(manifest.package.version);
    expect(entry.integrity).toBe(manifest.package.integrity);
    expect(entry.resolved).toBe(manifest.package.tarball);
    const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as { devDependencies?: Record<string, string>; dependencies?: Record<string, string> };
    expect(pkg.devDependencies?.gsap).toBe(GSAP_VERSION);
    // A dev-only dependency: the app's own code never loads it, only this check.
    expect(pkg.dependencies?.gsap).toBeUndefined();
  });

  for (const f of ['gsap', 'ScrollTrigger'] as const) {
    it(`${f}: the vendored file is byte for byte the file in the installed package at that version, not a copy checked against itself`, () => {
      const installed = path.join(ROOT, 'node_modules', 'gsap');
      expect(existsSync(path.join(installed, 'package.json')), 'run npm ci: the gsap package is not installed').toBe(true);
      const meta = JSON.parse(readFileSync(path.join(installed, 'package.json'), 'utf8')) as { name: string; version: string };
      expect(meta).toMatchObject({ name: manifest.package.name, version: manifest.package.version });
      const entry = manifest.files.find((x) => x.name === `${f}-${GSAP_VERSION}.min.js`)!;
      expect(entry.packagePath).toBe(f === 'gsap' ? 'dist/gsap.min.js' : 'dist/ScrollTrigger.min.js');
      const fromPackage = readFileSync(path.join(installed, entry.packagePath));
      const vendored = readFileSync(path.join(DIR, entry.name));
      expect(vendored.equals(fromPackage)).toBe(true);
      // And the hashes the manifest and the page carry are those of the package's own file.
      expect(`sha384-${sha('sha384', fromPackage)}`).toBe(entry.sha384);
      expect(sha('sha256', fromPackage)).toBe(entry.sha256);
    });
  }

  it('is served from the app\'s own path, which the page code knows', () => {
    expect(MOTION_PATH).toBe('/roof-reports/motion');
  });
});
