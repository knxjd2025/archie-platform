/**
 * The pasted ticket reader, against the worked example in the written
 * contract (docs/sisters/contract-v2.md in the Roof Lee repository, "One
 * sign-in"). If this fails, the paste has drifted from Roof Lee's code.
 */
import { describe, expect, it } from 'vitest';
import { readTicket } from '../ticket';
import { makeTicket } from './helpers';

const SECRET = 'example-pair-secret';
const TICKET = 'eyJ2IjoyLCJqdGkiOiIwMDExMjIzMzQ0NTU2Njc3ODg5OWFhYmJjY2RkZWVmZiIsInByb2R1Y3QiOiJhcmNoaWUiLCJyb29mbGlDb21wYW55SWQiOiIwYjlmNmQwZS01YzU2LTRhOGUtOWQ1NS0yZjFmNWEzYzdlMTEiLCJhdXRoVXNlcklkIjoiN2QxYzFkMGEtM2YwZS00YjUzLThhNDQtMGQ2ZDdmMWYyYTEwIiwiZW1haWwiOiJkYW5hQGV4YW1wbGUudGVzdCIsInJvbGUiOiJvd25lciIsImlhdCI6MTc5NDkxNjgwMCwiZXhwIjoxNzk0OTE2ODYwfQ.71966557022f9b53beb1797e70eb77e33d510c8140034bb50bfe478ea649fb11';
const at = (seconds: number) => new Date(seconds * 1000);
const who = { roofliCompanyId: '0b9f6d0e-5c56-4a8e-9d55-2f1f5a3c7e11', authUserId: '7d1c1d0a-3f0e-4b53-8a44-0d6d7f1f2a10' };

describe('reading a sign-in ticket', () => {
  it('reads the contract\'s worked example', () => {
    expect(readTicket(TICKET, SECRET, at(1794916800), 'archie')).toEqual({
      v: 2, jti: '00112233445566778899aabbccddeeff', product: 'archie', ...who,
      email: 'dana@example.test', role: 'owner', iat: 1794916800, exp: 1794916860,
    });
  });

  it('writes the worked example the same way Roof Lee does', () => {
    expect(makeTicket({ ...who, jti: '00112233445566778899aabbccddeeff', iat: 1794916800 }, SECRET)).toBe(TICKET);
  });

  it('is good up to, but not at, its end', () => {
    expect(readTicket(TICKET, SECRET, at(1794916859), 'archie')).not.toBeNull();
    expect(readTicket(TICKET, SECRET, at(1794916860), 'archie')).toBeNull();
  });

  it('refuses another secret, and a ticket that has been altered', () => {
    expect(readTicket(TICKET, 'another-secret', at(1794916800), 'archie')).toBeNull();
    expect(readTicket(TICKET, '', at(1794916800), 'archie')).toBeNull();
    const [body, sig] = TICKET.split('.');
    const other = Buffer.from(Buffer.from(body, 'base64url').toString('utf8').replace('owner', 'admin')).toString('base64url');
    expect(readTicket(`${other}.${sig}`, SECRET, at(1794916800), 'archie')).toBeNull();
  });

  it('refuses a ticket made for another product, though the signature is right', () => {
    const now = Math.floor(Date.now() / 1000);
    for (const product of ['roofn', 'kontentfire']) {
      const t = makeTicket({ ...who, product, iat: now }, SECRET);
      expect(readTicket(t, SECRET, at(now), 'archie'), product).toBeNull();
    }
  });

  it('refuses a life that is not exactly sixty seconds, a ticket from the future and another version', () => {
    const now = 1794916800;
    expect(readTicket(makeTicket({ ...who, iat: now, exp: now + 3600 }, SECRET), SECRET, at(now), 'archie')).toBeNull();
    expect(readTicket(makeTicket({ ...who, iat: now + 61 }, SECRET), SECRET, at(now), 'archie')).toBeNull();
    expect(readTicket(makeTicket({ ...who, iat: now, v: 1 }, SECRET), SECRET, at(now), 'archie')).toBeNull();
    expect(readTicket(makeTicket({ ...who, iat: now }, SECRET), SECRET, at(now), 'archie')).not.toBeNull();
  });

  it('never throws on rubbish', () => {
    for (const junk of ['', '.', 'a.b', 'a.b.c', `${'a'.repeat(5000)}.${'0'.repeat(64)}`, 'e30.' + '0'.repeat(64)]) {
      expect(readTicket(junk, SECRET, new Date(), 'archie'), junk.slice(0, 20)).toBeNull();
    }
    expect(readTicket(undefined as never, SECRET, new Date(), 'archie')).toBeNull();
  });
});
