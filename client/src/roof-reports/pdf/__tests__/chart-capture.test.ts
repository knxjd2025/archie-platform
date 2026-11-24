/**
 * The two charts the PDF draws, with a fake canvas that records everything drawn.
 * The charts draw only from report numbers: every piece of text they write is a
 * number or one of a fixed set of words, never a string from the report, so a
 * label that came from a stored or typed report cannot reach the picture.
 */
import { describe, expect, it } from 'vitest';
import { DAMAGE_LABELS, captureDamageChart, captureStormTimelineChart, type MakeSurface } from '../chart-capture';

interface Drawn { texts: Array<{ text: string; maxWidth: unknown }>; rects: number; size: [number, number] }
function recorder(opts: { noContext?: boolean; badUrl?: boolean } = {}): { make: MakeSurface; drawn: Drawn } {
  const drawn: Drawn = { texts: [], rects: 0, size: [0, 0] };
  const make: MakeSurface = (w, h) => {
    drawn.size = [w, h];
    const ctx = {
      fillStyle: '', strokeStyle: '', font: '', textAlign: '', textBaseline: '', lineWidth: 0,
      fillRect: () => { drawn.rects++; }, strokeRect: () => {}, beginPath: () => {}, moveTo: () => {}, lineTo: () => {}, stroke: () => {}, scale: () => {},
      fillText: (text: string, _x: number, _y: number, maxWidth?: number) => { drawn.texts.push({ text, maxWidth }); },
    };
    return { width: w, height: h, getContext: () => (opts.noContext ? null : (ctx as never)), toDataURL: () => (opts.badUrl ? 'javascript:alert(1)' : 'data:image/png;base64,AAAA') };
  };
  return { make, drawn };
}

const PLAIN = /^(\d{1,5}|Hail|Wind|Other)$/;

describe('the storm timeline', () => {
  const years = { 2024: { hail: 3, wind: 2, total: 5 }, 2025: { hail: 5, wind: 5, total: 10 } };

  it('draws bars and returns a PNG address', () => {
    const { make, drawn } = recorder();
    expect(captureStormTimelineChart(years, make)).toBe('data:image/png;base64,AAAA');
    expect(drawn.rects).toBeGreaterThanOrEqual(4);
    expect(drawn.size[0]).toBeGreaterThan(0);
  });

  it('writes only numbers and the two fixed words, each with a width limit', () => {
    const { make, drawn } = recorder();
    captureStormTimelineChart(years, make);
    expect(drawn.texts.length).toBeGreaterThan(0);
    for (const t of drawn.texts) { expect(t.text).toMatch(PLAIN); expect(typeof t.maxWidth).toBe('number'); }
    expect(drawn.texts.map((t) => t.text)).toEqual(expect.arrayContaining(['2024', '2025', 'Hail', 'Wind']));
  });

  it('draws nothing a person typed: hostile years and counts become nothing or a plain number', () => {
    const { make, drawn } = recorder();
    const hostile = { '<script>alert(1)</script>': { hail: 1, wind: 1 }, '12345678901234567890': { hail: 1, wind: 1 }, 1800: { hail: 1, wind: 1 }, 2200: { hail: 1, wind: 1 }, 2025: { hail: '9<b>x</b>', wind: Infinity, total: NaN }, 2026: { hail: -4, wind: 1e12 } };
    const out = captureStormTimelineChart(hostile, make);
    for (const t of drawn.texts) expect(t.text).toMatch(PLAIN);
    expect(drawn.texts.some((t) => /script|<|>/.test(t.text))).toBe(false);
    expect(out === null || out.startsWith('data:image/png;base64,')).toBe(true);
    for (const t of drawn.texts.filter((x) => /^\d+$/.test(x.text))) expect(Number(t.text)).toBeLessThanOrEqual(99999);
  });

  it('draws at most twelve years, the latest ones', () => {
    const many = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [1995 + i, { hail: 1, wind: 1, total: 2 }]));
    const { make, drawn } = recorder();
    captureStormTimelineChart(many, make);
    const labelled = drawn.texts.filter((t) => /^\d{4}$/.test(t.text)).map((t) => t.text);
    expect(new Set(labelled).size).toBe(12);
    expect(labelled).toContain('2024');
    expect(labelled).not.toContain('1995');
  });

  it('draws nothing when there is nothing to draw', () => {
    for (const bad of [null, undefined, {}, [], 'x', 5, { 2024: null }]) {
      const { make, drawn } = recorder();
      expect(captureStormTimelineChart(bad, make), String(bad)).toBeNull();
      expect(drawn.texts).toHaveLength(0);
    }
    expect(captureStormTimelineChart({ 2024: { hail: 0, wind: 0, total: 0 } }, recorder().make)).toBeNull();
  });

  it('gives up quietly when there is no canvas, and never returns an address that is not a PNG', () => {
    expect(captureStormTimelineChart(years, recorder({ noContext: true }).make)).toBeNull();
    expect(captureStormTimelineChart(years, () => null)).toBeNull();
    expect(captureStormTimelineChart(years, recorder({ badUrl: true }).make)).toBeNull();
    expect(captureStormTimelineChart(years, () => { throw new Error('boom'); })).toBeNull();
  });
});

describe('the damage chart', () => {
  const types = [{ type: 'hail_impact', count: 4, severity: 'high' }, { type: 'wind_lift', count: 2, severity: 'medium' }];

  it('names each bar with a fixed word for a known kind of damage, and Other for anything else', () => {
    const { make, drawn } = recorder();
    expect(captureDamageChart([...types, { type: '<img src=x onerror=alert(1)>', count: 1, severity: 'low' }, { type: 'x'.repeat(500), count: 2, severity: 'low' }], make)).toBe('data:image/png;base64,AAAA');
    const words = drawn.texts.map((t) => t.text).filter((t) => !/^\d+$/.test(t));
    for (const w of words) expect([...Object.values(DAMAGE_LABELS), 'Other']).toContain(w);
    expect(words).toEqual(expect.arrayContaining([DAMAGE_LABELS.hail_impact, DAMAGE_LABELS.wind_lift, 'Other']));
    for (const t of drawn.texts) { expect(t.text.length).toBeLessThanOrEqual(24); expect(typeof t.maxWidth).toBe('number'); }
  });

  it('draws counts as plain numbers inside a bound, whatever the report holds', () => {
    const { make, drawn } = recorder();
    captureDamageChart([{ type: 'hail_impact', count: 1e30, severity: 'x' }, { type: 'wind_lift', count: -3, severity: 'x' }, { type: 'granule_loss', count: Number.NaN, severity: 'x' }, { type: 'missing_shingles', count: '7' as never, severity: 'x' }], make);
    for (const t of drawn.texts.filter((x) => /^\d+$/.test(x.text))) expect(Number(t.text)).toBeLessThanOrEqual(99999);
    expect(drawn.texts.some((t) => /e\+|NaN|Infinity|-/.test(t.text))).toBe(false);
  });

  it('draws at most six bars, and nothing when no kind has a count', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ type: i % 2 ? 'hail_impact' : 'wind_lift', count: i + 1, severity: 'low' }));
    const { make, drawn } = recorder();
    captureDamageChart(many, make);
    expect(drawn.rects).toBeLessThanOrEqual(6 + 2);
    for (const bad of [null, undefined, [], 'x', [{ type: 'hail_impact', count: 0, severity: 'x' }], [null]]) expect(captureDamageChart(bad, recorder().make), String(bad)).toBeNull();
  });

  it('holds no em dash in any word it can draw', () => {
    for (const w of Object.values(DAMAGE_LABELS)) expect(w).not.toContain('—');
  });
});
