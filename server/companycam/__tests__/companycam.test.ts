import { describe, it, expect } from 'vitest';
import { companyCamConfigured, MAX_PUSH } from '../routes';

describe('companycam connection', () => {
  it('stays dormant until the company has CompanyCam connected', async () => {
    // With no company in context nothing is connected, env token or not.
    const token = process.env.COMPANYCAM_API_TOKEN;
    try {
      process.env.COMPANYCAM_API_TOKEN = 'cc_test';
      expect(await companyCamConfigured()).toBe(false);
    } finally {
      if (token === undefined) delete process.env.COMPANYCAM_API_TOKEN;
      else process.env.COMPANYCAM_API_TOKEN = token;
    }
  });

  it('bounds how many photos one push sends', () => {
    // Each photo is its own API call, so a 60-photo job can't fire 60 requests.
    expect(MAX_PUSH).toBeGreaterThan(0);
    expect(MAX_PUSH).toBeLessThanOrEqual(50);
  });
});
