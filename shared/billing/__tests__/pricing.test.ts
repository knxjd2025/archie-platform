import { describe, it, expect } from 'vitest';
import {
  PRICING_EXAMPLES, billableSeats, describeQuote, formatDollars, quoteForSeats, seatsFromQuantities,
} from '../pricing';

const lines = (n: number) => quoteForSeats(n).lineItems.map((l) => [l.key, l.quantity, l.unitCents, l.totalCents]);

describe('pricing', () => {
  it('bills 0 seats as 1: Solo $149', () => {
    const q = quoteForSeats(0);
    expect(q).toMatchObject({ plan: 'solo', seats: 1, monthlyTotalCents: 14_900 });
    expect(lines(0)).toEqual([['solo_base', 1, 14_900, 14_900]]);
  });

  it('1 seat: Solo $149', () => {
    expect(quoteForSeats(1)).toMatchObject({ plan: 'solo', seats: 1, monthlyTotalCents: 14_900 });
    expect(lines(1)).toEqual([['solo_base', 1, 14_900, 14_900]]);
  });

  it('2 seats: Solo plus one extra at $99 = $248', () => {
    expect(quoteForSeats(2)).toMatchObject({ plan: 'solo', seats: 2, monthlyTotalCents: 24_800 });
    expect(lines(2)).toEqual([['solo_base', 1, 14_900, 14_900], ['solo_extra', 1, 9_900, 9_900]]);
  });

  it('3 seats: Team $299, no extras', () => {
    expect(quoteForSeats(3)).toMatchObject({ plan: 'team', seats: 3, monthlyTotalCents: 29_900 });
    expect(lines(3)).toEqual([['team_base', 1, 29_900, 29_900]]);
  });

  it('4 seats: Team plus one at $49 = $348', () => {
    expect(quoteForSeats(4)).toMatchObject({ plan: 'team', seats: 4, monthlyTotalCents: 34_800 });
    expect(lines(4)).toEqual([['team_base', 1, 29_900, 29_900], ['team_extra', 1, 4_900, 4_900]]);
  });

  it('5 seats = $397, 10 seats = $642, 50 seats = $2,602', () => {
    expect(quoteForSeats(5).monthlyTotalCents).toBe(39_700);
    expect(quoteForSeats(10)).toMatchObject({ plan: 'team', seats: 10, monthlyTotalCents: 64_200 });
    expect(lines(10)).toEqual([['team_base', 1, 29_900, 29_900], ['team_extra', 7, 4_900, 34_300]]);
    expect(quoteForSeats(50)).toMatchObject({ plan: 'team', seats: 50, monthlyTotalCents: 260_200 });
    expect(lines(50)).toEqual([['team_base', 1, 29_900, 29_900], ['team_extra', 47, 4_900, 230_300]]);
  });

  it('switches plan at the 2/3 line in both directions, and Solo never has more than 1 extra', () => {
    expect(quoteForSeats(2).plan).toBe('solo');
    expect(quoteForSeats(3).plan).toBe('team');
    for (let n = 0; n <= 60; n++) {
      const q = quoteForSeats(n);
      const extra = q.lineItems.find((l) => l.key === 'solo_extra')?.quantity ?? 0;
      expect(extra).toBeLessThanOrEqual(1);
      expect(q.lineItems.every((l) => l.quantity > 0)).toBe(true);
      expect(q.monthlyTotalCents).toBe(q.lineItems.reduce((s, l) => s + l.totalCents, 0));
      // Never cheaper for more people.
      if (n > 0) expect(q.monthlyTotalCents).toBeGreaterThanOrEqual(quoteForSeats(n - 1).monthlyTotalCents);
    }
  });

  it('treats nonsense as 1 seat and drops fractions', () => {
    expect(billableSeats(-3)).toBe(1);
    expect(billableSeats(Number.NaN)).toBe(1);
    expect(billableSeats(4.9)).toBe(4);
  });

  it('writes the bill out in one line', () => {
    expect(describeQuote(quoteForSeats(1))).toBe('Solo $149 = $149/month');
    expect(describeQuote(quoteForSeats(2))).toBe('Solo $149 + 1 extra person x $99 = $248/month');
    expect(describeQuote(quoteForSeats(3))).toBe('Team $299 (includes 3 people) = $299/month');
    expect(describeQuote(quoteForSeats(5))).toBe('Team $299 (includes 3 people) + 2 extra people x $49 = $397/month');
    expect(describeQuote(quoteForSeats(50))).toBe('Team $299 (includes 3 people) + 47 extra people x $49 = $2,602/month');
    for (const n of PRICING_EXAMPLES) expect(describeQuote(quoteForSeats(n))).not.toMatch(/[\u2014\u2013]/);
  });

  it('formats dollars', () => {
    expect(formatDollars(14_900)).toBe('$149');
    expect(formatDollars(260_200)).toBe('$2,602');
    expect(formatDollars(1_050)).toBe('$10.50');
  });

  it('reads seats back from subscription quantities', () => {
    for (const n of [1, 2, 3, 4, 10, 50]) {
      const q = quoteForSeats(n);
      const qty = Object.fromEntries(q.lineItems.map((l) => [l.key, l.quantity]));
      expect(seatsFromQuantities(qty)).toEqual({ plan: q.plan, seats: q.seats });
    }
    expect(seatsFromQuantities({})).toBeNull();
    expect(seatsFromQuantities({ solo_base: 1, team_base: 1 })).toBeNull();
  });
});
