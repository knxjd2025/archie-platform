/**
 * The photo scan for a commercial Proposal or Presentation.
 *
 * The rep picks up to ANALYZE_LIMIT photos; each one is read by the vision
 * model before the document is written, so the report can say what every
 * picture shows — which part of the roof, what is visible, and what shape it
 * is in — instead of printing forty uncaptioned thumbnails.
 *
 * What the scan is NOT: it is not the inspection. The ratings, the assembly
 * and the recommendation come from the inspector's checklist and nothing a
 * model sees in a photo overrides them. The model is told what the inspector
 * recorded so it names things correctly, and is told not to guess a cause, a
 * cost, an age or a claim. Everything it writes lands in the report as
 * ordinary findings the rep can edit or remove in the editor.
 *
 * Runs on the same providers as the residential vision pass (fal.ai router,
 * OpenRouter, then Groq) but with its own low-slope prompt: the residential
 * prompt looks for missing shingles and prices repairs by type, neither of
 * which means anything on a membrane roof.
 */
import { visionAttempts, REPORT_VISION_MODEL } from './groq-vision.js';

/** The most photos one scan reads — the same cap the photo picker enforces (photo-selection.ts). */
const SCAN_LIMIT = 40;

export const SCAN_COMPONENTS = [
  'overview', 'membrane_field', 'seams', 'base_flashing', 'coping', 'edge_metal', 'penetrations',
  'hvac_curbs', 'drains', 'ponding', 'skylights', 'walkways', 'core_cut', 'interior', 'other',
] as const;
export type ScanComponent = (typeof SCAN_COMPONENTS)[number];

export const SCAN_COMPONENT_LABEL: Record<ScanComponent, string> = {
  overview: 'Roof overview',
  membrane_field: 'Membrane field',
  seams: 'Seams and laps',
  base_flashing: 'Base flashings',
  coping: 'Parapet coping and wall caps',
  edge_metal: 'Perimeter edge metal',
  penetrations: 'Penetrations',
  hvac_curbs: 'HVAC curbs and rooftop equipment',
  drains: 'Drains and scuppers',
  ponding: 'Ponding and drainage',
  skylights: 'Skylights and hatches',
  walkways: 'Walkway pads and traffic areas',
  core_cut: 'Core cut',
  interior: 'Inside the building',
  other: 'Other',
};

/** The checklist rating each photographed component is graded under, when it has one. */
export const SCAN_COMPONENT_RATING_FIELD: Partial<Record<ScanComponent, string>> = {
  membrane_field: 'Membrane field condition',
  seams: 'Seams and laps',
  base_flashing: 'Base flashings (walls and curbs)',
  coping: 'Parapet coping and wall caps',
  edge_metal: 'Perimeter edge metal (fascia, gravel stop, drip edge)',
  penetrations: 'Penetrations (pipes, pitch pockets, conduits)',
  hvac_curbs: 'HVAC curbs and rooftop equipment',
  drains: 'Drains and strainers',
  skylights: 'Skylights, hatches and smoke vents',
  walkways: 'Walkway pads and traffic protection',
};

export type ScanCondition = 'good' | 'fair' | 'poor' | 'failed' | 'not_assessable';
export type ScanSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface ScanIssue { label: string; detail: string; severity: ScanSeverity }

export interface PhotoScanResult {
  usable: boolean;
  component: ScanComponent;
  caption: string;
  observation: string;
  condition: ScanCondition;
  issues: ScanIssue[];
}

export interface ScanPhoto { url: string; caption?: string }

/** One vision request. Returns the model's raw text, or null when it could not answer. */
export type VisionCall = (args: { system: string; user: string; imageUrl: string; deadline?: number }) => Promise<string | null>;

export interface ScanOptions {
  call?: VisionCall;
  /** Epoch ms after which no new photo is started. */
  deadline?: number;
  concurrency?: number;
}

export interface ScanRun {
  /** Index-aligned with the input; null where a photo could not be read. */
  results: Array<PhotoScanResult | null>;
  requested: number;
  scanned: number;
  /** True when the time budget stopped the run before every photo was started. */
  timedOut: boolean;
}

