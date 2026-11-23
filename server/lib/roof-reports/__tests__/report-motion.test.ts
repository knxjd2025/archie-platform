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
