import { describe, it, expect } from 'vitest';
import { isValidTone, parseEmailRisk, parseLeadSignal, WRITING_MODEL } from '../assist-service';

describe('assist config', () => {
  it('defaults to Kimi K2.6 (env-switchable)', () => {
    expect(WRITING_MODEL).toBe(process.env.WRITING_MODEL || 'moonshotai/kimi-k2.6');
  });
});

describe('isValidTone', () => {
  it('accepts the supported tones only', () => {
    expect(isValidTone('friendlier')).toBe(true);
    expect(isValidTone('shorter')).toBe(true);
    expect(isValidTone('formal')).toBe(true);
    expect(isValidTone('angrier')).toBe(false);
    expect(isValidTone('')).toBe(false);
  });
});

describe('parseEmailRisk', () => {
  it('parses clean JSON', () => {
    const r = parseEmailRisk('{"risk":"dangerous","score":92,"reasons":["spoofed sender","wire-change request"]}');
    expect(r.risk).toBe('dangerous');
    expect(r.score).toBe(92);
    expect(r.reasons).toHaveLength(2);
  });
  it('extracts JSON embedded in extra text', () => {
    const r = parseEmailRisk('Here is my analysis: {"risk":"safe","score":5,"reasons":[]} done');
    expect(r.risk).toBe('safe');
    expect(r.score).toBe(5);
  });
  it('clamps score and defaults unknown risk to suspicious', () => {
    const r = parseEmailRisk('{"risk":"weird","score":999,"reasons":["x"]}');
    expect(r.risk).toBe('suspicious');
    expect(r.score).toBe(100);
  });
  it('fails toward caution on unparseable output (never "safe")', () => {
    const r = parseEmailRisk('the model rambled without json');
    expect(r.risk).toBe('suspicious');
    expect(r.reasons.length).toBeGreaterThan(0);
  });
});

describe('parseLeadSignal', () => {
  it('parses a positive lead with extracted fields', () => {
    const r = parseLeadSignal('{"isLead":true,"confidence":88,"name":"Jane Doe","service":"Roof replacement","summary":"wants a quote after hail"}');
    expect(r).toMatchObject({ isLead: true, confidence: 88, name: 'Jane Doe', service: 'Roof replacement' });
  });
  it('extracts JSON from surrounding text and clamps confidence', () => {
    const r = parseLeadSignal('sure: {"isLead":true,"confidence":150,"name":"Bob"} ok');
    expect(r.confidence).toBe(100);
    expect(r.name).toBe('Bob');
  });
  it('treats non-leads and garbage as not-a-lead', () => {
    expect(parseLeadSignal('{"isLead":false,"confidence":10}').isLead).toBe(false);
    expect(parseLeadSignal('no json here').isLead).toBe(false);
    expect(parseLeadSignal('no json here').confidence).toBe(0);
  });
});

describe('isValidTone ignores Object.prototype', () => {
  it('refuses constructor and friends, keeps the real tones', () => {
    for (const k of ['constructor', '__proto__', 'toString']) expect(isValidTone(k)).toBe(false);
    for (const k of ['friendlier', 'shorter', 'formal']) expect(isValidTone(k)).toBe(true);
  });
});
