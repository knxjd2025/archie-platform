/**
 * NOT WIRED UP, ON PURPOSE. The feature was declined on 2026-09-19.
 *
 * Nothing calls `isRoofRendersEnabled`, `pickBestExteriorPhoto` or
 * `generateRoofColorRenders`, and that is the intended state — it is not an
 * oversight waiting to be tidied up. The far half is finished, which is what
 * makes it look unfinished: `colorRendersSection()` already renders a "Your
 * Home, New Roof" chapter and `generate-combined.ts` already accepts the
 * images, so connecting them is one call. Do not make that call without
 * asking — it spends Gemini credits on every report generated, and needs an
 * R2 bucket and a Gemini key that are deliberately unset.
 *
 * Harmless as it stands: with no images the chapter renders as an empty
 * string, and `arrangeSections` drops empty sections, so no blank chapter and
 * no dangling entry in the report navigation.
 */
/**
 * "Your new roof — visualized": Gemini image-edits of the customer's OWN
 * inspection photo showing a brand-new CertainTeed Landmark roof, in the 8
 * most popular colors. STANDARD on every full-replacement proposal
 * (as first specified, 2026-06-10).
 *
 * Pipeline: pick the best exterior photo (Gemini vision rank, fallback first
 * photo) -> edit it once per color with the newest Gemini image model ->
 * upload renders to R2 -> return URLs for the renderer section.
 *
 * Fail-soft by design: any error returns null and the proposal renders
 * without the section — a render failure must never block report delivery.
 */
import { fetchWithRetry } from './fetch-with-retry.js';
import { putReportImage, isR2Configured } from './r2-storage.js';

const IMAGE_MODELS = ['gemini-3-pro-image-preview', 'gemini-2.5-flash-image'];
const VISION_MODEL = 'gemini-2.5-flash';
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

/** The 8 most-chosen Landmark colors. */
export const LANDMARK_RENDER_COLORS: Array<{ slug: string; name: string; promptDesc: string; blurb: string }> = [
  { slug: 'weathered-wood',  name: 'Weathered Wood',  promptDesc: 'a warm earthy blend of soft browns, tans and gray',            blurb: 'The #1 most popular Landmark color — warm, earthy, goes with everything' },
  { slug: 'moire-black',     name: 'Moiré Black',     promptDesc: 'a deep charcoal-black blend with subtle gray shadow tones',    blurb: 'Deep charcoal black — bold, modern, striking' },
  { slug: 'pewter',          name: 'Pewter',          promptDesc: 'a light silvery gray',                                         blurb: 'Light silvery gray — clean and bright' },
  { slug: 'driftwood',       name: 'Driftwood',       promptDesc: 'a soft taupe blend of warm gray and light brown',              blurb: 'Soft taupe blend — warm gray with light brown' },
  { slug: 'georgetown-gray', name: 'Georgetown Gray', promptDesc: 'a classic medium gray with darker gray accents',               blurb: 'Classic medium gray — timeless and neutral' },
  { slug: 'colonial-slate',  name: 'Colonial Slate',  promptDesc: 'a blue-gray slate blend with deep shadow lines',               blurb: 'Blue-gray slate blend — rich, dimensional look' },
  { slug: 'resawn-shake',    name: 'Resawn Shake',    promptDesc: 'a rich medium wood-brown with cedar shake tones',              blurb: 'Wood-shake brown — warm cedar character' },
  { slug: 'heather-blend',   name: 'Heather Blend',   promptDesc: 'a warm autumn blend of brown, tan and subtle red',             blurb: 'Autumn blend — brown and tan with subtle red' },
];

export interface RoofColorRender {
  name: string;
  blurb: string;
  url: string;
}

export interface GenerateRendersParams {
  /** Candidate photo URLs (JobTread/CompanyCam). Best exterior shot is auto-picked. */
  photoUrls: string[];
  /** R2 report slug — renders land at reports/<slug>/render-<color>.jpg. */
  slug: string;
  /** Cap on how many candidates the vision picker examines (payload size). */
  maxCandidates?: number;
}

function apiKey(): string | null {
  return process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY || null;
}

export function isRoofRendersEnabled(): boolean {
  return !!apiKey() && isR2Configured() && process.env.ENABLE_ROOF_RENDERS !== 'false';
}

async function fetchImageB64(url: string): Promise<{ b64: string; bytes: number } | null> {
  try {
    const { response: res } = await fetchWithRetry(url, {}, { maxRetries: 1, timeoutMs: 30_000 });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 10_000) return null; // not a real photo
    return { b64: buf.toString('base64'), bytes: buf.length };
  } catch {
    return null;
  }
}

