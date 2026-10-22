/**
 * The letters that go to a carrier (shared/insurance-letters.ts): everything
 * they can be prefilled with, and sending them from the company's own mailbox.
 *
 * Rep-scoped like the rest of the client-page tools — a rep can only pull the
 * context for a job in their own book. The figures come from the claim record
 * the claims board keeps; nothing is invented here, so a claim with no RCV on
 * file comes back as zero and the screen says so rather than guessing.
 */
import type { Express, Request, Response } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { claims, leads, settings, teamMembers } from '../../shared/schema';
import { requireAuth } from '../auth/middleware';
import { ownsLead, type SessionUser } from '../access/rep-scope';
import { asyncHandler } from '../lib/async-handler';
import { logWrite } from '../writes/log';
import { OFFICE_ADDRESS_DEFAULT, OFFICE_PHONE } from '../../shared/neighbor-letters';
import {
  INSURANCE_LETTERS, buildInsuranceLetter, depreciationDue, isInsuranceLetterKind, letterDef, missingLetterFields,
  type ClaimLetterFields, type InsuranceLetterKind, type LetterImage,
} from '../../shared/insurance-letters';
import { JobTreadClient } from '../integrations/jobtread';
import { sendAsMailboxWithAttachments, type MailAttachment } from '../brain/gmail-delegated';
import { memberByEmail } from '../access/team-scope';
import { COMPANY_DOMAIN, OFFICE_CALENDAR } from '../calendar/access';
import { decodeImagePayload, MAX_UPLOAD_BYTES } from '../photos/routes';
import { jobCertificates } from '../../shared/schema';
import { certificatePdf } from '../certificates/pdf';
import { signaturesOf } from '../certificates/routes';
import type { CertificateData } from '../../shared/certificate-of-completion';

const COMPANY_NAME = 'Best Roofing Now';
const NEIGHBOR_SETTINGS_KEY = 'neighbor_letters';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_PHOTOS = 6;
const MAX_DOCS = 4;
const DOC_TYPES = ['application/pdf'];
/** Gmail's own ceiling is 25 MB; stay well under it so a send never bounces. */
const MAX_TOTAL_ATTACHMENT_BYTES = 12 * 1024 * 1024;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

const ymd = (d: Date | null | undefined): string => (d ? d.toISOString().slice(0, 10) : '');
const money = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0;
};

/** The office mailing address an admin set once for the neighbor letters — the same letterhead. */
async function officeAddress(): Promise<string> {
  const [row] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, NEIGHBOR_SETTINGS_KEY));
  const v = (row?.value ?? {}) as { officeAddress?: string };
  return v.officeAddress || OFFICE_ADDRESS_DEFAULT;
}

/**
 * Which mailbox the letter goes out from: the sender's own company address
 * when they have one, so the adjuster's reply lands with the person who sent
 * it; otherwise the office mailbox. A Workspace mailbox and its calendar id
 * are the same address, which is why this mirrors calendar/access.ts.
 */
async function sendingMailboxFor(email: string): Promise<string> {
  const e = (email || '').trim().toLowerCase();
  const me = await memberByEmail(e).catch(() => null);
  return me?.active && e.endsWith(COMPANY_DOMAIN) ? e : OFFICE_CALENDAR;
}

const str = (v: unknown, max = 200): string => String(v ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, max);

/**
 * The letter is rebuilt on the server from normalized fields rather than
 * accepting HTML from the browser: this goes out from a company mailbox, so
 * the body has to be something this code composed.
 */
