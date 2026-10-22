import { describe, it, expect } from 'vitest';
import {
  tracerfyOverrides, tracerfyGeography, pointInShape, coveringRadiusMiles, isAreaShape, filtersForPreset, ROOFING_PRESETS, CURRENT_YEAR,
} from '../../../shared/canvass-areas';
import { mapLeadRow, mapPropertyLookup, bestCleanPhone } from '../../integrations/tracerfy';
import { parseFilters } from '../tracerfy-routes';

const square = { type: 'polygon' as const, path: [{ lat: 35.20, lng: -80.85 }, { lat: 35.20, lng: -80.83 }, { lat: 35.22, lng: -80.83 }, { lat: 35.22, lng: -80.85 }] };

describe('roofing filters → Tracerfy', () => {
  it('the presets say what a roofer would say', () => {
    const aging = filtersForPreset('aging_roofs');
    expect(aging.yearBuiltMax).toBe(CURRENT_YEAR - 15);
    expect(aging.ownerOccupied).toBe(true);
    expect(tracerfyOverrides(aging)).toEqual({ property_type: 'SFR', year_built_max: CURRENT_YEAR - 15, owner_occupied: true, mls_active: false });
    expect(tracerfyOverrides(filtersForPreset('landlords'))).toMatchObject({ absentee_owner: true });
    expect(Object.keys(ROOFING_PRESETS)).toContain('custom');
    expect(filtersForPreset('nope').preset).toBe('custom');
  });
  it('only sends keys Tracerfy documents, and ANY property type sends none', () => {
    expect(tracerfyOverrides({ preset: 'custom', propertyType: 'ANY', roofScoreMin: 60 })).toEqual({});
    expect(tracerfyOverrides({ preset: 'custom', propertyType: 'SFR', valueMin: 250000.4, freeClear: true, yearsOwnedMin: 7 }))
      .toEqual({ property_type: 'SFR', value_min: 250000, free_clear: true, years_owned_min: 7 });
  });
  it('bounds what the request body may set', () => {
    const f = parseFilters({ preset: 'aging_roofs', yearBuiltMax: 3000, valueMin: -5, ownerOccupied: null, roofScoreMin: 150 });
    expect(f.yearBuiltMax).toBe(2100);
    expect(f.valueMin).toBe(0);
    expect(f.ownerOccupied).toBeNull();
    expect(f.roofScoreMin).toBe(100);
    expect(f.propertyType).toBe('SFR');
  });
});

describe('a drawn shape → the covering circle Tracerfy accepts', () => {
  it('centres on the drawing and reaches its farthest corner, in miles', () => {
    const g = tracerfyGeography(square);
    expect(g.mode).toBe('radius');
    expect(g.latitude).toBeCloseTo(35.21, 5);
    expect(g.longitude).toBeCloseTo(-80.84, 5);
    expect(g.radius).toBeGreaterThan(0.85); // half-diagonal of a ~1.4 x 1.1 mile box
    expect(g.radius).toBeLessThan(1.0);
    expect(coveringRadiusMiles({ type: 'circle', center: { lat: 35, lng: -80 }, radiusMeters: 1609.344 })).toBeCloseTo(1, 3);
    expect(coveringRadiusMiles({ type: 'circle', center: { lat: 35, lng: -80 }, radiusMeters: 20 })).toBe(0.1);
  });
  it('tells homes inside the drawing from the rest of the circle', () => {
    expect(pointInShape({ lat: 35.21, lng: -80.84 }, square)).toBe(true);
    expect(pointInShape({ lat: 35.23, lng: -80.84 }, square)).toBe(false);
    const rect = { type: 'rectangle' as const, north: 35.22, south: 35.20, east: -80.83, west: -80.85 };
    expect(pointInShape({ lat: 35.21, lng: -80.84 }, rect)).toBe(true);
    expect(pointInShape({ lat: 35.21, lng: -80.82 }, rect)).toBe(false);
    const circle = { type: 'circle' as const, center: { lat: 35.21, lng: -80.84 }, radiusMeters: 500 };
    expect(pointInShape({ lat: 35.211, lng: -80.841 }, circle)).toBe(true);
    expect(pointInShape({ lat: 35.25, lng: -80.84 }, circle)).toBe(false);
  });
  it('rejects shapes that are not shapes', () => {
    expect(isAreaShape(square)).toBe(true);
    expect(isAreaShape({ type: 'polygon', path: [{ lat: 1, lng: 1 }] })).toBe(false);
    expect(isAreaShape({ type: 'rectangle', north: 1, south: 2, east: 3, west: 1 })).toBe(false);
    expect(isAreaShape({ type: 'circle', center: { lat: 1, lng: 1 }, radiusMeters: 5 })).toBe(false);
    expect(isAreaShape(null)).toBe(false);
  });
});

