/**
 * Unit tests for the report quality score — a new feature that grades how
 * complete/send-ready a roof report is (0-100 + letter grade) and returns
 * actionable next-step suggestions for whatever is missing.
 */
import { describe, it, expect } from 'vitest';
import {
  calculateReportQualityScore,
  scoreToGrade,
} from '../report-quality-scoring';
import type { NarrativeFinding } from '../comprehensive-roof-report';

function finding(overrides: Partial<NarrativeFinding> = {}): NarrativeFinding {
  return {
    id: 'f1',
    title: 'Finding',
    severity: 'moderate',
    narrative: 'A detailed narrative describing the observed damage.',
    relatedPhotoIds: [],
    repairAction: 'Repair the affected area.',
    insuranceRelevant: false,
    ...overrides,
  };
}

const completeInput = {
  findings: [finding({ id: 'a' }), finding({ id: 'b' }), finding({ id: 'c' })],
  photoCount: 6,
  executiveSummary: Array(30).fill('word').join(' '),
  inspectorNotes: 'Notes recorded by the inspector on site.',
  customerName: 'Jane Homeowner',
  hasStormData: true,
};

describe('scoreToGrade', () => {
  const VALID_GRADES = ['A', 'B', 'C', 'D', 'F'];

  it('maps scores to letter grades on standard thresholds', () => {
    expect(scoreToGrade(95)).toBe('A');
    expect(scoreToGrade(90)).toBe('A');
    expect(scoreToGrade(85)).toBe('B');
    expect(scoreToGrade(72)).toBe('C');
    expect(scoreToGrade(61)).toBe('D');
    expect(scoreToGrade(40)).toBe('F');
  });

  it('keeps in-range boundary scores unchanged after hardening', () => {
    // Boundary thresholds must not shift.
    expect(scoreToGrade(89)).toBe('B');
    expect(scoreToGrade(80)).toBe('B');
    expect(scoreToGrade(79)).toBe('C');
    expect(scoreToGrade(70)).toBe('C');
    expect(scoreToGrade(69)).toBe('D');
    expect(scoreToGrade(60)).toBe('D');
    expect(scoreToGrade(59)).toBe('F');
    expect(scoreToGrade(0)).toBe('F');
  });

  it('maps non-finite / nullish scores to the safe default lowest grade', () => {
    expect(scoreToGrade(NaN)).toBe('F');
    expect(scoreToGrade(undefined as any)).toBe('F');
    expect(scoreToGrade(null as any)).toBe('F');
    expect(scoreToGrade(Infinity as any)).toBe('A'); // clamped to 100 → top grade
    expect(scoreToGrade(-Infinity as any)).toBe('F');
  });

  it('clamps out-of-range scores into [0, 100]', () => {
    // Below 0 → lowest grade.
    expect(scoreToGrade(-10)).toBe('F');
    // Above 100 → top grade (clamped to 100).
    expect(scoreToGrade(150)).toBe('A');
    expect(scoreToGrade(101)).toBe('A');
  });

  it('always returns a defined valid grade for any input', () => {
    for (const s of [NaN, Infinity, -Infinity, undefined, null, -10, 150, 1e9] as any[]) {
      expect(VALID_GRADES).toContain(scoreToGrade(s));
    }
  });
});

describe('calculateReportQualityScore', () => {
  it('scores an empty report 0 / grade F with every dimension unmet', () => {
    const r = calculateReportQualityScore({});

    expect(r.overallScore).toBe(0);
    expect(r.grade).toBe('F');
    expect(r.dimensions.every((d) => !d.met)).toBe(true);
    expect(r.suggestions.length).toBeGreaterThan(0);
  });

  it('scores a fully complete report 100 / grade A with no suggestions', () => {
    const r = calculateReportQualityScore(completeInput);

    expect(r.overallScore).toBe(100);
    expect(r.grade).toBe('A');
    expect(r.suggestions).toEqual([]);
  });

  it('keeps the overall score within 0..100 even for extreme input', () => {
    const r = calculateReportQualityScore({ photoCount: 1000, findings: [finding()] });

    expect(r.overallScore).toBeGreaterThanOrEqual(0);
    expect(r.overallScore).toBeLessThanOrEqual(100);
  });

  it('increases the score as more of the report is filled in', () => {
    const empty = calculateReportQualityScore({}).overallScore;
    const withPhotos = calculateReportQualityScore({ photoCount: 6 }).overallScore;

    expect(withPhotos).toBeGreaterThan(empty);
  });

  it('suggests adding photos when none are present', () => {
    const r = calculateReportQualityScore({ ...completeInput, photoCount: 0 });

    expect(r.suggestions.some((s) => /photo/i.test(s))).toBe(true);
    expect(r.grade).not.toBe('A');
  });

  it('reports all six quality dimensions', () => {
    const r = calculateReportQualityScore({});

    expect(r.dimensions.map((d) => d.key).sort()).toEqual(
      ['customerInfo', 'executiveSummary', 'findings', 'inspectorNotes', 'photos', 'stormData'].sort(),
    );
  });
});
