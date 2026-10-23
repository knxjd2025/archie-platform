import { describe, it, expect, vi } from 'vitest';
// These tests exercise pure summary/status helpers; no database is needed.
vi.mock('../../db', () => ({ db: {} }));
import { isCanvassStatus, isStormOutage, summarizeStorm, CANVASS_STATUSES, isNewKnock } from '../routes';

describe('a NOAA outage is not a storm-free house', () => {
  it('flags a report where every source failed', () => {
    expect(isStormOutage({ data_quality: 'degraded', events: [] })).toBe(true);
  });
  it('lets real answers through, including a genuine "no storms"', () => {
    for (const q of ['verified', 'no_data', 'partial']) expect(isStormOutage({ data_quality: q })).toBe(false);
    expect(isStormOutage(null)).toBe(false);
  });
});

describe('canvass status', () => {
  it('accepts the known door outcomes', () => {
    for (const s of CANVASS_STATUSES) expect(isCanvassStatus(s)).toBe(true);
  });
  it('rejects anything else', () => {
    expect(isCanvassStatus('sold!')).toBe(false);
    expect(isCanvassStatus('')).toBe(false);
    expect(isCanvassStatus(undefined)).toBe(false);
    expect(isCanvassStatus(7)).toBe(false);
  });
});

describe('storm summary for the doorstep', () => {
  it('preserves provenance and unknown magnitudes without coercing null to zero', () => {
    const s = summarizeStorm({ generated_at: '2026-09-29T12:00:00Z', data_quality: 'partial', data_sources: ['NOAA'], search_radius_miles: 10, events: [{ event_type: 'Hail', date: '2026-09-01', hail_size_inches: null, distance_miles: 2, source: 'NOAA' }] });
    expect(s).toMatchObject({ dataQuality: 'partial', sources: ['NOAA'], searchRadiusMiles: 10, fetchedAt: '2026-09-29T12:00:00Z', maxHailSize: null });
    expect(s.events[0]).toMatchObject({ distanceMiles: 2, hailInches: null, windMph: null, source: 'NOAA' });
  });
  // The shape the storm service actually returns (StormEvent.event_type,
  // hail_size_inches, wind_speed_mph; StormReport.summary, .risk_assessment).
  // The previous fixture was written in a camelCase shape nothing produces,
  // which is why it passed while production saved "0 hail, 0 wind" for every
  // address.
  const report = {
    summary: { total_events: 4, hail_events: 2, wind_events: 1, largest_hail_inches: 1.75, highest_wind_mph: 68 },
    risk_assessment: { overall_risk: 'high' },
    events: [
      { event_type: 'Hail', hail_size_inches: 1.75, date: '2024-04-02' },
      { event_type: 'Hail', hail_size_inches: 1.0, date: '2023-05-11' },
      { event_type: 'Thunderstorm Wind', wind_speed_mph: 68, date: '2025-06-20' },
      { event_type: 'Tornado', date: '2022-03-01' },
    ],
  };

  it('splits hail from wind and reports the worst of each', () => {
    const s = summarizeStorm(report);
    expect(s.totalEvents).toBe(4);
    expect(s.hailEvents).toBe(2);
    expect(s.windEvents).toBe(1);
    expect(s.maxHailSize).toBe(1.75);
    expect(s.maxWindMph).toBe(68);
    expect(s.riskLevel).toBe('high');
  });

  it('reports the most recent event date', () => {
    expect(summarizeStorm(report).lastEventDate).toBe('2025-06-20');
  });

  it('works from the events alone when the report carries no summary block', () => {
    const s = summarizeStorm({ events: report.events });
    expect(s.totalEvents).toBe(4);
    expect(s.hailEvents).toBe(2);
    expect(s.windEvents).toBe(1);
    expect(s.maxHailSize).toBe(1.75);
    expect(s.maxWindMph).toBe(68);
    expect(s.riskLevel).toBeNull();
  });

  it('still reads a report cached in the older camelCase shape', () => {
    const s = summarizeStorm({
      riskLevel: 'medium',
      events: [{ type: 'Hail', hailSize: 2.5, date: '2024-04-02' }],
    });
    expect(s.hailEvents).toBe(1);
    expect(s.maxHailSize).toBe(2.5);
    expect(s.riskLevel).toBe('medium');
  });

  it('counts hurricane and tropical wind as wind, not as nothing', () => {
    const s = summarizeStorm({ events: [{ event_type: 'Hurricane', wind_speed_mph: 90, date: '2024-09-01' }] });
    expect(s.windEvents).toBe(1);
    expect(s.maxWindMph).toBe(90);
  });

  it('is empty rather than throwing on a report that failed', () => {
    for (const bad of [null, undefined, {}, { events: null }]) {
      const s = summarizeStorm(bad);
      expect([s.totalEvents, s.hailEvents, s.windEvents]).toEqual([0, 0, 0]);
      expect(s.maxHailSize).toBeNull();
      expect(s.lastEventDate).toBeNull();
    }
  });
});

describe('one door knock per visit', () => {
  const now = new Date('2026-10-15T23:00:00Z'); // 7pm Thursday in the company's time zone
  it('counts the first outcome at a house nobody had knocked', () => {
    expect(isNewKnock({ status: 'not_knocked', knockedAt: null }, 'no_answer', now)).toBe(true);
    expect(isNewKnock({ status: null, knockedAt: null }, 'interested', now)).toBe(true);
  });
  it('does not count changing the outcome on the same doorstep', () => {
    // "No answer" then "Interested" on the same visit used to log two doors.
    expect(isNewKnock({ status: 'no_answer', knockedAt: new Date('2026-10-15T22:50:00Z') }, 'interested', now)).toBe(false);
  });
  it('counts a return visit on a later company day', () => {
    expect(isNewKnock({ status: 'no_answer', knockedAt: new Date('2026-10-14T22:00:00Z') }, 'no_answer', now)).toBe(true);
  });
  it('treats 9pm and 10pm Eastern as the same evening, though UTC has rolled over', () => {
    const tenPm = new Date('2026-10-16T02:00:00Z');
    expect(isNewKnock({ status: 'no_answer', knockedAt: new Date('2026-10-16T01:00:00Z') }, 'interested', tenPm)).toBe(false);
  });
  it('never counts resetting a house to not knocked', () => {
    expect(isNewKnock({ status: 'no_answer', knockedAt: null }, 'not_knocked', now)).toBe(false);
  });
});
