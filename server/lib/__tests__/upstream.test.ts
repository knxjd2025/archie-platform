import { describe, it, expect } from 'vitest';
import { classifyUpstream } from '../upstream';

/**
 * Every message here is one the API sweep actually produced against a server
 * with the integration credentials blanked — so these are the real strings,
 * not invented ones.
 */
describe('classifyUpstream', () => {
  it('treats "never set up" as unavailable, not broken', () => {
    for (const msg of [
      'Everee not configured - set EVEREE_API_KEY',
      'QuickBooks not connected - complete OAuth flow first',
      'GROQ_API_KEY is not set.',
      'No vision provider configured (set FAL_AI_API_KEY or OPENROUTER_API_KEY).',
      'No key or keyFile set.',
      'ANTHROPIC_API_KEY is not set. Add it to your Vercel environment variables.',
    ]) {
      const c = classifyUpstream(new Error(msg), 'Everee');
      expect(c.kind, msg).toBe('not-configured');
      expect(c.status, msg).toBe(503);
    }
  });

  it('calls a rejected key what it is, and does not blame us for it', () => {
    const ghl = classifyUpstream(
      new Error('GHL API Error (401): {"statusCode":401,"message":"The token in Authorization header is not valid!"}'),
      'GoHighLevel',
    );
    expect(ghl.kind).toBe('rejected');
    expect(ghl.status).toBe(502);

    const jt = classifyUpstream(new Error('JobTread API Error (400): Supplied key is invalid or expired'), 'JobTread');
    expect(jt.kind).toBe('rejected');
  });

  it('separates "the provider said no" from "the provider is down"', () => {
    expect(classifyUpstream(new Error('JobTread API Error (400): The field "tasks" does not exist'), 'JobTread').status).toBe(502);
    expect(classifyUpstream(new Error('JobTread API Error (503): upstream'), 'JobTread').status).toBe(503);
    expect(classifyUpstream(new Error('fetch failed'), 'JobTread').status).toBe(503);
  });

  it('never puts the provider’s own words in what the user is shown', () => {
    const leaky = 'Twilio API Error (404): {"code":20404,"message":"The requested resource /2010-04-01/Accounts//Messages.json was not found"}';
    const c = classifyUpstream(new Error(leaky), 'Twilio');
    expect(c.message).not.toContain('2010-04-01');
    expect(c.message).not.toContain('20404');
    expect(c.message).toContain('Twilio');
  });

  it('falls back to 500 only when it really is our problem', () => {
    const c = classifyUpstream(new Error('Cannot read properties of undefined (reading "id")'), 'JobTread');
    expect(c.kind).toBe('unknown');
    expect(c.status).toBe(500);
  });
});
