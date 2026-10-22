import { describe, it, expect } from 'vitest';
import { calendarWindow, shapeEvent } from '../calendar-tools';

const NOW = new Date('2026-09-06T15:00:00.000Z');
const WEEK_LATER = '2026-09-13T15:00:00.000Z';

describe('calendarWindow', () => {
  it('defaults to now through a week out', () => {
    expect(calendarWindow(undefined, undefined, NOW)).toEqual({
      timeMin: NOW.toISOString(),
      timeMax: WEEK_LATER,
    });
  });

  it('honours an explicit window', () => {
    const w = calendarWindow('2026-09-07T00:00:00Z', '2026-09-08T00:00:00Z', NOW);
    expect(w.timeMin).toBe('2026-09-07T00:00:00.000Z');
    expect(w.timeMax).toBe('2026-09-08T00:00:00.000Z');
  });

  it('falls back to a sane week when the model sends prose', () => {
    // Models pass things like "next Tuesday". new Date() gives Invalid Date,
    // whose toISOString() throws — which would fail the whole chat turn.
    for (const junk of ['next Tuesday', '', 'tomorrow', 'not-a-date']) {
      const w = calendarWindow(junk, junk, NOW);
      expect(w.timeMin, junk).toBe(NOW.toISOString());
      expect(w.timeMax, junk).toBe(WEEK_LATER);
    }
  });

  it('widens a backwards window instead of returning nothing', () => {
    // to-before-from returns zero events from Google, which the assistant would
    // report as "you have nothing scheduled" — the worst possible wrong answer.
    const w = calendarWindow('2026-09-10T00:00:00Z', '2026-09-01T00:00:00Z', NOW);
    expect(w.timeMin).toBe('2026-09-10T00:00:00.000Z');
    expect(w.timeMax).toBe('2026-09-17T00:00:00.000Z');
  });

  it('treats an equal from/to as backwards and widens it', () => {
    const w = calendarWindow('2026-09-10T00:00:00Z', '2026-09-10T00:00:00Z', NOW);
    expect(w.timeMax).toBe('2026-09-17T00:00:00.000Z');
  });
});

describe('shapeEvent', () => {
  it('shapes a normal timed event', () => {
    expect(
      shapeEvent({
        summary: 'Roof inspection — Ballantyne',
        location: '123 Main St',
        start: { dateTime: '2026-09-07T14:00:00-04:00' },
        end: { dateTime: '2026-09-07T15:00:00-04:00' },
        attendees: [{ email: 'cust@example.com' }, { email: null }],
      }),
    ).toEqual({
      title: 'Roof inspection — Ballantyne',
      start: '2026-09-07T14:00:00-04:00',
      end: '2026-09-07T15:00:00-04:00',
      allDay: false,
      location: '123 Main St',
      attendees: ['cust@example.com'],
    });
  });

  it('marks a date-only event as all day', () => {
    const e = shapeEvent({ summary: 'PTO', start: { date: '2026-09-09' }, end: { date: '2026-09-10' } });
    expect(e?.allDay).toBe(true);
    expect(e?.start).toBe('2026-09-09');
  });

  it('drops cancelled events', () => {
    // Still returned by events.list; reporting them would have the assistant
    // tell a rep about an appointment the customer already cancelled.
    expect(shapeEvent({ summary: 'Cancelled call', status: 'cancelled', start: { dateTime: '2026-09-07T14:00:00Z' } })).toBeNull();
  });

  it('drops events with no start rather than emitting a bad row', () => {
    expect(shapeEvent({ summary: 'Broken' })).toBeNull();
    expect(shapeEvent({ summary: 'Broken', start: {} })).toBeNull();
  });

  it('names an untitled event instead of showing a blank line', () => {
    expect(shapeEvent({ start: { dateTime: '2026-09-07T14:00:00Z' } })?.title).toBe('(no title)');
  });

  it('omits location when absent and never returns null attendees', () => {
    const e = shapeEvent({ summary: 'Call', start: { dateTime: '2026-09-07T14:00:00Z' } });
    expect(e?.location).toBeUndefined();
    expect(e?.attendees).toEqual([]);
  });
});
