/**
 * The PDF library must load only when "Download PDF" is pressed, so the page
 * everyone opens never carries it. This reads the source: nothing outside the
 * pdf folder may import it, or the folder, in the ordinary (static) way. The one
 * way in is the loader's dynamic import. The built chunk sizes are checked by
 * hand and recorded in the docs.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const root = join(process.cwd(), 'client', 'src');
const files = (dir: string): string[] => readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? (n === '__tests__' ? [] : files(p)) : /\.(ts|tsx)$/.test(n) ? [p] : []; });
const all = files(root);
const inPdf = (f: string) => relative(root, f).startsWith(join('roof-reports', 'pdf') + sep);
const STATIC_IMPORT = /^\s*(import|export)\s[^;]*?from\s+['"]([^'"]+)['"]/gm;
const BARE_IMPORT = /^\s*import\s+['"]([^'"]+)['"]/gm;

describe('the PDF library loads only on demand', () => {
  it('is imported statically by nothing outside the pdf folder', () => {
    const offenders: string[] = [];
    for (const f of all.filter((x) => !inPdf(x))) {
      const text = readFileSync(f, 'utf8');
      for (const m of text.matchAll(STATIC_IMPORT)) if (/@react-pdf|\/pdf\/|\/pdf$/.test(m[2])) offenders.push(`${relative(root, f)}: ${m[2]}`);
      for (const m of text.matchAll(BARE_IMPORT)) if (/@react-pdf|\/pdf\//.test(m[1])) offenders.push(`${relative(root, f)}: ${m[1]}`);
    }
    expect(offenders).toEqual([]);
  });

  it('has exactly one way in, a dynamic import in the loader', () => {
    const ways = all.filter((f) => !inPdf(f)).flatMap((f) => [...readFileSync(f, 'utf8').matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)].filter((m) => /\/pdf\//.test(m[1]) || /@react-pdf/.test(m[1])).map((m) => `${relative(root, f)}: ${m[1]}`));
    expect(ways).toEqual(['roof-reports/pdf-loader.ts: ./pdf/build']);
  });

  it('keeps the library out of the files that ARE in the pdf folder from reaching shared code', () => {
    // The pdf folder may import the library; nothing in it is imported by the rest of the app except through the loader.
    const importers = all.filter((f) => !inPdf(f) && /from\s+['"][^'"]*\/pdf\/[^'"]*['"]/.test(readFileSync(f, 'utf8')));
    expect(importers.map((f) => relative(root, f))).toEqual([]);
  });

  it('pins the library to one exact version', () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'));
    expect(pkg.dependencies['@react-pdf/renderer']).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
