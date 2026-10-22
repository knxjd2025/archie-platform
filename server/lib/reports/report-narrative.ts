/**
 * The property-specific narrative for a Proposal / Presentation: an in-depth
 * "Inspection Findings" write-up and an "Our Recommended Solution" that
 * argues from those findings to the fix.
 *
 * inspection-findings.ts and recommended-solution.ts already do this well
 * (guardrails: nothing invented, no AI voice, no GC-license claims, storm
 * language fenced, claim mode for insurance jobs). They were orphaned when
 * the scroll documents replaced the old proposal. This module feeds them —
 * with one difference: the photo digest is built from the analysis the
 * report ALREADY stores, not by re-reading the photos. The narrative is
 * therefore grounded in exactly the findings the customer sees on the same
 * document, and costs one text call rather than a second vision pass.
 *
 * Always best-effort: any failure returns null and the document simply has
 * no narrative chapters. The rep sees and can edit the text before sending
 * (draft.ts, the report editor).
 */
import { synthesize, scrubVoice, scrubGapLanguage, scrubClaimLanguage, stripPlaceholderSections } from './inspection-findings.js';
import { INSPECTION_FORM_FIELDS } from '../../../shared/inspection-form';
import { COMMERCIAL_INSPECTION_FIELDS } from '../../../shared/commercial-inspection-form';
import { buildRecommendedSolution } from './recommended-solution.js';
import { plainLanguageFor } from './plain-language-damage.js';
import { isScanFindingType } from './commercial-photo-scan.js';

export interface ReportNarrative {
  findings: string;
  solution: string | null;
  generatedAt: string;
}

export interface NarrativeInput {
  report: any;
  customer?: string;
  inspectorNotes?: string | null;
  /** The rep's "Overall damage summary" from the field checklist — authoritative. */
  damageSummary?: string | null;
  /** The full checklist answer set, keyed by field name. */
  answers?: Record<string, unknown> | null;
  recommendation?: string | null;
  recommendedProduct?: string;
  squares?: number | null;
  jobType?: 'retail' | 'insurance';
  /** The "Our Recommended Solution" argument — a sales chapter, so off for the Inspection. Default true. */
  wantSolution?: boolean;
}

export function narrativeEnabled(): boolean {
  if (process.env.REPORT_NARRATIVE === 'off') return false;
  return !!process.env.GROQ_API_KEY;
}

const STORM_TYPES = new Set(['hail_damage', 'wind_damage']);

/**
 * The stored per-photo analysis, in the shape the synthesizer was written
 * for (see analyzePhotos in inspection-findings.ts) — including the storm
 * fence line, which is what keeps a retail write-up from inventing a claim.
 */
