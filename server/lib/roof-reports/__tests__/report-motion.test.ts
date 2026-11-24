import { describe, it, expect } from 'vitest';
import { motionStyles, motionRuntime } from '../report-motion';

describe('motionStyles', () => {
  const css = motionStyles();

  it('scopes every hidden state under .gsap-anim (content-first)', () => {
    for (const line of css.split('\n')) {
      if (/opacity\s*:\s*0\b/.test(line) || /scaleX\(0\)/.test(line)) {
        expect(line).toMatch(/\.gsap-anim/);
      }
    }
  });

  it('keeps content visible under print and reduced-motion', () => {
    expect(css).toContain('@media print');
    expect(css).toContain('prefers-reduced-motion');
    expect(css).toMatch(/@media print[\s\S]*opacity\s*:\s*1\s*!important/);
    expect(css).toMatch(/prefers-reduced-motion[\s\S]*opacity\s*:\s*1\s*!important/);
  });

  it('defines the scroll progress bar', () => {
    expect(css).toContain('.archie-progress');
  });
});

describe('motionRuntime', () => {
  it('inlines provided gsap source (self-contained)', () => {
    const out = motionRuntime({ gsapSource: '/*FAKE_GSAP*/' });
    expect(out).toContain('/*FAKE_GSAP*/');
    expect(out).toContain('archie-motion-runtime');
    expect(out).not.toContain('cdn.jsdelivr.net');
  });

  it('falls back to pinned CDN when no source given', () => {
    const out = motionRuntime();
    expect(out).toContain('cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js');
    expect(out).toContain('cdn.jsdelivr.net/npm/gsap@3.14.2/dist/ScrollTrigger.min.js');
  });

  it('the CDN scripts carry a subresource integrity hash for the exact pinned version, and crossorigin', () => {
    // sha384 of dist/gsap.min.js and dist/ScrollTrigger.min.js from the npm package gsap@3.14.2
    // (the registry's own sha512 for that package was checked when these were computed).
    // Changing GSAP_VERSION without recomputing both hashes must fail here.
    const PINNED: Record<string, string> = {
      'gsap.min.js': 'sha384-sG0Hv1tP1lZCk9KQmrIbY/XNwi+OY84GQqhMscbnsoBFqAz8KNCil1kvfL3Hbbk2',
      'ScrollTrigger.min.js': 'sha384-xNHNOfrykny9oFwnmpfNbkSc6isny38d1GZvTRVuFV0l9fTMIZKhULvomyQJSMRl',
    };
    const tags = [...motionRuntime().matchAll(/<script\s[^>]*src="([^"]+)"[^>]*>/g)];
    expect(tags).toHaveLength(2);
    for (const [tag, src] of tags) {
      expect(src).toMatch(/^https:\/\/cdn\.jsdelivr\.net\/npm\/gsap@3\.14\.2\/dist\/(gsap|ScrollTrigger)\.min\.js$/);
      const file = src.split('/').pop()!;
      expect(tag).toContain(`integrity="${PINNED[file]}"`);
      expect(tag).toContain('crossorigin="anonymous"');
    }
  });

  it('registers ScrollTrigger and guards reduced-motion; never ships markers', () => {
    const out = motionRuntime({ gsapSource: 'x' });
    expect(out).toContain('registerPlugin(ScrollTrigger)');
    expect(out).toContain('(prefers-reduced-motion: no-preference)');
    expect(out).not.toMatch(/markers\s*:\s*true/);
  });

  it('honors enabled:false and intensity presets', () => {
    expect(motionRuntime({ enabled: false })).toBe('');
    expect(motionRuntime({ gsapSource: 'x', intensity: 'subtle' })).toContain('y: 24');
    expect(motionRuntime({ gsapSource: 'x', intensity: 'standard' })).toContain('y: 40');
  });

  it('includes a content-first reveal safety net', () => {
    const out = motionRuntime({ gsapSource: 'x' });
    expect(out).toContain('revealInView');
    expect(out).toContain("addEventListener('load'");
  });
});

describe('motionRuntime under a nonce, with the app\'s own copy of the library', () => {
  const NONCE = 'dGVzdC1ub25jZS0wMDAxLWFiY2RlZg==';
  const BASE = 'https://app.example.test/roof-reports/motion';
  const tags = (html: string) => [...html.matchAll(/<script\b([^>]*)>/g)].map((m) => m[1]);

  it('loads both files from the app\'s own address, each with the nonce, and from nowhere else', () => {
    const out = motionRuntime({ nonce: NONCE, assetBase: BASE });
    const external = tags(out).filter((t) => /\ssrc=/.test(t));
    expect(external).toHaveLength(2);
    expect(external[0]).toContain(`src="${BASE}/gsap-3.14.2.min.js"`);
    expect(external[1]).toContain(`src="${BASE}/ScrollTrigger-3.14.2.min.js"`);
    for (const t of tags(out)) expect(t).toContain(`nonce="${NONCE}"`);
    expect(out).not.toContain('cdn.jsdelivr.net');
  });

  it('writes no outside script when it has a nonce but no address for the app\'s copy', () => {
    expect(tags(motionRuntime({ nonce: NONCE })).filter((t) => /\ssrc=/.test(t))).toEqual([]);
  });

  it('refuses an address that is not the app\'s own motion folder, so it can never open an attribute or point elsewhere', () => {
    for (const bad of [
      'javascript:alert(1)', 'https://app.example.test/other', 'https://app.example.test/roof-reports/motion/../x', 'https://app.example.test/roof-reports/motion"onload="x',
      '//evil.example/roof-reports/motion', 'https://app.example.test/roof-reports/motion?x=1', 'ftp://app.example.test/roof-reports/motion', '',
    ]) {
      expect(() => motionRuntime({ nonce: NONCE, assetBase: bad }), bad).toThrow();
    }
  });

  it('is ignored without a nonce (a stored or exported page keeps the pinned CDN copy with its integrity hashes)', () => {
    expect(motionRuntime({ assetBase: BASE })).toContain('cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js');
  });
});
