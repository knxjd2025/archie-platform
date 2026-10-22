import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { googleMapsKey, googleMapsKeySource, googleMapsConfigured } from '../google-key';

const NAMES = ['GOOGLE_MAPS_API_KEY', 'GOOGLEMAPS_API_KEY', 'GOOGLE_MAPS_KEY', 'MAPS_API_KEY'];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const n of NAMES) { saved[n] = process.env[n]; delete process.env[n]; }
});
afterEach(() => {
  for (const n of NAMES) {
    delete process.env[n];
    if (saved[n] !== undefined) process.env[n] = saved[n];
  }
});

describe('googleMapsKey', () => {
  it('prefers the canonical name', () => {
    process.env.GOOGLE_MAPS_API_KEY = 'canonical';
    process.env.GOOGLEMAPS_API_KEY = 'alias';
    expect(googleMapsKey()).toBe('canonical');
    expect(googleMapsKeySource()).toBe('GOOGLE_MAPS_API_KEY');
  });

  it('accepts the missing-underscore spelling', () => {
    // The real one: GOOGLEMAPS_API_KEY was set in Vercel. Without this the key
    // is ignored and measurements silently fall back to rough estimates, so
    // nothing looks broken — the report still renders.
    process.env.GOOGLEMAPS_API_KEY = 'from-vercel';
    expect(googleMapsKey()).toBe('from-vercel');
    expect(googleMapsConfigured()).toBe(true);
    expect(googleMapsKeySource()).toBe('GOOGLEMAPS_API_KEY');
  });

  it('reports not-configured when nothing is set', () => {
    expect(googleMapsKey()).toBeUndefined();
    expect(googleMapsConfigured()).toBe(false);
    expect(googleMapsKeySource()).toBeNull();
  });

  it('ignores an empty value rather than treating it as configured', () => {
    process.env.GOOGLE_MAPS_API_KEY = '';
    process.env.GOOGLEMAPS_API_KEY = 'real';
    expect(googleMapsKey()).toBe('real');
  });
});
