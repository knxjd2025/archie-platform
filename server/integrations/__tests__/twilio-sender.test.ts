import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TwilioClient } from '../twilio';

/**
 * Which sender a text goes out through decides whether the 10DLC registration
 * is true in practice. The campaign told the carriers that replying STOP or
 * HELP gets a reply naming Best Roofing Now — and those replies are configured
 * on the Messaging Service, not on the account. A message sent straight from a
 * number gets the account's unbranded defaults instead.
 */
const env = { ...process.env };

describe('which sender a text uses', () => {
  let sent: URLSearchParams | null;

  beforeEach(() => {
    sent = null;
    process.env.TWILIO_ACCOUNT_SID = 'AC_test';
    process.env.TWILIO_AUTH_TOKEN = 'token';
    delete process.env.TWILIO_PHONE_NUMBER;
    delete process.env.TWILIO_MESSAGING_SERVICE_SID;
    vi.stubGlobal('fetch', async (_url: string, opts: any) => {
      sent = new URLSearchParams(String(opts.body));
      return { ok: true, status: 201, json: async () => ({ sid: 'SM1', status: 'queued' }), text: async () => '' } as any;
    });
  });
  afterEach(() => { vi.unstubAllGlobals(); process.env = { ...env }; });

  it('sends through the messaging service when one is configured', async () => {
    process.env.TWILIO_MESSAGING_SERVICE_SID = 'MG_test';
    process.env.TWILIO_PHONE_NUMBER = '+19809902042';
    await new TwilioClient().sendSms('+15551234567', 'hello');
    expect(sent!.get('MessagingServiceSid')).toBe('MG_test');
    // And not both: sending From as well would take the number's own route.
    expect(sent!.get('From')).toBeNull();
  });

  it('falls back to the single number when there is no service', async () => {
    process.env.TWILIO_PHONE_NUMBER = '+19809902042';
    await new TwilioClient().sendSms('+15551234567', 'hello');
    expect(sent!.get('From')).toBe('+19809902042');
    expect(sent!.get('MessagingServiceSid')).toBeNull();
  });

  it('refuses rather than sending with an empty From', async () => {
    // The live account had neither set: a send would have gone out with
    // From="" and been rejected by Twilio with a error nobody would read.
    await expect(new TwilioClient().sendSms('+15551234567', 'hello')).rejects.toThrow(/no sender/i);
    expect(sent).toBeNull();
  });

  it('says which sender it would use, and calls a service alone configured', async () => {
    process.env.TWILIO_MESSAGING_SERVICE_SID = 'MG_test';
    vi.stubGlobal('fetch', async () => ({ ok: true, status: 200, json: async () => ({ friendly_name: 'x' }), text: async () => '' } as any));
    const h = await new TwilioClient().healthCheck();
    expect(h.ok).toBe(true);
    expect(h.sendsVia).toBe('messaging-service');
  });

  it('is not configured when neither sender is set', async () => {
    const h = await new TwilioClient().healthCheck();
    expect(h.ok).toBe(false);
    expect(h.error).toMatch(/no sender/i);
  });
});
