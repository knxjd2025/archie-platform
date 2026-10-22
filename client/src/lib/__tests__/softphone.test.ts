import { describe, it, expect } from 'vitest';
import { prettyFrom, callClock, tokenRefreshDelay } from '../softphone';

describe('prettyFrom', () => {
  it('formats a US number a person can read aloud', () => {
    expect(prettyFrom('+17045551234')).toBe('(704) 555-1234');
    expect(prettyFrom('7045551234')).toBe('(704) 555-1234');
  });
  it('strips the client: prefix Twilio puts on browser-to-browser calls', () => {
    expect(prettyFrom('client:office')).toBe('office');
  });
  it('shows something rather than nothing when the caller withheld their number', () => {
    expect(prettyFrom('')).toBe('Unknown');
    expect(prettyFrom(null)).toBe('Unknown');
    expect(prettyFrom(undefined)).toBe('Unknown');
  });
  it('leaves an unfamiliar shape alone rather than mangling it', () => {
    expect(prettyFrom('+442071234567')).toBe('+442071234567');
  });
});

describe('callClock', () => {
  it('counts a call the way a phone does', () => {
    expect(callClock(0)).toBe('0:00');
    expect(callClock(9)).toBe('0:09');
    expect(callClock(60)).toBe('1:00');
    expect(callClock(372)).toBe('6:12');
  });
  it('keeps going past an hour rather than wrapping', () => {
    expect(callClock(3671)).toBe('61:11');
  });
});

describe('tokenRefreshDelay', () => {
  const now = Date.parse('2026-10-15T12:00:00Z');
  it('refreshes five minutes before an hour-long token lapses', () => {
    expect(tokenRefreshDelay('2026-10-15T13:00:00Z', now)).toBe(55 * 60_000);
  });
  it('waits at least a minute even when the token is nearly gone', () => {
    expect(tokenRefreshDelay('2026-10-15T12:02:00Z', now)).toBe(60_000);
    expect(tokenRefreshDelay('2026-10-15T11:00:00Z', now)).toBe(60_000);
  });
  it('refreshes soon rather than never when the expiry is missing or garbled', () => {
    expect(tokenRefreshDelay(undefined, now)).toBe(60_000);
    expect(tokenRefreshDelay('not a date', now)).toBe(60_000);
  });
});