function normalizeFields(kind: InsuranceLetterKind, b: any): ClaimLetterFields {
  const date = (v: unknown) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v ?? '')) ? String(v) : '');
  const list = Array.isArray(b?.enclosures) ? b.enclosures : letterDef(kind).enclosures;
  const items = Array.isArray(b?.items) ? b.items : [];
  return {
    date: date(b?.date) || new Date().toISOString().slice(0, 10),
    carrier: str(b?.carrier), adjusterName: str(b?.adjusterName, 120),
    claimNumber: str(b?.claimNumber, 80), policyNumber: str(b?.policyNumber, 80),
    insuredName: str(b?.insuredName, 160), propertyAddress: str(b?.propertyAddress, 300),
    dateOfLoss: date(b?.dateOfLoss),
    eventDate: date(b?.eventDate),
    amount: money(b?.amount),
    items: items.map((x: unknown) => str(x, 200)).filter(Boolean).slice(0, 25),
    note: String(b?.note ?? '').trim().slice(0, 2000),
    manualTotal: b?.manualTotal === true,
    invoiceTotal: money(b?.invoiceTotal),
    rcv: money(b?.rcv), supplements: money(b?.supplements), acv: money(b?.acv),
    deductible: money(b?.deductible), deductibleCollected: b?.deductibleCollected === true,
    payableTo: str(b?.payableTo, 160),
    enclosures: list.map((x: unknown) => str(x, 120)).filter(Boolean).slice(0, 10),
    senderName: str(b?.senderName, 120), senderTitle: str(b?.senderTitle, 120),
    senderPhone: str(b?.senderPhone, 40), senderEmail: str(b?.senderEmail, 160),
    companyName: COMPANY_NAME, officeAddress: str(b?.officeAddress, 200), companyPhone: str(b?.companyPhone, 40),
  };
}

interface AttachmentRequest {
  photoIds: string[];
  photoUploads: any[];
  documentIds: string[];
  documentUploads: any[];
}

/**
 * What travels with the letter: photos shown in the body, and documents — the
 * final invoice, the certificate of completion — attached for the carrier to
 * file. Anything already on the job is named by id and re-resolved from
 * JobTread here; a URL supplied by the browser is never fetched, so this can't
 * be pointed at an internal address. Uploads are decoded from the request.
 *
 * Nothing is silently dropped: whatever can't be sent comes back in `skipped`
 * for the sender to see, because a depreciation request missing its invoice
 * gets refused by the carrier weeks later.
 */
async function collectAttachments(externalId: string, req: AttachmentRequest): Promise<{ attachments: MailAttachment[]; images: LetterImage[]; skipped: string[] }> {
  const attachments: MailAttachment[] = [];
  const images: LetterImage[] = [];
  const skipped: string[] = [];
  let total = 0;
  let photoCount = 0;
  let docCount = 0;

  const addPhoto = (buf: Buffer, contentType: string, filename: string, caption?: string) => {
    if (photoCount >= MAX_PHOTOS) { skipped.push(`${filename} (over ${MAX_PHOTOS} photos)`); return; }
    if (total + buf.length > MAX_TOTAL_ATTACHMENT_BYTES) { skipped.push(`${filename} (message too large)`); return; }
    total += buf.length; photoCount++;
    const contentId = `brnphoto${photoCount}`;
    attachments.push({ filename, contentType, base64: buf.toString('base64'), contentId });
    images.push({ src: `cid:${contentId}`, caption });
  };

  const addDoc = (buf: Buffer, contentType: string, filename: string) => {
    if (docCount >= MAX_DOCS) { skipped.push(`${filename} (over ${MAX_DOCS} documents)`); return; }
    if (total + buf.length > MAX_TOTAL_ATTACHMENT_BYTES) { skipped.push(`${filename} (message too large)`); return; }
    total += buf.length; docCount++;
    attachments.push({ filename, contentType, base64: buf.toString('base64') });
  };

  const wanted = [...req.photoIds.slice(0, MAX_PHOTOS), ...req.documentIds.slice(0, MAX_DOCS)];
  if (wanted.length) {
    const { files } = await new JobTreadClient().getJobFiles(externalId, 100, 1600);
    for (const id of wanted) {
      const asDoc = req.documentIds.includes(id);
      const file = files.find((f) => f.id === id);
      if (!file?.url) { skipped.push(`${asDoc ? 'document' : 'photo'} ${id} (not on the job any more)`); continue; }
      try {
        const r = await fetch(file.url);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const served = (r.headers.get('content-type') || '').split(';')[0].toLowerCase();
        const buf = Buffer.from(await r.arrayBuffer());
        if (asDoc) {
          // JobTread's file store sometimes serves a PDF as octet-stream; the
          // file's own recorded type decides, and the name is the last word.
          const type = DOC_TYPES.includes(served) ? served
            : DOC_TYPES.includes(String(file.type || '').toLowerCase()) ? String(file.type).toLowerCase()
              : /\.pdf$/i.test(file.name || '') ? 'application/pdf' : '';
          if (!type) { skipped.push(`${file.name} (only PDFs can be attached)`); continue; }
          addDoc(buf, type, file.name || 'document.pdf');
        } else {
          const type = IMAGE_TYPES.includes(served) ? served : String(file.type || '').toLowerCase();
          if (!IMAGE_TYPES.includes(type)) { skipped.push(`${file.name} (${served || 'that type'} can't be embedded)`); continue; }
          addPhoto(buf, type, file.name || 'photo.jpg', file.description || undefined);
        }
      } catch (e: any) {
        skipped.push(`${file.name || id} (${e?.message || 'download failed'})`);
      }
    }
  }

  for (const u of req.photoUploads.slice(0, MAX_PHOTOS)) {
    const type = String(u?.contentType || 'image/jpeg').toLowerCase();
    if (!IMAGE_TYPES.includes(type)) { skipped.push(`${str(u?.name, 80) || 'upload'} (only JPEG, PNG or WEBP)`); continue; }
    const buf = decodeImagePayload(u?.base64);
    if (!buf) { skipped.push(`${str(u?.name, 80) || 'upload'} (no image data)`); continue; }
    if (buf.length > MAX_UPLOAD_BYTES) { skipped.push(`${str(u?.name, 80) || 'upload'} (too large)`); continue; }
    addPhoto(buf, type, str(u?.name, 80) || 'photo.jpg', str(u?.caption, 120) || undefined);
  }

  for (const u of req.documentUploads.slice(0, MAX_DOCS)) {
    const name = str(u?.name, 80) || 'document.pdf';
    const type = String(u?.contentType || '').toLowerCase();
    if (!DOC_TYPES.includes(type) && !/\.pdf$/i.test(name)) { skipped.push(`${name} (only PDFs can be attached)`); continue; }
    const buf = decodeImagePayload(u?.base64);   // same base64 decode; nothing image-specific about it
    if (!buf) { skipped.push(`${name} (no file data)`); continue; }
    if (buf.length > MAX_UPLOAD_BYTES) { skipped.push(`${name} (too large)`); continue; }
    addDoc(buf, 'application/pdf', name);
  }

  return { attachments, images, skipped };
}

