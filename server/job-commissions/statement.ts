/**
 * The commission statement: the record as a one-page document, filed on the
 * JobTread job so the paperwork lives with the job rather than only in this
 * app. What it shows is exactly what the record holds — the same figures, the
 * same overhead rate, the same checklist — so a rep querying their pay and an
 * admin reading the record are looking at the same sheet of paper.
 */
import { buildPdf, type PdfLine } from '../lib/pdf/simple-pdf';
import {
  COMMISSION_LINES, COMMISSION_LINE_LABEL, JOB_COMMISSION_CHECKS, JOB_COMMISSION_STATUS_LABEL,
  computeJobCommission, isAdjusted, sourcesFor, type ChecksState, type CommissionSources, type JobCommissionStatus,
} from '../../shared/job-commission';
import type { JobCommission } from '../../shared/schema';
import { figuresOf } from './service';

const usd = (n: number) => (Number.isFinite(n) ? n : 0).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });
const day = (d: Date | string | null | undefined) =>
  (d ? new Date(d).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '—');
/**
 * Who did it, for a printed page: 'james@bestroofingnow.com' → 'james', and
 * anything the app opened by itself → 'automatically'. A bare dash here read
 * as a missing name rather than as "nobody typed this in".
 */
const who = (v: string | null | undefined) => {
  const raw = String(v || '').trim();
  if (!raw) return 'unknown';
  if (raw.startsWith('system:')) return 'automatically';
  return raw.split('@')[0] || 'unknown';
};

export function commissionStatementFilename(row: Pick<JobCommission, 'jobName' | 'jobExternalId' | 'status'>): string {
  const base = String(row.jobName || row.jobExternalId || 'job').replace(/[^A-Za-z0-9 _-]/g, '').trim().slice(0, 60) || 'job';
  return `Commission — ${base} (${JOB_COMMISSION_STATUS_LABEL[row.status as JobCommissionStatus] ?? row.status}).pdf`;
}

/** The statement's lines — pure, so the wording is testable without rendering a PDF. */
export function commissionStatementLines(row: JobCommission): PdfLine[] {
  const f = figuresOf(row);
  const result = computeJobCommission(f);
  const checks = (row.checks || {}) as ChecksState;
  const lines: PdfLine[] = [
    { kind: 'subheading', text: row.jobName || row.jobExternalId },
    { kind: 'text', text: `Sales rep: ${row.repName || 'unassigned'}` },
    { kind: 'text', text: `Status: ${JOB_COMMISSION_STATUS_LABEL[row.status as JobCommissionStatus] ?? row.status}` },
    { kind: 'space' },
    { kind: 'heading', text: 'Job' },
    { kind: 'row', label: 'Job type', value: f.jobType === 'insurance' ? 'Insurance' : 'Retail' },
    { kind: 'row', label: 'Lead source', value: f.leadSource === 'self' ? 'Self-generated' : f.leadSource === 'company' ? 'Company-provided' : 'not set' },
    { kind: 'space', size: 4 },
    { kind: 'heading', text: 'Figures' },
    { kind: 'row', label: 'Revenue (final contract price)', value: usd(f.revenue) },
    { kind: 'row', label: 'Material', value: usd(f.material) },
    { kind: 'row', label: 'Labor', value: usd(f.labor) },
    { kind: 'row', label: 'Other costs', value: usd(f.other) },
  ];

  if (result) {
    lines.push(
      { kind: 'row', label: `Overhead (${result.overheadPct}%${f.manualOverheadPct == null ? '' : ', set by hand'})`, value: usd(result.overheadAmount) },
      { kind: 'rule' },
      { kind: 'row', label: 'Profit', value: usd(result.profit), bold: true },
      {
        kind: 'row',
        label: result.isManual ? 'Commission agreed (set by hand)' : 'Commission earned (50% of profit)',
        value: usd(result.commission), bold: true,
      },
    );
    // What it overrode, so an agreed figure can be read against the formula
    // rather than taken on trust.
    if (result.isManual) {
      lines.push({ kind: 'row', label: '    the formula would have paid', value: usd(result.calculatedCommission) });
    }
    // Only worth printing when there were draws — on a job with none, a zero
    // line and a repeated total read as a mistake rather than as a settlement.
    if (result.advancesPaid > 0) {
      lines.push(
        { kind: 'row', label: 'Less: already paid to the rep during the job', value: `-${usd(result.advancesPaid)}` },
        { kind: 'rule' },
        {
          kind: 'row',
          label: result.balanceDue < 0 ? 'Overpaid — to recover from a later job' : 'Balance still owed to the rep',
          value: usd(Math.abs(result.balanceDue)),
          bold: true,
        },
      );
    }
  } else {
    lines.push(
      { kind: 'rule' },
      { kind: 'text', text: 'No commission has been worked out yet: the lead source has to be set before the overhead rate is known.' },
    );
  }

  // Where each figure came from. A number nobody can trace back to a document
  // is a number a rep has to take on trust, which is how pay gets argued about.
  const sources = (row.sources || {}) as CommissionSources;
  const itemised = COMMISSION_LINES.filter((line) => sourcesFor(sources, line).length > 0);
  if (itemised.length) {
    lines.push({ kind: 'space', size: 4 }, { kind: 'heading', text: 'How these figures were built' });
    for (const line of itemised) {
      lines.push({ kind: 'text', text: COMMISSION_LINE_LABEL[line] });
      for (const src of sourcesFor(sources, line)) {
        lines.push({ kind: 'row', label: `    ${src.kind === 'doc' ? 'JobTread' : 'Entered'} — ${src.label}`, value: usd(src.amount) });
        // A figure typed over a document's own must not read as the document's.
        if (isAdjusted(src)) {
          lines.push({ kind: 'row', label: `        changed by hand; the document says`, value: usd(src.docAmount as number) });
        }
      }
    }
  }

  lines.push({ kind: 'space', size: 4 }, { kind: 'heading', text: 'Checklist' });
  for (const c of JOB_COMMISSION_CHECKS) {
    const ticked = checks[c.key];
    lines.push({ kind: 'row', label: `${ticked ? '[x]' : '[ ]'} ${c.label}`, value: ticked ? `${who(ticked.by)}, ${day(ticked.at)}` : 'not yet' });
  }

  lines.push({ kind: 'space', size: 4 }, { kind: 'heading', text: 'Trail' });
  lines.push({ kind: 'row', label: 'Opened', value: `${who(row.createdBy)}, ${day(row.createdAt)}` });
  lines.push({ kind: 'row', label: 'Approved', value: row.approvedAt ? `${who(row.approvedBy)}, ${day(row.approvedAt)}` : 'not yet' });
  if (row.deniedAt) {
    lines.push({ kind: 'row', label: 'Denied', value: `${who(row.deniedBy)}, ${day(row.deniedAt)}` });
    if (row.deniedReason) lines.push({ kind: 'text', text: `Reason: ${row.deniedReason}` });
  }
  lines.push({ kind: 'row', label: 'Paid', value: row.paidAt ? `${who(row.paidBy)}, ${day(row.paidAt)}` : 'not yet' });
  if (row.notes) lines.push({ kind: 'space', size: 4 }, { kind: 'heading', text: 'Notes' }, { kind: 'text', text: row.notes });

  return lines;
}

export function commissionStatementPdf(row: JobCommission, generatedBy: string): Buffer {
  return buildPdf(
    'Commission statement',
    commissionStatementLines(row),
    `Best Roofing Now · ${row.jobName || row.jobExternalId} · saved by ${who(generatedBy)} on ${day(new Date())}`,
  );
}