async function geminiGenerate(model: string, parts: unknown[], imageOut: boolean): Promise<any> {
  const { response: res } = await fetchWithRetry(
    `${GEMINI_BASE}/${model}:generateContent?key=${apiKey()}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts }],
        ...(imageOut ? { generationConfig: { responseModalities: ['IMAGE'] } } : {}),
      }),
    },
    { maxRetries: 1, timeoutMs: 120_000 },
  );
  const json: any = await res.json();
  if (json.error) throw new Error(`${model}: ${json.error.message}`);
  return json;
}

function extractInlineImage(json: any): Buffer | null {
  const parts = json?.candidates?.[0]?.content?.parts || [];
  for (const p of parts) {
    const data = p.inlineData?.data || p.inline_data?.data;
    if (data) return Buffer.from(data, 'base64');
  }
  return null;
}

/**
 * Pick the photo that best shows the home's exterior with the roof prominent
 * (ideally an aerial/drone front elevation). Vision-ranked; falls back to the
 * first photo on any failure.
 */
export async function pickBestExteriorPhoto(photoUrls: string[], maxCandidates = 6): Promise<string | null> {
  const urls = photoUrls.filter(Boolean);
  if (!urls.length) return null;
  if (urls.length === 1) return urls[0];

  const candidates: Array<{ url: string; b64: string }> = [];
  let payloadBytes = 0;
  for (const url of urls.slice(0, maxCandidates)) {
    const img = await fetchImageB64(url);
    if (!img) continue;
    if (payloadBytes + img.bytes > 10_000_000) break; // stay under request limits
    payloadBytes += img.bytes;
    candidates.push({ url, b64: img.b64 });
  }
  if (!candidates.length) return urls[0];
  if (candidates.length === 1) return candidates[0].url;

  try {
    const parts: unknown[] = [];
    candidates.forEach((c, i) => {
      parts.push({ text: `Photo ${i + 1}:` });
      parts.push({ inline_data: { mime_type: 'image/jpeg', data: c.b64 } });
    });
    parts.push({
      text:
        'These are roof-inspection photos of one property. Which single photo best shows the WHOLE HOUSE exterior with the roof clearly visible — ideally an aerial/drone shot of the front elevation? ' +
        'Avoid close-ups of shingles, gutters, skylights or flashing, and avoid straight-down overhead shots where the walls are not visible. ' +
        'Answer with ONLY the photo number, nothing else.',
    });
    const json = await geminiGenerate(VISION_MODEL, parts, false);
    const text: string = json?.candidates?.[0]?.content?.parts?.map((p: any) => p.text || '').join(' ') || '';
    const n = parseInt(text.match(/\d+/)?.[0] || '', 10);
    if (n >= 1 && n <= candidates.length) return candidates[n - 1].url;
  } catch (err: any) {
    console.warn('[roof-renders] photo pick failed, using first photo:', err.message);
  }
  return candidates[0].url;
}

function editPrompt(colorName: string, colorDesc: string): string {
  return (
    `Edit this real photo of a house. Replace the old, worn asphalt shingle roof with a BRAND NEW ` +
    `CertainTeed Landmark architectural (dimensional) asphalt shingle roof in the color "${colorName}" — ${colorDesc}. ` +
    `The new shingles should look crisp and freshly installed with clean dimensional shadow lines and a neat new ridge cap. ` +
    `Do NOT add, move or remove any skylights, dormers, chimneys, vents or any other roof features — only change the shingle surface itself. ` +
    `Keep absolutely everything else in the photo identical: the house, windows, doors, trees, landscaping, driveway, lawn, lighting and camera angle. ` +
    `Photorealistic, no text or watermarks.`
  );
}

/**
 * Generate the 8-color render set and upload to R2. Returns the renders in
 * LANDMARK_RENDER_COLORS order (Weathered Wood first = hero), or null when
 * disabled / no usable photo / too few successful renders.
 */
export async function generateRoofColorRenders(params: GenerateRendersParams): Promise<RoofColorRender[] | null> {
  if (!isRoofRendersEnabled()) return null;

  const sourceUrl = await pickBestExteriorPhoto(params.photoUrls, params.maxCandidates);
  if (!sourceUrl) return null;
  const source = await fetchImageB64(sourceUrl);
  if (!source) return null;

  // First color also discovers which image model is available.
  let model: string | null = null;
  const results: Array<RoofColorRender | null> = new Array(LANDMARK_RENDER_COLORS.length).fill(null);

  const renderOne = async (idx: number, useModel: string): Promise<void> => {
    const color = LANDMARK_RENDER_COLORS[idx];
    const json = await geminiGenerate(
      useModel,
      [
        { inline_data: { mime_type: 'image/jpeg', data: source.b64 } },
        { text: editPrompt(color.name, color.promptDesc) },
      ],
      true,
    );
    const buf = extractInlineImage(json);
    if (!buf) throw new Error('no image in response');
    const stored = await putReportImage(params.slug, `render-${color.slug}.jpg`, buf, 'image/jpeg');
    if (!stored) throw new Error('R2 upload failed');
    results[idx] = { name: color.name, blurb: color.blurb, url: stored.url };
  };

  for (const m of IMAGE_MODELS) {
    try {
      await renderOne(0, m);
      model = m;
      break;
    } catch (err: any) {
      console.warn(`[roof-renders] model ${m} failed:`, err.message);
    }
  }
  if (!model) return null;

  // Remaining colors, 2 at a time (rate-limit friendly), each fail-soft.
  const remaining = LANDMARK_RENDER_COLORS.map((_, i) => i).slice(1);
  const CONCURRENCY = 2;
  for (let i = 0; i < remaining.length; i += CONCURRENCY) {
    await Promise.all(
      remaining.slice(i, i + CONCURRENCY).map((idx) =>
        renderOne(idx, model!).catch((err: any) =>
          console.warn(`[roof-renders] ${LANDMARK_RENDER_COLORS[idx].slug} failed:`, err.message),
        ),
      ),
    );
  }

  const ok = results.filter((r): r is RoofColorRender => !!r);
  // A sparse gallery looks broken — require most colors before showing the section.
  if (ok.length < 5) {
    console.warn(`[roof-renders] only ${ok.length}/8 renders succeeded — omitting section`);
    return null;
  }
  console.log(`[roof-renders] ${ok.length}/8 renders generated with ${model} (source: ${sourceUrl.slice(0, 80)}…)`);
  return ok;
}
