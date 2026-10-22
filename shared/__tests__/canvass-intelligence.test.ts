import { describe, expect, it } from 'vitest';
import { assessLead, type IntelligenceInput, type StormEvidence } from '../canvass-intelligence';

const now = new Date('2026-09-29T12:00:00Z');
const empty: IntelligenceInput = { status: 'not_knocked', labels: [], stormSummary: null, measurements: null };
const event: StormEvidence = { date: '2026-09-01', type: 'Hail', distanceMiles: 0.5, hailInches: 2, windMph: null, source: 'NOAA' };
const property = (events = [event]): IntelligenceInput => ({ ...empty, stormSummary: { totalEvents: events.length, fetchedAt: now.toISOString(), dataQuality: 'verified', events } });

describe('canvass lead priority', () => {
  it('keeps an unresearched property unscored rather than declaring low risk', () => {
    expect(assessLead(empty, null, now)).toMatchObject({ score: null, coverage: 0, priority: 'Needs data' });
  });
  it('combines independent signals and stays within 100 points', () => {
    expect(assessLead({ ...property(), status: 'appointment' }, { roofScore: 100 }, now).score).toBe(100);
  });
  it('discounts distance and age on the same event, without combining unrelated maxima', () => {
    const near = assessLead(property(), null, now).score!;
    expect(assessLead(property([{ ...event, distanceMiles: 9 }]), null, now).score).toBeLessThan(near);
    expect(assessLead(property([{ ...event, date: '2024-09-01' }]), null, now).score).toBeLessThan(near);
  });
  it('does not stack duplicate reports or count missing distances and future events', () => {
    expect(assessLead(property([event, event]), null, now).score).toBe(40);
    expect(assessLead(property([{ ...event, distanceMiles: null }, { ...event, date: '2027-01-01' }]), null, now).score).toBe(0);
  });
  it('handles wind independently of hail', () => {
    expect(assessLead(property([{ ...event, type: 'Thunderstorm Wind', hailInches: null, windMph: 80 }]), null, now).score).toBe(40);
  });
  it('discounts partial coverage and refuses stale, legacy, or failed storm data', () => {
    const p = property();
    p.stormSummary!.dataQuality = 'partial';
    expect(assessLead(p, null, now).score).toBe(30);
    p.stormSummary!.dataQuality = 'degraded';
    expect(assessLead(p, null, now).score).toBeNull();
    p.stormSummary!.dataQuality = 'verified'; p.stormSummary!.fetchedAt = '2020-01-01';
    expect(assessLead(p, null, now).score).toBeNull();
    delete p.stormSummary!.fetchedAt;
    expect(assessLead(p, null, now).score).toBeNull();
  });
  it('suppresses prospecting for excluded properties even with strong signals', () => {
    for (const status of ['sold', 'not_interested']) expect(assessLead({ ...property(), status }, { roofScore: 100 }, now).score).toBe(0);
    expect(assessLead({ ...property(), labels: ['do not knock'] }, { roofScore: 100 }, now).priority).toBe('Not a prospecting target');
  });
  it('does not give sales points for having measurements or invalid propensity', () => {
    expect(assessLead({ ...empty, measurements: { roofAreaSqFt: 2500, confidence: 'high', imageryDate: 'Jan 2026' } }, { roofScore: NaN }, now).score).toBeNull();
  });
});
