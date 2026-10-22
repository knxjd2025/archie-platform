import { describe, it, expect, beforeEach } from 'vitest';
import { __resetBugMonitor, addTrail, endpointShape, getTrail, isNoise, setBugPage, getBugPage } from '../bug-monitor';

beforeEach(() => __resetBugMonitor());

describe('isNoise', () => {
  it('ignores what is not a bug in this app', () => {
    expect(isNoise('ResizeObserver loop completed with undelivered notifications.')).toBe(true);
    expect(isNoise('Script error.')).toBe(true);
    expect(isNoise('x is undefined', 'at foo (chrome-extension://abc/content.js:1:1)')).toBe(true);
    expect(isNoise('AbortError: The user aborted a request.')).toBe(true);
    expect(isNoise('   ')).toBe(true);
  });
  it('keeps real errors', () => {
    expect(isNoise("Cannot read properties of undefined (reading 'name')", 'at renderLead (https://app/assets/index.js:1:1)')).toBe(false);
  });
});

describe('endpointShape', () => {
  it('turns ids into placeholders and drops the query', () => {
    expect(endpointShape('/api/leads/812?tab=notes')).toBe('/api/leads/:id');
    expect(endpointShape('/api/reports/3f2b9c1e-1111-2222-3333-444455556666/pdf')).toBe('/api/reports/:id/pdf');
    expect(endpointShape('/api/jobs/22PPmUyBbNqLxkJ3sVWcD5/photos')).toBe('/api/jobs/:id/photos');
  });
  it('leaves named routes alone', () => {
    expect(endpointShape('/api/follow-ups')).toBe('/api/follow-ups');
  });
});

describe('trail', () => {
  it('keeps only the most recent entries', () => {
    for (let i = 0; i < 50; i++) addTrail('api', `call ${i}`);
    const t = getTrail();
    expect(t).toHaveLength(30);
    expect(t[t.length - 1].message).toBe('call 49');
  });
  it('records a page change once', () => {
    setBugPage('Leads'); setBugPage('Leads'); setBugPage('Home');
    expect(getTrail().map((e) => e.message)).toEqual(['Leads', 'Home']);
    expect(getBugPage()).toBe('Home');
  });
});
