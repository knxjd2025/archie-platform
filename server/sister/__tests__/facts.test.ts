/**
 * What Archie takes from a company's confirmed facts. Fact names are the
 * company's own words in Roof Lee, so this takes only what it can place
 * without guessing, and never words a claim itself.
 */
import { describe, expect, it } from 'vitest';
import { mapCompanyFacts } from '../facts';

const empty = { identity: {}, contact: {}, service_area: {}, services: {}, credentials: {}, warranties: {}, offers: {}, voice: {}, audiences: {}, preferences: {} };

describe('mapping confirmed facts onto a company', () => {
  it('places the city and state, and nothing else, when there are no facts', () => {
    expect(mapCompanyFacts({ city: 'Cedar Falls', state: 'ia', facts: empty, timezone: null })).toEqual({
      branding: { city: 'Cedar Falls', state: 'IA' }, settings: {},
    });
    expect(mapCompanyFacts({ city: null, state: null, facts: empty, timezone: undefined })).toEqual({ branding: {}, settings: {} });
    expect(mapCompanyFacts({ city: '  ', state: 'Iowa', facts: undefined, timezone: null })).toEqual({ branding: {}, settings: {} });
  });

  it('takes contact details and identity it can place', () => {
    const out = mapCompanyFacts({
      city: null, state: null, timezone: null,
      facts: {
        ...empty,
        identity: { legal_name: ' Summit Ridge Roofing LLC ', tagline: 'Roofs done right in Cedar Falls', founded: '2009', short_name: 'Summit Ridge' },
        contact: { phone: '(319) 555-0142', email: 'Office@SummitRidge.example.test', website: 'summitridge.example.test' },
      },
    });
    expect(out.branding).toEqual({
      legalName: 'Summit Ridge Roofing LLC', tagline: 'Roofs done right in Cedar Falls', foundedYear: 2009, shortName: 'Summit Ridge',
      phone: '(319) 555-0142', email: 'office@summitridge.example.test', website: 'summitridge.example.test',
    });
  });

  it('uses the company\'s own words for credentials and warranties, and never makes any up', () => {
    const out = mapCompanyFacts({
      city: null, state: null, timezone: null,
      facts: {
        ...empty,
        // A yes or a number is a fact, but not a sentence Archie may print.
        credentials: { licensed: true, state_license: 'Iowa contractor registration C123456', memberships: ['Cedar Valley Home Builders', 7, ''], years: 12 },
        warranties: { workmanship: '5 year workmanship warranty', shingles: 'Lifetime limited from the maker', workmanship_years: 5 },
      },
    });
    expect(out.settings).toEqual({
      credentials: ['Iowa contractor registration C123456', 'Cedar Valley Home Builders'],
      workmanshipWarranty: '5 year workmanship warranty',
      workmanshipYears: 5,
    });
  });

  it('describes the service area only from text the company confirmed', () => {
    expect(mapCompanyFacts({ city: null, state: null, timezone: null, facts: { ...empty, service_area: { summary: 'Cedar Falls and 30 miles around' } } }).settings)
      .toEqual({ serviceArea: 'Cedar Falls and 30 miles around' });
    expect(mapCompanyFacts({ city: null, state: null, timezone: null, facts: { ...empty, service_area: { towns: ['Cedar Falls', 'Waterloo'], radius_miles: 30 } } }).settings)
      .toEqual({ serviceArea: 'Cedar Falls, Waterloo' });
  });

  it('takes a time zone only when it is a real one', () => {
    expect(mapCompanyFacts({ city: null, state: null, facts: empty, timezone: 'America/Chicago' }).settings).toEqual({ timeZone: 'America/Chicago' });
    expect(mapCompanyFacts({ city: null, state: null, facts: empty, timezone: 'Mars/Olympus' }).settings).toEqual({});
  });

  it('ignores anything that is not the shape it expects', () => {
    const out = mapCompanyFacts({
      city: null, state: null, timezone: null,
      facts: { identity: 'nope', contact: { phone: { a: 1 }, email: 'not an email', website: 'javascript:alert(1)' }, credentials: [1, 2], warranties: null } as never,
    });
    expect(out).toEqual({ branding: {}, settings: {} });
  });

  it('keeps long text within sensible limits', () => {
    const out = mapCompanyFacts({ city: 'x'.repeat(500), state: null, timezone: null, facts: { ...empty, identity: { tagline: 'y'.repeat(5000) } } });
    expect(out.branding.city).toBeUndefined();
    expect(out.branding.tagline).toBeUndefined();
  });
});
