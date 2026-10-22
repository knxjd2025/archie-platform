import { describe, it, expect, vi } from 'vitest';
import { ghlContactLinks, callLogNote, normalizeVia, exactContactMatch, existingContactIdFrom, findOrCreateContact } from '../routes';

describe('ghlContactLinks', () => {
  it('builds the GHL web URL and, only with a template, the LeadConnector deep link', () => {
    const none = ghlContactLinks('c1', 'loc9', '');
    expect(none.webUrl).toBe('https://app.gohighlevel.com/v2/location/loc9/contacts/detail/c1');
    expect(none.appUrl).toBeNull(); // no universal link exists for GHL web URLs — never pretend one does

    const app = ghlContactLinks('c1', 'loc9', 'leadconnector://location/{locationId}/contacts/{contactId}');
    expect(app.appUrl).toBe('leadconnector://location/loc9/contacts/c1');
  });

  it('returns nothing to open when there is no contact or no location', () => {
    expect(ghlContactLinks(null, 'loc9', 'x://{contactId}')).toEqual({ contactId: null, webUrl: null, appUrl: null });
    expect(ghlContactLinks('c1', '', 'x://{contactId}').webUrl).toBeNull();
  });
});

describe('callLogNote', () => {
  it('names how the call was placed, who placed it, and when (Eastern)', () => {
    const note = callLogNote('ghl-app', 'rep@bestroofingnow.com', new Date('2026-09-14T18:05:00Z'));
    expect(note).toContain('LeadConnector app');
    expect(note).toContain('rep@bestroofingnow.com');
    expect(note).toContain('2:05 PM ET');
    expect(callLogNote('ghl-web', 'a')).toContain('GHL web dialer');
    expect(callLogNote('phone', 'a')).toContain("rep's own phone");
  });
});

describe('normalizeVia', () => {
  it('accepts only the three known channels', () => {
    expect(normalizeVia('ghl-app')).toBe('ghl-app');
    expect(normalizeVia('phone')).toBe('phone');
    expect(normalizeVia('twilio')).toBeNull();
    expect(normalizeVia(undefined)).toBeNull();
  });
});

describe('exactContactMatch', () => {
  const lead = { phone: '(704) 555-1234', email: 'Pat@Example.com' };

  it('matches the phone however GHL formats it', () => {
    const hit = exactContactMatch([{ id: 'other', phone: '+17045551299' }, { id: 'pat', phone: '+17045551234' }], lead);
    expect(hit?.id).toBe('pat');
  });

  it('falls back to an exact email match', () => {
    expect(exactContactMatch([{ id: 'pat', phone: null, email: 'pat@example.com ' }], lead)?.id).toBe('pat');
  });

  it('never picks the first fuzzy result when nothing matches exactly', () => {
    // GHL's search returned a neighbour sharing digits; the old fallback took
    // contacts[0] and the text went to the wrong person.
    expect(exactContactMatch([{ id: 'stranger', phone: '+17045559999', email: 'x@y.com' }], lead)).toBeNull();
    expect(exactContactMatch([], lead)).toBeNull();
    expect(exactContactMatch(undefined, lead)).toBeNull();
  });

  it('ignores a contact without an id', () => {
    expect(exactContactMatch([{ phone: '+17045551234' }], lead)).toBeNull();
  });
});

describe('existingContactIdFrom', () => {
  it('reads the contact GHL names in its duplicate refusal', () => {
    const e = new Error('GHL API Error (400): {"statusCode":400,"message":"This location does not allow duplicated contacts.","meta":{"contactId":"abc123","matchingField":"phone"}}');
    expect(existingContactIdFrom(e)).toBe('abc123');
  });

  it('is null for any other failure', () => {
    expect(existingContactIdFrom(new Error('GHL API Error (500): Internal Server Error'))).toBeNull();
    expect(existingContactIdFrom(new Error('GHL API Error (401): {"message":"Invalid JWT"}'))).toBeNull();
    expect(existingContactIdFrom(undefined)).toBeNull();
  });
});

describe('findOrCreateContact', () => {
  const lead = { phone: '(704) 555-1234', email: null, firstName: 'Pat', lastName: 'Lee' };
  const client = (contacts: unknown[], create: () => Promise<unknown>) => {
    const getContacts = vi.fn(async () => ({ contacts }));
    return { getContacts, createContact: vi.fn(create) } as any;
  };

  it('looks through twenty fuzzy results, not five, for the exact one', async () => {
    const neighbours = Array.from({ length: 7 }, (_, i) => ({ id: `n${i}`, phone: `+170455512${40 + i}` }));
    const ghl = client([...neighbours, { id: 'pat', phone: '+17045551234' }], async () => { throw new Error('should not create'); });
    expect(await findOrCreateContact(ghl, lead)).toEqual({ ok: true, contactId: 'pat' });
    expect(ghl.getContacts).toHaveBeenCalledWith({ query: lead.phone, limit: 20 });
    expect(ghl.createContact).not.toHaveBeenCalled();
  });

  it('uses the contact GHL already has when it refuses a duplicate', async () => {
    // The search missed them; the create said they exist and named them.
    // That used to come back as "GoHighLevel is not responding" and block the rep.
    const ghl = client([], async () => {
      throw new Error('GHL API Error (400): {"message":"This location does not allow duplicated contacts.","meta":{"contactId":"pat"}}');
    });
    expect(await findOrCreateContact(ghl, lead)).toEqual({ ok: true, contactId: 'pat' });
  });

  it('still reports a real failure as one', async () => {
    const ghl = client([], async () => { throw new Error('GHL API Error (503): unavailable'); });
    expect(await findOrCreateContact(ghl, lead)).toEqual({ ok: false, error: 'GoHighLevel is not responding right now.' });
  });
});