export function digestStoredAnalysis(report: any): string {
  const d = report?.damageAnalysis;
  const photos: any[] = d?.photos ?? [];
  const lines: string[] = [];
  if (d?.roofAge?.roofMaterial) lines.push(`Roof material: ${d.roofAge.roofMaterial}.`);
  if (d?.roofAge?.materialCondition) lines.push(`Overall assessed condition: ${d.roofAge.materialCondition}.`);
  if (d?.aiSummary) lines.push(`Summary: ${d.aiSummary}`);

  const seen = new Map<string, { label: string; severity: string; locations: string[]; descriptions: string[]; count: number; type: string }>();
  for (const p of photos) {
    for (const x of p?.damages ?? []) {
      const key = `${x.type}|${x.label}`;
      const cur = seen.get(key);
      if (cur) {
        cur.count += 1;
        if (x.location && !cur.locations.includes(x.location)) cur.locations.push(x.location);
        if (x.description && cur.descriptions.length < 3 && !cur.descriptions.includes(x.description)) cur.descriptions.push(x.description);
        continue;
      }
      seen.set(key, { type: x.type, label: x.label || plainLanguageFor(x.type).label, severity: x.severity, locations: x.location ? [x.location] : [], descriptions: x.description ? [x.description] : [], count: 1 });
    }
  }
  const items = [...seen.values()];
  if (items.length) {
    lines.push('Distinct conditions observed across the photos (deduplicated; use ALL of these — do not drop any):');
    for (const i of items) {
      // A commercial scan finding carries its own wording; the residential
      // plain-language table has no entry for a membrane roof.
      const bits = [
        isScanFindingType(i.type) ? i.label : plainLanguageFor(i.type).label,
        i.severity ? `severity ${i.severity}` : '',
        i.count > 1 ? `seen in ${i.count} places` : '',
        i.locations.length ? `location: ${i.locations.slice(0, 3).join('; ')}` : '',
      ].filter(Boolean).join('; ');
      const detail = i.descriptions.length ? ` Observed: ${i.descriptions.join(' ')}` : '';
      lines.push(`- ${bits}.${detail}`);
    }
    const storm = items.filter((i) => STORM_TYPES.has(i.type));
    lines.push(storm.length
      ? `STORM-CATEGORY observations (the ONLY items permitted under "Possible Storm-Related Indicators", each stated as possible/pending adjuster): ${storm.map((i) => `${i.label} (${i.severity}${i.locations[0] ? `, ${i.locations[0]}` : ''})`).join('; ')}.`
      : 'STORM-CATEGORY observations: NONE. Do NOT include any storm/hail/wind indicator and OMIT the storm section entirely.');
  } else {
    lines.push('No distinct defects were flagged by the photo analysis.');
    lines.push('STORM-CATEGORY observations: NONE. Omit the storm section.');
  }
  const s = report?.stormHistory;
  if (s?.totalEvents) {
    lines.push(`NOAA storm records within ${s.searchRadiusMiles ?? 5} miles over ${s.yearsAnalyzed ?? 3} years: ${s.totalEvents} events (${s.hailEvents ?? 0} hail, ${s.windEvents ?? 0} wind)${s.largestHailInches ? `; largest hail ${s.largestHailInches}"` : ''}${s.highestWindMph ? `; highest wind ${s.highestWindMph} mph` : ''}.`);
  }
  if (report?.repConfirmedStorm?.date) {
    lines.push(`Inspector-documented storm: ${report.repConfirmedStorm.type} on ${report.repConfirmedStorm.date}.`);
  }
  return lines.join('\n');
}

/**
 * Every field on both checklists, in checklist order, except identity and
 * sign-off fields (who, when, signature, reviewer) that say nothing about
 * the roof. A hand-picked subset used to drop the gutters, ground view,
 * siding, soffit, solar and storm answers on the floor — the write-up was
 * thinner than what the inspector had actually recorded.
 */
const NOT_ABOUT_THE_ROOF = new Set(['Inspection Date', 'Inspector Name', 'Inspector Signature', 'Reviewed by', 'Full photo package complete', 'Overall damage summary', 'Overall condition summary', 'Recommendation']);
const ANSWER_FIELDS = Array.from(new Set([...INSPECTION_FORM_FIELDS, ...COMMERCIAL_INSPECTION_FIELDS].map((f) => f.name))).filter((n) => !NOT_ABOUT_THE_ROOF.has(n));

/** The rep's own documentation, the authoritative input. */
export function inspectorTextFrom(input: NarrativeInput): string {
  const parts: string[] = [];
  if (input.damageSummary?.trim()) parts.push(`Inspector's overall damage summary: ${input.damageSummary.trim()}`);
  if (input.recommendation?.trim()) parts.push(`Inspector's recommendation: ${input.recommendation.trim()}`);
  const answers = input.answers ?? {};
  for (const f of ANSWER_FIELDS) {
    const v = answers[f];
    if (v == null || v === '' || (Array.isArray(v) && !v.length)) continue;
    parts.push(`${f}: ${Array.isArray(v) ? v.join(', ') : String(v)}`);
  }
  if (input.inspectorNotes?.trim()) parts.push(`Rep notes: ${input.inspectorNotes.trim()}`);
  return parts.join('\n');
}

export async function buildReportNarrative(input: NarrativeInput): Promise<ReportNarrative | null> {
  const groqKey = process.env.GROQ_API_KEY;
  if (!narrativeEnabled() || !groqKey) return null;
  const inspectorText = inspectorTextFrom(input);
  const digest = digestStoredAnalysis(input.report);
  const hasFindings = (input.report?.damageAnalysis?.photos ?? []).some((p: any) => (p?.damages ?? []).length);
  // Nothing to write from: no rep documentation and no findings.
  if (!inspectorText && !hasFindings) return null;
  const claim = input.jobType === 'insurance';

  let raw = '';
  try { raw = await synthesize(inspectorText, digest, groqKey, claim); } catch { return null; }
  if (!raw) return null;
  let findings = scrubVoice(scrubGapLanguage(stripPlaceholderSections(raw)));
  if (claim) findings = scrubClaimLanguage(findings);
  if (!findings.trim()) return null;

  let solution: string | null = null;
  if (input.wantSolution === false) return { findings, solution, generatedAt: new Date().toISOString() };
  try {
    const built = await buildRecommendedSolution({
      findingsText: findings,
      customer: input.customer,
      billableSquares: input.squares ?? undefined,
      recommendedShingle: input.recommendedProduct,
      inspectorNote: [input.damageSummary, input.recommendation ? `Recommendation: ${input.recommendation}` : ''].filter(Boolean).join(' '),
      mode: claim ? 'claim' : 'proposal',
    });
    solution = built?.text ?? null;
  } catch { solution = null; }

  return { findings, solution, generatedAt: new Date().toISOString() };
}
