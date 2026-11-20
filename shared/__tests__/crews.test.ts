import { describe, expect, it } from 'vitest';
import {
  addDays, checkCrewName, checkInstallBooking, countCrewSeats, crewMayMove, installDays, installSpanLabel,
  isCrewSeat, isIsoDate, isReschedule, mayScheduleCrews, milestoneForStatus, startTimeLabel, weekDates, weekStartOf,
  CREW_NAME_NEEDED, CREW_NOTES_TOO_LONG, END_BEFORE_START, INSTALL_TOO_LONG, PICK_CREW, PICK_INSTALL_DATE, PICK_START_TIME,
} from '../crews';

const crewId = '7d1f7c2e-4a1b-4c3d-9e8f-0a1b2c3d4e5f';

describe('install bookings', () => {
  it('takes a one day install and tidies what it was sent', () => {
    expect(checkInstallBooking({ crewId, installDate: '2026-11-23', endDate: '2026-11-23', startTime: '07:30', notes: '  Tear off and dry in.  ' }))
      .toEqual({ ok: true, value: { crewId, installDate: '2026-11-23', endDate: null, startTime: '07:30', notes: 'Tear off and dry in.' } });
  });

  it('takes a span of days and an empty start time', () => {
    expect(checkInstallBooking({ crewId, installDate: '2026-11-23', endDate: '2026-11-25', startTime: '' }))
      .toEqual({ ok: true, value: { crewId, installDate: '2026-11-23', endDate: '2026-11-25', startTime: null, notes: null } });
  });

  it('refuses in plain words', () => {
    expect(checkInstallBooking({ installDate: '2026-11-23' })).toEqual({ ok: false, error: PICK_CREW });
    expect(checkInstallBooking({ crewId, installDate: '2026-02-30' })).toEqual({ ok: false, error: PICK_INSTALL_DATE });
    expect(checkInstallBooking({ crewId, installDate: '2026-11-23', endDate: '2026-11-22' })).toEqual({ ok: false, error: END_BEFORE_START });
    expect(checkInstallBooking({ crewId, installDate: '2026-11-01', endDate: '2026-11-20' })).toEqual({ ok: false, error: INSTALL_TOO_LONG });
    expect(checkInstallBooking({ crewId, installDate: '2026-11-23', startTime: '7am' })).toEqual({ ok: false, error: PICK_START_TIME });
    expect(checkInstallBooking({ crewId, installDate: '2026-11-23', notes: 'x'.repeat(1001) })).toEqual({ ok: false, error: CREW_NOTES_TOO_LONG });
    expect(checkInstallBooking(null)).toEqual({ ok: false, error: PICK_CREW });
  });

  it('counts a new crew, day or time as scheduling again, and a note as not', () => {
    const before = { crewId, installDate: '2026-11-23', endDate: null, startTime: '07:00' };
    expect(isReschedule(null, before)).toBe(true);
    expect(isReschedule(before, { ...before })).toBe(false);
    expect(isReschedule(before, { ...before, installDate: '2026-11-24' })).toBe(true);
    expect(isReschedule(before, { ...before, startTime: null })).toBe(true);
  });
});

describe('statuses and milestones', () => {
  it('lets a crew move forward one step at a time only', () => {
    expect(crewMayMove('scheduled', 'in_progress')).toBe(true);
    expect(crewMayMove('in_progress', 'done')).toBe(true);
    expect(crewMayMove('scheduled', 'done')).toBe(false);
    expect(crewMayMove('done', 'scheduled')).toBe(false);
    expect(crewMayMove('done', 'done')).toBe(true);
  });

  it('records a start and a finish as milestones', () => {
    expect(milestoneForStatus('in_progress')).toBe('install_started');
    expect(milestoneForStatus('done')).toBe('install_done');
    expect(milestoneForStatus('scheduled')).toBeNull();
  });
});

describe('who', () => {
  it('lets office staff and up book crews, never a salesperson or a crew', () => {
    expect(['admin', 'sales_director', 'manager', 'customer_service'].every((r) => mayScheduleCrews(r as any))).toBe(true);
    expect(mayScheduleCrews('sales')).toBe(false);
    expect(mayScheduleCrews('production')).toBe(false);
    expect(mayScheduleCrews(undefined)).toBe(false);
  });

  it('counts crew sign-ins as active Production members who can sign in, for billing to read', () => {
    expect(isCrewSeat({ role: 'production', active: true, canLogin: true })).toBe(true);
    expect(isCrewSeat({ role: 'production', active: false, canLogin: true })).toBe(false);
    expect(isCrewSeat({ role: 'production', active: true, canLogin: false })).toBe(false);
    expect(isCrewSeat({ role: 'sales', active: true, canLogin: true })).toBe(false);
    expect(countCrewSeats([
      { role: 'production', active: true, canLogin: true },
      { role: 'production', active: true, canLogin: true },
      { role: 'customer_service', active: true, canLogin: true },
    ])).toBe(2);
  });
});

describe('dates', () => {
  it('reads only real calendar dates', () => {
    expect(isIsoDate('2026-11-23')).toBe(true);
    expect(isIsoDate('2026-13-01')).toBe(false);
    expect(isIsoDate('11/23/2026')).toBe(false);
  });

  it('starts a week on Monday, across a month and a year', () => {
    expect(weekStartOf('2026-11-23')).toBe('2026-11-23'); // a Monday
    expect(weekStartOf('2026-11-29')).toBe('2026-11-23'); // a Sunday
    expect(weekStartOf('2027-01-01')).toBe('2026-12-28');
    expect(weekDates('2026-11-23')).toEqual(['2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27', '2026-11-28', '2026-11-29']);
  });

  it('adds days across a daylight saving change without drifting', () => {
    expect(addDays('2026-11-01', 1)).toBe('2026-11-02');
    expect(addDays('2026-03-08', 1)).toBe('2026-03-09');
  });

  it('lists the days of an install and says them plainly', () => {
    expect(installDays({ installDate: '2026-11-30', endDate: '2026-12-02' })).toEqual(['2026-11-30', '2026-12-01', '2026-12-02']);
    expect(installDays({ installDate: '2026-11-30', endDate: null })).toEqual(['2026-11-30']);
    expect(installSpanLabel({ installDate: '2026-11-23', endDate: '2026-11-25' })).toBe('Mon, Nov 23 to Wed, Nov 25');
    expect(startTimeLabel('07:30')).toBe('7:30 AM');
    expect(startTimeLabel('12:05')).toBe('12:05 PM');
    expect(startTimeLabel('00:00')).toBe('12:00 AM');
    expect(startTimeLabel(null)).toBeNull();
  });

  it('names a crew in plain words', () => {
    expect(checkCrewName('  Red   crew ')).toEqual({ ok: true, value: 'Red crew' });
    expect(checkCrewName('   ')).toEqual({ ok: false, error: CREW_NAME_NEEDED });
  });
});
