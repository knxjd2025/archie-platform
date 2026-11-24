/**
 * The plain functions behind "Rewrite": no database, no network.
 *
 *   promptFacts    what the model is asked about: that report's own findings and
 *                  the roof facts, cleaned and cut. Never a name, an address, a
 *                  contact, a note, an id, another report or another company.
 *   cleanRewrite   what comes back is untrusted text. Markup, fences, wrapping
 *                  quotes, control characters and em dashes are taken out and it
 *                  is cut to a length; a reply too short to be a narrative is
 *                  nothing at all.
 *   applyRewrite   the report with ONE piece of text changed (a copy; the
 *                  original is untouched). The result is stored only through the
 *                  normalizer (`sanitizeReportJson`), never straight.
 */
import { REWRITE_NO_SUCH } from '../../shared/roof-reports';
import { sanitizePromptText } from '../lib/roof-reports/prompt-sanitize.js';
import type { FindingSeverity, NarrativeFinding } from '../lib/roof-reports/comprehensive-roof-report.js';

export const MAX_FINDING_TEXT = 1500;
export const MAX_SUMMARY_TEXT = 2000;
const MIN_USEFUL = 20;
const MAX_FINDINGS = 40;

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g;
const SEVERITIES: readonly FindingSeverity[] = ['critical', 'high', 'moderate', 'minor', 'advisory', 'cosmetic'];

/** The model's reply as text safe to store, or '' when there is nothing usable in it. */
export function cleanRewrite(raw: unknown, max: number): string {
  if (typeof raw !== 'string') return '';
  let t = raw.replace(/\r\n?/g, '\n')
    .replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<\/?[a-zA-Z][^>]*>/g, ' ')
    .replace(/```[a-zA-Z]*/g, '')
    .replace(CONTROL, '')
    .replace(/\s*—\s*/g, ', ').replace(/–/g, '-');
  t = t.split('\n').map((l) => l.replace(/[ \t]+/g, ' ').trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  // A markdown heading or bullet at the start is formatting, not words.
  t = t.replace(/^(?:#{1,6}[ \t].*\n+)+/, '').replace(/^[-*][ \t]+/, '').trim();
  const wrapped = /^(["“])([\s\S]*)(["”])$/.exec(t);
  if (wrapped && !/["“”]/.test(wrapped[2])) t = wrapped[2].trim();
  t = t.replace(/[,;:\s]+$/, '');
  if (t.length > max) {
    const cut = t.slice(0, max);
    const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('.\n'), cut.endsWith('.') ? cut.length - 1 : -1);
    t = end >= max * 0.4 ? cut.slice(0, end + 1) : `${cut.slice(0, max - 1).trimEnd()}.`;
  }
  return t.length >= MIN_USEFUL ? t : '';
}

export type RewriteBody = { ok: true; index: number } | { ok: false; error: string };

/** The body of "rewrite this finding": the finding's place in the list, and nothing else. */
export function parseRewriteBody(body: unknown, findingCount: number): RewriteBody {
  const fail: RewriteBody = { ok: false, error: REWRITE_NO_SUCH };
  if (!body || typeof body !== 'object' || Array.isArray(body)) return fail;
  const keys = Object.keys(body);
  if (keys.length !== 1 || keys[0] !== 'index') return fail;
  const index = (body as { index: unknown }).index;
  return typeof index === 'number' && Number.isInteger(index) && index >= 0 && index < findingCount ? { ok: true, index } : fail;
}

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const finite = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

export interface PromptFacts {
  roofDetails?: { material?: string; squares?: number; pitch?: string };
  stormHistory?: { totalEvents: number; yearsAnalyzed: number; riskLevel: 'low' | 'medium' | 'high' };
  findings: Array<Pick<NarrativeFinding, 'title' | 'severity' | 'narrative'>>;
}

/** What a rewrite may tell the model: this report's findings and the roof facts, and nothing that names a person or a place. */
export function promptFacts(report: unknown): PromptFacts {
  const r = obj(report);
  const out: PromptFacts = {
    findings: (Array.isArray(r.structuredFindings) ? r.structuredFindings : []).slice(0, MAX_FINDINGS).map((f) => {
      const x = obj(f);
      return {
        title: sanitizePromptText(typeof x.title === 'string' ? x.title : '', 200),
        severity: (SEVERITIES as readonly unknown[]).includes(x.severity) ? (x.severity as FindingSeverity) : 'moderate',
        narrative: sanitizePromptText(typeof x.narrative === 'string' ? x.narrative : '', 4000),
      };
    }),
  };
  const roof = obj(r.roofDetails);
  const details: NonNullable<PromptFacts['roofDetails']> = {};
  if (typeof roof.material === 'string' && roof.material) details.material = sanitizePromptText(roof.material, 60);
  const squares = finite(roof.squares); if (squares !== undefined) details.squares = squares;
  if (typeof roof.pitch === 'string' && roof.pitch) details.pitch = sanitizePromptText(roof.pitch, 20);
  if (Object.keys(details).length) out.roofDetails = details;
  const storm = obj(r.stormHistory);
  const total = finite(storm.totalEvents); const years = finite(storm.yearsAnalyzed);
  if (total !== undefined && years !== undefined) out.stormHistory = { totalEvents: total, yearsAnalyzed: years, riskLevel: storm.riskLevel === 'high' || storm.riskLevel === 'low' ? storm.riskLevel : 'medium' };
  return out;
}

export type RewriteTarget = { kind: 'finding'; index: number } | { kind: 'summary' };

/** A copy of the report with the one piece of text changed. */
export function applyRewrite(report: Record<string, unknown>, target: RewriteTarget, text: string): Record<string, unknown> {
  const copy = JSON.parse(JSON.stringify(report)) as Record<string, unknown>;
  if (target.kind === 'summary') { copy.executiveSummary = text; return copy; }
  const list = Array.isArray(copy.structuredFindings) ? (copy.structuredFindings as unknown[]) : [];
  list[target.index] = { ...obj(list[target.index]), narrative: text };
  copy.structuredFindings = list;
  return copy;
}
