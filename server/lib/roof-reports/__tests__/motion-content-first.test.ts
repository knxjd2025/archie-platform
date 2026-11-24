/**
 * Motion is an enhancement, never a requirement: a report page whose scripts do
 * not run (blocked, offline, a policy that refuses them, print, reduced motion)
 * hides nothing. Every hidden starting state lives under `.gsap-anim`, a class
 * only the motion script adds once the library has loaded, and nothing in the
 * markup carries it or hides an element by an inline style.
 */
import { describe, it, expect } from 'vitest';
import { generateComprehensiveReportHTML } from '../roof-analysis-report-html';
import { richBrand, richReport } from './fixtures/injection';

const NONCE = 'dGVzdC1ub25jZS0wMDAxLWFiY2RlZg==';
const BASE = 'https://app.example.test/roof-reports/motion';

/** The page with every script element taken out: what a browser shows when none of them runs. */
const withoutScripts = (html: string) => html.replace(/<script\b[\s\S]*?<\/script>/gi, '');

/** Style rules as [selector, body] pairs, with keyframes and comments left out. */
function rules(html: string): Array<[string, string]> {
  const css = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  const out: Array<[string, string]> = [];
  // Flatten @media and @supports blocks one level, drop @keyframes entirely.
  const flat = css.replace(/@keyframes[^{]+\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');
  for (const m of flat.matchAll(/([^{}@]+)\{([^{}]*)\}/g)) out.push([m[1].trim(), m[2]]);
  return out;
}

describe('a classic report page whose scripts do not run', () => {
  const html = generateComprehensiveReportHTML(richReport('full'), richBrand() as never, { nonce: NONCE, motionBase: BASE });
  const bare = withoutScripts(html);

  it('really is the page with the motion library tags in it (so the check below looks at the real page)', () => {
    expect(html).toContain(`${BASE}/gsap-3.14.2.min.js`);
    expect(html).toContain('data-reveal');
    expect(bare).not.toContain('gsap-3.14.2.min.js');
  });

  it('carries no gsap-anim class in its markup, the class every hidden state waits for', () => {
    expect(bare).not.toMatch(/class="[^"]*\bgsap-anim\b/);
    expect(bare).not.toMatch(/<html[^>]*gsap-anim/);
  });

  it('hides nothing in its stylesheet unless the rule sits under gsap-anim', () => {
    const hiding = rules(bare).filter(([, body]) => /opacity\s*:\s*0\s*(;|$)|visibility\s*:\s*hidden|scaleX\(0\)|scale\(0\)/i.test(body));
    expect(hiding.length).toBeGreaterThan(0); // the hidden states exist, so this is not an empty check
    for (const [selector] of hiding) expect(selector, selector).toMatch(/\.gsap-anim/);
  });

  it('hides no element by an inline style (opacity 0, visibility hidden)', () => {
    expect(bare).not.toMatch(/style="[^"]*(?:opacity\s*:\s*0\s*(?:;|")|visibility\s*:\s*hidden)/i);
  });
});
