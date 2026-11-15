/**
 * Tripwire: the CRM and the messaging service behind Archie are shown to
 * customers as "Current CRM" and "KynexPro" (see shared/product-names.ts).
 * This scans client source for the real product names showing up in text
 * people can read. It is a simple scan of string literals and JSX text, not a
 * parser; imports, comments, console lines and lowercase identifiers, paths
 * and URLs are ignored.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

const CLIENT = join(__dirname, '../../client/src');
const GHL_FAMILY = /\bGHL\b|GoHighLevel|Go High Level|\bHighLevel\b|LeadConnector/i;
const JOBTREAD = /JobTread/i;
// The Integrations page names the provider on purpose, so people know whose key to paste.
const JOBTREAD_ALLOWED = /^pages\/integrations\//;
// Add "path:line" here only for a name that people cannot see.
const ALLOWLIST: string[] = [];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return files(p);
    return p.endsWith('.tsx') ? [p] : [];
  });
}

/** Source with comments blanked out (line numbers kept). */
function withoutComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** True when the match sits in something other than readable text. */
function ignorable(line: string, match: RegExpMatchArray): boolean {
  const t = line.trim();
  if (/^(import|export)\b.*\bfrom\b/.test(t) || /\bconsole\.\w+\(/.test(line)) return true;
  const word = match[0];
  // Lowercase use (ghl, jobtread) is an identifier, route, URL or key, not a label.
  if (word === word.toLowerCase()) return true;
  // Identifier-shaped (JobTreadBrowser, JobTread_x), but "JobTread's" is text.
  const idx = match.index ?? 0;
  const before = line[idx - 1] ?? '';
  const rest = line.slice(idx + word.length);
  return /[\w-]/.test(before) || (/^[\w-]/.test(rest) && !/^['\u2019]s/.test(rest));
}

function hits(pattern: RegExp, skipFile: (rel: string) => boolean): string[] {
  const out: string[] = [];
  for (const file of files(CLIENT)) {
    const rel = relative(CLIENT, file);
    if (skipFile(rel)) continue;
    withoutComments(readFileSync(file, 'utf8')).split('\n').forEach((line, i) => {
      for (const m of line.matchAll(new RegExp(pattern.source, 'gi'))) {
        if (ignorable(line, m)) continue;
        const where = `${rel}:${i + 1}`;
        if (ALLOWLIST.includes(where)) continue;
        out.push(`${where}  ${line.trim().slice(0, 120)}`);
        break;
      }
    });
  }
  return out;
}

describe('product names in client text', () => {
  it('never shows GHL, GoHighLevel, HighLevel or LeadConnector (say KynexPro)', () => {
    expect(hits(GHL_FAMILY, () => false)).toEqual([]);
  });

  it('never shows JobTread outside the Integrations page (say Current CRM or your CRM)', () => {
    expect(hits(JOBTREAD, (rel) => JOBTREAD_ALLOWED.test(rel))).toEqual([]);
  });
});