describe('what the app keeps from Tracerfy', () => {
  const row = {
    address: '315 Grant St', city: 'Charlotte', state: 'NC', zip_code: '28207', latitude: 35.2, longitude: -80.8, apn: '1-2-3',
    property_type: 'SFR', year_built: 1998, building_size_sqft: 2233, stories: 2, roof_material: 'Composition Shingle', roof_construction: 'Gable',
    estimated_value: 474000, equity_percent: 58, years_owned: 20, last_sale_date: '2006-04-13',
    owner_1_first_name: 'MICHAEL', owner_1_last_name: 'BENNETT', owner_2_first_name: '', owner_2_last_name: '',
    mail_address: '315 Grant St', mail_city: 'Charlotte', mail_state: 'NC', mail_zip: '28207',
    primary_phone: '5399703934', primary_phone_type: 'Mobile', primary_phone_carrier: 'VERIZON', primary_phone_dnc: true, primary_phone_tcpa: false,
    mobile_1: '(425) 491-0999', mobile_1_dnc: false, mobile_1_tcpa: false, mobile_2: '', landline_1: '5395551212', landline_1_dnc: false, landline_1_tcpa: false,
    email_1: 'john77@yahoo.com', email_2: '', litigator: false, has_contact: true, contact_clean: false,
    absentee_owner: false, owner_occupied: true, vacant: false, free_clear: false, high_equity: true, mls_active: false,
    roof_renovate_propensity_score: 71, sell_propensity_score: 40, roof_renovate_propensity_factors: [{ name: 'year_built', points: 20, reason: 'Roof age' }],
  };
  it('flattens a lead row: phones deduped and flagged, owner joined, scores kept', () => {
    const e = mapLeadRow(row);
    expect(e.ownerName).toBe('MICHAEL BENNETT');
    expect(e.owner2Name).toBeNull();
    expect(e.phones.map((p) => p.number)).toEqual(['5399703934', '4254910999', '5395551212']);
    expect(e.phones[0]).toMatchObject({ dnc: true, type: 'Mobile', carrier: 'VERIZON' });
    expect(e.emails).toEqual([{ email: 'john77@yahoo.com', rank: 1 }]);
    expect(e.roofMaterial).toBe('Composition Shingle');
    expect(e.roofScore).toBe(71);
    expect(e.roofScoreFactors[0].reason).toBe('Roof age');
    expect(e.mailingAddress).toBe('315 Grant St, Charlotte, NC, 28207');
  });
  it('the number a rep may dial skips DNC and TCPA-flagged phones, mobile first', () => {
    const e = mapLeadRow(row);
    expect(bestCleanPhone(e.phones)?.number).toBe('4254910999');
    expect(bestCleanPhone([{ number: '1112223333', type: 'Mobile', carrier: null, dnc: true, tcpa: false }])).toBeNull();
    expect(bestCleanPhone([{ number: '1112223333', type: 'Landline', carrier: null, dnc: false, tcpa: false }, { number: '2223334444', type: 'Mobile', carrier: null, dnc: false, tcpa: false }])?.number).toBe('2223334444');
  });
  it('reads the single-address lookup, and a miss is null', () => {
    expect(mapPropertyLookup({ hit: false })).toBeNull();
    const e = mapPropertyLookup({ hit: true, property: { address: '1200 Queens Rd', city: 'Charlotte', state: 'NC', year_built: 2000, roof_material: 'Wood Shake', owners: [{ first_name: 'Cameron', last_name: 'Hunter' }], phones: [{ number: '718-691-3336', type: 'Mobile', dnc: false, tcpa: false, carrier: 'VERIZON', rank: 1 }], emails: [{ email: 'a@b.com', rank: 1 }], mailing_address: { street: '1 St', city: 'X', state: 'MO', zip: '1' }, roof_renovate_propensity_score: 34 } });
    expect(e?.ownerName).toBe('Cameron Hunter');
    expect(e?.phones[0].number).toBe('7186913336');
    expect(e?.mailingAddress).toBe('1 St, X, MO, 1');
    expect(e?.roofScore).toBe(34);
    // the shape the API actually returns: owners and contacts beside `property`
    const live = mapPropertyLookup({ hit: true, property: { address: '1200 Queens Rd', year_built: 2000, roof_renovate_propensity_score: 34 }, owners: [{ first_name: 'LARRY', last_name: 'RICHARDSON' }], mailing_address: { address: '1200 Queens Rd', city: 'Charlotte', state: 'NC', zip: '' }, contacts: { phones: [{ number: '2809411977', type: 'Mobile', dnc: true, tcpa: false }, { number: '8718897550', type: 'Mobile', dnc: false, tcpa: false }], emails: [{ email: 'ana55@gmail.com', rank: 1 }], litigator: false, contact_clean: false } });
    expect(live?.ownerName).toBe('LARRY RICHARDSON');
    expect(live?.phones.map((p) => p.number)).toEqual(['2809411977', '8718897550']);
    expect(bestCleanPhone(live!.phones)?.number).toBe('8718897550');
    expect(live?.emails[0].email).toBe('ana55@gmail.com');
    expect(live?.mailingAddress).toBe('1200 Queens Rd, Charlotte, NC');
  });
});
