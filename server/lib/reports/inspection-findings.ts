/**
 * Inspection Findings builder. Gathers the inspector's REAL documentation for a
 * job — comments/messages, task notes, uploaded inspection-report PDFs — plus a
 * structured AI read of the roof photos and any description from the report
 * request, then synthesizes an IN-DEPTH, component-by-component "Inspection
 * Findings" section.
 *
 * Depth comes from feeding the synthesizer MORE real signal (more photos, the
 * full structured per-area vision detail, and the inspector's own write-ups) —
 * never from invention.
 *
 * Guardrails (hard): never invent damage or conditions; only report what the
 * inputs support; storm/wind/hail is ONLY ever "possible, pending verification
 * by an insurance adjuster" — never asserted as confirmed; replace-vs-repair
 * follows the documented condition (reports are repair-first); omit any component
 * subsection that has no grounded observation.
 */
import type { JobTreadClient } from '../../integrations/jobtread.js';
import { analyzeRoofImageWithFallback, analyzeRoofImageWithGemini, combineAnalysisResults, type RoofAnalysisResult } from './groq-vision.js';
import { esc } from './report-theme.js';
import { companyBrand } from './company-brand.js';
import { isCertainTeedCredentialed } from './certainteed-data.js';

/**
 * pdf-parse is pinned at v1 (CJS) but may be hoisted to v2 (ESM) in some
 * installs. Import it lazily and tolerate either export shape so the build
 * type-checks regardless of which version resolves.
 */
async function parsePdf(buf: Buffer): Promise<{ text?: string }> {
  const mod = await import('pdf-parse');
  const fn = ((mod as any).default ?? mod) as (b: Buffer) => Promise<{ text?: string }>;
  return fn(buf);
}

const SYNTH_MODEL = process.env.GROQ_REPORT_MODEL || 'llama-3.3-70b-versatile';
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
// How many photos to AI-analyze. More photos = deeper, better-grounded findings.
const PHOTO_SAMPLE = Math.max(4, Math.min(24, Number(process.env.GROQ_FINDINGS_PHOTO_SAMPLE) || 16));

export interface FindingsInput {
  jobId?: string;
  /** Hosted image URLs to AI-analyze (a sample is taken). */
  photoUrls?: string[];
  /** Free text from the report-request email / description. */
  emailDescription?: string;
  /** 'claim' biases the findings toward the storm/wind damage (the covered peril) and
   * suppresses age/end-of-life editorializing that a carrier would use to deny coverage. */
  mode?: 'proposal' | 'claim';
}

/** Pull the inspector's written documentation from every JobTread source. */
/** Comments the app itself posted on the job (report links and the like), which are not inspector notes. */
const isAutoComment = (m: string): boolean => /auto-generated/i.test(m) || /\/r\/[A-Za-z0-9_-]{16,}/.test(m);

async function gatherInspectorText(client: JobTreadClient, jobId: string): Promise<string> {
  const parts: string[] = [];
  try {
    const td: any = await client.paveQuery({ job: { $: { id: jobId }, description: {}, tasks: { $: { size: 25 }, nodes: { name: {}, description: {} } } } });
    if (td?.job?.description) parts.push(`Job description: ${td.job.description}`);
    for (const t of td?.job?.tasks?.nodes || []) if (t?.description) parts.push(`Task "${t.name}": ${t.description}`);
  } catch { /* non-fatal */ }
  try {
    const cd: any = await client.paveQuery({ job: { $: { id: jobId }, comments: { $: { size: 40, sortBy: [{ field: 'createdAt', order: 'asc' }] }, nodes: { message: {}, createdByUser: { name: {} } } } } });
    for (const c of cd?.job?.comments?.nodes || []) {
      if (c?.message && !isAutoComment(c.message)) parts.push(`Note (${c.createdByUser?.name || 'staff'}): ${c.message}`);
    }
  } catch { /* non-fatal */ }
  // uploaded inspection-report PDFs (paginated)
  try {
    const docs: any[] = [];
    let page: string | undefined;
    for (let p = 0; p < 3; p++) {
      const arg: any = page ? { size: 100, page } : { size: 100 };
      const d: any = await client.paveQuery({ job: { $: { id: jobId }, files: { $: arg, nextPage: {}, nodes: { name: {}, url: {} } } } });
      const f = d?.job?.files; (f?.nodes || []).forEach((n: any) => docs.push(n));
      if (!f?.nextPage) break; page = f.nextPage;
    }
    for (const pdf of docs.filter((f) => f.url && /\.pdf$/i.test(f.name || ''))) {
      try {
        const r = await fetch(pdf.url); const parsed = await parsePdf(Buffer.from(await r.arrayBuffer()));
        const txt = parsed.text || '';
        // Pull the most relevant excerpts: the roof section plus any
        // exterior/gutter/flashing/ventilation context, so the synthesis can be
        // specific rather than generic.
        const idx = txt.search(/ROOF\s*(SYSTEM|COVERING|SURFACE)?/i);
        const roofExcerpt = (idx >= 0 ? txt.slice(idx, idx + 4000) : txt.slice(0, 2400)).replace(/\s+/g, ' ').trim();
        if (roofExcerpt) parts.push(`Uploaded inspection report "${pdf.name}" (roof/exterior section): ${roofExcerpt}`);
      } catch { /* skip this pdf */ }
    }
  } catch { /* non-fatal */ }
  return parts.join('\n\n');
}

