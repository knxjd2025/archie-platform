import { describe, it, expect } from 'vitest';
import { isPipelineStage, isTrade, normalizeTrades, moveBlocker, type PipelineState } from '../production-pipeline';
import { filtersForPreset } from '../canvass-areas';

// `key in MAP` answers true for everything on Object.prototype, so these
// validators let 'constructor' through and the gates compared NaN indexes.
const PROTO_KEYS = ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf'];

describe('validators built on lookup maps ignore Object.prototype', () => {
  it('isPipelineStage refuses prototype keys and still knows real stages', () => {
    for (const k of PROTO_KEYS) expect(isPipelineStage(k)).toBe(false);
    expect(isPipelineStage('approved')).toBe(true);
    expect(isPipelineStage('closed_out')).toBe(true);
  });

  it('isTrade refuses prototype keys, so normalizeTrades drops them', () => {
    for (const k of PROTO_KEYS) expect(isTrade(k)).toBe(false);
    expect(isTrade('gutters')).toBe(true);
    expect(normalizeTrades(['constructor', 'siding']).map((t) => t.key)).toEqual(['siding']);
  });

  it('a canvass preset of "constructor" falls back to custom, with its filters', () => {
    const f = filtersForPreset('constructor');
    expect(f.preset).toBe('custom');
    expect(f.propertyType).toBe('SFR');
  });

  it('keeps the moveBlocker contract for real stages', () => {
    const state: PipelineState = { stage: 'approved', trades: [{ key: 'roofing', done: false }], checks: {} };
    expect(moveBlocker('schedule', state, { preconSubmitted: false, walkthroughSubmitted: false })).toMatch(/pre-construction/);
  });
});
