import { describe, it, expect } from 'vitest';
import { safeColor, safeUrl, safeHttpUrl, safeImageSrc, isSafeId, boundedNumber, jsonForScript } from '../html-safety';
import { toNumber, normalizeReportNumbers } from '../report-normalize';
import { makeReport } from './fixtures/report';

describe('safeColor', () => {
  it('keeps hex colours and nothing else', () => {
    expect(safeColor('#ea580c', 'x')).toBe('#ea580c');
    expect(safeColor(' #FFF ', 'x')).toBe('#FFF');
    expect(safeColor('#ea580c88', 'x')).toBe('#ea580c88');
    for (const bad of ['red', 'red;}</style>', 'url(javascript:1)', '#12', '#ggg', 'rgb(1,2,3)', '', null, 5]) {
      expect(safeColor(bad, 'fallback')).toBe('fallback');
    }
  });
});

describe('safeUrl', () => {
  it('allows http, https, mailto and tel', () => {
    for (const ok of ['https://a.example/x?y=1', 'http://a.example', 'mailto:a@b.example', 'tel:+13195550142', ' HTTPS://A.example ']) {
      expect(safeUrl(ok)).not.toBe('');
    }
  });
  it('refuses everything else, including disguised script schemes', () => {
    for (const bad of ['javascript:alert(1)', 'JaVaScRiPt:1', 'java\tscript:1', '\u0001javascript:1', 'data:text/html,x', 'vbscript:x', '//evil.example', '/relative', 'https://', 'ftp://x', '', null, undefined, 4]) {
      expect(safeUrl(bad)).toBe('');
    }
  });
  it('http-only and image variants are stricter', () => {
    expect(safeHttpUrl('mailto:a@b.example')).toBe('');
    expect(safeHttpUrl('https://a.example/p.png')).toBe('https://a.example/p.png');
    expect(safeImageSrc('data:image/png;base64,AAAA')).not.toBe('');
    expect(safeImageSrc('data:text/html;base64,AAAA')).toBe('');
    expect(safeImageSrc('data:image/svg+xml;base64,AAAA')).toBe('');
  });
});

describe('ids, numbers and inline JSON', () => {
  it('isSafeId matches the chapter id pattern', () => {
    expect(isSafeId('ventilation')).toBe(true);
    expect(isSafeId('a-b-2')).toBe(true);
    for (const bad of ['', 'A', '1a', 'a b', 'a"><img>', 'a'.repeat(50), 5, null]) expect(isSafeId(bad)).toBe(false);
  });
  it('boundedNumber clamps and refuses text', () => {
    expect(boundedNumber(5, 0, 10, 1)).toBe(5);
    expect(boundedNumber(500, 0, 10, 1)).toBe(10);
    expect(boundedNumber(-5, 0, 10, 1)).toBe(0);
    expect(boundedNumber('7', 0, 10, 1)).toBe(7);
    expect(boundedNumber('1</script>', 0, 10, 1)).toBe(1);
    expect(boundedNumber(NaN, 0, 10, 1)).toBe(1);
  });
  it('jsonForScript can never close a script block, open a comment or break a string', () => {
    const out = jsonForScript({ a: '</script><!-- & \u2028 \u2029 >' });
    expect(out).not.toMatch(/[<>&\u2028\u2029]/);
    expect(JSON.parse(out).a).toBe('</script><!-- & \u2028 \u2029 >');
  });
});

describe('normalizeReportNumbers', () => {
  it('turns text where a figure belongs into 0 and leaves real numbers and absent fields alone', () => {
    expect(toNumber('12')).toBe(12);
    expect(toNumber('3.5')).toBe(3.5);
    expect(toNumber('"><img>')).toBe(0);
    expect(toNumber(Infinity)).toBe(0);
    const r = makeReport();
    (r.stormHistory as unknown as Record<string, unknown>).totalEvents = '<b>';
    (r.stormHistory as unknown as Record<string, unknown>).hailEvents = '8';
    const out = normalizeReportNumbers(r);
    expect(out.stormHistory.totalEvents).toBe(0);
    expect(out.stormHistory.hailEvents).toBe(8);
    expect(out.stormHistory.windEvents).toBe(7);
    expect('mostRecentHailStorm' in out.stormHistory).toBe(false);
    expect(r.stormHistory.totalEvents).toBe('<b>'); // the original is not touched
  });
});
