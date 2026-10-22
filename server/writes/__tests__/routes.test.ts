import { describe, it, expect } from 'vitest';
import { normalizeReplyChannel, parseAppointment, appointmentEvent } from '../routes';

describe('normalizeReplyChannel', () => {
  it('accepts sms and email case-insensitively', () => {
    expect(normalizeReplyChannel('sms')).toBe('sms');
    expect(normalizeReplyChannel('SMS')).toBe('sms');
    expect(normalizeReplyChannel('Email')).toBe('email');
  });
  it('rejects anything else', () => {
    expect(normalizeReplyChannel('call')).toBeNull();
    expect(normalizeReplyChannel('')).toBeNull();
    expect(normalizeReplyChannel(undefined)).toBeNull();
    expect(normalizeReplyChannel(null)).toBeNull();
  });
});

describe('quick lead + appointment', () => {
  it('reads a slot only when it has a real date and time, clamping the duration', () => {
    expect(parseAppointment(undefined)).toBeNull();
    expect(parseAppointment({ date: '2026-09-16' })).toBeNull();
    expect(parseAppointment({ date: 'tomorrow', time: '09:00' })).toBeNull();
    expect(parseAppointment({ date: '2026-09-16', time: '09:00' })).toEqual({ date: '2026-09-16', time: '09:00', durationMins: 60, type: 'Inspection', notes: '' });
    expect(parseAppointment({ date: '2026-09-16', time: '09:00', durationMins: 5, type: ' Sales appointment ', notes: ' met at the door ' }))
      .toEqual({ date: '2026-09-16', time: '09:00', durationMins: 15, type: 'Sales appointment', notes: 'met at the door' });
  });

  it('builds the calendar event with the address, the type and who booked it', () => {
    const ev = appointmentEvent({ date: '2026-09-16', time: '09:00', durationMins: 90, type: 'Inspection', notes: 'Gate code 1234' }, { clientName: 'Pat Jones', address: '1200 Queens Rd, Charlotte', bookedBy: 'Joven' });
    expect(ev.summary).toBe('Inspection — Pat Jones');
    expect(ev.location).toBe('1200 Queens Rd, Charlotte');
    expect(ev.start).toEqual({ dateTime: '2026-09-16T09:00:00', timeZone: 'America/New_York' });
    expect(ev.end).toEqual({ dateTime: '2026-09-16T10:30:00', timeZone: 'America/New_York' });
    expect(ev.description).toBe('Gate code 1234\n\nBooked from the Team App by Joven.');
  });
});