/** Evenly sample up to `PHOTO_SAMPLE` unique photo URLs from the set. */
function samplePhotos(photoUrls: string[]): string[] {
  const urls = [...new Set(photoUrls.filter(Boolean))];
  if (urls.length <= PHOTO_SAMPLE) return urls;
  const out: string[] = [];
  for (let i = 0; i < PHOTO_SAMPLE; i++) out.push(urls[Math.round((i * (urls.length - 1)) / (PHOTO_SAMPLE - 1))]);
  return [...new Set(out)];
}

/**
 * AI-read a representative sample of the photos and build a RICH, structured
 * digest of grounded observations (material, condition, every distinct damage
 * with severity/urgency/location, and the AI's repair notes). This detail is
 * what lets the synthesis be in-depth without inventing anything.
 */
async function analyzePhotos(photoUrls: string[], groqKey: string, geminiKey?: string): Promise<string> {
  const sample = samplePhotos(photoUrls);
  if (!sample.length) return '';
  const results: RoofAnalysisResult[] = [];
  for (const u of sample) {
    try {
      // Gemini 3.5 Flash is the primary roof-photo reader; fall back to Groq only
      // if Gemini fails (Groq's vision model has a tight daily token cap).
      let r = geminiKey ? await analyzeRoofImageWithGemini(u, geminiKey).catch(() => null) : null;
      if (!r || !r.success) r = await analyzeRoofImageWithFallback(u, groqKey, geminiKey);
      if (r) results.push(r);
    } catch { /* skip */ }
  }
  const ok = results.filter((r) => r && r.success);
  if (!ok.length) return '';

  const c = combineAnalysisResults(results);
  const lines: string[] = [];
  if (c.roof_material?.type) {
    const ch = (c.roof_material.characteristics || []).slice(0, 6).join(', ');
    lines.push(`Roof material (AI): ${c.roof_material.type}${ch ? ` — ${ch}` : ''}.`);
  }
  lines.push(`Overall AI-assessed condition: ${c.overall_condition}.`);

  const STORM = /hail|wind|storm/i;
  // Drop non-roof and speculative "hidden / shadow / unknown" noise — only real, observed conditions belong in a report.
  const NOISE = /no\s*roof\s*visible|not[_\s]?applicable|hidden\s*damage|shadow|obscured/i;
  const damages = (c.damages_detected || [])
    .filter((d) => !NOISE.test(`${d.damage_name} ${d.category}`))
    .filter((d) => !(/unknown/i.test(String(d.severity)) && Number(d.confidence) < 50))
    .slice(0, 16);
  if (damages.length) {
    lines.push(`Distinct conditions observed across the photos (deduplicated; use ALL of these — do not drop any):`);
    for (const d of damages) {
      const bits = [
        d.damage_name || 'condition',
        `severity ${d.severity}`,
        `${d.estimated_urgency} priority`,
        d.location_description ? `location: ${d.location_description}` : '',
        typeof d.confidence === 'number' ? `confidence ${d.confidence}` : '',
        d.category ? `category: ${d.category}` : '',
      ].filter(Boolean).join('; ');
      const rec = d.repair_recommendation ? ` Suggested action: ${d.repair_recommendation}.` : '';
      lines.push(`- ${bits}.${rec}`);
    }
    // Storm fence: list the ONLY observations allowed in the storm section.
    const stormItems = damages.filter((d) => STORM.test(`${d.category} ${d.damage_name}`));
    lines.push(stormItems.length
      ? `STORM-CATEGORY observations (the ONLY items permitted under "Possible Storm-Related Indicators", each stated as possible/pending adjuster): ${stormItems.map((d) => `${d.damage_name} (${d.severity}, ${d.location_description})`).join('; ')}.`
      : `STORM-CATEGORY observations: NONE. Do NOT include any storm/hail/wind indicator and OMIT the storm section entirely.`);
  } else {
    lines.push(`No distinct defects were flagged by the photo analysis.`);
    lines.push(`STORM-CATEGORY observations: NONE. Omit the storm section.`);
  }
  if ((c.recommendations || []).length) {
    lines.push(`Suggested next steps: ${c.recommendations.slice(0, 6).join(' ')}`);
  }
  return lines.join('\n');
}

