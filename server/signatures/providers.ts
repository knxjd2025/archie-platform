/**
 * What can be sent for signature.
 *
 * A provider is a document this app builds. It knows how to list what it has
 * for a job and how to render one copy of it. Everything downstream — sending,
 * signing, the audit trail, the signed PDF — is the same no matter which
 * provider produced the document, so adding the next one is this file only.
 *
 * Two kinds of document, and the difference decides what the signed PDF can
 * honestly contain:
 *
 *  - Documents that are WORDS (the certificate of completion). Their text goes
 *    into the signed PDF, so the PDF is the whole record.
 *  - Documents that are a DESIGNED PAGE (a roof report, a commercial
 *    proposal). Stripping those to text would misrepresent what the customer
 *    actually saw, so the signed PDF records the title, the SHA-256 of the
 *    exact bytes that were shown, and a permanent link to that frozen copy.
 */
import { and, desc, eq, isNotNull } from 'drizzle-orm';
import { db } from '../db';
import { clientReports, leads } from '../../shared/schema';
import { certificateHtml, type CertificateData } from '../../shared/certificate-of-completion';
import { buildCertificateData, certificateFor } from '../certificates/routes';
import type { SignatureSourceKind } from '../../shared/signatures';

export interface SignableOption {
  kind: SignatureSourceKind;
  ref: string | null;
  label: string;
  detail: string;
  /** Who normally signs this one — prefills the signer list in the app. */
  suggests: 'customer' | 'both';
}

export interface BuiltDoc {
  kind: SignatureSourceKind;
  ref: string | null;
  title: string;
  html: string;
  /** The document as words, when it is words. Null for a designed page. */
  text: string | null;
}

const BLANK = { companySigner: '', companySignedAt: null, homeownerSigner: '', homeownerSignedAt: null };

/** Strip tags to readable text — used for the documents that are prose. */
export function htmlToText(html: string): string {
  return String(html || '')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<\/(p|div|tr|h[1-6]|li)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n').map((l) => l.trim()).join('\n')
    .trim();
}

/** Everything this job has that could go out for signature, newest first. */
export async function listSignable(externalId: string): Promise<SignableOption[]> {
  const out: SignableOption[] = [];

  const reports = await db.select({
    reportId: clientReports.reportId, title: clientReports.title, reportType: clientReports.reportType,
    createdAt: clientReports.createdAt,
  })
    .from(clientReports)
    .where(and(eq(clientReports.jobExternalId, externalId), eq(clientReports.status, 'succeeded'), isNotNull(clientReports.html)))
    .orderBy(desc(clientReports.createdAt))
    .limit(25);

  for (const r of reports) {
    out.push({
      kind: 'report',
      ref: r.reportId,
      label: r.title || 'Roof report',
      detail: [r.reportType, r.createdAt ? new Date(r.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '']
        .filter(Boolean).join(' · '),
      suggests: 'customer',
    });
  }

  // Only once somebody has actually created it. Rebuilding from the
  // walkthrough here would be a second way to bring a certificate into
  // existence, behind the Create button's back — and a copy that could differ
  // from the one on file.
  // And not once the homeowner has signed it: there is nothing left to sign,
  // and a second request would put a second signed copy on the job.
  const cert = await certificateFor(externalId).catch(() => null);
  if (cert && !cert.homeownerSignedAt) {
    out.push({
      kind: 'certificate',
      ref: null,
      label: 'Certificate of Completion',
      detail: 'Created from the final walkthrough',
      suggests: 'both',
    });
  }

  return out;
}

/**
 * One copy of a document, rendered now. The caller freezes what comes back —
 * a report can be refined and a walkthrough corrected after the fact, and a
 * signed document must never change under the signatures.
 */
export async function buildSignable(
  externalId: string, kind: SignatureSourceKind, ref: string | null,
): Promise<{ ok: true; doc: BuiltDoc } | { ok: false; error: string }> {
  if (kind === 'report') {
    if (!ref) return { ok: false, error: 'Pick which report to send.' };
    const [row] = await db.select().from(clientReports)
      .where(and(eq(clientReports.reportId, ref), eq(clientReports.jobExternalId, externalId)));
    if (!row) return { ok: false, error: 'That report is not on this job.' };
    if (!row.html) return { ok: false, error: 'That report has no rendered copy to send.' };
    return { ok: true, doc: { kind, ref, title: row.title || 'Roof report', html: row.html, text: null } };
  }

  if (kind === 'certificate') {
    // The certificate as it was created and stands on the job — not a fresh
    // rebuild, which could say something different from the copy on file.
    const row = await certificateFor(externalId);
    if (!row) {
      // Two different problems, and the rep can only act on one of them: no
      // walkthrough yet is "go and do the walkthrough", a walkthrough with no
      // certificate is "press the button". Saying which saves a phone call.
      const walkthrough = await buildCertificateData(externalId).catch(() => null);
      return {
        ok: false,
        error: walkthrough
          ? 'No certificate on this job yet — create it from the Certificate of Completion panel first.'
          : 'Submit the final walkthrough first — the certificate is written from it.',
      };
    }
    if (row.homeownerSignedAt) {
      return { ok: false, error: 'The homeowner has already signed this certificate — the signed copy is on the job.' };
    }
    const data = row.data as CertificateData;
    const html = certificateHtml(data, BLANK, { signatures: false });
    return { ok: true, doc: { kind, ref: null, title: 'Certificate of Completion', html, text: htmlToText(html) } };
  }

  return { ok: false, error: 'That is not a document this app can send for signature.' };
}

/** The property the document is about — geocoded once, to measure signatures against. */
export async function propertyAddressFor(externalId: string): Promise<string> {
  const [lead] = await db.select({
    address: leads.address, city: leads.city, state: leads.state, zip: leads.zip,
  }).from(leads).where(eq(leads.externalId, externalId));
  if (!lead) return '';
  return [lead.address, [lead.city, lead.state].filter(Boolean).join(', '), lead.zip].filter(Boolean).join(', ');
}
