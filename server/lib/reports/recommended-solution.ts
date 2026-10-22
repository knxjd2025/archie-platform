/**
 * "Our Recommended Solution" builder. Given the synthesized inspection findings
 * (and roof context), it writes an honest, plain-language section that BRIDGES
 * the findings to the fix: what we recommend, why it resolves the specific
 * issues found, and what the work involves.
 *
 * Guardrails (hard): repair-first (recommend the least-invasive path the findings
 * support); only claim what the CertainTeed Integrity Roof System and the stated
 * warranty actually provide; never guarantee a problem-free future; never invent
 * conditions; tie the solution to the ACTUAL findings provided.
 */
import { esc } from './report-theme.js';
import { scrubGapLanguage, scrubVoice, scrubClaimLanguage, groqChatWithFallback } from './inspection-findings.js';

export interface SolutionInput {
  /** Plain text of the synthesized Inspection Findings. */
  findingsText?: string;
  customer?: string;
  billableSquares?: number;
  /** Recommended shingle/package, e.g. "CertainTeed Landmark Solaris". */
  recommendedShingle?: string;
  /** The authoritative inspector note / request description — use its specifics (e.g. a repair-coverage proportion like ~85%). */
  inspectorNote?: string;
  /** 'claim' frames the scope for an insurance claim: no Good/Better/Best tiers, no retail
   * pricing, no age/end-of-life framing; the scope is what's needed to restore the storm damage. */
  mode?: 'proposal' | 'claim';
}

const SYS_PROMPT = `You write the "Our Recommended Solution" section of a roof proposal for Best Roofing Now (BRN) — a CertainTeed-certified, honest, repair-first roofer in Charlotte NC. Connect the inspection findings to the fix in plain, confident, homeowner-friendly language.

RULES (do not break):
- REPAIR-FIRST: recommend the least-invasive path the findings support. Only recommend a full replacement when the findings document end-of-life condition, widespread failure, or the inspector's note calls for it. If the findings show mostly minor/monitor-level wear, recommend targeted repairs / maintenance instead, and say a full replacement is not yet warranted.
- GROUND EVERYTHING in the provided findings. Tie the recommended work to the SPECIFIC issues found (e.g. "the granule loss and curling noted across the field" → why a full re-roof addresses it). Never invent conditions or findings.
- HONEST SCOPE: describe what BRN does — a complete tear-off and a full CertainTeed Integrity Roof System (waterproofing underlayment, synthetic underlayment, starter, the shingle, hip & ridge caps, balanced ventilation), installed by BRN's own crews, with full cleanup and a magnetic nail sweep. For the steep-slope roof, the homeowner chooses from Good / Better / Best shingle packages.
- MIXED / LOW-SLOPE ROOFS: If the findings indicate a low-slope section (or that architectural shingles on a low slope are non-compliant / against code), your solution MUST state that the low-slope section is re-roofed with an appropriate low-slope material — a flat-roof membrane, or the specific material the findings direct (e.g. a flat-style material or 3-tab) — NOT architectural shingles. The Good/Better/Best architectural package applies only to the steep-slope sections. Never imply a single architectural shingle (e.g. Landmark/Solaris) covers a low-slope area.
- WHY NOT A REPAIR (REQUIRED when the findings raise it): When the findings indicate a repair is possible but problematic, you MUST include a clear, substantive paragraph that explains, in concrete technical terms, WHY a repair is not a sound solution for THIS roof. Use ALL the documented reasons, for example: brittle materials that crack/break when worked around (creating new leaks); failing areas spread across most of the roof, so a "repair" would in practice require replacing the large majority of the roof anyway; patching would bond aging, failing materials into new work; and a short time-to-failure if given (e.g. more issues within ~2 years). CRITICAL — PROPORTIONS: ONLY state a specific percentage or fraction of the roof a repair would replace (e.g. "about 85%") if that exact figure is given in the inspector note or findings. If no proportion is provided, do NOT invent or estimate one — describe the spread qualitatively instead ("the large majority of the roof", "most of the field"). Never put a made-up statistic on the report. If a specific proportion IS provided, you MUST state that exact figure and the point that only a small isolated section, one that does not tie into the rest of the failing roof, could be left untouched (and even it has only a few years of life left). Make the reasoning specific and factual, then conclude that a full, proper replacement is the sound, cost-effective path. Keep it an objective professional assessment — NEVER reference buyers, sellers, negotiations, home sales, or who the report "helps".
- NO OVERPROMISING: never guarantee the roof will never leak or never have problems. Coverage is the manufacturer + workmanship warranty only. Do not state specific warranty year numbers here (the warranty section covers that).
- BRN'S OWN VOICE, NO SECOND VISIT: write as Best Roofing Now in the first person ("we recommend", "we will"). NEVER mention "AI" or an "AI review". NEVER tell the homeowner to schedule, arrange, conduct, or get a further/separate/close-up/hands-on/manual/physical/on-site inspection — the inspection is already done from the site photos. State recommended work (e.g. redo the chimney flashing, reseal the skylights) as the work WE will perform, not as an inspection to book.
- For AI-only storm/wind/hail observations, keep them "possible, pending an insurance adjuster" — never assert a claim. EXCEPTION: when the inspector's note documents wind/hail/storm damage and/or recommends a claim, you MAY state the roof has wind/storm damage and recommend filing an insurance claim plus an adjuster inspection (cite documented storm dates if given) — but never say the claim is approved/owed or coverage is guaranteed.

OUTPUT FORMAT (Markdown-ish): 3-5 substantive paragraphs — this is the argument the homeowner weighs a five-figure decision against, so make the reasoning complete rather than brief. Never pad: every sentence must carry a documented fact or its consequence. You MAY use one "## " sub-header and "- " bullets when listing how the solution addresses each issue. No markdown bold/asterisks, no emojis. Start by stating the recommended path clearly, then how it resolves the documented findings, then briefly what the work involves.`;

