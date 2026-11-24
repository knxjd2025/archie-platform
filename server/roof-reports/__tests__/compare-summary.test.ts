/**
 * What a comparison is allowed to carry for one report: the roof's condition, its findings, its storm events,
 * its repair cost and its roof facts, read from the saved report, and nothing else. No customer, no notes, no photos.
 * Fictional: Summit Ridge Roofing's report for 12 Elm Street in Cedar Falls.
 */
import { describe, expect, it } from 'vitest';
import { makeReport } from '../../lib/roof-reports/__tests__/fixtures/report';
import { summaryOf, type SummaryRow } from '../compare-summary';

const row = (over: Partial<SummaryRow> = {}, report: unknown = makeReport()): SummaryRow => ({
  id: '11111111-1111-4111-8111-111111111111', title: 'Roof report, 12 Elm Street', address: '12 Elm Street', city: 'Cedar Falls',
  createdAt: new Date('2026-11-18T15:00:00.000Z'), totalEstimate: null, reportJson: report, ...over,
});

describe('one report, as a comparison reads it', () => {
  it('reads the condition, the storm events, the cost and the roof facts from the saved report', () => {
    const s = summaryOf(row({}, makeReport({
      roofConditionIndex: { overallScore: 72, grade: 'C', components: [] },
      roofDetails: { squares: 24, pitch: '6/12', stories: 2, material: 'asphalt_shingle', age_years: 12 },
    })));
    expect(s.condition).toEqual({ score: 72, grade: 'C', severity: 'medium' });
    expect(s.storm).toEqual({ events: 15, hail: 8, wind: 7, largestHailInches: 1.5, risk: 'medium', claimPotential: 'medium' });
    expect(s.cost).toBe(340);
    expect(s.measurements).toEqual({ squares: 24, pitch: '6/12', stories: 2, material: 'asphalt_shingle', ageYears: 12 });
    expect(s.address).toBe('12 Elm Street');
    expect(s.createdAt).toBe('2026-11-18T15:00:00.000Z');
  });

  it('uses the written findings, and the damage types only when there are none', () => {
    const written = summaryOf(row({}, makeReport({ structuredFindings: [
      { id: 'f0', title: 'Missing shingles', severity: 'high', narrative: 'ZZ-LONG-NARRATIVE', relatedPhotoIds: ['p'], repairAction: 'Replace', insuranceRelevant: true },
    ] as never })));
    expect(written.findings).toEqual([{ title: 'Missing shingles', severity: 'high' }]);
    expect(JSON.stringify(written)).not.toContain('ZZ-LONG-NARRATIVE');
    const fallback = summaryOf(row());
    expect(fallback.findings).toEqual([{ title: 'Hail impact', severity: 'high' }, { title: 'Wind lift', severity: 'medium' }]);
  });

  it('says "not known" (null) for what the report does not hold, never zero', () => {
    const s = summaryOf(row({}, { property: { address: '12 Elm Street' } }));
    expect(s.condition).toEqual({ score: null, grade: null, severity: null });
    expect(s.storm).toEqual({ events: null, hail: null, wind: null, largestHailInches: null, risk: null, claimPotential: null });
    expect(s.cost).toBeNull();
    expect(s.findings).toEqual([]);
    expect(s.measurements).toEqual({ squares: null, pitch: null, stories: null, material: null, ageYears: null });
    expect(summaryOf(row({}, null)).cost).toBeNull();
    expect(summaryOf(row({}, 'nonsense')).findings).toEqual([]);
  });

  it('takes the cost from the row when the report holds none, and treats a zero estimate as none', () => {
    expect(summaryOf(row({ totalEstimate: '1250.50' }, { repairEstimate: { total: 0 } })).cost).toBe(1250.5);
    expect(summaryOf(row({ totalEstimate: null }, { repairEstimate: { total: 0 } })).cost).toBeNull();
  });

  it('takes the size from the measurement part when the roof facts have none', () => {
    expect(summaryOf(row({}, { measurementReport: { totalSquares: 31.5 } })).measurements.squares).toBe(31.5);
  });

  it('never carries a name, an email, notes, photos or the long text', () => {
    const s = summaryOf(row({}, makeReport({
      customerName: 'Dana Whitfield', customerEmail: 'dana@example.com', inspectorNotes: 'ZZ-NOTES', executiveSummary: 'ZZ-SUMMARY',
    })));
    const text = JSON.stringify(s);
    for (const mark of ['Dana Whitfield', 'dana@example.com', 'ZZ-NOTES', 'ZZ-SUMMARY', 'photos', 'customer']) expect(text, mark).not.toContain(mark);
  });

  it('cuts a very long list and a very long title', () => {
    const many = Array.from({ length: 80 }, (_v, i) => ({ id: `f${i}`, title: `T${i} ${'x'.repeat(400)}`, severity: 'minor' }));
    const s = summaryOf(row({}, { structuredFindings: many }));
    expect(s.findings).toHaveLength(20);
    expect(s.findings[0].title.length).toBeLessThanOrEqual(120);
  });

  it('ignores a number that is not a number', () => {
    const s = summaryOf(row({}, { stormHistory: { totalEvents: 'lots', hailEvents: Infinity, windEvents: -3 }, roofConditionIndex: { overallScore: 'high', grade: 'Z' } }));
    expect(s.storm.events).toBeNull();
    expect(s.storm.hail).toBeNull();
    expect(s.storm.wind).toBeNull();
    expect(s.condition.score).toBeNull();
    expect(s.condition.grade).toBeNull();
  });
});
