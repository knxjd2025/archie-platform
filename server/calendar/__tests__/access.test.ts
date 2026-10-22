import { describe, it, expect } from 'vitest';
import { calendarFor, visibleCalendars } from '../access';

const D = 'acme.test';
const OFFICE_CALENDAR = 'office@acme.test';

describe('whose calendar a booking lands on', () => {
  it('is the rep\'s own when they are an active roster member with a company mailbox', () => {
    expect(calendarFor('Jo@Acme.test', true, D, OFFICE_CALENDAR)).toBe('jo@acme.test');
    expect(calendarFor('toni@acme.test', true, D, OFFICE_CALENDAR)).toBe('toni@acme.test');
  });
  it('is the office calendar for anyone else', () => {
    expect(calendarFor('jo@acme.test', false, D, OFFICE_CALENDAR)).toBe(OFFICE_CALENDAR);
    expect(calendarFor('someone@gmail.com', true, D, OFFICE_CALENDAR)).toBe(OFFICE_CALENDAR);
    expect(calendarFor('', true, D, OFFICE_CALENDAR)).toBe(OFFICE_CALENDAR);
  });
});

describe('whose calendars a person sees', () => {
  it('follows the role scope unless the person is on the sees-all list', () => {
    expect(visibleCalendars('toni@acme.test', [], ['toni@acme.test'])).toEqual(['toni@acme.test']);
    expect(visibleCalendars('jo@acme.test', ['jo@acme.test'], ['jo@acme.test'])).toBeNull();
    expect(visibleCalendars('JO@acme.test', ['jo@acme.test'], [])).toBeNull();
    expect(visibleCalendars('jamie@acme.test', [], null)).toBeNull(); // admin already sees all
  });
});
