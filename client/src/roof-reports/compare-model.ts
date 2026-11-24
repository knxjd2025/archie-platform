/**
 * What the comparison screen shows, worked out in plain functions with no screen:
 * which two reports are picked, and the rows, notes and findings of two reports
 * set side by side. The server sends facts (`ReportSummary`); this decides how
 * each is said.
 *
 * A difference is always written in words ("Report A is higher by 28 points"),
 * because colour alone is not enough for a person who cannot tell the colours
 * apart. The one place colour also says "better" is the condition score, where
 * a higher score is better; nothing else is called better or worse.
 */
import type { ReportSummary } from '../../../shared/roof-reports';
import { fmtDate } from '../lib/format';
import { MATERIAL_OPTIONS } from './wizard-model';
import { RR } from './words';

export const MAX_SELECTED = 2;

/** The picks after the person ticks or unticks one. A third is not taken. */
export function toggleSelected(selected: readonly string[], id: string): string[] {
  if (selected.includes(id)) return selected.filter((x) => x !== id);
  return selected.length >= MAX_SELECTED ? [...selected] : [...selected, id];
}

/** What to tell the person under the list while they pick. */
export function compareHint(count: number): string {
  return count <= 0 ? RR.compare.hintNone : count === 1 ? RR.compare.hintOne : RR.compare.hintTwo;
}

export type Difference = 'same' | 'different' | 'unknown';
export type Tone = 'plain' | 'good' | 'bad';

export interface CompareRow {
  label: string;
  a: string;
  b: string;
  difference: Difference;
  /** The difference in words. */
  note: string;
  /** Colour hints for each side; always 'plain' except the condition score. */
  tone: { a: Tone; b: Tone };
}

export interface CompareFinding { title: string; severity: string | null }
export interface BothFinding { title: string; a: string; b: string; note: string }

export interface Comparison {
  columns: Array<{ label: string; address: string; date: string }>;
  sections: Array<{ title: string; rows: CompareRow[] }>;
  findings: { both: BothFinding[]; onlyA: CompareFinding[]; onlyB: CompareFinding[] };
  summary: string;
}

const UNKNOWN = RR.compare.notKnown;
const plainTone = { a: 'plain', b: 'plain' } as const;

function column(label: string, r: ReportSummary): Comparison['columns'][number] {
  return { label, address: [r.address, r.city].filter(Boolean).join(', '), date: fmtDate(r.createdAt) ?? '' };
}

interface NumberRule {
  label: string;
  show: (n: number) => string;
  /** How a gap reads: "28 points", "$8,660". */
  gap: (n: number) => string;
  /** Colour the better side. Only for a score. */
  higherIsBetter?: boolean;
}

const trim = (n: number): string => String(Math.round(n * 100) / 100);

function numberRow(rule: NumberRule, a: number | null, b: number | null): CompareRow {
  const row = { label: rule.label, a: a === null ? UNKNOWN : rule.show(a), b: b === null ? UNKNOWN : rule.show(b) };
  if (a === null && b === null) return { ...row, difference: 'unknown', note: RR.compare.unknownBoth, tone: plainTone };
  if (a === null || b === null) return { ...row, difference: 'different', note: RR.compare.unknownOne(a === null ? 'A' : 'B'), tone: plainTone };
  if (a === b) return { ...row, difference: 'same', note: RR.compare.same, tone: plainTone };
  const higher = a > b ? 'A' : 'B';
  const tone = rule.higherIsBetter ? (a > b ? { a: 'good', b: 'bad' } as const : { a: 'bad', b: 'good' } as const) : plainTone;
  return { ...row, difference: 'different', note: RR.compare.higherBy(higher, rule.gap(Math.abs(a - b))), tone };
}

function wordRow(label: string, a: string | null, b: string | null, show: (s: string) => string = (s) => s): CompareRow {
  const row = { label, a: a === null ? UNKNOWN : show(a), b: b === null ? UNKNOWN : show(b) };
  if (a === null && b === null) return { ...row, difference: 'unknown', note: RR.compare.unknownBoth, tone: plainTone };
  if (a === null || b === null) return { ...row, difference: 'different', note: RR.compare.unknownOne(a === null ? 'A' : 'B'), tone: plainTone };
  return a.toLowerCase() === b.toLowerCase()
    ? { ...row, difference: 'same', note: RR.compare.same, tone: plainTone }
    : { ...row, difference: 'different', note: RR.compare.different, tone: plainTone };
}

