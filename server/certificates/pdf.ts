/**
 * The Certificate of Completion as a PDF — the copy that goes to the carrier
 * with the depreciation request, and the copy the homeowner gets back.
 *
 * Same content as the HTML the homeowner signed (shared/certificate-of-completion.ts),
 * rendered through the app's own small PDF writer so it needs no browser.
 */
import { buildPdf, type PdfLine } from '../lib/pdf/simple-pdf';
import { certDate, certificateStatement, type CertificateData, type CertificateSignatures } from '../../shared/certificate-of-completion';

const stamp = (iso: string | null): string =>
  (iso ? new Date(iso).toLocaleString('en-US', { month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }) : 'not signed yet');

export function certificateLines(d: CertificateData, s: CertificateSignatures): PdfLine[] {
  const lines: PdfLine[] = [];
  const fact = (label: string, value: string) => { if (value.trim()) lines.push({ kind: 'row', label, value }); };

  fact('Customer', d.customerName);
  fact('Property address', d.propertyAddress);
  fact('Job', d.jobName);
  fact('Claim number', d.claimNumber);
  fact('Date completed', certDate(d.completedOn));

  lines.push({ kind: 'space', size: 6 }, { kind: 'text', text: certificateStatement(d) });

  if (d.sections.length) {
    lines.push({ kind: 'heading', text: 'What the walkthrough covered' });
    for (const x of d.sections) {
      lines.push({
        kind: 'row',
        label: x.section,
        value: `${x.ok} passed${x.issue ? ` · ${x.issue} to address` : ''}${x.na ? ` · ${x.na} n/a` : ''}`,
      });
    }
  }

  if (d.openItems.length) {
    lines.push({ kind: 'heading', text: 'Items noted at the walkthrough, which we are completing' });
    for (const i of d.openItems) lines.push({ kind: 'text', text: `- ${i.label}${i.note ? ` — ${i.note}` : ''}` });
  }

  if (d.warrantyExplained) {
    lines.push({ kind: 'space', size: 4 }, { kind: 'text', text: 'The workmanship and manufacturer warranties, roof care and what to expect were explained to the homeowner.' });
  }
  if (d.balance) lines.push({ kind: 'row', label: 'Final balance', value: d.balance });
  if (d.homeownerConcerns) lines.push({ kind: 'space', size: 4 }, { kind: 'text', text: `Homeowner comments: ${d.homeownerConcerns}` });

  lines.push(
    { kind: 'space', size: 6 },
    { kind: 'text', text: 'By signing below, the homeowner confirms the work described above has been completed to their satisfaction, and the contractor confirms it was completed as contracted.' },
    { kind: 'space', size: 6 },
    { kind: 'heading', text: 'Signatures' },
    { kind: 'row', label: `For ${d.companyName}`, value: s.companySigner || 'not signed yet' },
    { kind: 'row', label: '', value: stamp(s.companySignedAt) },
    { kind: 'rule' },
    { kind: 'row', label: 'Homeowner', value: s.homeownerSigner || 'not signed yet' },
    { kind: 'row', label: '', value: stamp(s.homeownerSignedAt) },
    { kind: 'rule' },
    { kind: 'text', text: 'Signed electronically by typed name, recorded with the date and time above.' },
  );

  return lines;
}

export function certificatePdf(d: CertificateData, s: CertificateSignatures): Buffer {
  return buildPdf(
    'Certificate of Completion',
    certificateLines(d, s),
    `${d.companyName} · ${d.officeAddress} · ${d.companyPhone}`,
  );
}