/** Whether the scan may run at all. On unless switched off; needs a vision provider. */
export function commercialScanEnabled(): boolean {
  if (process.env.COMMERCIAL_PHOTO_SCAN === 'off') return false;
  return !!(process.env.COMMERCIAL_SCAN_ENDPOINT || process.env.FAL_AI_API_KEY || process.env.FAL_KEY || process.env.OPENROUTER_API_KEY || process.env.GROQ_API_KEY);
}

const filled = (v: unknown) => v !== undefined && v !== null && String(v).trim() !== '';

/** The handful of checklist facts that let the model name what it is looking at. */
export function recordedRoofFacts(answers: Record<string, unknown> | null | undefined): string {
  const a = answers ?? {};
  const pick = (k: string) => (filled(a[k]) ? String(a[k]).trim().slice(0, 160) : null);
  const rows: Array<[string, string | null]> = [
    ['Building', pick('Building type / use')],
    ['Membrane', pick('Membrane type')],
    ['Membrane attachment', pick('Membrane attachment')],
    ['Surfacing', pick('Surfacing')],
    ['Deck', pick('Deck type')],
    ['Insulation', pick('Insulation type')],
    ['Parapets', pick('Parapet walls')],
  ];
  return rows.filter(([, v]) => v).map(([k, v]) => `- ${k}: ${v}`).join('\n');
}

export function buildScanSystemPrompt(answers: Record<string, unknown> | null | undefined): string {
  const facts = recordedRoofFacts(answers);
  return `You are helping a commercial roofing inspector label ONE photo from a low-slope (flat) commercial roof inspection. A building owner will read what you write.

Describe only what is visible in this photo. Write at a 5th-grade reading level: short sentences and everyday words a building owner understands. When you must use a roofing word (membrane, seam, flashing), keep the sentence around it simple.

${facts ? `The inspector recorded this about the roof. Use it to name things correctly and never contradict it:\n${facts}\n` : ''}
Rules:
- Say what is in the picture and what shape it is in. Do not guess what is outside the frame or under the surface.
- The recorded facts are for naming what you can see. Do not repeat one as an observation when the photo does not show it.
- Never state a cause. Do not say hail, wind, storm, age or installer error caused anything.
- Never estimate a cost, a roof age, remaining life, or an area or count you cannot see.
- Never mention insurance or a claim.
- Do not name a brand or manufacturer unless a label is legible in the photo.
- If the photo does not show the roof, its drainage, its equipment, a core cut or the inside of the building, set "usable" to false and "component" to "other".

Answer with JSON only, in this shape:
{
  "usable": true,
  "component": "one of: ${SCAN_COMPONENTS.join(', ')}",
  "caption": "what the photo shows, 10 words or fewer",
  "observation": "one to three sentences on what is visible and its condition",
  "condition": "good | fair | poor | failed | not_assessable",
  "issues": [
    { "label": "6 words or fewer", "detail": "one sentence: what is visible and where in the frame", "severity": "low | medium | high | critical" }
  ]
}
"issues" holds at most 3 entries and is empty when nothing is wrong in the photo.`;
}

const clean = (v: unknown, max: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const CONDITIONS: ScanCondition[] = ['good', 'fair', 'poor', 'failed', 'not_assessable'];
const SEVERITIES: ScanSeverity[] = ['low', 'medium', 'high', 'critical'];

/** Language the prompt forbids — dropped if a model writes it anyway. */
const FORBIDDEN = /\b(hail|storm|insurance|claim|adjuster|deductible)\b/i;

/** Parse and sanitize one model reply. Null when it is not usable JSON. */
export function parseScanResponse(raw: string | null | undefined): PhotoScanResult | null {
  if (!raw) return null;
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1);
  let parsed: any;
  try { parsed = JSON.parse(body); } catch { return null; }
  if (!parsed || typeof parsed !== 'object') return null;

  const component: ScanComponent = (SCAN_COMPONENTS as readonly string[]).includes(parsed.component) ? parsed.component : 'other';
  const condition: ScanCondition = CONDITIONS.includes(parsed.condition) ? parsed.condition : 'not_assessable';
  const observation = clean(parsed.observation, 600);
  // The caption can become the photo's caption on the document, so it is held
  // to the same rule as the rest.
  const rawCaption = clean(parsed.caption, 120);
  const caption = FORBIDDEN.test(rawCaption) ? '' : rawCaption;
  if (!observation && !rawCaption) return null;

  const issues: ScanIssue[] = (Array.isArray(parsed.issues) ? parsed.issues : [])
    .map((x: any) => ({
      label: clean(x?.label, 80),
      detail: clean(x?.detail, 400),
      severity: (SEVERITIES.includes(x?.severity) ? x.severity : 'medium') as ScanSeverity,
    }))
    .filter((x: ScanIssue) => x.label && !FORBIDDEN.test(`${x.label} ${x.detail}`))
    .slice(0, 3);

  return {
    usable: parsed.usable !== false,
    component,
    caption,
    observation: FORBIDDEN.test(observation) ? '' : observation,
    condition,
    issues,
  };
}

