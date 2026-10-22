import { describe, it, expect } from 'vitest';
import { calendarFor, visibleCalendars, OFFICE_CALENDAR } from '../access';

describe('whose calendar a booking lands on', () => {
  it('is the rep\'s own when they are an active roster member with a company mailbox', () => {
    expect(calendarFor('Joven@BestRoofingNow.com', true)).toBe('joven@bestroofingnow.com');
    expect(calendarFor('thomas@bestroofingnow.com', true)).toBe('thomas@bestroofingnow.com');
  });
  it('is the office calendar for anyone else', () => {
    expect(calendarFor('joven@bestroofingnow.com', false)).toBe(OFFICE_CALENDAR);
    expect(calendarFor('someone@gmail.com', true)).toBe(OFFICE_CALENDAR);
    expect(calendarFor('', true)).toBe(OFFICE_CALENDAR);
  });
});

describe('whose calendars a person sees', () => {
  it('follows the role scope unless the person is on the sees-all list', () => {
    expect(visibleCalendars('thomas@bestroofingnow.com', [], ['thomas@bestroofingnow.com'])).toEqual(['thomas@bestroofingnow.com']);
    expect(visibleCalendars('joven@bestroofingnow.com', ['joven@bestroofingnow.com'], ['joven@bestroofingnow.com'])).toBeNull();
    expect(visibleCalendars('JOVEN@bestroofingnow.com', ['joven@bestroofingnow.com'], [])).toBeNull();
    expect(visibleCalendars('james@bestroofingnow.com', [], null)).toBeNull(); // admin already sees all
  });
});
