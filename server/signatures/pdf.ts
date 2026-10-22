/**
 * The signed document as a PDF.
 *
 * Three parts, in the order somebody reading it would want them:
 *
 *  1. What was signed — title, property, and the SHA-256 of the exact bytes
 *     the signers were shown. For a document that is prose, its text follows;
 *     for a designed page, the fingerprint plus the permanent link is the
 *     honest record, because a report stripped to text is not the report
 *     anyone actually read.
 *  2. The signatures, drawn or typed.
 *  3. The audit page: for each signer, how the link reached them, when they
 *     opened it, when they signed, from what device and IP, and where they
 *     were standing — measured against the property itself.
 */
import { buildPdf, type PdfLine } from '../lib/pdf/simple-pdf';
import {
  CONSENT_TEXT, describeDevice, describeGeo, describeProximity, stamp,
  type SignatureRequestView, type SignerView,
} from '../../shared/signatures';
import { htmlToText } from './providers';

/** A long report is recorded by fingerprint and link, not by dumping its text. */
const MAX_EMBEDDED_TEXT = 14000;

const ROLE_LABEL: Record<string, string> = { customer: 'Customer', company: 'Best Roofing Now' };

export function signedPdf(req: SignatureRequestView, documentHtml: string, documentUrl: string): Buffer {
  const lines: PdfLine[] = [];

  lines.push({ kind: 'row', label: 'Document', value: req.title, bold: true });
  if (req.propertyAddress) lines.push({ kind: 'row', label: 'Property', value: req.propertyAddress });
  lines.push({ kind: 'row', label: 'Sent', value: `${stamp(req.sentAt)}${req.sentBy ? ` by ${req.sentBy}` : ''}` });
  if (req.completedAt) lines.push({ kind: 'row', label: 'Completed', value: stamp(req.completedAt) });
  lines.push({ kind: 'row', label: 'Document fingerprint', value: `SHA-256 ${req.docHash.slice(0, 32)}…` });
  lines.push({ kind: 'rule' });

  // ---- What was signed ----
  const text = req.sourceKind === 'report' ? null : htmlToText(documentHtml);
  if (text) {
    lines.push({ kind: 'heading', text: 'The document' });
    const body = text.length > MAX_EMBEDDED_TEXT ? `${text.slice(0, MAX_EMBEDDED_TEXT)}…` : text;
    for (const para of body.split('\n')) {
      if (!para.trim()) { lines.push({ kind: 'space', size: 6 }); continue; }
      lines.push({ kind: 'text', text: para });
    }
  } else {
    lines.push({ kind: 'heading', text: 'The document' });
    lines.push({
      kind: 'text',
      text: `"${req.title}" was presented as a web document. The copy the signers were shown is frozen and served, `
        + 'unchanged, at the link below. The fingerprint above is the SHA-256 of that exact copy, so any later edit to it is detectable.',
    });
    if (documentUrl) lines.push({ kind: 'text', text: documentUrl });
  }

  // ---- The signatures ----
  lines.push({ kind: 'space', size: 8 });
  lines.push({ kind: 'heading', text: 'Signatures' });
  for (const s of req.signers) {
    if (s.signedAt && s.signatureImage) {
      const jpeg = jpegFromBase64(s.signatureImage);
      if (jpeg) lines.push({ kind: 'image', jpeg, width: 190 });
    } else if (s.signedAt) {
      lines.push({ kind: 'subheading', text: `/s/ ${s.signedName || s.name}` });
    }
    lines.push({ kind: 'row', label: s.name, value: s.signedAt ? stamp(s.signedAt) : s.declinedAt ? `Declined ${stamp(s.declinedAt)}` : 'Not signed', bold: true });
    const where = [describeProximity(s.geo), describeGeo(s.geo)].filter(Boolean).join(' — ');
    if (where) lines.push({ kind: 'row', label: '', value: where });
    lines.push({ kind: 'space', size: 4 });
  }

  lines.push({ kind: 'space', size: 4 });
  lines.push({ kind: 'text', text: `Each signer confirmed: "${CONSENT_TEXT}"` });

  // ---- The audit page ----
  lines.push({ kind: 'space', size: 14 });
  lines.push({ kind: 'heading', text: 'Audit trail' });
  for (const s of req.signers) {
    lines.push({ kind: 'subheading', text: `${s.name} — ${ROLE_LABEL[s.role] || s.role}` });
    for (const [label, value] of auditRows(s)) lines.push({ kind: 'row', label, value });
    lines.push({ kind: 'space', size: 8 });
  }
  lines.push({
    kind: 'text',
    text: 'Times are US Eastern. GPS locations were shared by the signer\'s own device; network locations are derived '
      + 'from the connection and are accurate to a city, not an address.',
  });

  return buildPdf(
    req.status === 'signed' ? 'Signed document' : 'Signature record',
    lines,
    `${req.title} · ${req.docHash.slice(0, 16)} · Best Roofing Now`,
    // Addresses, coordinates and user agents need more room than a column
    // sized for dollar amounts.
    { valueX: 230 },
  );
}

/** The per-signer rows on the audit page, skipping what never happened. */
export function auditRows(s: SignerView): Array<[string, string]> {
  const rows: Array<[string, string]> = [];
  if (s.email) rows.push(['Email', s.email]);
  if (s.phone) rows.push(['Phone', s.phone]);
  if (s.emailedAt) rows.push(['Link emailed', stamp(s.emailedAt)]);
  if (s.emailError) rows.push(['Email failed', s.emailError]);
  if (s.textedAt) rows.push(['Link texted', stamp(s.textedAt)]);
  if (s.textError) rows.push(['Text failed', s.textError]);
  if (s.remindCount) rows.push(['Reminders', `${s.remindCount} · last ${stamp(s.remindedAt)}`]);
  if (s.firstViewedAt) rows.push(['First opened', `${stamp(s.firstViewedAt)}${s.viewCount > 1 ? ` (${s.viewCount} views)` : ''}`]);
  if (s.viewGeo && s.viewGeo.source !== 'none') rows.push(['Opened from', describeGeo(s.viewGeo)]);
  if (s.signedAt) {
    rows.push(['Signed', stamp(s.signedAt)]);
    rows.push(['Signed as', `${s.signedName || ''}${s.signatureKind ? ` (${s.signatureKind === 'drawn' ? 'drawn on screen' : 'typed'})` : ''}`]);
  }
  if (s.declinedAt) {
    rows.push(['Declined', stamp(s.declinedAt)]);
    if (s.declineReason) rows.push(['Reason given', s.declineReason]);
  }
  if (s.ip) rows.push(['IP address', s.ip]);
  if (s.userAgent) rows.push(['Device', describeDevice(s.userAgent)]);
  if (s.geo) {
    rows.push(['Location', describeGeo(s.geo)]);
    const near = describeProximity(s.geo);
    if (near) rows.push(['Distance', near]);
  }
  return rows;
}

/** The base64 the signing page posted, back to bytes — rejecting anything that is not a JPEG. */
export function jpegFromBase64(b64: string | null | undefined): Buffer | null {
  if (!b64) return null;
  try {
    const buf = Buffer.from(String(b64), 'base64');
    return buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8 ? buf : null;
  } catch {
    return null;
  }
}
