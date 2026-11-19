import { describe, expect, it } from 'vitest';
import { EMAIL_LOOKS_WRONG, noteLabel, noteMessage, parseNativeContact, PHONE_LOOKS_WRONG } from '../native-job-page';

describe('a note in the client\'s messages', () => {
  it('is labelled by where it came from', () => {
    expect(noteLabel('roofli')).toBe('From Roof Lee');
    expect(noteLabel('archie')).toBe('Note');
    expect(noteLabel(null)).toBe('Note');
  });

  it('has the shape of the other messages, with who wrote it', () => {
    const at = new Date('2026-11-19T12:00:00Z');
    expect(noteMessage({ text: 'Gate code 4411', author: 'pat@example.test', authorName: 'Pat Office', system: 'archie', createdAt: at }))
      .toEqual({ source: 'archie', channel: 'note', direction: 'internal', label: 'Note', author: 'Pat Office', body: 'Pat Office: Gate code 4411', date: at.getTime() });
    expect(noteMessage({ text: 'Called back', author: 'lee@example.test', authorName: null, system: 'roofli', createdAt: at }))
      .toMatchObject({ source: 'roofli', label: 'From Roof Lee', author: 'lee@example.test', body: 'lee@example.test: Called back' });
  });
});

describe('a phone or email correction on a job Archie keeps', () => {
  it('changes only what was sent, and clears a field sent blank', () => {
    expect(parseNativeContact({ phone: '319-555-0142' })).toEqual({ ok: true, change: { phone: '319-555-0142' } });
    expect(parseNativeContact({ email: '', phone: '(319) 555 0142' })).toEqual({ ok: true, change: { email: null, phone: '(319) 555 0142' } });
    expect(parseNativeContact({})).toEqual({ ok: true, change: {} });
  });

  it('refuses one that does not look right, in plain words', () => {
    expect(parseNativeContact({ phone: 'call me' })).toEqual({ ok: false, error: PHONE_LOOKS_WRONG });
    expect(parseNativeContact({ email: 'pat at home' })).toEqual({ ok: false, error: EMAIL_LOOKS_WRONG });
  });
});