/**
 * Who the report is from, for the AI prompts: the company's name, where it is,
 * and a CertainTeed credential only when the company has entered one. The
 * "honest, repair-first" stance is how every report is written, not a claim.
 */
export function promptCompanyLine(): string {
  const p = companyBrand();
  const where = p.cityState ? ` in ${p.cityState}` : '';
  const cred = isCertainTeedCredentialed() ? 'a CertainTeed-credentialed, ' : 'an ';
  return `${p.displayName} — ${cred}honest, repair-first ${p.trade || 'roofing'} company${where}`;
}

const findingsSystemPrompt = (): string => `You are a senior roofing inspector writing the "Inspection Findings" section of a report for ${promptCompanyLine()}. Write an IN-DEPTH, professional yet homeowner-friendly assessment.

ABSOLUTE RULES (legal — do not break):
1. Use ONLY the provided inputs. NEVER invent damage, measurements, ages, counts, timeframes, or conditions not supported by an input. Only cite a repair timeframe if it appears in the evidence (e.g. a "Suggested action" window).
2. STORM FENCE: The "Possible Storm-Related Indicators" section may ONLY reference observations explicitly listed under "STORM-CATEGORY observations". If that line says NONE, OMIT the storm section entirely. NEVER infer a storm/wind/hail cause from debris, staining, granule loss, weathering, age, biological/algae growth, or any non-storm item. Every storm bullet must be framed as "possible … pending verification by a licensed insurance adjuster", and never assert a claim is owed. EXCEPTION — INSPECTOR-DOCUMENTED STORM DAMAGE: when the inspector's note explicitly documents wind/hail/storm damage (an authoritative finding) and/or recommends an insurance claim, you MAY describe it as observed wind/storm damage (not merely "possible"), reference any documented storm dates, and recommend filing an insurance claim and an adjuster inspection. Even then, never state the claim is approved/owed or that coverage is guaranteed — the insurance adjuster makes the coverage determination.
3. REPLACE vs REPAIR: we are repair-first. Recommend replacement ONLY when an input documents it, and ATTRIBUTE it to that specific basis (e.g. "the inspector's note that the roof is at the end of its serviceable life"). Do NOT imply that minor/monitor-level photo wear corroborates replacement. Use the evidence's own severity and timeframe words — do NOT escalate to "urgent" unless an input says immediate/critical.
4. NO PHOTO COUNTS: NEVER mention how many photos or images were reviewed, the size of the photo set, or that the assessment is "based on N of M photos". Do not reference image counts anywhere. Just present the findings.
5. COMPLETENESS & ACTIONS: Use EVERY real observation in the inputs (do not drop items like roof-edge wear, debris/cleaning, chimney, or inspector-flagged siding); group under sensible headers (e.g. put chimney mortar/cap and chimney flashing together under "Flashings & Penetrations"). In the Recommendation, surface the concrete next steps using the suggested actions in the inputs, stated as the work we recommend/will perform.
6. OMIT EMPTY COMPONENTS: Include a component section ONLY when you have at least one ACTUAL OBSERVED condition for it. A recommendation to inspect/check an area is NOT an observation — if all you have for a component is a suggestion to inspect it, put that in the Recommendation section, never in its own component section. LEAVE OUT entirely any component you have no observed condition for. NEVER write a section body like "No specific observations are noted", "not assessable", "no issues", or "recommend on-site verification" — if you would write any of those, omit the whole section.
7. LOW-SLOPE/FLAT: If an input notes low-slope / flat roofing squares, briefly note that area's different considerations (only if noted).
8. THIS IS THE INSPECTION: these findings are made from the job's on-site inspection photos. NEVER defer a condition or finding to a future or separate visit — do NOT write that anything "will be confirmed on site", "after an on-site inspection", "pending an on-site assessment", and NEVER tell the homeowner to schedule, arrange, or get a "close-up", "physical", or any further inspection. The chimney, flashing, skylights, etc. are already documented; state recommended work as the work we will perform, not as an inspection to book. State what the inputs show. When the inspector's note states an overall condition (e.g. poor, end of serviceable life) that differs from any AI photo rating, the INSPECTOR'S assessment is authoritative — report the inspector's condition, not the AI's.
9. NEVER ADVERTISE MISSING INFORMATION: do NOT write that anything is "not specified", "not stated", "not determinable", "not available", "not provided", "unknown from the inputs", "no information", or similar — never call attention to a gap. Present only what the inputs DO show and silently omit the rest. DETERMINE THE OVERALL CONDITION by combining the inspector's notes with the AI photo observations: if the photos show dirt/debris, missing/damaged/creased shingles, granule loss, algae/moss, or other wear, the roof is NOT in good condition — describe it as dirty, worn, fair, or poor as the observations warrant; if the photos show a clean, intact roof, it is in good condition. ALWAYS lead with the inspector's notes (your primary source), then incorporate the photo observations.
10. OUR OWN VOICE: write as ${companyBrand().displayName}, first person ("we recommend", "we found"). NEVER mention "AI", an "AI review", "AI-assisted", "AI recommendations", a "photo analysis model", or any tooling — the reader must never see the machinery. Phrase recommendations as our own (e.g. "We recommend a professional low-pressure chemical cleaning…"), never "the AI recommendations suggest…".

OUTPUT FORMAT (Markdown-ish) — include ONLY sections that have real content; omit every other section:
"## Overview" — 4-7 sentences: the overall condition (lead with the inspector's note, then the photo observations), roof material/type if visible, approximate age/remaining life ONLY if grounded (otherwise OMIT age and remaining-life entirely — never say they're unknown or undeterminable), and the headline takeaway. Never state that any detail is missing from the inputs.
Then a "## " header ONLY for components that have an actual observation, each with 3-8 "- " bullets — use every real observation you have for that component rather than stopping at a token few; depth comes from the evidence, never from padding. Each bullet = a specific observation AND why it matters (the consequence, stated as general roofing knowledge and hedged with "may/can"). Choose only from headers the evidence supports, e.g.: "## Roof Covering (Shingles)", "## Flashings & Penetrations", "## Gutters, Fascia & Soffit", "## Siding & Exterior", "## Surface & Debris". Do NOT emit a header for a component you have nothing to report.
"## Possible Storm-Related Indicators" — ONLY per the STORM FENCE rule above.
"## Recommendation & Priority" — 5-9 sentences: the repair-vs-replace rationale ATTRIBUTED to its documented basis, what the photo evidence does vs does not show, and what is time-sensitive (using the evidence's own urgency words) vs what can be monitored.

STYLE: factual, specific, confident, no hype, no markdown bold/asterisks, no emojis. Reference real observed locations/severities to stay concrete.

DEPTH: this document is read at a kitchen table by a homeowner deciding whether to spend thousands of dollars, and later by an adjuster. Write it in full. For each observation give the specific location, what was seen, and why it matters to the roof's performance — a bullet that states a condition without its consequence is half-written. Never pad: length must come from covering every real observation thoroughly, never from repeating yourself, restating the overview, or adding filler sentences. If the evidence is genuinely thin, a short honest section beats an inflated one.`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Synthesis model + fallback chain. Each Groq model has its own per-day token cap
// (TPD); when the primary is exhausted we transparently fall through to the next so
// a single model's daily limit never drops a report's findings/solution.
const SYNTH_FALLBACKS = (process.env.GROQ_REPORT_FALLBACKS || 'openai/gpt-oss-120b,qwen/qwen3-32b,llama-3.1-8b-instant')
  .split(',').map((s) => s.trim()).filter(Boolean);
