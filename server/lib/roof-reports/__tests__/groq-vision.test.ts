/**
 * Hardening tests for `combineAnalysisResults` — the PURE merge step that
 * folds multiple per-image `RoofAnalysisResult` objects into one aggregate
 * report (deduping damages, averaging condition, summing severity, etc.).
 *
 * Two guarantees are locked in here:
 *  1. A WELL-FORMED array of results merges exactly as before (no behavior
 *     change for the happy path) — aggregate fields are finite and correct.
 *  2. MALFORMED input — a non-array, an empty array, or an array that
 *     contains null / partial result objects (missing `damages_detected`,
 *     non-finite `overall_severity_score`, missing `recommendations`, etc.)
 *     — does NOT throw, and yields a structurally valid result with finite
 *     aggregate scores.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  combineAnalysisResults,
  analyzeRoofImageWithFallback,
  type RoofAnalysisResult,
  type DamageDetection,
} from '../groq-vision';

// These tests must never reach a real model provider.
vi.stubGlobal('fetch', vi.fn(() => { throw new Error('no network in tests'); }));

function makeDamage(overrides: Partial<DamageDetection> = {}): DamageDetection {
  return {
    damage_type_id: 'missing_shingles',
    damage_name: 'Missing Shingles',
    category: 'structural' as DamageDetection['category'],
    confidence: 80,
    severity: 'severe',
    location_description: 'north slope',
    visual_evidence: ['exposed underlayment'],
    haag_compliant: true,
    insurance_claim_worthy: true,
    repair_recommendation: 'Replace affected shingles',
    estimated_urgency: 'soon',
    ...overrides,
  };
}

function makeResult(overrides: Partial<RoofAnalysisResult> = {}): RoofAnalysisResult {
  return {
    success: true,
    image_quality: 'good',
    roof_material: { type: 'asphalt_shingle', confidence: 90, characteristics: ['3-tab'] },
    damages_detected: [makeDamage()],
    overall_condition: 'fair',
    overall_severity_score: 50,
    insurance_claim_recommended: true,
    summary: 'one finding',
    detailed_findings: 'finding detail',
    recommendations: ['Get an inspection'],
    model_used: 'meta-llama/llama-4-scout-17b-16e-instruct',
    processing_time_ms: 1200,
    ...overrides,
  };
}

function assertValidResult(r: RoofAnalysisResult) {
  expect(r).toBeTruthy();
  expect(typeof r.success).toBe('boolean');
  expect(Array.isArray(r.damages_detected)).toBe(true);
  expect(Number.isFinite(r.overall_severity_score)).toBe(true);
  expect(Number.isFinite(r.processing_time_ms)).toBe(true);
  expect(typeof r.overall_condition).toBe('string');
  expect(r.overall_condition.length).toBeGreaterThan(0);
  expect(typeof r.insurance_claim_recommended).toBe('boolean');
  expect(Array.isArray(r.recommendations)).toBe(true);
  expect(typeof r.summary).toBe('string');
}

describe('combineAnalysisResults — well-formed input (no behavior change)', () => {
  it('merges two successful results into a valid aggregate', () => {
    const a = makeResult();
    const b = makeResult({
      damages_detected: [makeDamage({ damage_type_id: 'granule_loss', damage_name: 'Granule Loss', severity: 'moderate' })],
      overall_condition: 'poor',
      processing_time_ms: 800,
    });

    const combined = combineAnalysisResults([a, b]);

    assertValidResult(combined);
    expect(combined.success).toBe(true);
    // Two distinct damage types → two aggregated damages.
    expect(combined.damages_detected.length).toBe(2);
    // Processing time is the sum of inputs.
    expect(combined.processing_time_ms).toBe(2000);
    // Severity score is a finite 0-100 number.
    expect(combined.overall_severity_score).toBeGreaterThanOrEqual(0);
    expect(combined.overall_severity_score).toBeLessThanOrEqual(100);
    expect(combined.insurance_claim_recommended).toBe(true);
  });

  it('returns a safe empty aggregate when all results are unsuccessful', () => {
    const combined = combineAnalysisResults([makeResult({ success: false })]);
    assertValidResult(combined);
    expect(combined.success).toBe(false);
    expect(combined.damages_detected.length).toBe(0);
    expect(combined.overall_severity_score).toBe(0);
  });
});

describe('combineAnalysisResults — malformed input (hardening)', () => {
  it('does not throw and returns a safe default for a non-array input', () => {
    // @ts-expect-error — intentionally passing a non-array to test robustness.
    const combined = combineAnalysisResults(null);
    assertValidResult(combined);
    expect(combined.success).toBe(false);
    expect(combined.damages_detected.length).toBe(0);
  });

  it('does not throw and returns a safe default for undefined input', () => {
    // @ts-expect-error — intentionally passing undefined.
    const combined = combineAnalysisResults(undefined);
    assertValidResult(combined);
    expect(combined.success).toBe(false);
  });

  it('does not throw and returns a safe default for a non-array object', () => {
    // @ts-expect-error — intentionally passing a plain object.
    const combined = combineAnalysisResults({ foo: 'bar' });
    assertValidResult(combined);
    expect(combined.success).toBe(false);
  });

  it('does not throw and returns a safe default for an empty array', () => {
    const combined = combineAnalysisResults([]);
    assertValidResult(combined);
    expect(combined.success).toBe(false);
    expect(combined.overall_severity_score).toBe(0);
  });

  it('skips null / undefined entries and still merges the valid ones', () => {
    const valid = makeResult();
    // @ts-expect-error — intentionally interleaving null/undefined entries.
    const combined = combineAnalysisResults([null, valid, undefined]);
    assertValidResult(combined);
    expect(combined.success).toBe(true);
    expect(combined.damages_detected.length).toBe(1);
    expect(Number.isFinite(combined.processing_time_ms)).toBe(true);
  });

  it('handles a partial successful result missing damages_detected/recommendations without NaN', () => {
    const partial = {
      success: true,
      overall_condition: undefined, // missing → must not poison the average
      overall_severity_score: NaN, // non-finite → must not propagate
      // damages_detected, recommendations, processing_time_ms all missing
    } as unknown as RoofAnalysisResult;
    const valid = makeResult();

    const combined = combineAnalysisResults([partial, valid]);

    assertValidResult(combined);
    expect(Number.isFinite(combined.overall_severity_score)).toBe(true);
    expect(Number.isFinite(combined.processing_time_ms)).toBe(true);
    // The one valid result's damage still comes through.
    expect(combined.damages_detected.length).toBeGreaterThanOrEqual(1);
  });

  it('handles an array of only null entries as a safe empty aggregate', () => {
    // @ts-expect-error — intentionally all-null.
    const combined = combineAnalysisResults([null, null]);
    assertValidResult(combined);
    expect(combined.success).toBe(false);
    expect(combined.damages_detected.length).toBe(0);
    expect(combined.overall_severity_score).toBe(0);
  });
});

describe('combineAnalysisResults — undefined location_description and visual_evidence (hardening)', () => {
  it('does not throw when a damage is missing location_description and visual_evidence and a second result has a corroborating damage with the same damage_type_id', () => {
    // Result A has a damage with undefined location_description and undefined visual_evidence.
    const resultA = makeResult({
      damages_detected: [
        makeDamage({
          damage_type_id: 'hail_damage',
          damage_name: 'Hail Damage',
          location_description: undefined as unknown as string,
          visual_evidence: undefined as unknown as string[],
        }),
      ],
    });

    // Result B has a corroborating damage with the same damage_type_id — this
    // triggers the merge/dedup path that reads location_description on both
    // sides and the visual_evidence merge.
    const resultB = makeResult({
      damages_detected: [
        makeDamage({
          damage_type_id: 'hail_damage',
          damage_name: 'Hail Damage',
          location_description: 'north slope',
          visual_evidence: ['circular impact marks'],
        }),
      ],
    });

    // Must not throw — before the fix this throws
    // "Cannot read properties of undefined (reading 'toLowerCase')"
    const run = () => combineAnalysisResults([resultA, resultB]);
    expect(run).not.toThrow();

    const combined = run();
    assertValidResult(combined);
    // The single hail_damage entry should survive dedup
    expect(combined.damages_detected.length).toBeGreaterThanOrEqual(1);
    const hailDamage = combined.damages_detected.find(d => d.damage_type_id === 'hail_damage');
    expect(hailDamage).toBeDefined();
  });
});

describe('analyzeRoofImageWithFallback: US providers only, no silent success', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.stubGlobal('fetch', vi.fn(() => { throw new Error('no network in tests'); }));
    vi.restoreAllMocks();
  });

  it('reports failure when Groq and Google both answer with an error, and calls no other host', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: unknown) => {
      urls.push(String(input));
      return new Response(JSON.stringify({ error: { message: 'down' } }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      });
    }));

    const result = await analyzeRoofImageWithFallback(
      'data:image/jpeg;base64,AAAA',
      'groq-test-key',
      'google-test-key',
      {},
      undefined,
    );

    expect(result.success).toBe(false);
    expect(urls.length).toBeGreaterThanOrEqual(2);
    const hosts = new Set(urls.map((u) => new URL(u).host));
    expect([...hosts].sort()).toEqual(['api.groq.com', 'generativelanguage.googleapis.com']);
  });
});
