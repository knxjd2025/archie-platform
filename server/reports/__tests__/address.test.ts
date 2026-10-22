import { describe, it, expect } from 'vitest';
import { parseUsAddress, hasRealStreet } from '../../lib/reports/address-utils';

// Regression: JobTread stores the full formatted address, but the report engine
// appends city/state/zip itself. Passing the raw value produced
// "550 Manning Dr, Charlotte, NC 28209, USA, Charlotte, NC 28209", which
// geocoders return no match for — the report failed with "Unable to geocode
// address". Generation must split it back into parts first.
describe('report address handling', () => {
  it('splits a JobTread-formatted address (including the trailing USA)', () => {
    expect(parseUsAddress('550 Manning Dr, Charlotte, NC 28209, USA')).toEqual({
      address: '550 Manning Dr', city: 'Charlotte', state: 'NC', zip: '28209',
    });
  });

  it('splits one without the country token', () => {
    expect(parseUsAddress('1234 Sardis Rd N, Charlotte, NC 28270')).toEqual({
      address: '1234 Sardis Rd N', city: 'Charlotte', state: 'NC', zip: '28270',
    });
  });

  it('leaves a street-only address alone', () => {
    expect(parseUsAddress('550 Manning Dr').address).toBe('550 Manning Dr');
  });

  it('never re-appends the city that is already in the address', () => {
    const p = parseUsAddress('550 Manning Dr, Charlotte, NC 28209, USA');
    const geocoded = `${p.address}, ${p.city}, ${p.state} ${p.zip}`;
    expect(geocoded).toBe('550 Manning Dr, Charlotte, NC 28209');
    expect(geocoded).not.toMatch(/Charlotte.*Charlotte/);
    expect(geocoded).not.toMatch(/USA/);
  });

  it('knows a city/state pair is not a street address', () => {
    expect(hasRealStreet('550 Manning Dr')).toBe(true);
    expect(hasRealStreet('Charlotte, NC')).toBe(false);
  });
});