/* ------------------------------------------------------------- providers --- */

const envTimeout = Number(process.env.VISION_API_TIMEOUT_MS);
const CALL_TIMEOUT_MS = Number.isFinite(envTimeout) && envTimeout > 0 ? envTimeout : 45_000;
const FAL_ROUTER_URL = 'https://fal.run/openrouter/router/openai/v1/chat/completions';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

interface Endpoint { name: string; url: string; auth: string; model: string }

function endpoints(): Endpoint[] {
  // One OpenAI-compatible endpoint of the operator's choosing, used alone. The
  // end-to-end suite points this at a stand-in so the whole scan path runs
  // without a paid call; it also serves a self-hosted or pinned provider.
  const custom = process.env.COMMERCIAL_SCAN_ENDPOINT;
  if (custom) {
    return [{ name: 'custom', url: custom, auth: `Bearer ${process.env.COMMERCIAL_SCAN_KEY || ''}`, model: process.env.COMMERCIAL_SCAN_MODEL || REPORT_VISION_MODEL }];
  }
  const out: Endpoint[] = [];
  const fal = process.env.FAL_AI_API_KEY || process.env.FAL_KEY;
  for (const a of visionAttempts()) {
    out.push(a.provider === 'fal'
      ? { name: `fal:${a.model}`, url: FAL_ROUTER_URL, auth: `Key ${fal}`, model: a.model }
      : { name: `openrouter:${a.model}`, url: OPENROUTER_URL, auth: `Bearer ${process.env.OPENROUTER_API_KEY}`, model: a.model });
  }
  if (process.env.GROQ_API_KEY) {
    const model = process.env.GROQ_REPORT_MODEL || 'meta-llama/llama-4-maverick-17b-128e-instruct';
    out.push({ name: `groq:${model}`, url: GROQ_URL, auth: `Bearer ${process.env.GROQ_API_KEY}`, model });
  }
  return out;
}