/** Render the solution text into a branded HTML section (reuses findings-style formatting). */
export function renderSolutionSection(text: string): string {
  if (!text || !text.trim()) return '';
  const clean = text.trim().replace(/\*\*/g, '');
  const lines = clean.split(/\r?\n/);
  const out: string[] = [];
  let inList = false;
  const closeList = () => { if (inList) { out.push('</ul>'); inList = false; } };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { closeList(); continue; }
    const header = line.match(/^#{1,6}\s+(.*)$/);
    if (header) { closeList(); out.push(`<h3 class="findings-h" style="margin:16px 0 6px;font-size:16px">${esc(header[1].replace(/[:]\s*$/, ''))}</h3>`); continue; }
    const bullet = line.match(/^[-*•]\s+(.*)$/);
    if (bullet) { if (!inList) { out.push('<ul style="margin:4px 0 10px;padding-left:20px">'); inList = true; } out.push(`<li style="margin:4px 0">${esc(bullet[1])}</li>`); continue; }
    closeList();
    out.push(`<p style="margin:8px 0">${esc(line)}</p>`);
  }
  closeList();
  return `<section class="sec">
    <div class="sec-head"><h2>Our Recommended Solution</h2><span class="n">From findings to fix</span></div>
    ${out.join('\n    ')}
  </section>`;
}

/**
 * Build the "Our Recommended Solution" section. Returns null when there's no
 * findings text to ground it (we never write a solution without findings) or no
 * GROQ key.
 */
export async function buildRecommendedSolution(input: SolutionInput): Promise<{ html: string; text: string } | null> {
  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) return null;
  const findings = (input.findingsText || '').trim();
  if (!findings) return null; // never produce a solution narrative ungrounded in findings

  const ctx = [
    input.billableSquares ? `Roof size: about ${input.billableSquares} squares.` : '',
    `Recommended package: ${input.recommendedShingle || 'CertainTeed Landmark Solaris (our Best package)'}.`,
  ].filter(Boolean).join(' ');
  const note = (input.inspectorNote || '').trim();
  const claimDirective = input.mode === 'claim'
    ? `\n\nINSURANCE-CLAIM CONTEXT: This is the recommended SCOPE for a storm/wind insurance claim, not a sales proposal. Describe the full replacement scope needed to properly restore the storm damage. Do NOT mention Good/Better/Best packages, tiers, shingle "choices", or ANY pricing — the carrier prices the scope. Do NOT call the roof old, aged, worn out, or "at/nearing the end of its serviceable life", and NEVER use the phrase "wear and tear" (a named policy exclusion) or give an overall condition grade (fair/good/poor). Only reference damage descriptors that ACTUALLY appear in the inspection findings above — do NOT introduce a wind signature (e.g. "creased") that the findings do not document. Frame the work as what is required to restore the roof after the documented storm damage.`
    : '';
  const user = `INSPECTION FINDINGS:\n${findings}\n\n${note ? `AUTHORITATIVE INSPECTOR NOTE (treat as fact; use its specifics verbatim where relevant — especially any proportion of the roof a repair would replace, e.g. ~85%, and any timeframe):\n${note}\n\n` : ''}CONTEXT: ${ctx}\n\nWrite the "Our Recommended Solution" section now, following the rules and tying the solution to these findings and the inspector note.${claimDirective}`;

  let text = '';
  try {
    // Model fallback chain: survives any single Groq model's per-day token cap.
    text = await groqChatWithFallback(groqKey, [{ role: 'system', content: SYS_PROMPT }, { role: 'user', content: user }], // 1100 tokens truncated the "why not a repair" paragraph the format
    // demands. This section is the argument the sale rests on.
    { temperature: 0.3, maxTokens: Math.min(Math.max(Number(process.env.REPORT_SOLUTION_TOKENS) || 2600, 1100), 5000) });
  } catch {
    return null;
  }
  if (!text) return null;
  let clean = scrubVoice(scrubGapLanguage(text));
  if (input.mode === 'claim') clean = scrubClaimLanguage(clean);
  return { html: renderSolutionSection(clean), text: clean };
}
