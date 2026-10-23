import { describe, it, expect } from 'vitest';
import { MEASURES, MEASURE_BY_KEY, measureWindows } from '../measures';
import { etParts } from '../../../shared/schedule-board';

describe('the measure catalogue', () => {
  it('has a unique key per measure', () => {
    const keys = MEASURES.map((m) => m.key);
    expect(new Set(keys).size, `duplicate keys: ${keys.filter((k, i) => keys.indexOf(k) !== i)}`).toBe(keys.length);
    expect(MEASURE_BY_KEY.size).toBe(MEASURES.length);
  });

  it('gives every measure a room, a unit, a direction and a hint', () => {
    for (const m of MEASURES) {
      expect(['leadership', 'claims', 'sales'], `${m.key} room`).toContain(m.meeting);
      expect(['count', 'money', 'days'], `${m.key} unit`).toContain(m.unit);
      expect(['at_least', 'at_most'], `${m.key} direction`).toContain(m.direction);
      expect(m.hint.length, `${m.key} has no hint for whoever sets its goal`).toBeGreaterThan(10);
    }
  });

  it('points the counting measures the right way', () => {
    // A backlog going up is never good; work done going up never bad. Getting
    // one of these backwards silently inverts on/off track for that number.
    const shouldFall = ['overdue_followups', 'unassigned_jobs', 'claims_gone_quiet',
      'claims_waiting_carrier', 'emails_awaiting_reply', 'commission_blocked', 'claims_open'];
    const shouldRise = ['new_leads', 'sales_closed', 'revenue_closed',
      'customer_appts_run', 'customer_appts_booked'];
    for (const k of shouldFall) expect(MEASURE_BY_KEY.get(k)?.direction, k).toBe('at_most');
    for (const k of shouldRise) expect(MEASURE_BY_KEY.get(k)?.direction, k).toBe('at_least');
  });

  it('offers a per-rep reading exactly where one is meaningful', () => {
    // A rep can own their leads, their sales and their diary. "Open claims" is
    // the claims desk's number; splitting it per rep would put something on a
    // scorecard that nobody could act on.
    const perRep = MEASURES.filter((m) => m.computeForRep).map((m) => m.key).sort();
    expect(perRep).toEqual(['customer_appts_booked', 'customer_appts_run', 'new_leads', 'revenue_closed', 'sales_closed']);
    for (const k of ['claims_open', 'claims_gone_quiet', 'unassigned_jobs', 'commission_blocked']) {
      expect(MEASURE_BY_KEY.get(k)?.computeForRep, `${k} should have no per-rep reading`).toBeUndefined();
    }
  });

  it('never measures on a column the sync leaves empty', () => {
    // jobs_signed and value_signed were built on deals.signed_at, which is null
    // on every row, so they reported zero sales for ever. Nothing may come back
    // under those keys without a measure that actually reads something.
    expect(MEASURE_BY_KEY.has('jobs_signed')).toBe(false);
    expect(MEASURE_BY_KEY.has('value_signed')).toBe(false);
  });

  it('reports on the week that finished, not the one in progress', () => {
    // The windows are company days whatever timezone the server runs in — a
    // week that ends at Sunday midnight in the company's time zone is already Monday in UTC,
    // so these are asserted on company dates rather than on an ISO string.
    const local = (d: Date) => etParts(d).date;
    const w = measureWindows('2026-09-21');
    expect(local(w.last.from)).toBe('2026-09-14');
    expect(local(w.last.to)).toBe('2026-09-20');
    expect(local(w.prior.from)).toBe('2026-09-07');
    expect(local(w.prior.to)).toBe('2026-09-13');
    expect(w.lastDates).toEqual({ from: '2026-09-14', to: '2026-09-20' });
    // The Monday itself is outside the window: the pack reports a closed week.
    expect(w.last.to.getTime()).toBeLessThan(new Date('2026-09-21T04:00:00Z').getTime());
    expect(w.last.from.getTime()).toBeGreaterThan(w.prior.to.getTime());
  });

  it('runs Eastern midnight to Eastern midnight, not UTC (8pm Eastern)', () => {
    // On Vercel `new Date('…T00:00:00')` is UTC midnight, which started the
    // week at 8pm Sunday company time and dropped Sunday evening's leads.
    const w = measureWindows('2026-09-21');
    expect(w.last.from.toISOString()).toBe('2026-09-14T04:00:00.000Z');
    expect(w.last.to.toISOString()).toBe('2026-09-21T03:59:59.999Z');
  });

  it('keeps a whole company week across the end of daylight saving', () => {
    // DST ends Sunday 1 November 2026: the week starts on EDT and ends on EST.
    const w = measureWindows('2026-11-02');
    expect(w.last.from.toISOString()).toBe('2026-10-26T04:00:00.000Z');
    expect(w.last.to.toISOString()).toBe('2026-11-02T04:59:59.999Z');
  });
});
