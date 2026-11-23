/**
 * Security regression test for the image-labeler Claude prompt builder.
 *
 * `buildLabelPrompt` interpolates vision-derived text (the previously detected
 * damage `label`/`type` token and `location`) into a Claude prompt that asks
 * Haiku to produce positioned image labels. Those fields are untrusted — a
 * malicious caption / vision detection could embed ASCII control characters
 * (terminal escapes, NUL/BEL) or be arbitrarily long to attempt prompt
 * injection or to blow out the prompt budget.
 *
 * These tests assert each interpolated field is stripped of control chars and
 * length-capped in the built prompt, while ordinary text is left untouched so
 * the labels for normal inputs do not change.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { buildLabelPrompt, labelPhotosWithClaude } from '../claude-image-labeler';
import { ROOF_REPORT_MODELS } from '../models';
import type { ModelCaller } from '../model-call';
import type { DamageDetection } from '../comprehensive-roof-report';

function damage(over: Partial<DamageDetection>): DamageDetection {
  return {
    id: 'd-0',
    type: 'missing_shingles',
    label: 'Missing shingles',
    severity: 'high',
    confidence: 0.9,
    description: 'desc',
    location: 'center',
    ...over,
  } as DamageDetection;
}

describe('buildLabelPrompt — prompt-injection / control-char hardening', () => {
  it('strips ASCII control characters from the damage label token', () => {
    const prompt = buildLabelPrompt([
      damage({ label: 'Hail\x07 strike\x00 — granule\x1b[31m loss', type: 'hail' }),
    ]);
    expect(prompt).toContain('Hail strike — granule[31m loss');
    expect(prompt).not.toContain('\x07');
    expect(prompt).not.toContain('\x00');
    expect(prompt).not.toContain('\x1b');
  });

  it('strips ASCII control characters from the damage location field', () => {
    const prompt = buildLabelPrompt([
      damage({ label: 'Cracked boot', location: 'upper\x00 ridge\x1b[2J area' }),
    ]);
    expect(prompt).toContain('upper ridge[2J area');
    expect(prompt).not.toContain('\x00');
    expect(prompt).not.toContain('\x1b');
  });

  it('falls back to the type token (sanitized) when label is absent', () => {
    const prompt = buildLabelPrompt([
      damage({ label: '', type: 'pipe\x07_boot\x00_failure' }),
    ]);
    expect(prompt).toContain('pipe_boot_failure');
    expect(prompt).not.toContain('\x07');
    expect(prompt).not.toContain('\x00');
  });

  it('caps an oversized damage label embedded in the prompt', () => {
    const huge = 'A'.repeat(5000);
    const prompt = buildLabelPrompt([damage({ label: huge, type: 'x' })]);
    // The full oversized string must not survive into the prompt.
    expect(prompt).not.toContain(huge);
    // A bounded run of the repeated char should still be present (capped, not dropped).
    expect(prompt).toContain('A'.repeat(100));
  });

  it('caps an oversized location field embedded in the prompt', () => {
    const huge = 'B'.repeat(5000);
    const prompt = buildLabelPrompt([damage({ label: 'Cracked boot', location: huge })]);
    expect(prompt).not.toContain(huge);
    expect(prompt).toContain('B'.repeat(100));
  });

  it('leaves ordinary label / location text untouched', () => {
    const prompt = buildLabelPrompt([
      damage({
        label: 'Hail strike — granule loss',
        location: 'upper-right quadrant',
        severity: 'high',
      }),
    ]);
    // Ordinary inputs pass through verbatim — no change to normal labeling.
    expect(prompt).toContain('Hail strike — granule loss');
    expect(prompt).toContain('high severity');
    expect(prompt).toContain('at upper-right quadrant');
  });

  it('produces the no-damage context line when there are no detections', () => {
    const prompt = buildLabelPrompt([]);
    expect(prompt).toContain('No damage was previously detected');
  });
});

// ── the call itself ─────────────────────────────────────────────────────────

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const REPLY = JSON.stringify({
  labels: [
    { text: 'Hail strike \u2014 granule loss', position: 'top left', severity: 'high' },
    { text: 'Cracked pipe boot', position: 'center', severity: 'moderate' },
  ],
});
const BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

describe('labelPhotosWithClaude', () => {
  it('a photo given as bytes is sent as base64 and no download is made', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ content: [{ type: 'text', text: REPLY }] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const download = vi.fn(async () => 'data:image/jpeg;base64,AAAA');
    const out = await labelPhotosWithClaude(
      [{ photoId: 'p1', image: { bytes: BYTES, mediaType: 'image/jpeg' }, existingDamages: [] }],
      { apiKey: 'test-key', downloadImage: download },
    );
    expect(download).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown[])[1] && ((fetchMock.mock.calls[0] as unknown[])[1] as RequestInit).body));
    expect(body.model).toBe(ROOF_REPORT_MODELS.labels.id);
    const image = body.messages[0].content.find((b: { type: string }) => b.type === 'image');
    expect(image.source).toEqual({ type: 'base64', media_type: 'image/jpeg', data: BYTES.toString('base64') });
    expect(out?.p1).toHaveLength(2);
    expect(out?.p1[0].position).toBe('top-left');
    expect(out?.p1[0].text).toBe('Hail strike, granule loss');
  });

  it('a photo given as an address goes through the downloader once, then the seam with the role', async () => {
    const call = vi.fn<ModelCaller>(async () => ({ text: REPLY }));
    const download = vi.fn(async () => 'data:image/jpeg;base64,QUJD');
    const out = await labelPhotosWithClaude(
      [{ photoId: 'p2', photoUrl: 'https://photos.example.com/a.jpg', existingDamages: [] }],
      { call, downloadImage: download },
    );
    expect(download).toHaveBeenCalledWith('https://photos.example.com/a.jpg');
    expect(call.mock.calls[0][0].role).toBe('labels');
    expect(call.mock.calls[0][0].image).toEqual({ base64: 'QUJD', mediaType: 'image/jpeg' });
    expect(out?.p2).toHaveLength(2);
  });

  it('a 500 from the provider returns null and the error text and photo address are not logged', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'SECRET-PROVIDER-WORDS' }), { status: 500 })));
    const logs: string[] = [];
    for (const m of ['log', 'warn', 'error'] as const) {
      vi.spyOn(console, m).mockImplementation((...args: unknown[]) => { logs.push(args.map(String).join(' ')); });
    }
    const out = await labelPhotosWithClaude(
      [{ photoId: 'p3', image: { bytes: BYTES, mediaType: 'image/jpeg' }, existingDamages: [] }],
      { apiKey: 'test-key' },
    );
    expect(out).toBeNull();
    const all = logs.join('\n');
    expect(all).not.toContain('SECRET-PROVIDER-WORDS');
    expect(all).toContain('status 500');
  });

  it('one failed photo keeps labels from its existing detections while the others use the model', async () => {
    let n = 0;
    const call: ModelCaller = async () => {
      if (n++ === 0) throw new Error('x');
      return { text: REPLY };
    };
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const out = await labelPhotosWithClaude(
      [
        { photoId: 'bad', image: { bytes: BYTES, mediaType: 'image/jpeg' }, existingDamages: [damage({ type: 'hail_impact', label: 'Hail', severity: 'high' })] },
        { photoId: 'good', image: { bytes: BYTES, mediaType: 'image/jpeg' }, existingDamages: [] },
      ],
      { call, batchSize: 1 },
    );
    expect(out?.bad[0].text).toBe('Hail');
    expect(out?.good).toHaveLength(2);
  });

  it('returns null with neither a caller nor a key, and refuses a private address without calling anything', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await labelPhotosWithClaude([{ photoId: 'x', image: { bytes: BYTES, mediaType: 'image/jpeg' }, existingDamages: [] }], {})).toBeNull();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const call = vi.fn<ModelCaller>(async () => ({ text: REPLY }));
    const out = await labelPhotosWithClaude([{ photoId: 'y', photoUrl: 'https://10.0.0.5/a.jpg', existingDamages: [] }], { call });
    expect(out).toBeNull();
    expect(call).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('the prompt asks for no em dashes and gives no example with one', () => {
    const prompt = buildLabelPrompt([]);
    expect(prompt).toContain('Do not use em dashes');
    expect(prompt.includes('\u2014')).toBe(false);
  });
});
