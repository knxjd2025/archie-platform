/**
 * PERMANENT. Never delete, skip or weaken this file.
 *
 * Holds the roof reports library to its four promises:
 *  (a) it stands alone: every import stays inside this folder, is a Node
 *      built-in, a measurement-maths package, or is Archie's one shared
 *      scroll engine;
 *  (b) model ids live in models.ts and nowhere else;
 *  (c) no Best Roofing Now value and no real-looking phone number appears
 *      anywhere in the folder, tests and fixtures included;
 *  (d) only US model providers are named.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { US_MODEL_PROVIDERS, ROOF_REPORT_MODELS } from '../models';

const ROOT = path.resolve(__dirname, '..');
const ENGINE = path.resolve(ROOT, '../reports/scrollcraft-engine');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

const FILES = walk(ROOT);
const isTest = (f: string) => f.includes(`${path.sep}__tests__${path.sep}`);
const SOURCE_FILES = FILES.filter((f) => !isTest(f));
const rel = (f: string) => path.relative(ROOT, f);

function importsOf(text: string): string[] {
  const specs: string[] = [];
  const patterns = [
    /\b(?:import|export)\s+(?:type\s+)?(?:[^'"`;]*?\sfrom\s+)?['"]([^'"]+)['"]/g,
    /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) specs.push(m[1]);
  }
  return specs;
}

describe('roof reports library boundary', () => {
  it('finds the library files it is meant to guard', () => {
    expect(SOURCE_FILES.length).toBeGreaterThan(3);
  });

  it('(a) imports only from inside the folder, Node built-ins, @turf/* and the shared scroll engine', () => {
    const bad: string[] = [];
    for (const file of FILES) {
      const text = readFileSync(file, 'utf8');
      for (const spec of importsOf(text)) {
        if (spec.startsWith('node:')) continue;
        if (spec.startsWith('@turf/')) continue;
        if (isTest(file) && spec === 'vitest') continue;
        if (spec.startsWith('.')) {
          const resolved = path.resolve(path.dirname(file), spec).replace(/\.(js|ts)$/, '');
          if (resolved === ENGINE) continue;
          if (resolved === ROOT || resolved.startsWith(ROOT + path.sep)) continue;
        }
        bad.push(`${rel(file)} imports ${spec}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('(a) the scroll engine is imported only by its exact shared path', () => {
    const bad: string[] = [];
    for (const file of FILES) {
      for (const spec of importsOf(readFileSync(file, 'utf8'))) {
        if (/scrollcraft-engine/.test(spec) && path.resolve(path.dirname(file), spec).replace(/\.(js|ts)$/, '') !== ENGINE) {
          bad.push(`${rel(file)} imports ${spec}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('(b) no file but models.ts holds a model name inside quotes', () => {
    const MODEL_IN_QUOTES = /(['"`])[^'"`\n]*\b(claude|gemini|llama|qwen|gpt|mistral|deepseek)[-\w.]*[^'"`\n]*\1/i;
    const bad: string[] = [];
    for (const file of SOURCE_FILES) {
      if (path.basename(file) === 'models.ts') continue;
      readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        const code = line.replace(/\/\/.*$/, '');
        if (MODEL_IN_QUOTES.test(code)) bad.push(`${rel(file)}:${i + 1}`);
      });
    }
    expect(bad).toEqual([]);
  });

  it('(c) carries no Best Roofing Now value and no real phone number, tests and fixtures included', () => {
    const NAMES = /bestroofingnow|bestroofersnow|best\s+roofing\s+now|\bBailey\b/i;
    const PHONE = /\(?\d{3}\)?[-. ]\d{3}[-. ]\d{4}/g;
    const bad: string[] = [];
    for (const file of FILES) {
      if (path.basename(file) === 'module-boundary.test.ts') continue;
      const text = readFileSync(file, 'utf8');
      if (NAMES.test(text)) bad.push(`${rel(file)}: a company name`);
      for (const hit of text.match(PHONE) ?? []) {
        if (!/^\(?319\)?[-. ]555[-. ]01\d\d$/.test(hit)) bad.push(`${rel(file)}: phone ${hit}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('(d) names only US model providers', () => {
    expect([...US_MODEL_PROVIDERS].sort()).toEqual(['anthropic', 'google', 'groq']);
    for (const [role, m] of Object.entries(ROOF_REPORT_MODELS)) {
      expect(US_MODEL_PROVIDERS, role).toContain(m.provider);
    }
  });
});
