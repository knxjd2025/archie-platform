import { describe, it, expect } from 'vitest';
import { addressKey, surnameOf, matchAppointment, type LinkableLead } from '../appointment-link';

const lead = (o: Partial<LinkableLead>): LinkableLead => ({
  externalId: 'x1', jobName: null, firstName: null, lastName: null,
  address: null, phone: null, email: null, ...o,
});

const KENT = lead({ externalId: 'k', jobName: 'A Kent 0523', firstName: 'Anthony', lastName: null, address: '15728 Guthrie Dr, Huntersville' });
const MCMILLAN = lead({ externalId: 'm', jobName: 'L McMillan 0520', firstName: 'Linda', lastName: 'McMillan', address: '550 Manning Dr, Charlotte, NC ' });
const BAKER = lead({ externalId: 'b', jobName: 'G Baker 0519', firstName: 'Greg', lastName: 'Baker', address: '3434 Nancy Creek Rd, Charlotte' });
const LEADS = [KENT, MCMILLAN, BAKER];

describe('addressKey', () => {
  it('reduces an address to house number + street word', () => {
    expect(addressKey('550 Manning Dr, Charlotte, NC ')).toBe('550 manning');
    expect(addressKey('137 Poplin Pl, Lake Wylie, SC 29710')).toBe('137 poplin');
  });

  it('survives formatting differences between the two systems', () => {
    // JobTread and Google Calendar disagree on suffixes, suites and zips.
    expect(addressKey('550 Manning Drive, Charlotte NC 28203'))
      .toBe(addressKey('550 Manning Dr, Charlotte, NC '));
  });

  it('returns null when there is no street number to anchor on', () => {
    for (const a of ['', null, undefined, 'Charlotte, NC', 'Zoom', 'Office']) {
      expect(addressKey(a)).toBeNull();
    }
  });
});

describe('surnameOf', () => {
  it('uses the surname field when present', () => {
    expect(surnameOf(MCMILLAN)).toBe('mcmillan');
  });

  it('falls back to the job-name pattern', () => {
    // Many leads have lastName null and the surname only in "A Kent 0523".
    expect(surnameOf(KENT)).toBe('kent');
  });

  it('ignores the literal string "null"', () => {
    // Seen in live data: firstName "Anthony", lastName the string "null".
    expect(surnameOf(lead({ lastName: 'null', jobName: 'A Kent 0523' }))).toBe('kent');
  });

  it('returns null when neither source yields a name', () => {
    expect(surnameOf(lead({ jobName: 'Some Random Job' }))).toBeNull();
    expect(surnameOf(lead({}))).toBeNull();
  });
});

describe('matchAppointment', () => {
  it('matches on address', () => {
    expect(matchAppointment({ title: 'Roof inspection', address: '550 Manning Dr' }, LEADS))
      .toEqual({ externalId: 'm', via: 'address' });
  });

  it('matches on surname in a customer-facing title', () => {
    expect(matchAppointment({ title: 'McMillan — adjuster meeting', address: null }, LEADS))
      .toEqual({ externalId: 'm', via: 'title' });
  });

  it('prefers the address when both signals disagree', () => {
    // The location is where the rep is actually going.
    expect(matchAppointment({ title: 'Baker follow-up', address: '550 Manning Dr' }, LEADS))
      .toEqual({ externalId: 'm', via: 'address' });
  });

  it('refuses to link internal meetings', () => {
    // Most of the real calendar is these. Linking one to a customer would put
    // a client record behind "Sales Meeting".
    for (const t of ['Sales Meeting', 'Leadership Meeting Virtual', 'Weekly Catch up', 'Drive Time', 'Home', 'Payday Reminder']) {
      expect(matchAppointment({ title: t, address: null }, LEADS), t).toBeNull();
    }
  });

  it('refuses an ambiguous address rather than guessing', () => {
    // A duplex or a repeat customer at one address must not resolve to an
    // arbitrary one of them — showing the wrong customer is worse than none.
    const twin = lead({ externalId: 'm2', address: '550 Manning Dr, Charlotte' });
    expect(matchAppointment({ title: 'Inspection', address: '550 Manning Dr' }, [...LEADS, twin])).toBeNull();
  });

  it('refuses an ambiguous surname', () => {
    const otherBaker = lead({ externalId: 'b2', lastName: 'Baker', address: '9 Other St' });
    expect(matchAppointment({ title: 'Baker roof', address: null }, [...LEADS, otherBaker])).toBeNull();
  });

  it('does not match a surname inside another word', () => {
    // "Kent" must not match "Kentucky".
    expect(matchAppointment({ title: 'Kentucky supplier call', address: null }, LEADS)).toBeNull();
  });

  it('ignores very short surnames as too collision-prone', () => {
    const shortName = lead({ externalId: 's', lastName: 'Ho', address: '1 A St' });
    expect(matchAppointment({ title: 'Ho inspection', address: null }, [shortName])).toBeNull();
  });

  it('returns null for an empty or unmatched appointment', () => {
    expect(matchAppointment({ title: null, address: null }, LEADS)).toBeNull();
    expect(matchAppointment({ title: 'Nobody we know', address: '1 Nowhere Ln' }, LEADS)).toBeNull();
  });
});
