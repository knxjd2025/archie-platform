import { describe, expect, it } from 'vitest';
import type { ReportSummary } from '../../../../shared/roof-reports';
import { buildComparison, toggleSelected, MAX_SELECTED, compareHint } from '../compare-model';

const summary = (over: Partial<ReportSummary> = {}): ReportSummary => ({
  id: '11111111-1111-4111-8111-111111111111', title: null, address: '12 Elm Street', city: 'Cedar Falls', createdAt: '2026-11-18T15:00:00.000Z',
  condition: { score: 72, grade: 'C', severity: 'medium' },
  findings: [{ title: 'Missing shingles', severity: 'high' }, { title: 'Chimney flashing', severity: 'low' }],
  storm: { events: 15, hail: 8, wind: 7, largestHailInches: 1.5, risk: 'medium', claimPotential: 'medium' },
  cost: 340,
  measurements: { squares: 24, pitch: '6/12', stories: 2, material: 'asphalt_shingle', ageYears: 12 },
  ...over,
});
const A = summary();
const B = summary({
  id: '22222222-2222-4222-8222-222222222222', address: '40 Birch Lane',
  condition: { score: 44, grade: 'D', severity: 'high' },
  findings: [{ title: 'missing shingles ', severity: 'critical' }, { title: 'Cracked vent boot', severity: 'minor' }],
  storm: { events: 4, hail: 1, wind: 3, largestHailInches: null, risk: 'low', claimPotential: 'low' },
  cost: 9000, measurements: { squares: 31, pitch: '8/12', stories: 2, material: 'metal', ageYears: null },
});
const rowOf = (c: ReturnType<typeof buildComparison>, label: string) => c.sections.flatMap((s) => s.rows).find((r) => r.label === label)!;

describe('two reports side by side', () => {
  const c = buildComparison(A, B);

  it('has the five parts: condition, findings, storm events, cost and measurements', () => {
    expect(c.sections.map((s) => s.title)).toEqual(['Condition', 'Findings', 'Storm events', 'Cost', 'Roof facts']);
    expect(c.columns).toEqual([
      { label: 'Report A', address: '12 Elm Street, Cedar Falls', date: 'Nov 18, 2026' },
      { label: 'Report B', address: '40 Birch Lane, Cedar Falls', date: 'Nov 18, 2026' },
    ]);
  });

  it('says every difference in words, not only in colour', () => {
    for (const row of c.sections.flatMap((s) => s.rows)) {
      expect(row.note, row.label).toMatch(/\w/);
      if (row.difference === 'different') expect(row.note, row.label).not.toBe('Same');
    }
    expect(rowOf(c, 'Condition score')).toMatchObject({ a: '72 out of 100', b: '44 out of 100', difference: 'different', note: 'Report A is higher by 28 points' });
    expect(rowOf(c, 'Estimated repair cost')).toMatchObject({ a: '$340', b: '$9,000', difference: 'different', note: 'Report B is higher by $8,660' });
    expect(rowOf(c, 'Roof material')).toMatchObject({ a: 'Asphalt shingle', b: 'Metal', difference: 'different', note: 'Different' });
    expect(rowOf(c, 'Stories')).toMatchObject({ a: '2', b: '2', difference: 'same', note: 'Same' });
  });

  it('marks the better score with colour as well, and nothing else is called better', () => {
    expect(rowOf(c, 'Condition score').tone).toEqual({ a: 'good', b: 'bad' });
    for (const row of c.sections.flatMap((s) => s.rows).filter((r) => r.label !== 'Condition score')) expect(row.tone, row.label).toEqual({ a: 'plain', b: 'plain' });
    expect(buildComparison(B, A).sections[0].rows[0].tone).toEqual({ a: 'bad', b: 'good' });
    expect(rowOf(buildComparison(A, A), 'Condition score').tone).toEqual({ a: 'plain', b: 'plain' });
  });

  it('says plainly what one report does not hold, and never shows it as zero', () => {
    expect(rowOf(c, 'Largest hail')).toMatchObject({ a: '1.5 inches', b: 'Not known', difference: 'different', note: 'Not known for report B' });
    expect(rowOf(c, 'Roof age')).toMatchObject({ a: 'About 12 years', b: 'Not known', note: 'Not known for report B' });
    const none = buildComparison(summary({ cost: null }), summary({ cost: null }));
    expect(rowOf(none, 'Estimated repair cost')).toMatchObject({ a: 'Not known', b: 'Not known', difference: 'unknown', note: 'Not known for either report' });
    for (const row of c.sections.flatMap((s) => s.rows)) { expect(row.a).not.toMatch(/\bnull\b|undefined|NaN/); expect(row.b).not.toMatch(/\bnull\b|undefined|NaN/); }
  });

  it('matches findings by their title, whatever the case or spacing, and says what each one has', () => {
    expect(c.findings.both).toEqual([{ title: 'Missing shingles', a: 'high', b: 'critical', note: 'In both. Report A rates it high and report B rates it critical.' }]);
    expect(c.findings.onlyA).toEqual([{ title: 'Chimney flashing', severity: 'low' }]);
    expect(c.findings.onlyB).toEqual([{ title: 'Cracked vent boot', severity: 'minor' }]);
    const same = buildComparison(A, A).findings;
    expect(same.both.map((f) => f.note)).toEqual(['In both, rated the same.', 'In both, rated the same.']);
    expect(same.onlyA).toEqual([]);
    expect(rowOf(c, 'Findings')).toMatchObject({ a: '2', b: '2', difference: 'same' });
  });

  it('sums up how many rows differ, in a sentence', () => {
    expect(c.summary).toMatch(/^These two reports differ in \d+ of \d+ things we could compare\.$/);
    expect(buildComparison(A, A).summary).toBe('These two reports match on everything we could compare.');
  });

  it('writes no long dash and no code', () => {
    const text = JSON.stringify(c);
    expect(text).not.toMatch(/—|undefined|NaN|\[object/);
  });
});

describe('picking two reports in the list', () => {
  it('takes a second, drops one that is picked again, and never holds more than two', () => {
    expect(MAX_SELECTED).toBe(2);
    expect(toggleSelected([], 'a')).toEqual(['a']);
    expect(toggleSelected(['a'], 'b')).toEqual(['a', 'b']);
    expect(toggleSelected(['a', 'b'], 'a')).toEqual(['b']);
    expect(toggleSelected(['a', 'b'], 'c')).toEqual(['a', 'b']);
  });

  it('tells the person what to do next', () => {
    expect(compareHint(0)).toBe('Pick two finished reports to compare them.');
    expect(compareHint(1)).toBe('Pick one more report to compare.');
    expect(compareHint(2)).toBe('Two reports picked.');
  });
});
