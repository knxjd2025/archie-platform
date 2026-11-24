import { describe, expect, it } from 'vitest';
import { RR, plainMessage, statusLabel, kindsLabel } from '../words';

/** Every string a person can read in this feature, walked through, so a new sentence is checked the day it is added. */
function everySentence(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (typeof value === 'function') {
    for (const args of [[1], [2], [1, 2], [12, 40], [3, 5], ['Dana Whitfield', '12 Elm Street'], ['wind damage'], ['2 hours ago']]) {
      try { const r = (value as (...a: unknown[]) => unknown)(...args); if (typeof r === 'string') out.push(r); } catch { /* wrong arity for this probe */ }
    }
  } else if (Array.isArray(value)) value.forEach((v) => everySentence(v, out));
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => everySentence(v, out));
  return out;
}

describe('the words of the roof report screens', () => {
  const all = everySentence(RR);

  it('has a good many sentences to check', () => {
    expect(all.length).toBeGreaterThan(20);
  });

  it('uses no long dash, no sparkle or wand, no status code and no raw data', () => {
    for (const s of all) {
      expect(s, s).not.toMatch(/\u2014/);
      expect(s, s).not.toMatch(/✨|🪄|⭐|🌟|sparkle|magic/iu);
      expect(s, s).not.toMatch(/\bHTTP\b|\b[45]\d\d\b|undefined|null|NaN|\{|\}|\[object/);
    }
  });

  it('names no other company, product or place of the old program', () => {
    for (const s of all) expect(s, s).not.toMatch(/best roofing|bestroofing|roofy|archie crm|jobtread|companycam/iu);
  });

  it('lets a server sentence through and turns anything technical into the fallback', () => {
    const fallback = 'The reports could not be loaded. Please try again.';
    expect(plainMessage(new Error('That report could not be found.'), fallback)).toBe('That report could not be found.');
    expect(plainMessage(new Error('Your company has made a lot of reports today. Please try again tomorrow.'), fallback))
      .toBe('Your company has made a lot of reports today. Please try again tomorrow.');
    for (const bad of ['HTTP 500', 'HTTP 404', '{"error":"x"}', 'Request timed out \u2014 try again.', 'Failed to fetch', 'TypeError: x is not a function',
      'NetworkError when attempting to fetch resource.', 'violates foreign key constraint', '', 'a'.repeat(300), 'ECONNRESET', 'rate_limit']) {
      expect(plainMessage(new Error(bad), fallback), bad).toBe(fallback);
    }
    expect(plainMessage('not an error object', fallback)).toBe(fallback);
    expect(plainMessage(undefined, fallback)).toBe(fallback);
  });

  it('names a report status in plain words', () => {
    expect(statusLabel('generating')).toBe('Being made');
    expect(statusLabel('ready')).toBe('Ready');
    expect(statusLabel('failed')).toBe('Could not finish');
    expect(statusLabel('archived')).toBe('Archived');
    expect(statusLabel('something_new')).toBe('Not ready');
  });

  it('names the kinds of report in plain words', () => {
    expect(kindsLabel(['inspection'])).toBe('Inspection');
    expect(kindsLabel(['storm', 'inspection', 'measurement'])).toBe('Inspection, Measurements, Storm history');
    expect(kindsLabel([])).toBe('');
  });
});
