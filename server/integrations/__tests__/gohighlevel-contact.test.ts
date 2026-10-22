import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
vi.mock('../ghl/connection', async (orig) => ({
  ...(await orig<typeof import('../ghl/connection')>()),
  ghlConnection: async () => ({ locationId: 'loc-test', token: 'test-token' }),
}));

import { GoHighLevelClient, duplicateContactId, exactPhoneMatch } from '../gohighlevel';

describe('exactPhoneMatch', () => {
  const contacts = [
    { id: 'stranger', phone: '+17045551299' },
    { id: 'customer', phone: '(704) 555-1234' },
  ];

  it('takes only the contact with the same last ten digits', () => {
    // sendSms used to text contacts[0] of GHL's fuzzy search — here, the stranger.
    expect(exactPhoneMatch(contacts, '+17045551234')?.id).toBe('customer');
  });

  it('takes nothing when no phone matches exactly', () => {
    expect(exactPhoneMatch(contacts, '+17045550000')).toBeNull();
    expect(exactPhoneMatch(contacts, '1234')).toBeNull();
  });
});

describe('duplicateContactId', () => {
  it("reads the existing contact out of GHL's duplicate refusal", () => {
    const err = new Error('GHL API Error (400): {"statusCode":400,"message":"This location does not allow duplicated contacts.","meta":{"contactId":"abc123","matchingField":"phone"}}');
    expect(duplicateContactId(err)).toBe('abc123');
  });

  it('is null for any other failure', () => {
    expect(duplicateContactId(new Error('GHL API Error (500): upstream down'))).toBeNull();
    expect(duplicateContactId(new Error('GHL API Error (400): {"message":"bad"}'))).toBeNull();
  });
});

describe('sendSms without a contactId', () => {
  const realFetch = globalThis.fetch;
  let calls: Array<{ url: string; method: string; body: any }>;

  const respond = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  beforeEach(() => {
    calls = [];
  });
  afterEach(() => { globalThis.fetch = realFetch; });

  const stub = (handler: (url: string, method: string) => Response) => {
    globalThis.fetch = vi.fn(async (url: any, init: any = {}) => {
      const method = init.method || 'GET';
      calls.push({ url: String(url), method, body: init.body ? JSON.parse(init.body) : undefined });
      return handler(String(url), method);
    }) as any;
  };

  it('texts the contact whose phone matches, not the first search hit', async () => {
    stub((url, method) => {
      if (method === 'GET' && url.includes('/contacts/?')) {
        return respond(200, { contacts: [{ id: 'stranger', phone: '+17045551299' }, { id: 'customer', phone: '704-555-1234' }] });
      }
      return respond(200, { conversationId: 'c1', messageId: 'm1' });
    });
    const r = await new GoHighLevelClient().sendSms('(704) 555-1234', 'Your signing link');
    expect(r.success).toBe(true);
    expect(calls.at(-1)!.body).toMatchObject({ type: 'SMS', contactId: 'customer' });
  });

  it('creates the contact when none matches, and uses the existing one GHL names on a duplicate', async () => {
    stub((url, method) => {
      if (method === 'GET') return respond(200, { contacts: [{ id: 'stranger', phone: '+17045551299' }] });
      if (url.endsWith('/contacts/')) {
        return respond(400, { message: 'This location does not allow duplicated contacts.', meta: { contactId: 'existing' } });
      }
      return respond(200, { conversationId: 'c1', messageId: 'm1' });
    });
    const r = await new GoHighLevelClient().sendSms('7045551234', 'hello');
    expect(r.success).toBe(true);
    const create = calls.find((c) => c.method === 'POST' && c.url.endsWith('/contacts/'));
    expect(create?.body).toMatchObject({ phone: '+17045551234' });
    expect(calls.at(-1)!.body).toMatchObject({ contactId: 'existing' });
  });

  it('refuses a number it cannot text instead of guessing', async () => {
    stub(() => respond(200, {}));
    const r = await new GoHighLevelClient().sendSms('555-1234', 'hello');
    expect(r.success).toBe(false);
    expect(calls).toHaveLength(0);
  });
});
