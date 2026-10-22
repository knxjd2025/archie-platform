import { describe, it, expect } from 'vitest';
import {
  normalizeGoogleEvent, findConflicts, isCustomerFacing, conflictRef, calendarFindings,
  type CalEvent,
} from '../calendar-brain';

const MB = 'james@bestroofingnow.com';
const NOW = new Date('2026-07-23T12:00:00Z');
const h = (n: number) => new Date(NOW.getTime() + n * 3_600_000);

const ev = (over: Partial<CalEvent>): CalEvent => ({
  id: 'e1', mailbox: MB, title: 'Roof estimate', start: h(20), end: h(21),
  allDay: false, externalAttendees: [], hasAttendees: false, ...over,
});

describe('normalizeGoogleEvent', () => {
  it('parses a timed event', () => {
    const e = normalizeGoogleEvent({
      id: 'a', status: 'confirmed', summary: 'Estimate — Smith',
      start: { dateTime: '2026-07-24T14:00:00Z' }, end: { dateTime: '2026-07-24T15:00:00Z' },
      location: '123 Main St', attendees: [{ email: 'smith@gmail.com', responseStatus: 'accepted' }],
    }, MB);
    expect(e).not.toBeNull();
    expect(e!.allDay).toBe(false);
    expect(e!.externalAttendees).toEqual(['smith@gmail.com']);
  });

  it('flags all-day events and keeps internal attendees out of externalAttendees', () => {
    const e = normalizeGoogleEvent({
      id: 'b', summary: 'Crew day', start: { date: '2026-07-24' }, end: { date: '2026-07-25' },
      attendees: [{ email: 'thomas@bestroofingnow.com' }],
    }, MB);
    expect(e!.allDay).toBe(true);
    expect(e!.externalAttendees).toEqual([]);
    expect(e!.hasAttendees).toBe(true);
  });

  it('drops cancelled, owner-declined, transparent, and time-less events', () => {
    expect(normalizeGoogleEvent({ id: 'c', status: 'cancelled', start: { dateTime: '2026-07-24T14:00:00Z' }, end: { dateTime: '2026-07-24T15:00:00Z' } }, MB)).toBeNull();
    expect(normalizeGoogleEvent({ id: 'd', attendees: [{ email: MB, self: true, responseStatus: 'declined' }], start: { dateTime: '2026-07-24T14:00:00Z' }, end: { dateTime: '2026-07-24T15:00:00Z' } }, MB)).toBeNull();
    expect(normalizeGoogleEvent({ id: 'e', transparency: 'transparent', start: { dateTime: '2026-07-24T14:00:00Z' }, end: { dateTime: '2026-07-24T15:00:00Z' } }, MB)).toBeNull();
    expect(normalizeGoogleEvent({ id: 'f' }, MB)).toBeNull();
  });
});

describe('findConflicts', () => {
  const commit = { location: '123 Main St' };

  it('detects an overlap between two real commitments on the same calendar', () => {
    const a = ev({ id: 'a', start: h(1), end: h(3), ...commit });
    const b = ev({ id: 'b', start: h(2), end: h(4), hasAttendees: true });
    expect(findConflicts([a, b])).toHaveLength(1);
  });

  it('back-to-back events do not conflict', () => {
    const a = ev({ id: 'a', start: h(1), end: h(2), ...commit });
    const b = ev({ id: 'b', start: h(2), end: h(3), ...commit });
    expect(findConflicts([a, b])).toHaveLength(0);
  });

  it('all-day events never conflict', () => {
    const a = ev({ id: 'a', allDay: true, start: h(0), end: h(24), ...commit });
    const b = ev({ id: 'b', start: h(1), end: h(2), ...commit });
    expect(findConflicts([a, b])).toHaveLength(0);
  });

  it('bare time-blocks (no attendees, no location) never conflict — reminders and sprints are not bookings', () => {
    const block = ev({ id: 'a', start: h(1), end: h(3), title: 'Payday Reminder' });
    const real = ev({ id: 'b', start: h(2), end: h(4), ...commit });
    expect(findConflicts([block, real])).toHaveLength(0);
  });
});

describe('isCustomerFacing', () => {
  it('true with an external attendee', () => {
    expect(isCustomerFacing(ev({ externalAttendees: ['x@gmail.com'], hasAttendees: true }))).toBe(true);
  });
  it('false for internal-only meetings even with keywords', () => {
    expect(isCustomerFacing(ev({ title: 'Roof estimate sync', hasAttendees: true }))).toBe(false);
  });
  it('attendee-less events count only with a roofing keyword — location alone is not a signal', () => {
    expect(isCustomerFacing(ev({ title: 'Adjuster meeting — Jones' }))).toBe(true);
    expect(isCustomerFacing(ev({ title: 'Massage session', location: 'Massage Envy South Park' }))).toBe(false);
    expect(isCustomerFacing(ev({ title: 'Dentist' }))).toBe(false);
  });

  it('emoji-prefixed planning blocks are never customer-facing, even with keywords', () => {
    expect(isCustomerFacing(ev({ title: '💰 Pipeline Harvest — work the pending estimates' }))).toBe(false);
    expect(isCustomerFacing(ev({ title: '🔨 Site Sprint — 3 active sites' }))).toBe(false);
  });
});

describe('calendarFindings', () => {
  it('opens a conflict loop and a confirm loop, and keys match', () => {
    const a = ev({ id: 'a', start: h(20), end: h(22), title: 'Estimate — Smith', externalAttendees: ['smith@gmail.com'], hasAttendees: true });
    const b = ev({ id: 'b', start: h(21), end: h(23), title: 'Inspection — Jones', location: '9 Oak Ave' });
    const { loops, keys } = calendarFindings({ james: [a, b] }, NOW);
    const kinds = loops.map((l) => l.kind).sort();
    expect(kinds).toEqual(['appointment_conflict', 'appointment_stale_confirmed', 'appointment_stale_confirmed']);
    expect(keys.size).toBe(3);
    const confirm = loops.find((l) => l.kind === 'appointment_stale_confirmed' && l.sourceRef.endsWith(':a'))!;
    expect(confirm.contact).toEqual({ email: 'smith@gmail.com' });
    expect(confirm.owner).toBe('james');
    expect(confirm.urgency).toBe('urgent'); // 20h out — within 24h
  });

  it('ignores appointments beyond the 36h confirm window and past events', () => {
    const far = ev({ id: 'far', start: h(40), end: h(41), location: 'x' });
    const past = ev({ id: 'past', start: h(-3), end: h(-2), location: 'x' });
    const { loops } = calendarFindings({ james: [far, past] }, NOW);
    expect(loops).toHaveLength(0);
  });

  it('conflictRef is stable regardless of event order', () => {
    const a = ev({ id: 'zzz' });
    const b = ev({ id: 'aaa' });
    expect(conflictRef(MB, a, b)).toBe(conflictRef(MB, b, a));
  });
});