async function post(e: Endpoint, args: { system: string; user: string; imageUrl: string; deadline?: number }): Promise<string | null> {
  // Never wait on a provider past the scan's own deadline.
  const budget = Math.min(CALL_TIMEOUT_MS, (args.deadline ?? Infinity) - Date.now());
  if (budget <= 0) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), budget);
  try {
    const res = await fetch(e.url, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { Authorization: e.auth, 'Content-Type': 'application/json', 'X-Title': 'Best Roofing Now Reports' },
      body: JSON.stringify({
        model: e.model,
        temperature: 0.1,
        max_tokens: 700,
        messages: [
          { role: 'system', content: args.system },
          { role: 'user', content: [{ type: 'text', text: args.user }, { type: 'image_url', image_url: { url: args.imageUrl } }] },
        ],
      }),
    });
    if (!res.ok) {
      console.warn(`[photo-scan] ${e.name} answered ${res.status}`);
      return null;
    }
    const data: any = await res.json();
    return data?.choices?.[0]?.message?.content || null;
  } catch (err) {
    console.warn(`[photo-scan] ${e.name} failed:`, (err as Error)?.message || err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The default call: the first endpoint that returns parseable JSON wins, and
 * is remembered so the other thirty-nine photos go straight to it instead of
 * rediscovering which provider is up.
 */
function providerCall(): VisionCall {
  const all = endpoints();
  let preferred = 0;
  return async (args) => {
    const order = [all[preferred], ...all.filter((_, i) => i !== preferred)].filter(Boolean);
    for (const e of order) {
      // Falling through to the next provider is for an outage, not for
      // spending the rest of the function's time on one photo.
      if (args.deadline !== undefined && Date.now() >= args.deadline) return null;
      const raw = await post(e, args);
      if (raw && parseScanResponse(raw)) { preferred = all.indexOf(e); return raw; }
    }
    return null;
  };
}

const isHttpUrl = (u: string) => { try { const p = new URL(u).protocol; return p === 'http:' || p === 'https:'; } catch { return false; } };

/**
 * Scan the photos. A small worker pool rather than fixed rounds, so one slow
 * image does not hold nine finished ones; no new photo starts past the
 * deadline, and the caller reports the shortfall.
 */
export async function scanCommercialPhotos(
  photos: ScanPhoto[],
  answers: Record<string, unknown> | null | undefined,
  opts: ScanOptions = {},
): Promise<ScanRun> {
  const results: Array<PhotoScanResult | null> = photos.map(() => null);
  if (!photos.length) return { results, requested: 0, scanned: 0, timedOut: false };

  const call = opts.call ?? providerCall();
  const system = buildScanSystemPrompt(answers);
  const deadline = opts.deadline ?? Infinity;
  const workers = Math.max(1, Math.min(opts.concurrency ?? (Number(process.env.VISION_BATCH_SIZE) || 10), photos.length));
  let next = 0;
  let timedOut = false;

  const work = async () => {
    for (;;) {
      const i = next++;
      if (i >= photos.length) return;
      if (Date.now() >= deadline) { timedOut = true; return; }
      const p = photos[i];
      if (!isHttpUrl(p.url)) continue;
      const user = `Label this inspection photo.${p.caption ? ` The inspector's caption for it: "${clean(p.caption, 200)}".` : ''} Answer with the JSON only.`;
      try {
        results[i] = parseScanResponse(await call({ system, user, imageUrl: p.url, deadline: opts.deadline }));
      } catch (err) {
        console.warn('[photo-scan] photo failed:', (err as Error)?.message || err);
      }
    }
  };
  await Promise.all(Array.from({ length: workers }, work));

  return { results, requested: photos.length, scanned: results.filter(Boolean).length, timedOut };
}

/* ------------------------------------------------------------ onto report --- */

const SEV_RANK: Record<string, number> = { none: 0, low: 1, medium: 2, high: 3, critical: 4 };

export interface PhotoScanSummary {
  scannedAt: string;
  /** Every photo sent for scanning, read or not — what a later reuse check compares against. */
  urls: string[];
  requested: number;
  scanned: number;
  withIssues: number;
  timedOut: boolean;
}

/** JobTread falls back to the file or folder name when a photo has no description. That is not a caption. */
export function isPlaceholderCaption(caption: unknown): boolean {
  const c = String(caption ?? '').trim();
  return !c || /\.(jpe?g|png|heic|heif|webp|gif)$/i.test(c) || /^(img|dsc|pxl|photo|image)[\s_-]?\d+/i.test(c);
}

/** The finding type a scanned photo's findings carry — never priced, never mistaken for shingle damage. */
export const scanFindingType = (c: ScanComponent) => `commercial_${c}`;
export const isScanFindingType = (t: unknown): boolean => typeof t === 'string' && t.startsWith('commercial_');

/**
 * Write a scan onto the report's photos. Pure.
 *
 * Each scanned photo gets its observation as its first finding (labelled
 * with the component) and each visible issue as a further finding — so the
 * editor's Findings tab, which already edits, reorders and removes findings,
 * edits every word the scan wrote. The inspector's own caption is kept; the
 * model's caption is used only for a photo that had none.
 */
export function applyPhotoScan<T extends Record<string, any>>(report: T, photos: ScanPhoto[], run: ScanRun, now = new Date()): T {
  const byUrl = new Map<string, PhotoScanResult | null>();
  photos.forEach((p, i) => byUrl.set(p.url, run.results[i] ?? null));
  const existing: any[] = report?.damageAnalysis?.photos ?? [];
  let withIssues = 0;
  let worst = 'none';

  const updated = existing.map((p, i) => {
    const r = byUrl.get(p.url);
    if (r === undefined) return p; // not sent for scanning — appendix or record photo
    if (!r) return { ...p, damages: [], overallSeverity: 'none', aiSummary: 'Unable to analyze this image.' };
    const label = SCAN_COMPONENT_LABEL[r.component];
    // A photo that does not show the roof is kept, as taken, with nothing
    // written about it.
    const findings = !r.usable ? [] : [
      ...(r.observation ? [{
        id: `damage-${i}-0`, type: scanFindingType(r.component), label, severity: null as string | null,
        confidence: 80, description: r.observation, location: label, observation: true,
      }] : []),
      ...r.issues.map((x, k) => ({
        id: `damage-${i}-${k + 1}`, type: scanFindingType(r.component), label: x.label, severity: x.severity as string | null,
        confidence: 80, description: x.detail, location: label,
      })),
    ];
    const issues = r.usable ? r.issues : [];
    const sev = issues.reduce((m, x) => (SEV_RANK[x.severity] > SEV_RANK[m] ? x.severity : m), 'none' as string);
    if (issues.length) withIssues++;
    if (SEV_RANK[sev] > SEV_RANK[worst]) worst = sev;
    return {
      ...p,
      caption: (isPlaceholderCaption(p.caption) ? r.caption : p.caption) || p.caption || undefined,
      damages: findings,
      overallSeverity: sev,
      aiSummary: r.usable ? 'Photo reviewed.' : 'Photo reviewed — does not show the roof.',
      component: r.usable ? r.component : 'other',
      condition: r.usable ? r.condition : 'not_assessable',
      scanned: true,
      analyzedAt: now.toISOString(),
    };
  });

  const summary: PhotoScanSummary = { scannedAt: now.toISOString(), urls: photos.map((p) => p.url), requested: run.requested, scanned: run.scanned, withIssues, timedOut: run.timedOut };
  return {
    ...report,
    damageAnalysis: {
      ...(report?.damageAnalysis ?? {}),
      photos: updated,
      totalPhotosAnalyzed: run.scanned,
      photosWithDamage: withIssues,
      overallSeverity: worst,
      analysisSkipped: run.scanned === 0,
      aiSummary: '',
    },
    photoScan: summary,
  };
}

/** The line the rep sees when the scan came up short. Undefined when it was complete. */
export function scanWarning(run: ScanRun): string | undefined {
  if (!run.requested) return undefined;
  if (run.scanned === 0) return `None of the ${run.requested} photos could be read by the photo scan, so the photos appear as taken. Check the vision provider (FAL_AI_API_KEY / GROQ_API_KEY) and generate again.`;
  if (run.scanned < run.requested) {
    return run.timedOut
      ? `The photo scan read ${run.scanned} of ${run.requested} photos before its time limit; the rest appear as taken. Generate again with fewer photos to scan them all.`
      : `The photo scan read ${run.scanned} of ${run.requested} photos; the rest could not be read and appear as taken.`;
  }
  return undefined;
}

/**
 * Whether a stored report's scan covers exactly the photos the rep has picked
 * now. A derived document reuses the previous one's findings to stay
 * consistent with what the owner was shown — but not when the rep has just
 * chosen a different set of photos to be read.
 */
export function sameScanSelection(data: any, pickedUrls: string[] | undefined): boolean {
  if (!pickedUrls?.length) return true;
  // What was SENT, not what came back: a photo the model could not read was
  // still part of the selection, and re-reading the set would spend the scan
  // again and could describe the roof differently from the document the
  // owner already has.
  const sent: string[] = Array.isArray(data?.photoScan?.urls)
    ? data.photoScan.urls
    : ((data?.damageAnalysis?.photos ?? []) as any[]).filter((p) => p?.scanned).map((p) => String(p.url));
  if (!sent.length) return false;
  const had = new Set(sent);
  // The server caps a selection at the scan limit, so a longer pick is
  // compared on the part that could have been sent.
  const picked = [...new Set(pickedUrls)];
  return picked.length >= had.size && picked.filter((u) => had.has(u)).length === had.size && (picked.length === had.size || had.size >= SCAN_LIMIT);
}

/** The time the scan may take, leaving room inside the 300s function limit for the write-up and the render. */
export function scanDeadline(startedAt: number, now = Date.now()): number {
  const budget = Math.max(20_000, Number(process.env.COMMERCIAL_SCAN_BUDGET_MS) || 170_000);
  return Math.min(now + budget, startedAt + 215_000);
}