/** Tick "Depreciation requested" on the job's claim, if it has one on the board. */
async function tickDepreciationRequested(externalId: string, wanted: boolean): Promise<boolean> {
  if (!wanted) return false;
  const [claim] = await db.select({ id: claims.id, checks: claims.checks }).from(claims).where(eq(claims.jobtreadJobId, externalId));
  if (!claim) return false;
  await db.update(claims)
    .set({ checks: { ...(claim.checks || {}), depreciation_requested: true }, updatedAt: new Date() })
    .where(eq(claims.id, claim.id));
  return true;
}

/**
 * The job's certificate of completion, but only once the homeowner has signed
 * it. An unsigned certificate sent to a carrier is worse than none: it invites
 * a refusal and a second round of paperwork.
 */
async function signedCertificateAttachment(externalId: string): Promise<{ attachment?: MailAttachment; skipped?: string }> {
  const [cert] = await db.select().from(jobCertificates).where(eq(jobCertificates.jobExternalId, externalId));
  if (!cert) return { skipped: 'certificate of completion (none for this job yet)' };
  if (!cert.homeownerSignedAt) return { skipped: 'certificate of completion (the homeowner has not signed it yet)' };
  return {
    attachment: {
      filename: 'Certificate of completion.pdf',
      contentType: 'application/pdf',
      base64: certificatePdf(cert.data as CertificateData, signaturesOf(cert)).toString('base64'),
    },
  };
}