export const SYNTH_MODELS: string[] = [...new Set([SYNTH_MODEL, ...SYNTH_FALLBACKS])];

/**
 * Call Groq chat completions across the synthesis model chain. Retries transient
 * per-minute rate limits and 5xx on the same model, but jumps straight to the next
 * model on a per-day (TPD) cap or a model-unavailable error. Throws only if every
 * model fails.
 */
export async function groqChatWithFallback(
  groqKey: string,
  messages: Array<{ role: string; content: string }>,
  opts: { temperature?: number; maxTokens?: number } = {},
): Promise<string> {
  const { temperature = 0.2, maxTokens = 1600 } = opts;
  let lastErr = '';
  for (const model of SYNTH_MODELS) {
    const body = JSON.stringify({ model, temperature, max_tokens: maxTokens, messages });
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await fetch(GROQ_URL, { method: 'POST', headers: { Authorization: `Bearer ${groqKey}`, 'Content-Type': 'application/json' }, body });
      if (res.ok) { const j: any = await res.json(); return (j.choices?.[0]?.message?.content || '').trim(); }
      const text = await res.text().catch(() => '');
      lastErr = `Groq ${res.status} [${model}]: ${text.slice(0, 200)}`;
      const isDailyCap = res.status === 429 && /per day|TPD/i.test(text);
      if (isDailyCap || (res.status !== 429 && res.status < 500)) break; // next model: daily cap or hard 4xx
      const retryAfter = Number(res.headers.get('retry-after'));
      const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 20000) : 1500 * 2 ** attempt;
      await sleep(waitMs);
    }
  }
  throw new Error(lastErr || 'Groq synthesis failed (all models)');
}