const money = (n: number): string => `$${Math.round(n).toLocaleString('en-US')}`;
const capital = (s: string): string => (s ? s[0].toUpperCase() + s.slice(1) : s);
const materialName = (value: string): string => MATERIAL_OPTIONS.find((m) => m.value === value)?.label ?? capital(value.replace(/_/g, ' '));
const key = (title: string): string => title.toLowerCase().replace(/\s+/g, ' ').trim();

/** The findings both reports share (by title), and those only one has. */
function compareFindings(a: ReportSummary['findings'], b: ReportSummary['findings']): Comparison['findings'] {
  const inB = new Map(b.map((f) => [key(f.title), f]));
  const inA = new Set(a.map((f) => key(f.title)));
  const both: BothFinding[] = [];
  const onlyA: CompareFinding[] = [];
  for (const f of a) {
    const other = inB.get(key(f.title));
    if (!other) { onlyA.push({ title: f.title, severity: f.severity }); continue; }
    const sa = f.severity ?? UNKNOWN.toLowerCase();
    const sb = other.severity ?? UNKNOWN.toLowerCase();
    both.push({ title: f.title, a: sa, b: sb, note: sa === sb ? RR.compare.findingSame : RR.compare.findingRated(sa, sb) });
  }
  return { both, onlyA, onlyB: b.filter((f) => !inA.has(key(f.title))).map((f) => ({ title: f.title, severity: f.severity })) };
}

export function buildComparison(a: ReportSummary, b: ReportSummary): Comparison {
  const findings = compareFindings(a.findings, b.findings);
  const findingsRow: CompareRow = numberRow({ label: 'Findings', show: String, gap: (n) => String(n) }, a.findings.length, b.findings.length);
  const sections: Comparison['sections'] = [
    {
      title: RR.compare.sections.condition,
      rows: [
        numberRow({ label: 'Condition score', show: (n) => `${trim(n)} out of 100`, gap: (n) => `${trim(n)} points`, higherIsBetter: true }, a.condition.score, b.condition.score),
        wordRow('Condition grade', a.condition.grade, b.condition.grade),
        wordRow('Damage seen', a.condition.severity, b.condition.severity, capital),
      ],
    },
    { title: RR.compare.sections.findings, rows: [findingsRow] },
    {
      title: RR.compare.sections.storm,
      rows: [
        numberRow({ label: 'Storm events', show: trim, gap: trim }, a.storm.events, b.storm.events),
        numberRow({ label: 'Hail events', show: trim, gap: trim }, a.storm.hail, b.storm.hail),
        numberRow({ label: 'Wind events', show: trim, gap: trim }, a.storm.wind, b.storm.wind),
        numberRow({ label: 'Largest hail', show: (n) => `${trim(n)} inches`, gap: (n) => `${trim(n)} inches` }, a.storm.largestHailInches, b.storm.largestHailInches),
        wordRow('Storm risk', a.storm.risk, b.storm.risk, capital),
        wordRow('Claim potential', a.storm.claimPotential, b.storm.claimPotential, capital),
      ],
    },
    { title: RR.compare.sections.cost, rows: [numberRow({ label: 'Estimated repair cost', show: money, gap: money }, a.cost, b.cost)] },
    {
      title: RR.compare.sections.roof,
      rows: [
        numberRow({ label: 'Roof size', show: (n) => `${trim(n)} squares`, gap: (n) => `${trim(n)} squares` }, a.measurements.squares, b.measurements.squares),
        wordRow('Pitch', a.measurements.pitch, b.measurements.pitch),
        numberRow({ label: 'Stories', show: trim, gap: trim }, a.measurements.stories, b.measurements.stories),
        wordRow('Roof material', a.measurements.material, b.measurements.material, materialName),
        numberRow({ label: 'Roof age', show: (n) => `About ${trim(n)} years`, gap: (n) => `${trim(n)} years` }, a.measurements.ageYears, b.measurements.ageYears),
      ],
    },
  ];
  const rows = sections.flatMap((s) => s.rows).filter((r) => r.difference !== 'unknown');
  const differing = rows.filter((r) => r.difference === 'different').length;
  return {
    columns: [column('Report A', a), column('Report B', b)],
    sections,
    findings,
    summary: differing === 0 ? RR.compare.summaryAllSame : RR.compare.summaryDiffer(differing, rows.length),
  };
}
