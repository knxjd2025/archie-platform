/**
 * The document builders, rendered against the throwaway database — what
 * actually goes out under the company's name.
 *
 *   DATABASE_URL=postgres://$USER@localhost:5432/bra_e2e npx tsx scripts/e2e/signatures-docs.ts
 *
 * No server needed. This is also the only way to cover document rendering
 * while the harness has every integration blanked: no send can succeed, and a
 * send that reaches nobody is discarded, so signatures.mjs never has a
 * server-rendered document to inspect.
 */
import { buildSignable, htmlToText, listSignable, propertyAddressFor } from '../../server/signatures/providers';
import { signedPdf } from '../../server/signatures/pdf';
import { certificateFor, createCertificate } from '../../server/certificates/routes';
import { db } from '../../server/db';
import { jobCertificates } from '../../shared/schema';
import { eq } from 'drizzle-orm';
import { escapeHtml, type SignatureRequestView } from '../../shared/signatures';

const JOB = 'e2e-sig-a';
const JOB_EMPTY = 'e2e-sig-b';

let pass = 0, fail = 0;
const T = (name: string, ok: boolean, evidence = '') => {
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${name}${evidence ? `  :: ${evidence}` : ''}`);
  ok ? pass++ : fail++;
};

async function main() {
  // Start from no certificate, so the gate is exercised rather than assumed.
  await db.delete(jobCertificates).where(eq(jobCertificates.jobExternalId, JOB));

  const beforeCreate = await listSignable(JOB);
  T('documents: the certificate is not offered until it is created',
    !beforeCreate.some((o) => o.kind === 'certificate'), beforeCreate.map((o) => o.kind).join(', '));
  const notYet = await buildSignable(JOB, 'certificate', null);
  T('documents: and building one is refused', !notYet.ok && /create it/i.test((notYet as any).error), (notYet as any).error);

  // The Create button's own path.
  const made = await createCertificate(JOB, 'e2e-rep@bestroofingnow.com');
  T('documents: the create path builds it from the walkthrough', !!made && !!(await certificateFor(JOB)));

  const options = await listSignable(JOB);
  T('documents: lists what the job has', options.length === 3, options.map((o) => o.kind).join(', '));
  T('documents: a report suggests the customer signs', options.find((o) => o.kind === 'report')?.suggests === 'customer');
  T('documents: the certificate suggests both sides sign', options.find((o) => o.kind === 'certificate')?.suggests === 'both');

  const cert = await buildSignable(JOB, 'certificate', null);
  if (!cert.ok) { T('documents: the certificate builds', false, cert.error); process.exit(1); }
  T('documents: the certificate builds from the walkthrough', true);
  const h = cert.doc.html;
  T('documents: it names the customer and the property', h.includes('Dana Whitfield') && h.includes('1200 Queens Rd'));
  T('documents: it carries the completion date', h.includes('September 17, 2026'));
  T('documents: it says who walked it', h.includes('E2E Rep'));
  T('documents: it tallies what the walkthrough covered', /passed/.test(h));
  T('documents: it does not hide the items still open', h.includes('downspout') && h.includes('garage trim'));
  T('documents: it says the homeowner was present', h.includes('with the homeowner present'));
  T("documents: it repeats the homeowner's own words", h.includes('keep an eye on the gutter'));
  T('documents: it leaves off its own signature lines', !h.includes('Not signed yet'));
  T('documents: it reads as text for the PDF', (cert.doc.text || '').includes('Certificate of Completion'));

  const rep = await buildSignable(JOB, 'report', 'e2e-sig-report');
  if (!rep.ok) { T('documents: the report builds', false, rep.error); process.exit(1); }
  T('documents: a report is taken exactly as generated', rep.doc.html.includes('Roof Replacement Proposal'));
  T('documents: a designed page is not flattened to text', rep.doc.text === null);
  T('documents: it keeps the report title', rep.doc.title === 'Roof Replacement Proposal — Whitfield', rep.doc.title);

  const wrongJob = await buildSignable(JOB, 'report', 'e2e-sig-other-report');
  T('documents: a report from another job is refused', !wrongJob.ok && /not on this job/i.test((wrongJob as any).error));
  const noHtml = await buildSignable(JOB, 'report', 'e2e-sig-failed');
  T('documents: a report with no rendered copy is refused', !noHtml.ok, (noHtml as any).error);
  const draft = await buildSignable(JOB_EMPTY, 'certificate', null);
  T('documents: a job with no certificate refuses to build one', !draft.ok, (draft as any).error);
  T('documents: an unknown kind is refused', !(await buildSignable(JOB, 'invoice' as any, null)).ok);

  T('documents: the property address comes from the lead', (await propertyAddressFor(JOB)).includes('1200 Queens Rd'));
  T('documents: a job that does not exist has no address', (await propertyAddressFor('nope')) === '');

  const now = new Date().toISOString();
  const view: SignatureRequestView = {
    id: 1, jobExternalId: JOB, sourceKind: 'certificate', sourceRef: null,
    title: 'Certificate of Completion', docHash: 'a'.repeat(64), message: null,
    propertyAddress: '1200 Queens Rd, Charlotte, NC, 28207', propertyLocated: true,
    status: 'signed', createdBy: 'e2e-rep@bestroofingnow.com', sentAt: now, sentBy: 'e2e-rep@bestroofingnow.com',
    completedAt: now, voidedAt: null, voidedBy: null, voidReason: null, jobtreadFileId: null, createdAt: now,
    signers: [{
      id: 1, name: 'Dana Whitfield', email: 'dana@example.com', phone: null, role: 'customer', signUrl: null,
      emailedAt: now, emailError: null, textedAt: now, textError: null, remindedAt: null, remindCount: 0,
      firstViewedAt: now, lastViewedAt: now, viewCount: 2, signedAt: now, signedName: 'Dana Whitfield',
      signatureKind: 'typed', signatureImage: null, declinedAt: null, declineReason: null,
      ip: '73.15.2.9', userAgent: 'Mozilla/5.0 (iPhone) Safari',
      geo: {
        source: 'gps', lat: 35.1925, lng: -80.8396, accuracyM: 9, address: '1200 Queens Rd, Charlotte, NC',
        city: 'Charlotte', region: 'North Carolina', country: 'USA', distanceFromPropertyM: 26, capturedAt: now,
      },
      viewGeo: null,
    }],
  };
  const pdf = signedPdf(view, cert.doc.html, 'https://app.bestroofingnow.com/r/s/abc/document');
  const asText = pdf.toString('latin1');
  T('documents: the signed PDF is built from the real document', asText.startsWith('%PDF-') && pdf.length > 3000, `${pdf.length} bytes`);
  T('documents: it prints the document text', asText.includes('Certificate of Completion'));
  T('documents: it prints the audit trail', asText.includes('Audit trail'));
  T('documents: it prints where they signed', asText.includes('At the property'));

  T('documents: anything a person typed is escaped', escapeHtml('<script>x</script>') === '&lt;script&gt;x&lt;/script&gt;');
  T('documents: html reduces to readable text', htmlToText('<p>A</p><p>B</p>') === 'A\nB');

  console.log(`signature documents: PASS ${pass} FAIL ${fail} of ${pass + fail}`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error('DOCUMENT CHECK FAILED:', e); process.exit(2); });
