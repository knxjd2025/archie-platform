/**
 * Security regression test for the report-narrator Claude prompt builder.
 *
 * `buildNarratorPrompt` interpolates user/vision-derived text (inspector notes,
 * damage descriptions/types, AI photo summaries, roof details) into a Claude
 * prompt. Those fields are untrusted — a malicious inspector note or a
 * vision-derived description could embed ASCII control characters (terminal
 * escapes, NUL/BEL) or be arbitrarily long to attempt prompt injection or to
 * blow out the prompt budget.
 *
 * These tests assert each interpolated field is stripped of control chars and
 * length-capped in the built prompt, while ordinary text is left untouched so
 * the narration for normal inputs does not change.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  buildNarratorPrompt,
  generateNarrativeWithClaude,
  rewriteFindingWithClaude,
  ruleBasedNarrative,
} from '../claude-report-narrator';
import { ROOF_REPORT_MODELS } from '../models';
import type { ModelCaller } from '../model-call';
import type {
  AnalyzedPhoto,
  DamageAnalysisSection,
} from '../comprehensive-roof-report';

// Minimal damage-analysis section — only the fields the prompt builder reads.
function baseDamageAnalysis(): DamageAnalysisSection {
  return {
    totalPhotosAnalyzed: 2,
    photosWithDamage: 1,
    overallSeverity: 'medium',
    damageTypes: [],
  } as unknown as DamageAnalysisSection;
}

function photo(over: Partial<AnalyzedPhoto>): AnalyzedPhoto {
  return {
    id: 'photo-0',
    url: 'https://example.com/p.jpg',
    aiSummary: '',
    damages: [],
    ...over,
  } as unknown as AnalyzedPhoto;
}

describe('buildNarratorPrompt — prompt-injection / control-char hardening', () => {
  it('strips ASCII control characters from inspector notes', () => {
    const prompt = buildNarratorPrompt({
      analyzedPhotos: [],
      damageAnalysis: baseDamageAnalysis(),
      inspectorNotes: 'Check\x07 ridge\x00 cap\x1b[31m here',
    });
    expect(prompt).toContain('Check ridge cap[31m here');
    expect(prompt).not.toContain('\x07');
    expect(prompt).not.toContain('\x00');
    expect(prompt).not.toContain('\x1b');
  });

  it('caps an oversized inspector note embedded in the prompt', () => {
    const huge = 'A'.repeat(50_000);
    const prompt = buildNarratorPrompt({
      analyzedPhotos: [],
      damageAnalysis: baseDamageAnalysis(),
      inspectorNotes: huge,
    });
    // The full 50k blob must not survive into the prompt.
    expect(prompt).not.toContain(huge);
    // A bounded run of As must still be present (note is included, just capped).
    expect(prompt).toContain('A'.repeat(500));
  });

  it('strips control chars from damage descriptions and AI photo summaries', () => {
    const prompt = buildNarratorPrompt({
      analyzedPhotos: [
        photo({
          id: 'photo-0',
          aiSummary: 'Shingle\x1b]0;pwn\x07 loss observed',
          damages: [
            {
              type: 'hail_damage',
              severity: 'high',
              description: 'Impact\x00 bruising\x08 on field',
            } as never,
          ],
        }),
      ],
      damageAnalysis: baseDamageAnalysis(),
    });
    expect(prompt).not.toContain('\x00');
    expect(prompt).not.toContain('\x07');
    expect(prompt).not.toContain('\x08');
    expect(prompt).not.toContain('\x1b');
    expect(prompt).toContain('Impact bruising on field');
  });

  it('strips control chars from a damage type/label used as a grouping key', () => {
    const prompt = buildNarratorPrompt({
      analyzedPhotos: [
        photo({
          id: 'photo-0',
          damages: [
            {
              type: 'wind\x1b[2J_damage',
              severity: 'high',
              description: '',
            } as never,
          ],
        }),
      ],
      damageAnalysis: baseDamageAnalysis(),
    });
    expect(prompt).not.toContain('\x1b');
  });

  it('leaves ordinary inspector notes, descriptions and summaries unchanged', () => {
    const prompt = buildNarratorPrompt({
      analyzedPhotos: [
        photo({
          id: 'photo-0',
          aiSummary: 'Granule loss across the southern slope.',
          damages: [
            {
              type: 'granule_loss',
              severity: 'medium',
              description: 'Bare mat exposed near the ridge.',
            } as never,
          ],
        }),
      ],
      damageAnalysis: baseDamageAnalysis(),
      roofDetails: { material: 'asphalt shingle', pitch: '6/12', squares: 24 },
      inspectorNotes: 'Homeowner reports a leak in the master bedroom.',
    });
    expect(prompt).toContain('Homeowner reports a leak in the master bedroom.');
    expect(prompt).toContain('Granule loss across the southern slope.');
    expect(prompt).toContain('Bare mat exposed near the ridge.');
    expect(prompt).toContain('asphalt shingle');
    expect(prompt).toContain('6/12');
  });
});

// ── the call itself: stubbed network, the seam, non-fatal failure ───────────

const GOOD_REPLY = JSON.stringify({
  findings: [
    {
      title: 'Hail Damage \u2014 Several Strikes',
      severity: 'high',
      narrative: 'Strikes on the rear slope \u2014 granule loss visible.',
      relatedPhotoIds: ['photo-0'],
      repairAction: 'Replace the slope.',
      insuranceRelevant: true,
      sourceDamageTypes: ['hail_impact'],
    },
  ],
  executiveSummary: 'The roof needs work \u2014 soon.',
});

const INPUT = {
  analyzedPhotos: [photo({ id: 'photo-0' })],
  damageAnalysis: baseDamageAnalysis(),
};

function stubFetch(impl: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const fn = vi.fn(async (url: string, init: RequestInit) => impl(url, init));
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('generateNarrativeWithClaude', () => {
  it('goes through the seam with the narrative role and returns findings with plain punctuation', async () => {
    const call = vi.fn<ModelCaller>(async () => ({ text: GOOD_REPLY, usage: { inputTokens: 10, outputTokens: 5 } }));
    const out = await generateNarrativeWithClaude(INPUT, { call });
    expect(call).toHaveBeenCalledTimes(1);
    expect(call.mock.calls[0][0].role).toBe('narrative');
    expect(out?.findings).toHaveLength(1);
    const text = JSON.stringify(out);
    expect(text.includes('\u2014')).toBe(false);
    expect(out?.executiveSummary).toBe('The roof needs work, soon.');
  });

  it('with an api key, sends the narrative model from models.ts to the provider, and nothing else is called', async () => {
    const fetchMock = stubFetch(() => new Response(JSON.stringify({ content: [{ type: 'text', text: GOOD_REPLY }], usage: { input_tokens: 1, output_tokens: 2 } }), { status: 200 }));
    const out = await generateNarrativeWithClaude(INPUT, { apiKey: 'test-key' });
    expect(out).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.anthropic.com/v1/messages');
    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    expect(body.model).toBe(ROOF_REPORT_MODELS.narrative.id);
    expect(body.temperature).toBeUndefined();
  });

  it('a 500 from the provider returns null and the error text is not logged', async () => {
    stubFetch(() => new Response(JSON.stringify({ error: { message: 'SECRET-PROVIDER-WORDS dana@example.com' } }), { status: 500 }));
    const logs: string[] = [];
    for (const m of ['log', 'warn', 'error'] as const) {
      vi.spyOn(console, m).mockImplementation((...args: unknown[]) => { logs.push(args.map(String).join(' ')); });
    }
    expect(await generateNarrativeWithClaude(INPUT, { apiKey: 'test-key' })).toBeNull();
    expect(logs.length).toBeGreaterThan(0);
    const all = logs.join('\n');
    expect(all).not.toContain('SECRET-PROVIDER-WORDS');
    expect(all).not.toContain('dana@example.com');
    expect(all).toContain('status 500');
  });

  it('returns null for a reply that is not JSON, and with neither a caller nor a key', async () => {
    expect(await generateNarrativeWithClaude(INPUT, { call: async () => ({ text: 'sorry' }) })).toBeNull();
    const fetchMock = stubFetch(() => new Response('{}'));
    expect(await generateNarrativeWithClaude(INPUT, {})).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('the prompt tells the model not to use em dashes and gives no example with one', () => {
    const prompt = buildNarratorPrompt(INPUT);
    expect(prompt).toContain('Do not use em dashes');
    expect(prompt.includes('\u2014')).toBe(false);
  });

  it('the rule-based version is still there for a caller that wants something to show, with no em dash', () => {
    const out = ruleBasedNarrative({
      analyzedPhotos: [photo({ id: 'p', damages: [{ type: 'hail_impact', severity: 'high' } as never] })],
      damageAnalysis: baseDamageAnalysis(),
    });
    expect(out.findings.length).toBe(1);
    expect(JSON.stringify(out).includes('\u2014')).toBe(false);
  });
});

describe('rewriteFindingWithClaude', () => {
  const finding = { id: 'f', title: 'T', severity: 'high', narrative: 'N', relatedPhotoIds: [], repairAction: '', insuranceRelevant: false, sourceDamageTypes: [] } as never;

  it('uses the rewrite role through the seam and returns plain text', async () => {
    const call = vi.fn<ModelCaller>(async () => ({ text: '  Better words \u2014 clearer.  ' }));
    expect(await rewriteFindingWithClaude(finding, undefined, { call })).toBe('Better words, clearer.');
    expect(call.mock.calls[0][0].role).toBe('rewrite');
  });

  it('returns null on a failed call', async () => {
    stubFetch(() => new Response('{}', { status: 529 }));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await rewriteFindingWithClaude(finding, 'shorter', { apiKey: 'k' })).toBeNull();
  });
});
