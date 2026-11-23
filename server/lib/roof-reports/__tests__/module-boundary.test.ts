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
 *  (d) only US model providers are named;
 *  (e) every model call goes through the seam (model-call.ts): no model
 *      provider's host is written anywhere else, and the only other hosts the
 *      folder names are the storm sources, geocoders and fonts listed below.
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

/**
 * Remove comments from TypeScript source and keep every string literal whole.
 * A `//` inside a quote is part of an address (`'https://api.example.com'`), not
 * a comment, so cutting a line at the first `//` would hide whatever follows it.
 */
export function stripComments(text: string): string {
  let out = '';
  let quote: string | null = null;
  for (let i = 0; i < text.length; ) {
    const c = text[i];
    if (quote === null) {
      if (text.startsWith('//', i)) {
        const end = text.indexOf('\n', i);
        i = end === -1 ? text.length : end;
        continue;
      }
      if (text.startsWith('/*', i)) {
        const end = text.indexOf('*/', i + 2);
        i = end === -1 ? text.length : end + 2;
        continue;
      }
      if (c === "'" || c === '"' || c === '`') quote = c;
      out += c;
      i += 1;
    } else {
      if (c === '\\') {
        out += text.slice(i, i + 2);
        i += 2;
        continue;
      }
      if (c === quote) quote = null;
      out += c;
      i += 1;
    }
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

  it('(a) imports only from inside the folder, Node built-ins, @turf/*, ipaddr.js and the shared scroll engine', () => {
    const bad: string[] = [];
    for (const file of FILES) {
      const text = readFileSync(file, 'utf8');
      for (const spec of importsOf(text)) {
        if (spec.startsWith('node:')) continue;
        if (spec.startsWith('@turf/')) continue;
        if (spec === 'ipaddr.js') continue;
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
      stripComments(readFileSync(file, 'utf8')).split('\n').forEach((line, i) => {
        // Interpolated names such as ${geminiResult.model_used} are code, not text.
        const code = line.replace(/\$\{[^}]*\}/g, '');
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

  it('(b) the comment stripper cuts comments and keeps a // inside a string', () => {
    expect(stripComments("const a = 'https://x.example/y'; // gone")).toBe("const a = 'https://x.example/y'; ");
    expect(stripComments('const a = "b"; /* gone */ const c = `//kept`;')).toBe('const a = "b";  const c = `//kept`;');
    expect(stripComments("const a = 'it\\'s // still a string'; // gone")).toBe("const a = 'it\\'s // still a string'; ");
    // a line such as this used to hide the model name behind its own address
    expect(/claude/.test(stripComments("const u = 'https://h.example/claude-haiku-4-5';"))).toBe(true);
  });

  it('(e) no model provider host is written outside the seam, and no other host is new', () => {
    const MODEL_HOSTS = /(?:^|\.)(api\.groq\.com|groq\.com|api\.anthropic\.com|anthropic\.com|generativelanguage\.googleapis\.com|aiplatform\.googleapis\.com|api\.openai\.com|openai\.com|api\.deepseek\.com|dashscope\.aliyuncs\.com|api\.siliconflow\.cn|api\.mistral\.ai|api\.cohere\.(?:ai|com)|api\.x\.ai)$/i;
    // The seam, then the only other places a host may be written, and which.
    const ALLOWED: Record<string, string[]> = {
      'model-call.ts': ['api.groq.com', 'generativelanguage.googleapis.com', 'api.anthropic.com'],
      'swdi-api-service.ts': ['www.ncei.noaa.gov', 'www.ncdc.noaa.gov'], // storm source
      'iem-api-service.ts': ['mesonet.agron.iastate.edu'], // storm source
      'storm-history-service.ts': ['maps.googleapis.com', 'nominatim.openstreetmap.org', 'mesonet.agron.iastate.edu', 'www.ncdc.noaa.gov'], // geocoders and storm links
      'fonts.ts': ['fonts.googleapis.com'],
      'measurement-report-html.ts': ['fonts.googleapis.com'],
      'scroll-flight-report.ts': ['fonts.googleapis.com', 'fonts.gstatic.com', 'www.w3.org'],
      'scroll-presentation-report.ts': ['fonts.googleapis.com', 'fonts.gstatic.com', 'www.w3.org'],
      'report-motion.ts': ['cdn.jsdelivr.net'],
    };
    const bad: string[] = [];
    for (const file of SOURCE_FILES) {
      const name = path.basename(file);
      const code = stripComments(readFileSync(file, 'utf8'));
      for (const m of code.matchAll(/https?:\/\/([A-Za-z0-9.-]+)/g)) {
        const host = m[1].toLowerCase();
        if (name !== 'model-call.ts' && MODEL_HOSTS.test(host)) bad.push(`${rel(file)}: model provider host ${host} outside the seam`);
        if (!(ALLOWED[name] ?? []).includes(host)) bad.push(`${rel(file)}: host ${host} is not on the list`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('(e) only the seam, the storm sources, the geocoders and the guarded downloaders call fetch', () => {
    const MAY_FETCH = new Set(['model-call.ts', 'fetch-with-retry.ts', 'safe-fetch.ts', 'storm-history-service.ts']);
    const bad: string[] = [];
    for (const file of SOURCE_FILES) {
      const name = path.basename(file);
      if (MAY_FETCH.has(name)) continue;
      const code = stripComments(readFileSync(file, 'utf8'));
      if (/(?<![\w.])fetch\s*\(|globalThis\.fetch|window\.fetch/.test(code)) bad.push(`${rel(file)} calls fetch directly`);
    }
    expect(bad).toEqual([]);
  });

  it('(c) names no real town as an example or a default: fixtures use the fictional Cedar Falls', () => {
    const bad: string[] = [];
    for (const file of FILES) {
      if (path.basename(file) === 'module-boundary.test.ts') continue;
      if (/\bCharlotte\b/.test(readFileSync(file, 'utf8'))) bad.push(rel(file));
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
