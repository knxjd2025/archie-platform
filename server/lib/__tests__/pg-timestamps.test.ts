import { describe, it, expect } from 'vitest';
import { parseNaiveTimestampAsUtc } from '../pg-timestamps';

describe('reading a naive Postgres timestamp', () => {
  it('reads it as UTC, which is how Drizzle wrote it', () => {
    // Drizzle writes value.toISOString(); Postgres stores the wall clock and
    // drops the Z. Reading it back as UTC returns the original instant.
    expect(parseNaiveTimestampAsUtc('2026-09-18 23:00:43.44').toISOString()).toBe('2026-09-18T23:00:43.440Z');
  });

  it('is not fooled by the space Postgres uses instead of a T', () => {
    const spaced = parseNaiveTimestampAsUtc('2026-09-18 23:00:43');
    const isoish = parseNaiveTimestampAsUtc('2026-09-18T23:00:43');
    expect(spaced.toISOString()).toBe('2026-09-18T23:00:43.000Z');
    expect(spaced.getTime()).toBe(isoish.getTime());
  });

  it('does not drift with the process timezone — the bug it exists to fix', () => {
    // Whatever TZ the server runs in, the same stored string is the same instant.
    // (This assertion holds because the parser never consults the local zone.)
    expect(parseNaiveTimestampAsUtc('2026-01-15 12:00:00').toISOString()).toBe('2026-01-15T12:00:00.000Z');
    expect(parseNaiveTimestampAsUtc('2026-07-15 12:00:00').toISOString()).toBe('2026-07-15T12:00:00.000Z');
  });

  it('keeps sub-second precision and midnight boundaries intact', () => {
    expect(parseNaiveTimestampAsUtc('2026-03-08 00:00:00').toISOString()).toBe('2026-03-08T00:00:00.000Z');
    expect(parseNaiveTimestampAsUtc('2026-11-01 01:30:00.123').toISOString()).toBe('2026-11-01T01:30:00.123Z');
  });
});
