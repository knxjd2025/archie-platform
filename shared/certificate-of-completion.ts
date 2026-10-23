/**
 * The Certificate of Completion — the page a carrier asks for before it will
 * release held depreciation, and the page a homeowner signs to say the work is
 * done and they are satisfied.
 *
 * It is not typed out by hand. The Final Walkthrough already records the date,
 * who walked it, every Pass/Issue/N/A on the roof and the property, whether the
 * warranty was explained and where the balance stands — so the certificate is
 * built from that, and stays honest about what the walkthrough actually found:
 * an open issue is printed on the certificate rather than quietly dropped.
 *
 * Signing is by typed name, the same convention the walkthrough itself uses,
 * recorded with who typed it and when.
 */
import { WALKTHROUGH_FIELDS, verifyAnswer, walkthroughIssues, walkthroughTally } from './final-walkthrough';
import { boardTz } from './schedule-board';

export type CertificateStatus = 'draft' | 'sent' | 'signed';

export const CERTIFICATE_STATUS_LABEL: Record<CertificateStatus, string> = {
  draft: 'Not sent yet',
  sent: 'Waiting on the homeowner',
  signed: 'Signed',
};

export interface CertificateCheck { label: string; state: 'ok' | 'issue' | 'na'; note?: string }

export interface CertificateData {
  customerName: string;
  propertyAddress: string;
  jobName: string;
  claimNumber: string;
  /** YYYY-MM-DD the work was completed, from the walkthrough's own date. */
  completedOn: string;
  walkedBy: string;
  walkedByRole: string;
  /** Section-by-section summary of what was verified. */
  sections: Array<{ section: string; ok: number; issue: number; na: number }>;
  /** Anything the walkthrough flagged, in the walker's words. Printed, not hidden. */
  openItems: Array<{ label: string; note: string }>;
  warrantyExplained: boolean;
  homeownerPresent: boolean;
  balance: string;
  homeownerConcerns: string;
  companyName: string;
  officeAddress: string;
  companyPhone: string;
}

export interface CertificateSignatures {
  companySigner: string;
  companySignedAt: string | null;
  homeownerSigner: string;
  homeownerSignedAt: string | null;
}

const str = (v: unknown): string => (v == null ? '' : String(v)).trim();

/** The walkthrough answer for a field, by its exact name. */
const answer = (answers: Record<string, any>, name: string): unknown => answers?.[name];

/**
 * Build the certificate from a submitted walkthrough. Everything here comes
 * from what the walker recorded — nothing is assumed about work nobody
 * verified, which is why a section with no answers reports zeros rather than
 * a clean bill.
 */
export function certificateFromWalkthrough(
  answers: Record<string, any>,
  job: { customerName: string; propertyAddress: string; jobName: string; claimNumber?: string },
  company: { companyName: string; officeAddress: string; companyPhone: string },
): CertificateData {
  const sections = [...new Set(WALKTHROUGH_FIELDS.filter((f) => f.type === 'verify').map((f) => f.section))]
    .map((section) => {
      const fields = WALKTHROUGH_FIELDS.filter((f) => f.section === section && f.type === 'verify');
      const tally = { section, ok: 0, issue: 0, na: 0 };
      for (const f of fields) {
        const a = verifyAnswer(answer(answers, f.name));
        if (a?.state === 'ok') tally.ok += 1;
        else if (a?.state === 'issue') tally.issue += 1;
        else if (a?.state === 'na') tally.na += 1;
      }
      return tally;
    })
    .filter((s) => s.ok + s.issue + s.na > 0);

  return {
    customerName: job.customerName,
    propertyAddress: job.propertyAddress,
    jobName: job.jobName,
    claimNumber: str(job.claimNumber),
    completedOn: str(answer(answers, 'Date')),
    walkedBy: str(answer(answers, 'Walked by')),
    walkedByRole: str(answer(answers, 'Role')),
    sections,
    openItems: walkthroughIssues(answers).map((i) => ({ label: i.item, note: str(i.note) })),
    warrantyExplained: answer(answers, 'Explained the warranty, roof care and what to expect') === true,
    homeownerPresent: str(answer(answers, 'Homeowner present')) === 'Yes',
    balance: str(answer(answers, 'Final balance')),
    homeownerConcerns: str(answer(answers, 'Homeowner concerns')),
    ...company,
  };
}

/** How many checks the walkthrough carried in total — the line the certificate leads with. */
export function certificateTally(answers: Record<string, any>) {
  return walkthroughTally(answers);
}

