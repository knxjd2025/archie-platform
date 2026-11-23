/**
 * Every model call the photo analysis makes goes through the ModelCaller seam
 * (model-call.ts): so a cost row can be written for each one, the model id can
 * only be one written in models.ts, a failure says only that it failed, and the
 * request-wide deadline reaches every call. fetch is replaced and must never be
 * reached directly by this module.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  analyzeRoofImage,
  analyzeRoofImageWithGemini,
  analyzeRoofImageWithHaiku,
  analyzeRoofImageWithFallback,
  reanalyzeWithHints,
  classifyPhoto,
  correlateMultiImageFindings,
  analyzeAccessories,
  quickDamageCheck,
  type RoofAnalysisResult,
} from '../groq-vision';
import { ModelCallError, type ModelCallRequest, type ModelCaller } from '../model-call';
import { ROOF_REPORT_MODELS } from '../models';

const fetchMock = vi.fn(() => { throw new Error('direct fetch is not allowed here'); });
const IMG = 'data:image/png;base64,QUJD';
const PLAIN = 'This photo could not be analyzed.';

const DAMAGE_JSON = JSON.stringify({
  image_quality: 'good',
  roof_material: { type: 'asphalt_shingle', confidence: 90, characteristics: [] },
  damages: [{ type_id: 'hail_damage', name: 'Hail damage', category: 'hail', confidence: 80, severity: 'moderate', location: 'north slope', evidence: ['bruising'], insurance_worthy: true, repair_urgency: 'soon' }],
  overall_condition: 'fair',
  severity_score: 40,
  claim_recommended: true,
  summary: 'Hail damage seen.',
  recommendations: ['Repair'],
});
const CLEAN_JSON = JSON.stringify({ image_quality: 'good', damages: [], overall_condition: 'good', severity_score: 5, summary: 'Fine.' });

function recorder(reply: (r: ModelCallRequest) => string | Error = () => DAMAGE_JSON): { call: ModelCaller; calls: ModelCallRequest[] } {
  const calls: ModelCallRequest[] = [];
  const call: ModelCaller = async (request) => {
    calls.push(request);
    const out = reply(request);
    if (out instanceof Error) throw out;
    return { text: out, usage: { inputTokens: 10, outputTokens: 5 } };
  };
  return { call, calls };
}

let errorLog: string[];
beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockClear();
  errorLog = [];
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => { errorLog.push(args.map(String).join(' ')); });
  vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => { errorLog.push(args.map(String).join(' ')); });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('each call goes through the seam, once, with the right role', () => {
  it('analyzeRoofImage: the Groq vision role, the photo inline, JSON mode, a 45 s limit and the deadline', async () => {
    const { call, calls } = recorder();
    const deadline = new AbortController();
    const result = await analyzeRoofImage(IMG, '', { call, signal: deadline.signal });
    expect(result.success).toBe(true);
    expect(calls).toHaveLength(1);
    const r = calls[0];
    expect(r.role).toBe('visionAlternative'); // the default model is the alternative one
    expect(r.image).toEqual({ base64: 'QUJD', mediaType: 'image/png' });
    expect(r.json).toBe(true);
    expect(r.timeoutMs).toBe(45_000);
    expect(r.signal).toBe(deadline.signal);
    expect(r.system).toContain('Response Format');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('Gemini and Haiku each go through the seam with a limit and the deadline', async () => {
    const { call, calls } = recorder();
    const deadline = new AbortController();
    await analyzeRoofImageWithGemini(IMG, 'g', undefined, { call, signal: deadline.signal });
    await analyzeRoofImageWithHaiku(IMG, 'a', undefined, { call, signal: deadline.signal });
    expect(calls.map((c) => c.role)).toEqual(['visionFallback', 'visionLastResort']);
    for (const c of calls) {
      expect(c.timeoutMs).toBeGreaterThan(0);
      expect(c.timeoutMs).toBeLessThanOrEqual(60_000);
      expect(c.signal).toBe(deadline.signal);
      expect(c.image).toEqual({ base64: 'QUJD', mediaType: 'image/png' });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('the fallback runs all three providers on one photo, every call visible to a cost recorder', async () => {
    const { call, calls } = recorder();
    const result = await analyzeRoofImageWithFallback(IMG, '', 'g', { call }, 'a');
    expect(calls.map((c) => c.role).sort()).toEqual(['visionAlternative', 'visionFallback', 'visionLastResort']);
    expect(result.model_used).toContain('cross-validated');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('when the first provider finds nothing, the others are tried in turn through the seam', async () => {
    const { call, calls } = recorder((r) => (r.role === 'visionAlternative' ? CLEAN_JSON : DAMAGE_JSON));
    const result = await analyzeRoofImageWithFallback(IMG, '', 'g', { call }, 'a');
    expect(calls.map((c) => c.role)).toEqual(['visionAlternative', 'visionLastResort']);
    expect(result.damages_detected.length).toBeGreaterThan(0);
  });

  it('every other call in the module uses the seam too', async () => {
    const { call, calls } = recorder(() => JSON.stringify({ category: 'vent', confidence: 90, correlations: 'c', crossPhotoPatterns: ['p'], accessories_found: [] }));
    await reanalyzeWithHints(IMG, '', undefined, { focusDamageTypes: ['hail'] }, { call });
    await classifyPhoto(IMG, '', { call });
    const found: RoofAnalysisResult = {
      success: true, image_quality: 'good', roof_material: null, damages_detected: [JSON.parse(DAMAGE_JSON) && {
        damage_type_id: 'hail_damage', damage_name: 'Hail', category: 'hail', confidence: 80, severity: 'moderate', location_description: 'n',
        visual_evidence: [], haag_compliant: true, insurance_claim_worthy: true, repair_recommendation: 'r', estimated_urgency: 'soon',
      }], overall_condition: 'fair', overall_severity_score: 40, insurance_claim_recommended: true, summary: 's', detailed_findings: '', recommendations: [], model_used: 'm', processing_time_ms: 1,
    };
    await correlateMultiImageFindings([found, found], '', { call });
    await analyzeAccessories(IMG, '', { call });
    await quickDamageCheck(IMG, '', { call });
    expect(calls.map((c) => c.role)).toEqual(['visionAlternative', 'vision', 'vision', 'vision', 'vision']);
    for (const c of calls) expect(c.timeoutMs).toBeGreaterThan(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a result carries the tokens the seam returned, so a cost row can be written per call', async () => {
    const seen: Array<{ input: number; output: number }> = [];
    const { call } = recorder();
    const costing: ModelCaller = async (request) => {
      const result = await call(request);
      seen.push({ input: result.usage!.inputTokens, output: result.usage!.outputTokens });
      return result;
    };
    await analyzeRoofImageWithFallback(IMG, '', 'g', { call: costing }, 'a');
    expect(seen).toHaveLength(3);
  });
});

describe('options.model must be an id written in models.ts', () => {
  it('maps the two Groq vision ids to their roles', async () => {
    const { call, calls } = recorder();
    await analyzeRoofImage(IMG, '', { call, model: ROOF_REPORT_MODELS.vision.id });
    await analyzeRoofImage(IMG, '', { call, model: ROOF_REPORT_MODELS.visionAlternative.id });
    expect(calls.map((c) => c.role)).toEqual(['vision', 'visionAlternative']);
  });

  it.each(['gpt-4o', 'qwen/qwen3-32b', '', ROOF_REPORT_MODELS.visionFallback.id, ROOF_REPORT_MODELS.narrative.id, ' meta-llama/llama-4-scout-17b-16e-instruct'])(
    'refuses %j: nothing is called and the result says it failed plainly',
    async (model) => {
      const { call, calls } = recorder();
      const result = await analyzeRoofImage(IMG, '', { call, model: model as never });
      expect(result.success).toBe(false);
      expect(result.summary).toBe(PLAIN);
      expect(calls).toHaveLength(0);
      const again = await reanalyzeWithHints(IMG, '', undefined, { focusDamageTypes: [] }, { call, model: model as never });
      expect(again.success).toBe(false);
      expect(calls).toHaveLength(0);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );
});

describe('a failed result is a plain sentence, never the provider\'s words', () => {
  const SECRET = 'SECRET-PROVIDER-WORDS {"error":{"message":"your key sk-123 is wrong"}}';

  it.each([
    ['status error', new ModelCallError(500)],
    ['timeout', new ModelCallError(0, true)],
    ['a thrown error with provider text', new Error(SECRET)],
  ])('%s', async (_name, error) => {
    const { call } = recorder(() => error);
    const results = [
      await analyzeRoofImage(IMG, '', { call }),
      await analyzeRoofImageWithGemini(IMG, 'g', undefined, { call }),
      await analyzeRoofImageWithHaiku(IMG, 'a', undefined, { call }),
      await reanalyzeWithHints(IMG, '', undefined, { focusDamageTypes: [] }, { call }),
    ];
    for (const r of results) {
      expect(r.success).toBe(false);
      expect(r.summary).toBe(PLAIN);
      expect(JSON.stringify(r)).not.toMatch(/SECRET|sk-123|status 500|ModelCallError/);
      expect(r.raw_analysis ?? '').toBe('');
    }
    expect(errorLog.join('\n')).not.toMatch(/SECRET|sk-123/);
  });

  it('only a status reaches the log', async () => {
    const { call } = recorder(() => new ModelCallError(503));
    await analyzeRoofImage(IMG, '', { call });
    expect(errorLog.join('\n')).toContain('status 503');
  });

  it('end to end through the default caller: a 500 with an error body shows nothing of that body', async () => {
    fetchMock.mockImplementation((() => Promise.resolve(new Response(JSON.stringify({ error: { message: SECRET } }), { status: 500 }))) as never);
    const results = [
      await analyzeRoofImage(IMG, 'groq-key'),
      await analyzeRoofImageWithGemini(IMG, 'google-key'),
      await analyzeRoofImageWithHaiku(IMG, 'anthropic-key'),
    ];
    for (const r of results) {
      expect(r.summary).toBe(PLAIN);
      expect(JSON.stringify(r)).not.toContain('SECRET');
    }
    expect(errorLog.join('\n')).not.toContain('SECRET');
  });
});

describe('the deadline', () => {
  it('a photo whose deadline has passed is a plain failed result, never an exception', async () => {
    const { call } = recorder((r) => (r.signal?.aborted ? new ModelCallError(0, true) : DAMAGE_JSON));
    const result = await analyzeRoofImage(IMG, '', { call, signal: AbortSignal.abort() });
    expect(result.success).toBe(false);
    expect(result.summary).toBe(PLAIN);
  });
});
