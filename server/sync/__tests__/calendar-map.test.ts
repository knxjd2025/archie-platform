import { describe, it, expect } from 'vitest';
import { mapAppointment, classifyKind } from '../calendar-map';

describe('classifyKind', () => {
  it('detects inspections and adjuster meetings', () => {
    expect(classifyKind('Kate Worley - Inspection')).toBe('inspection');
    expect(classifyKind('Jeff Byrne Adjuster')).toBe('adjuster');
    expect(classifyKind('Leadership Meeting Virtual')).toBe('internal');
    expect(classifyKind('Randall Bond')).toBe('other');
  });
});

describe('mapAppointment', () => {
  it('maps a timed event with address + attendees', () => {
    const r = mapAppointment({ id: 'e1', summary: 'Kate Worley - Inspection', location: '3633 Conway Ave, Charlotte, NC',
      start: { dateTime: '2026-08-10T13:30:00-04:00' }, end: { dateTime: '2026-08-10T14:30:00-04:00' },
      attendees: [{ email: 'banning@bestroofingnow.com' }] }, 'banning@bestroofingnow.com')!;
    expect(r.sourceId).toBe('banning@bestroofingnow.com:e1');
    expect(r.title).toBe('Kate Worley - Inspection');
    expect(r.kind).toBe('inspection');
    expect(r.address).toContain('Conway');
    expect(r.attendees).toEqual(['banning@bestroofingnow.com']);
    expect(r.start).toBeInstanceOf(Date);
  });
  it('returns null when id or start is missing', () => {
    expect(mapAppointment({ summary: 'x' } as any, 'cal')).toBeNull();
    expect(mapAppointment({ id: 'e2' } as any, 'cal')).toBeNull();
  });
});