/** en-US long date from YYYY-MM-DD, read as a calendar day rather than an instant. */
export function certDate(date: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return date || '';
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

const stamp = (iso: string | null): string =>
  (iso ? new Date(iso).toLocaleString('en-US', { month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: boardTz() }) : '');

/** What still has to happen before this certificate can go to a carrier. */
export function certificateBlockers(d: CertificateData, s: CertificateSignatures): string[] {
  const out: string[] = [];
  if (!d.completedOn) out.push('The walkthrough has no completion date');
  if (!d.customerName.trim()) out.push('No customer name');
  if (!d.propertyAddress.trim()) out.push('No property address');
  if (!s.companySigner.trim()) out.push('Not signed by us yet');
  if (!s.homeownerSigner.trim()) out.push('Not signed by the homeowner yet');
  return out;
}

const esc = (v: string): string =>
  String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The sentence the whole document turns on. */
export function certificateStatement(d: CertificateData): string {
  return `The roofing work at the property described below was completed on ${certDate(d.completedOn)} by ${d.companyName} `
    + 'in accordance with the contracted scope of work. A final walkthrough of the roof and the property was carried out'
    + `${d.walkedBy ? ` by ${d.walkedBy}${d.walkedByRole ? ` (${d.walkedByRole})` : ''}` : ''}`
    + `${d.homeownerPresent ? ', with the homeowner present' : ''}.`;
}

/**
 * The certificate as HTML — the homeowner's signing page, the on-screen
 * preview and the printed page all render this, so all three agree.
 *
 * `signatures: false` leaves off the two signature lines, for the places that
 * supply their own signature block (a signature request, which carries the
 * signers and their audit trail with it).
 */
export function certificateHtml(
  d: CertificateData, s: CertificateSignatures, opts: { signatures?: boolean } = {},
): string {
  const row = (k: string, v: string) => (v.trim()
    ? `<tr><td style="padding:2px 16px 2px 0;color:#555;white-space:nowrap">${esc(k)}</td><td style="padding:2px 0"><b>${esc(v)}</b></td></tr>`
    : '');
  const facts = [
    row('Customer', d.customerName),
    row('Property address', d.propertyAddress),
    row('Job', d.jobName),
    row('Claim number', d.claimNumber),
    row('Date completed', certDate(d.completedOn)),
  ].join('');

  const sections = d.sections.length
    ? `<table style="border-collapse:collapse;width:100%;max-width:30em;margin:0 0 14px">
        ${d.sections.map((x) => `<tr>
          <td style="padding:3px 0">${esc(x.section)}</td>
          <td style="padding:3px 0;text-align:right;white-space:nowrap;color:#555">${x.ok} passed${x.issue ? ` · ${x.issue} to address` : ''}${x.na ? ` · ${x.na} n/a` : ''}</td>
        </tr>`).join('')}
      </table>`
    : '';

  const open = d.openItems.length
    ? `<p><b>Items noted at the walkthrough, which we are completing:</b></p><ul>${
      d.openItems.map((i) => `<li>${esc(i.label)}${i.note ? ` — ${esc(i.note)}` : ''}</li>`).join('')
    }</ul>`
    : '';

  const signature = (title: string, name: string, at: string | null) => `
    <td style="width:50%;padding:0 12px 0 0;vertical-align:top">
      <div style="border-bottom:1px solid #333;padding:14px 0 2px;font:italic 15pt Georgia,serif;min-height:22px">${esc(name)}</div>
      <div style="font:9.5pt Arial,sans-serif;color:#666;padding-top:3px">${esc(title)}</div>
      <div style="font:9.5pt Arial,sans-serif;color:#666">${at ? `Signed ${esc(stamp(at))}` : 'Not signed yet'}</div>
    </td>`;

  return [
    `<h1 style="font:700 19pt Georgia,serif;color:#0e1f57;margin:0 0 4px">Certificate of Completion</h1>`,
    `<p style="color:#666;margin:0 0 16px">${esc(d.companyName)}</p>`,
    `<table style="border-collapse:collapse;margin:0 0 16px">${facts}</table>`,
    `<p>${esc(certificateStatement(d))}</p>`,
    sections ? '<p><b>What the walkthrough covered</b></p>' : '',
    sections,
    open,
    d.warrantyExplained ? '<p>The workmanship and manufacturer warranties, roof care and what to expect were explained to the homeowner.</p>' : '',
    d.balance ? `<p>Final balance: <b>${esc(d.balance)}</b>.</p>` : '',
    d.homeownerConcerns ? `<p><b>Homeowner comments:</b> ${esc(d.homeownerConcerns)}</p>` : '',
    '<p style="margin-top:18px">By signing below, the homeowner confirms the work described above has been completed to their satisfaction, and the contractor confirms it was completed as contracted.</p>',
    opts.signatures === false ? '' : `<table style="border-collapse:collapse;width:100%;margin-top:10px"><tr>
      ${signature(`For ${d.companyName}`, s.companySigner, s.companySignedAt)}
      ${signature('Homeowner', s.homeownerSigner, s.homeownerSignedAt)}
    </tr></table>`,
    `<p style="font:9.5pt Arial,sans-serif;color:#777;margin-top:20px">${esc(d.companyName)} · ${esc(d.officeAddress)} · ${esc(d.companyPhone)}</p>`,
  ].filter(Boolean).join('\n');
}