export function registerInsuranceLetterRoutes(app: Express) {
  /**
   * Everything the letter can be filled from for this job: the claim (carrier,
   * numbers, adjuster, approved figures), the job (insured, address, when the
   * work finished) and the person sending it.
   */
  app.get('/api/clients/:externalId/insurance-letters/context', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const user = req.session.user! as SessionUser;
    const externalId = req.params.externalId;
    const [lead] = await db.select().from(leads).where(eq(leads.externalId, externalId));
    if (!lead?.externalId) return res.status(404).json({ error: 'not found' });
    if (!(await ownsLead(user, lead.externalId))) return res.status(404).json({ error: 'not found' });

    const [claim] = await db.select().from(claims).where(eq(claims.jobtreadJobId, externalId));
    const [me] = await db.select({ name: teamMembers.name, phone: teamMembers.phone, role: teamMembers.role })
      .from(teamMembers).where(eq(teamMembers.email, user.email.toLowerCase()));

    // Plenty of claims never make it onto the board but do have the carrier,
    // claim number and adjuster filled in on the JobTread job. Use those to
    // fill any blank the claim record left — a letter typed from scratch is
    // how claim numbers get transposed.
    const jt = (lead.insuranceClaim || claim)
      ? await new JobTreadClient().getJobInsurance(externalId).catch(() => ({} as Record<string, string | boolean | null>))
      : ({} as Record<string, string | boolean | null>);
    const jtText = (k: string): string => {
      const v = jt[k];
      return typeof v === 'string' ? v.trim() : '';
    };
    const jtDate = (k: string): string => {
      const v = jtText(k);
      const d = v ? new Date(v) : null;
      return d && !Number.isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : '';
    };

    const amounts = (claim?.amounts ?? {}) as { deductible?: number; acv?: number; rcv?: number; firstCheck?: number; supplements?: number };
    const rcv = money(amounts.rcv);
    const acv = money(amounts.acv);
    const supplements = money(amounts.supplements);
    const insuredName = claim?.customerName
      || [lead.firstName, lead.lastName].filter(Boolean).join(' ').trim()
      || lead.jobName
      || '';
    const address = [lead.address, [lead.city, lead.state].filter(Boolean).join(', '), lead.zip].filter(Boolean).join(', ');

    res.json({
      // Whether this job looks like one the letter is for at all — the screen
      // warns rather than hides, since JobTread's flags lag reality.
      insuranceJob: !!lead.insuranceClaim || !!claim || jt.isClaim === true,
      claimFound: !!claim,
      claimId: claim?.id ?? null,
      claimStage: claim?.stage ?? null,
      depreciationRequested: !!(claim?.checks as Record<string, boolean> | undefined)?.depreciation_requested,
      fields: {
        date: ymd(new Date()),
        carrier: claim?.carrier || jtText('carrier'),
        adjusterName: claim?.adjuster?.name || jtText('adjusterName'),
        // The carrier's claims inbox beats one adjuster's address for a
        // depreciation release — an adjuster moves on, the inbox doesn't.
        adjusterEmail: jtText('claimsEmail') || claim?.adjuster?.email || jtText('adjusterEmail'),
        claimNumber: claim?.claimNumber || jtText('claimNumber'),
        policyNumber: claim?.policyNumber || jtText('policyNumber'),
        insuredName,
        propertyAddress: address,
        dateOfLoss: ymd(claim?.dateOfLoss ?? null) || jtDate('dateOfLoss'),
        // The date most letters turn on. JobTread's schedule end is when the
        // crew finished; the close date is the fallback for jobs wrapped up
        // without a schedule. The screen relabels it per letter and the sender
        // can change it — a supplement's date is not a completion date.
        eventDate: ymd(lead.scheduleEnd ?? lead.closedOn ?? null),
        amount: depreciationDue({ rcv, supplements, acv }),
        items: [],
        note: '',
        rcv, supplements, acv,
        deductible: money(amounts.deductible),
        deductibleCollected: false,
        payableTo: insuredName,
        // Per-letter defaults; the screen swaps these when the letter changes.
        enclosuresByKind: Object.fromEntries(INSURANCE_LETTERS.map((l) => [l.kind, l.enclosures])),
        enclosures: [...letterDef('depreciation').enclosures],
        senderName: me?.name || user.name || '',
        senderTitle: me?.role === 'admin' ? 'Owner' : 'Project Manager',
        senderPhone: me?.phone || OFFICE_PHONE,
        senderEmail: user.email,
        companyName: COMPANY_NAME,
        officeAddress: await officeAddress(),
        companyPhone: OFFICE_PHONE,
      },
    });
  }));

  /**
   * Send it, from the sender's own company mailbox, with the chosen photos in
   * the body. The letter is composed here from the posted fields — the browser
   * never supplies the HTML that goes out under the company's name.
   */
  app.post('/api/clients/:externalId/insurance-letters/send', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const user = req.session.user! as SessionUser;
    const externalId = req.params.externalId;
    if (!(await ownsLead(user, externalId))) return res.status(404).json({ error: 'not found' });

    const b = req.body || {};
    const to = str(b.to, 160).toLowerCase();
    const cc = str(b.cc, 160).toLowerCase();
    if (!EMAIL_RE.test(to)) return res.status(400).json({ error: "That doesn't look like an email address to send to." });
    if (cc && !EMAIL_RE.test(cc)) return res.status(400).json({ error: "The cc address doesn't look right." });

    const kind: InsuranceLetterKind = isInsuranceLetterKind(b.kind) ? b.kind : 'depreciation';
    const fields = normalizeFields(kind, b.fields);
    const missing = missingLetterFields(kind, fields);
    if (missing.length) return res.status(400).json({ error: `Still needed: ${missing.join(', ')}.`, missing });

    const ids = (v: unknown, max: number) => (Array.isArray(v) ? v : []).map((x: unknown) => str(x, 80)).filter(Boolean).slice(0, max);
    // The signed certificate of completion is generated here rather than
    // picked off the job: it is this app's own document, and a carrier must get
    // the copy with both signatures on it, not an earlier draft someone filed.
    const certificate = req.body?.includeCertificate === true ? await signedCertificateAttachment(externalId) : null;

    const { attachments, images, skipped } = await collectAttachments(externalId, {
      photoIds: ids(b.photoIds, MAX_PHOTOS),
      photoUploads: Array.isArray(b.uploads) ? b.uploads.slice(0, MAX_PHOTOS) : [],
      documentIds: ids(b.documentIds, MAX_DOCS),
      documentUploads: Array.isArray(b.documentUploads) ? b.documentUploads.slice(0, MAX_DOCS) : [],
    });

    if (certificate?.attachment) attachments.push(certificate.attachment);
    if (certificate?.skipped) skipped.push(certificate.skipped);

    const letter = buildInsuranceLetter(kind, fields, 'letter', images);
    const mailbox = await sendingMailboxFor(user.email);

    let messageId: string;
    try {
      messageId = await sendAsMailboxWithAttachments(mailbox, to, letter.subject, letter.html, attachments, cc || undefined);
    } catch (e: any) {
      await logWrite({
        actor: user.email, system: 'google', action: 'insurance_letter', targetId: externalId,
        summary: `${letterDef(kind).label} to ${to} FAILED`, ok: false, error: e?.message || 'Gmail send failed',
      });
      return res.status(502).json({ error: `Couldn't send: ${e?.message || 'Gmail refused the message'}` });
    }

    const claimTicked = await tickDepreciationRequested(externalId, b.tickClaim !== false);
    await logWrite({
      actor: user.email, system: 'google', action: 'insurance_letter', targetId: externalId,
      summary: `${letterDef(kind).label} emailed to ${to}${cc ? ` (cc ${cc})` : ''} from ${mailbox}`
        + `${fields.amount > 0 ? ` for ${fields.amount.toFixed(2)}` : ''}`
        + `${images.length ? ` · ${images.length} photo(s)` : ''}`
        + `${attachments.length - images.length > 0 ? ` · ${attachments.length - images.length} document(s)` : ''}`
        + `${claimTicked ? ' · claim ticked' : ''}`,
      ok: true, error: null,
    });

    res.json({
      ok: true, messageId, sentFrom: mailbox, to, cc: cc || null,
      photos: images.length, documents: attachments.length - images.length,
      certificate: !!certificate?.attachment, skipped, claimTicked,
    });
  }));

  /**
   * The letter went out. Logged like any other outbound action, and — when the
   * job has a claim on the board — it ticks "Depreciation requested" there, so
   * the claim stops being chased for something already done.
   */
  app.post('/api/clients/:externalId/insurance-letters/sent', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const user = req.session.user! as SessionUser;
    const externalId = req.params.externalId;
    if (!(await ownsLead(user, externalId))) return res.status(404).json({ error: 'not found' });

    const how = String(req.body?.how || 'sent').slice(0, 40);
    const amount = money(req.body?.amount);

    const claimTicked = await tickDepreciationRequested(externalId, req.body?.tickClaim !== false);

    await logWrite({
      actor: user.email, system: 'app', action: 'depreciation_letter', targetId: externalId,
      summary: `Depreciation letter ${how}${amount ? ` for ${amount.toFixed(2)}` : ''}${claimTicked ? ' · claim ticked' : ''}`,
      ok: true, error: null,
    });

    res.json({ ok: true, claimTicked });
  }));
}
