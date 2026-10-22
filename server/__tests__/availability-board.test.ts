import { describe, it, expect } from 'vitest';
import { boardPeople, canBookOn, fromGhlEvent, fromGoogleEvent, sells } from '../calendar/board';

const roster = [
  { email: 'jamie@acme.test', name: 'Jamie Owner', role: 'admin', active: true, jobtreadSalesRep: 'Jamie Owner' },
  { email: 'toni@acme.test', name: 'Toni Reed', role: 'sales', active: true, jobtreadSalesRep: 'Toni Reed' },
  { email: 'admin@acme.test', name: 'Office Admin', role: 'admin', active: true, jobtreadSalesRep: null },
  { email: 'old@acme.test', name: 'Old Rep', role: 'sales', active: false, jobtreadSalesRep: 'Old Rep' },
  { email: 'someone@gmail.com', name: 'Outside', role: 'sales', active: true, jobtreadSalesRep: null },
];

describe('boardPeople', () => {
  it('shows the sales reps and the owner by default, office calendars on request', () => {
    expect(boardPeople(roster, null, new Set()).map((p) => p.name)).toEqual(['Jamie Owner', 'Outside', 'Toni Reed']);
    expect(boardPeople(roster, null, new Set(), true).map((p) => p.name)).toEqual(['Jamie Owner', 'Office Admin', 'Outside', 'Toni Reed']);
  });
  it('limits a scoped rep to the calendars they may see and flags each source', () => {
    const people = boardPeople(roster, ['toni@acme.test', 'someone@gmail.com'], new Set(['someone@gmail.com']), false, 'acme.test');
    expect(people).toEqual([
      { email: 'someone@gmail.com', name: 'Outside', role: 'sales', google: false, ghl: true, jobtreadSalesRep: null },
      { email: 'toni@acme.test', name: 'Toni Reed', role: 'sales', google: true, ghl: false, jobtreadSalesRep: 'Toni Reed' },
    ]);
  });
  it('counts a JobTread Sales Rep name as selling', () => {
    expect(sells({ role: 'admin', jobtreadSalesRep: 'Jamie Owner' })).toBe(true);
    expect(sells({ role: 'customer_service', jobtreadSalesRep: null })).toBe(false);
  });
});

describe('event mapping', () => {
  it('maps a Google event and skips cancelled or free-time ones', () => {
    expect(fromGoogleEvent({ id: '1', summary: 'Inspection — Smith', start: { dateTime: '2026-09-17T10:00:00-04:00' }, end: { dateTime: '2026-09-17T11:00:00-04:00' }, location: '1 Main St' }, 'a@x'))
      .toMatchObject({ id: 'google:a@x:1', source: 'google', start: '2026-09-17T14:00:00.000Z', end: '2026-09-17T15:00:00.000Z', allDay: false, kind: 'inspection', address: '1 Main St' });
    expect(fromGoogleEvent({ id: '2', status: 'cancelled', start: { dateTime: '2026-09-17T10:00:00Z' } }, 'a@x')).toBeNull();
    expect(fromGoogleEvent({ id: '3', transparency: 'transparent', start: { dateTime: '2026-09-17T10:00:00Z' } }, 'a@x')).toBeNull();
    expect(fromGoogleEvent({ id: '4', summary: 'Holiday', start: { date: '2026-09-17' }, end: { date: '2026-09-18' } }, 'a@x')?.allDay).toBe(true);
  });
  it('maps a GoHighLevel appointment and skips cancelled, no-show and deleted ones', () => {
    const base = { id: 'g1', title: 'Ashley Cole', startTime: '2026-09-10T09:30:00-04:00', endTime: '2026-09-10T11:00:00-04:00', appointmentStatus: 'confirmed', address: '4823 Antioch Church Rd' };
    expect(fromGhlEvent(base, 'claims@x')).toMatchObject({ id: 'ghl:g1', source: 'ghl', start: '2026-09-10T13:30:00.000Z', end: '2026-09-10T15:00:00.000Z', status: 'confirmed' });
    expect(fromGhlEvent({ ...base, appointmentStatus: 'cancelled' }, 'claims@x')).toBeNull();
    expect(fromGhlEvent({ ...base, appointmentStatus: 'noshow' }, 'claims@x')).toBeNull();
    expect(fromGhlEvent({ ...base, deleted: true }, 'claims@x')).toBeNull();
  });
});

describe('canBookOn', () => {
  it('lets anyone book on their own calendar and on calendars they can see', () => {
    expect(canBookOn({ email: 'Jo@acme.test' }, 'jo@acme.test', [])).toBe(true);
    expect(canBookOn({ email: 'jo@acme.test' }, 'toni@acme.test', null)).toBe(true);
    expect(canBookOn({ email: 'banning@acme.test' }, 'toni@acme.test', ['banning@acme.test'])).toBe(false);
  });
});
