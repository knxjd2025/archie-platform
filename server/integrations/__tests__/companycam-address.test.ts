import { describe, it, expect } from 'vitest';
import { addressTarget, normalizeStreet, projectMatchesAddress } from '../companycam';

const project = (street_address_1: string, city?: string, postal_code?: string) => ({
  address: { street_address_1, city, postal_code },
});

describe('CompanyCam address matching', () => {
  const target = addressTarget('550 Manning Dr, Charlotte, NC 28209, USA');

  it('reads the street, city and zip out of a full address', () => {
    expect(target).toEqual({ street: '550 Manning Dr', city: 'Charlotte', postalCode: '28209' });
  });

  it("prefers the lead's own city and zip columns", () => {
    expect(addressTarget('550 Manning Dr', { city: 'Matthews', postalCode: '28105-1234' }))
      .toEqual({ street: '550 Manning Dr', city: 'Matthews', postalCode: '28105' });
  });

  it('treats spelled-out and abbreviated street words as the same street', () => {
    expect(normalizeStreet('550 Manning Drive.')).toBe(normalizeStreet('550 manning dr'));
    expect(projectMatchesAddress(project('550 Manning Drive', 'Charlotte'), target)).toBe(true);
  });

  it('matches on the zip when the city is spelled differently', () => {
    expect(projectMatchesAddress(project('550 Manning Dr', 'CLT', '28209'), target)).toBe(true);
  });

  it.each([
    // The substring rule matched every one of these, and pushed a job's
    // photos into another customer's project.
    ['a longer house number', project('1550 Manning Dr', 'Charlotte', '28209')],
    ['a shorter house number', project('50 Manning Dr', 'Charlotte', '28209')],
    ['the same street in another town', project('550 Manning Dr', 'Raleigh', '27601')],
    ['a unit on the street', project('550 Manning Dr Apt 4', 'Charlotte', '28209')],
    ['a project with no city or zip to confirm it', project('550 Manning Dr')],
    ['a project with no address at all', { address: null }],
  ])('refuses %s', (_label, p) => {
    expect(projectMatchesAddress(p, target)).toBe(false);
  });

  it('refuses everything when there is no street to match', () => {
    expect(projectMatchesAddress(project('', 'Charlotte', '28209'), addressTarget('', { city: 'Charlotte' }))).toBe(false);
  });
});