const CLAIM_DIRECTIVE = `\n\nINSURANCE-CLAIM CONTEXT (overrides tone, not honesty): This is documentation for a storm/wind insurance claim. LEAD with the storm/wind damage as the headline finding (it is the covered peril) and describe it clearly.
- NEVER use the phrase "wear and tear" — it is a NAMED EXCLUSION in homeowner policies; volunteering it hands the carrier a denial. Also never use "deterioration", "marring", or call the damage age/maintenance-related.
- Do NOT give the roof an overall condition GRADE or verdict ("fair", "good", "poor", "average", "aged"). State only the specific observed conditions; never an aggregate condition rating.
- Do NOT conclude the roof is "old", "worn out", "weathered out", or "at/nearing the end of its serviceable life", and do not editorialize about age or remaining life at all.
- Use OBSERVED / DOCUMENTED / "consistent with" framing — do NOT assert as adjudicated fact that the roof "has sustained" covered damage; the adjuster confirms causation and coverage.
- Only describe wind-damage signatures (e.g. creasing, lifting, tearing, missing tabs) that are ACTUALLY in the photo observations — NEVER introduce a signature the observations don't support (do not add "creased" if creasing isn't documented).
- Do NOT mention Good/Better/Best packages, tiers, or any pricing.`;

export async function synthesize(inspectorText: string, photoDigest: string, groqKey: string, claim = false): Promise<string> {
  const user = `INSPECTOR NOTES / UPLOADED INSPECTION REPORT / REQUEST EMAIL:\n${inspectorText || '(none provided)'}\n\nSTRUCTURED AI PHOTO OBSERVATIONS:\n${photoDigest || '(no photo analysis available)'}\n\nWrite the in-depth Inspection Findings now, following the format and the absolute rules.${claim ? CLAIM_DIRECTIVE : ''}`;
  // 1600 tokens could not hold an Overview, five component sections, a storm
  // section and a Recommendation — the model ran out mid-report and the
  // findings read thin. It binds harder now that ~40 photos are analysed
  // rather than 8, so there is far more real observation to write from.
  const maxTokens = Math.min(Math.max(Number(process.env.REPORT_FINDINGS_TOKENS) || 4000, 1600), 8000);
  return groqChatWithFallback(groqKey, [{ role: 'system', content: findingsSystemPrompt() }, { role: 'user', content: user }], { temperature: 0.2, maxTokens });
}

