import { describe, it, expect } from 'vitest';
import { pickPhoneContact } from '../vapi';

const c = (id: string, firstName: string, lastName: string, phone?: string) => ({ id, firstName, lastName, phone });

describe('pickPhoneContact', () => {
  it('picks the one clear match and normalises its number', () => {
    const r = pickPhoneContact([c('a', 'Brian', 'Freeman', '(704) 555-1234'), c('b', 'Sara', 'Lee', '704-555-0000')], 'brian freeman');
    expect(r).toEqual({ phone: '+17045551234', name: 'Brian Freeman', contactId: 'a' });
  });

  it('asks which one when two different numbers match about equally', () => {
    // "Text Mike the signing link" used to go to whichever Mike GHL listed first.
    const r = pickPhoneContact([c('a', 'Mike', 'Smith', '704-555-1234'), c('b', 'Mike', 'Jones', '980-555-9876')], 'mike');
    expect(r.phone).toBeUndefined();
    expect(r.error).toMatch(/more than one match/);
    expect(r.error).toMatch(/1234/);
    expect(r.error).toMatch(/9876/);
  });

  it('asks which one when the same name is on two numbers', () => {
    const r = pickPhoneContact([c('a', 'Mike', 'Smith', '704-555-1234'), c('b', 'Mike', 'Smith', '980-555-9876')], 'mike smith');
    expect(r.error).toMatch(/more than one match/);
  });

  it('does not count the same person twice as ambiguity', () => {
    const r = pickPhoneContact([c('a', 'Mike', 'Smith', '704-555-1234'), c('b', 'Mike', 'Smith', '+1 704 555 1234')], 'mike smith');
    expect(r.contactId).toBe('a');
  });

  it('skips contacts whose phone is not a real number', () => {
    const r = pickPhoneContact([c('a', 'Brian', 'Freeman', '555-1234')], 'brian freeman');
    expect(r.error).toMatch(/couldn't find a phone number/);
  });

  it('will not fall back to a contact that does not match at all', () => {
    const r = pickPhoneContact([c('a', 'Zed', 'Nobody', '704-555-1234')], 'brian freeman');
    expect(r.error).toMatch(/couldn't find/);
  });
});
