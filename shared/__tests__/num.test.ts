import { describe, it, expect } from 'vitest';
import { num, roundCents } from '../num';

describe('num', () => {
  it('reads money the way people type it', () => {
    expect(num('1,234')).toBe(1234);
    expect(num('$12,500.50')).toBe(12500.5);
    expect(num(' 99 ')).toBe(99);
    expect(num('-$1,000')).toBe(-1000);
    expect(num('1,234,567.89')).toBe(1234567.89);
  });

  it('still returns 0 for what is not a number', () => {
    expect(num('abc')).toBe(0);
    expect(num(undefined)).toBe(0);
    expect(num(null)).toBe(0);
    expect(num(NaN)).toBe(0);
    expect(num(Infinity)).toBe(0);
    // A comma that is not a thousands separator is not guessed at.
    expect(num('1,5')).toBe(0);
    expect(num('12,34,567')).toBe(0);
  });

  it('passes plain numbers and numeric strings through', () => {
    expect(num(42)).toBe(42);
    expect(num('42.5')).toBe(42.5);
    expect(num('')).toBe(0);
  });
});

describe('roundCents', () => {
  it('rounds half up where Math.round(x * 100) / 100 rounds down', () => {
    expect(Math.round(1.005 * 100) / 100).toBe(1); // the bug being fixed
    expect(roundCents(1.005)).toBe(1.01);
    expect(roundCents(1234.565)).toBe(1234.57);
    expect(roundCents(0.1 + 0.2)).toBe(0.3);
  });

  it('rounds negatives away from zero and never returns -0', () => {
    expect(roundCents(-1.005)).toBe(-1.01);
    expect(Object.is(roundCents(-0.001), 0)).toBe(true);
  });

  it('is 0 for non-finite input', () => {
    expect(roundCents(NaN)).toBe(0);
    expect(roundCents(Infinity)).toBe(0);
  });
});