// Phrasings that mean "nothing was actually observed here" — banned as a section body.
const PLACEHOLDER = /\b(no specific observations?|not assessable|no (?:issues|observations)\b|recommend(?:ed)? (?:an? )?on-site verification|no (?:visible )?(?:damage|defects?) (?:were|was|are) (?:noted|observed|found))\b/i;

// Phrases that advertise missing information — a reader should never wonder what
// "inputs" exist. Sentences/clauses containing these are scrubbed (the substantive
// part after a contrast conjunction is kept).
const GAP_PHRASE = /\b(not (?:determinable|specified|stated|provided|available|mentioned|known|clear|assessable|indicated|given)|cannot be (?:determined|assessed|established)|isn'?t (?:clear|determinable|specified|known|provided)|no (?:information|data|details?) (?:on|about|regarding|provided|available)|(?:from|in|based on) the (?:provided )?(?:inputs|information|data|materials?))\b/i;

/**
 * Deterministically remove any language that advertises missing information
 * ("not determinable from the inputs", "the roof material is not specified", etc.).
 * If a gap clause is followed by a contrast ("…, but its condition suggests…"),
 * the substantive clause is kept; otherwise the whole sentence is dropped.
 */
export function scrubGapLanguage(text: string): string {
  if (!text) return text;
  const cap = (x: string) => (x ? x.charAt(0).toUpperCase() + x.slice(1) : x);
  const ensureEnd = (x: string) => (/[.?!]$/.test(x) ? x : x + '.');
  const fixSentence = (s: string): string => {
    const t = s.trim();
    if (!GAP_PHRASE.test(t)) return t;
    // "<before>, but/however <after>" → keep whichever clause has no gap.
    const conj = t.match(/^(.*?),\s+(?:but|however|although|though|yet|while)\s+(.+)$/i);
    if (conj) {
      const before = conj[1].trim(), after = conj[2].trim();
      if (!GAP_PHRASE.test(after) && GAP_PHRASE.test(before)) return ensureEnd(cap(after));
      if (!GAP_PHRASE.test(before)) return ensureEnd(before);
    }
    return ''; // a sentence purely about a gap → drop it
  };
  const out = text.split(/\r?\n/).map((line) => {
    const prefix = (line.match(/^(#{1,6}\s+|\s*[-*•]\s+)/) || [''])[0];
    const body = line.slice(prefix.length);
    const sentences = body.match(/[^.?!]+[.?!]*/g) || (body ? [body] : []);
    const kept = sentences.map(fixSentence).filter(Boolean).map((s) => s.trim()).join(' ');
    return { prefix, body: kept };
  }).filter((l) => /^#{1,6}\s/.test(l.prefix) || l.body.length > 0)
    .map((l) => (l.prefix + l.body)).join('\n');
  // Strip any residual literal mentions of "inputs / provided information" and tidy.
  return out.replace(/\s*\b(?:from|in|based on) the (?:provided )?(?:inputs|information|data|materials?)\b/gi, '').replace(/ {2,}/g, ' ').replace(/\s+([.,;:])/g, '$1');
}

/**
 * Deterministic backstop that keeps customer-facing copy in the company's own voice: removes any
 * "AI"/"AI recommendations"/"AI-assisted" exposure, and drops clauses that tell the reader
 * to schedule a separate/close-up/physical inspection (reports are made FROM the site photos).
 */
export function scrubVoice(text: string): string {
  if (!text) return text;
  let out = text;
  out = out
    .replace(/\bthe\s+AI\s+recommendations?\s+(?:suggest|recommend|note|indicate|advise)s?\b/gi, 'we recommend')
    .replace(/\bAI\s+recommendations?\s+(?:suggest|recommend|note|indicate|advise)s?\b/gi, 'we recommend')
    .replace(/\ban?\s+AI[-\s]?assisted\b/gi, 'a')
    .replace(/\bAI[-\s]?assisted\b/gi, '')
    .replace(/\bAI\s+recommendations?\b/gi, 'our recommendations')
    .replace(/\bthe\s+AI(?:'s)?\s+(review|analysis|assessment|observations?)\b/gi, 'our $1')
    .replace(/\bAI[-\s]?(review|analysis|assessment)\b/gi, '$1');
  // Drop "scheduling/arranging a (close-up/physical/on-site) inspection …" — we don't book second visits.
  out = out.replace(/,?\s*(?:and\s+|as well as\s+|along with\s+)?(?:scheduling|schedule|arranging|arrange|getting|having)\s+(?:a|an)\s+(?:close[-\s]?up\s+|detailed\s+|professional\s+|further\s+|separate\s+)*(?:physical|on[-\s]?site|onsite|close[-\s]?up)\s+(?:inspection|assessment|evaluation)\b[^.;]*/gi, '');
  // Reframe any "<qualifier> inspection (and repair) of X" as the actual work, not a separate
  // in-person inspection (the report is made FROM the site photos). Qualifiers cover the many
  // ways the model phrases it (close-up / hands-on / manual / physical / on-site / in-person …).
  const QUAL = '(?:close[-\\s]?up|hands[-\\s]?on|manual|physical|on[-\\s]?site|onsite|in[-\\s]?person|detailed|further|additional|professional|thorough)';
  out = out
    .replace(new RegExp(`\\b(?:conduct|perform|carry out|complete|do|get|have|schedule|arrange|recommend)\\s+(?:a |an |another )?(?:${QUAL}[-\\s]+)*(?:inspection|assessment|evaluation)\\s+(?:and\\s+repair\\s+)?of\\b`, 'gi'), 'address')
    .replace(new RegExp(`\\b(?:a |an )?(?:${QUAL}[-\\s]+)+(?:inspection|assessment|evaluation)\\s+and\\s+repair\\s+of\\b`, 'gi'), 'repair of')
    .replace(new RegExp(`\\b(?:a |an )?(?:${QUAL}[-\\s]+)+(?:inspection|assessment|evaluation)\\s+of\\b`, 'gi'), 'attention to');
  out = out.replace(/ {2,}/g, ' ').replace(/\s+([.,;:])/g, '$1').replace(/\(\s*\)/g, '').trim();
  // Re-capitalize sentence starts and line starts (our replacements can lowercase a new sentence).
  out = out.replace(/(^|[.!?]\s+|\n\s*(?:-\s*)?)([a-z])/g, (_m, pre, c) => pre + c.toUpperCase());
  return out;
}

/**
 * CLAIM-mode backstop: strip language a carrier weaponizes to deny a storm claim — the
 * named policy exclusion "wear and tear", and any aggregate condition GRADE ("fair/poor").
 */
export function scrubClaimLanguage(text: string): string {
  if (!text) return text;
  let out = text;
  // Drop concessive "while there are signs of wear and tear, …" clauses outright.
  out = out.replace(/\b(?:while|although|though)\s+there\s+(?:are|is)\s+(?:various\s+|some\s+|other\s+|minor\s+|several\s+)*signs?\s+of\s+wear[-\s]and[-\s]tear\s*,?\s*/gi, '');
  // Any remaining "wear and tear" → neutral, non-exclusion wording.
  out = out.replace(/\b(?:various\s+|general\s+|normal\s+|other\s+|signs?\s+of\s+)?wear[-\s]and[-\s]tear\b/gi, 'minor surface conditions');
  // Drop any sentence that assigns an overall condition grade (an age/maintenance denial hook).
  out = out
    .split(/(?<=[.!?])\s+/)
    .filter((s) => !/\boverall condition\b[^.!?]*\bis\s+(?:fair|good|poor|average|aged)\b/i.test(s))
    .join(' ');
  out = out.replace(/ {2,}/g, ' ').replace(/\s+([.,;:])/g, '$1').replace(/^\s*[,;:]\s*/, '').trim();
  out = out.replace(/(^|[.!?]\s+|\n\s*(?:-\s*)?)([a-z])/g, (_m, pre, c) => pre + c.toUpperCase());
  return out;
}

/**
 * Deterministically enforce the "omit empty/unknown components" standard: drop any
 * component section whose body has no real observed condition (only placeholder
 * text, or empty). Overview and Recommendation are always kept.
 */
export function stripPlaceholderSections(text: string): string {
  if (!text) return text;
  return text
    .split(/\n(?=#{1,6}\s)/)
    .filter((block) => {
      const h = block.match(/^#{1,6}\s+(.*)/);
      if (!h) return true; // leading preamble, if any
      if (/^\s*(overview|recommendation|priority)/i.test(h[1])) return true; // always keep
      const bodyLines = block.replace(/^#{1,6}.*(\r?\n|$)/, '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      if (!bodyLines.length) return false; // empty section
      // keep only if at least one body line is a real observation (not a placeholder)
      return bodyLines.some((l) => !PLACEHOLDER.test(l));
    })
    .join('\n')
    .trim();
}

/**
 * Render the in-depth findings text into a branded HTML section.
 * Convention from the synthesizer: "## Header" = subsection, "- " = bullet,
 * everything else = paragraph.
 */
export function renderFindingsSection(findingsText: string): string {
  if (!findingsText || !findingsText.trim()) return '';
  const clean = findingsText.trim().replace(/\*\*/g, '');
  const lines = clean.split(/\r?\n/);
  const out: string[] = [];
  let inList = false;
  const closeList = () => { if (inList) { out.push('</ul>'); inList = false; } };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { closeList(); continue; }
    const header = line.match(/^#{1,6}\s+(.*)$/);
    if (header) {
      closeList();
      out.push(`<h3 class="findings-h" style="margin:18px 0 6px;font-size:16px">${esc(header[1].replace(/[:]\s*$/, ''))}</h3>`);
      continue;
    }
    const bullet = line.match(/^[-*•]\s+(.*)$/);
    if (bullet) {
      if (!inList) { out.push('<ul style="margin:4px 0 10px;padding-left:20px">'); inList = true; }
      out.push(`<li style="margin:4px 0">${esc(bullet[1])}</li>`);
      continue;
    }
    // A short label-style line ("Overall condition:") with no trailing sentence → treat as header.
    const label = line.match(/^([A-Z][A-Za-z &/]{2,40}):\s*$/);
    if (label) {
      closeList();
      out.push(`<h3 class="findings-h" style="margin:18px 0 6px;font-size:16px">${esc(label[1])}</h3>`);
      continue;
    }
    closeList();
    // Inline "Label: text" → bold the label.
    const inline = line.match(/^([A-Z][A-Za-z &/]{2,40}):\s+(.*)$/);
    if (inline) {
      out.push(`<p style="margin:8px 0"><b>${esc(inline[1])}:</b> ${esc(inline[2])}</p>`);
    } else {
      out.push(`<p style="margin:8px 0">${esc(line)}</p>`);
    }
  }
  closeList();

  return `<section class="sec">
    <div class="sec-head"><h2>Inspection Findings</h2></div>
    ${out.join('\n    ')}
    <p class="fineprint" style="margin-top:14px">Findings reflect our visual inspection of the roof and the documentation from our site photos. Any storm-related damage noted is preliminary and subject to verification by a licensed insurance adjuster.</p>
  </section>`;
}

/**
 * Build the in-depth Inspection Findings section for a job. Returns null when
 * nothing can be synthesized (no GROQ key, or no inspector text and no photos).
 * Also returns the raw `sources` (inspector text + photo digest) so callers can
 * audit the findings for grounding.
 */
export async function buildInspectionFindings(
  client: JobTreadClient,
  input: FindingsInput,
): Promise<{ html: string; text: string; sources: { inspectorText: string; photoDigest: string } } | null> {
  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) return null;
  const geminiKey = process.env.GEMINI_API_KEY;
  const jtText = input.jobId ? await gatherInspectorText(client, input.jobId).catch(() => '') : '';
  const inspectorText = [input.emailDescription, jtText].filter(Boolean).join('\n\n');
  // Pass the Gemini key so photo analysis falls back to Gemini when Groq vision is
  // unavailable (e.g. its daily token quota is exhausted) — keeps the findings
  // grounded in the actual photos rather than going blind on condition.
  const photoDigest = input.photoUrls?.length
    ? await analyzePhotos(input.photoUrls, groqKey, geminiKey).catch(() => '')
    : '';
  if (!inspectorText && !photoDigest) return null;
  let raw = '';
  try { raw = await synthesize(inspectorText, photoDigest, groqKey, input.mode === 'claim'); } catch { return null; }
  if (!raw) return null;
  let text = scrubVoice(scrubGapLanguage(stripPlaceholderSections(raw)));
  if (input.mode === 'claim') text = scrubClaimLanguage(text);
  if (!text) return null;
  return { html: renderFindingsSection(text), text, sources: { inspectorText, photoDigest } };
}
