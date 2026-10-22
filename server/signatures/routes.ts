/**
 * Send a document for signature — by text and by email — and record where it
 * was signed.
 *
 * The shape is the one the certificate of completion already proved out: a
 * random per-signer token in a link is the capability, so the customer signs
 * without an account, on a phone, from a text message. What is new here is
 * that any document the app builds can go out this way (server/signatures/
 * providers.ts), that more than one person can sign the same document, and
 * that every signature carries a location.
 *
 * Nothing the browser posts becomes the document. The HTML is built on the
 * server and frozen with its SHA-256 at the moment it goes out, so the thing
 * on file is the thing that was shown — and a later edit to the report it came
 * from cannot rewrite a document somebody already signed.
 */
import crypto from 'node:crypto';
import type { Express, Request, Response } from 'express';
import { waitUntil } from '@vercel/functions';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '../db';
import { leads, signatureRequests, signatureSigners, teamMembers, writeLog } from '../../shared/schema';
import { requireAuth } from '../auth/middleware';
import { ownsLead, type SessionUser } from '../access/rep-scope';
import { asyncHandler } from '../lib/async-handler';
import { rateLimit } from '../lib/rate-limit';
import { logWrite } from '../writes/log';
import { sendAsMailbox, sendAsMailboxWithAttachments } from '../brain/gmail-delegated';
import { memberByEmail } from '../access/team-scope';
import { COMPANY_DOMAIN, OFFICE_CALENDAR } from '../calendar/access';
import { GoHighLevelClient } from '../integrations/gohighlevel';
import { JobTreadClient } from '../integrations/jobtread';
import {
  escapeHtml, isOpen, signatureBlockHtml,
  type SignatureRequestView, type SignatureSourceKind, type SignatureStatus, type SignerGeo, type SignerRole, type SignerView,
} from '../../shared/signatures';
import { buildSignable, listSignable, propertyAddressFor } from './providers';
import { recordCertificateSignatures } from '../certificates/routes';
import { clientIp, geocodeProperty, networkGeo, resolveSignerGeo } from './geo';
import { signedPdf } from './pdf';
import {
  DOCUMENT_HEIGHT_SCRIPT, DOCUMENT_SANDBOX, SIGN_PAGE_CSP,
  declinePage, declinedPage, notFoundPage, signPage, signedPage, tooManyPage, voidedPage,
} from './sign-page';
import { signerLinkCompany } from '../tenant/public-links';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_SIGNERS = 4;
/** A drawn signature is a few tens of KB; this is the ceiling before a public form is storing junk. */
const MAX_SIGNATURE_BASE64 = 400_000;

/**
 * Public paths, rate-limited like the report beacon and the certificate page —
 * but answering with a page rather than JSON, because the person on the other
 * end of these is a customer in a browser, not a script.
 */
const publicLimit = (req: Request, res: Response) => {
  res.set('Content-Type', 'text/html; charset=utf-8').send(tooManyPage());
};
/**
 * Signing is limited per LINK, not per IP.
 *
 * Keyed by IP, a household signing four documents off one WiFi, or an office
 * behind one address, share a budget with every other signer on that
 * connection — and the person it turns away is a customer trying to sign.
 * One link never needs to be posted more than a handful of times, so that is
 * what is capped; `signFloodLimiter` still holds the line on an IP working
 * through tokens in bulk.
 */
const signLimiter = rateLimit(12, 60 * 60 * 1000, publicLimit, (req) => `sign:${req.params.token || 'none'}`);
const signFloodLimiter = rateLimit(200, 60 * 60 * 1000, publicLimit);
const viewLimiter = rateLimit(240, 60 * 60 * 1000, publicLimit);
/** Sending costs a text and an email per signer, so it is capped per user. */
const sendLimiter = rateLimit(40, 60 * 60 * 1000);

const str = (v: unknown, max = 200): string => String(v ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, max);
const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);
const digits = (v: unknown): string => String(v ?? '').replace(/\D/g, '');
const appBase = (): string => (process.env.APP_BASE_URL || 'https://app.bestroofingnow.com').replace(/\/+$/, '');
const signUrl = (token: string): string => `${appBase()}/r/s/${token}`;

/**
 * Vercel may freeze the function the moment the response is sent, which would
 * drop a filing or an email still in flight. waitUntil keeps it alive until the
 * work finishes; outside Vercel the promise simply runs.
 */
function afterResponse(work: Promise<unknown>, what: string): void {
  waitUntil(work.catch((e) => console.error(`[signatures] ${what} failed:`, e instanceof Error ? e.message : e)));
}

/** A US number in the form GoHighLevel wants, or null if it isn't one. */
export function normalizePhone(raw: unknown): string | null {
  const d = digits(raw);
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith('1')) return `+${d}`;
  return d.length > 11 && d.length <= 15 ? `+${d}` : null;
}

/** The mailbox this goes out from — the sender's own where they have one. */
async function sendingMailboxFor(email: string): Promise<string> {
  const e = (email || '').trim().toLowerCase();
  const me = await memberByEmail(e).catch(() => null);
  return me?.active && e.endsWith(COMPANY_DOMAIN) ? e : OFFICE_CALENDAR;
}

const signerView = (s: typeof signatureSigners.$inferSelect, withToken: boolean): SignerView => ({
  id: s.id,
  name: s.name,
  email: s.email,
  phone: s.phone,
  role: (s.role as SignerRole) || 'customer',
  signUrl: withToken ? signUrl(s.token) : null,
  emailedAt: iso(s.emailedAt), emailError: s.emailError,
  textedAt: iso(s.textedAt), textError: s.textError,
  remindedAt: iso(s.remindedAt), remindCount: s.remindCount ?? 0,
  firstViewedAt: iso(s.firstViewedAt), lastViewedAt: iso(s.lastViewedAt), viewCount: s.viewCount ?? 0,
  signedAt: iso(s.signedAt), signedName: s.signedName,
  signatureKind: (s.signatureKind as 'typed' | 'drawn' | null) ?? null,
  signatureImage: s.signatureImage,
  declinedAt: iso(s.declinedAt), declineReason: s.declineReason,
  ip: s.ip, userAgent: s.userAgent,
  geo: (s.geo as SignerGeo | null) ?? null,
  viewGeo: (s.viewGeo as SignerGeo | null) ?? null,
});

function requestView(
  r: typeof signatureRequests.$inferSelect,
  signers: Array<typeof signatureSigners.$inferSelect>,
  opts: { withTokens?: boolean; withImages?: boolean } = {},
): SignatureRequestView {
  const views = signers.map((s) => {
    const v = signerView(s, opts.withTokens !== false);
    // The signature images are tens of kilobytes each; the list screen does
    // not draw them, so they only travel when something is going to render one.
    return opts.withImages ? v : { ...v, signatureImage: null };
  });
  return {
    id: r.id,
    jobExternalId: r.jobExternalId,
    sourceKind: r.sourceKind as SignatureSourceKind,
    sourceRef: r.sourceRef,
    title: r.title,
    docHash: r.docHash,
    message: r.message,
    propertyAddress: r.propertyAddress,
    /** False when the address could not be geocoded, so no distance can be shown. */
    propertyLocated: r.propertyLat !== null && r.propertyLng !== null,
    status: r.status as SignatureStatus,
    createdBy: r.createdBy,
    sentAt: iso(r.sentAt), sentBy: r.sentBy,
    completedAt: iso(r.completedAt),
    voidedAt: iso(r.voidedAt), voidedBy: r.voidedBy, voidReason: r.voidReason,
    jobtreadFileId: r.jobtreadFileId,
    createdAt: iso(r.createdAt),
    signers: views,
  };
}

async function loadRequest(id: number) {
  const [r] = await db.select().from(signatureRequests).where(eq(signatureRequests.id, id));
  if (!r) return null;
  const signers = await db.select().from(signatureSigners)
    .where(eq(signatureSigners.requestId, id)).orderBy(asc(signatureSigners.ordinal), asc(signatureSigners.id));
  return { request: r, signers };
}

// ---- Delivery -------------------------------------------------------------

function emailBody(o: { title: string; signerName: string; message: string | null; link: string; senderName: string; property: string | null }): string {
  return [
    `<p>Hi ${escapeHtml(o.signerName.split(/\s+/)[0] || 'there')},</p>`,
    o.message ? `<p>${escapeHtml(o.message)}</p>` : '',
    `<p><b>${escapeHtml(o.title)}</b>${o.property ? ` for ${escapeHtml(o.property)}` : ''} is ready for your signature.</p>`,
    `<p><a href="${o.link}" style="display:inline-block;background:#b8322b;color:#fff;padding:13px 22px;border-radius:9px;text-decoration:none;font-weight:700">Review and sign</a></p>`,
    `<p style="color:#666;font-size:13px">Or paste this into your browser: ${o.link}</p>`,
    `<p style="color:#666;font-size:13px">It opens on a phone — you can sign with your finger. Ask us any time for a paper copy.</p>`,
    `<p>Thank you,<br>${escapeHtml(o.senderName)}<br>Best Roofing Now</p>`,
  ].filter(Boolean).join('\n');
}

const smsBody = (title: string, link: string, reminder: boolean): string =>
  `Best Roofing Now: ${reminder ? 'a reminder that ' : ''}${title} is ready for your signature. Sign here: ${link}`;

/**
 * Send one signer their link on both channels. Each is recorded on its own,
 * because "the text went and the email bounced" is the ordinary case and the
 * rep has to be able to see which half worked.
 */
async function deliver(
  signer: typeof signatureSigners.$inferSelect,
  req: typeof signatureRequests.$inferSelect,
  opts: { email: boolean; text: boolean; mailbox: string; senderName: string; reminder: boolean },
): Promise<{ emailed: boolean; texted: boolean; errors: string[]; rawErrors: string[] }> {
  const link = signUrl(signer.token);
  const errors: string[] = [];
  /** What actually went wrong, for the log — never for the rep's screen. */
  const rawErrors: string[] = [];
  const patch: Partial<typeof signatureSigners.$inferInsert> = {};

  if (opts.email && signer.email && EMAIL_RE.test(signer.email)) {
    try {
      await sendAsMailbox(
        opts.mailbox, signer.email,
        `${opts.reminder ? 'Reminder: ' : ''}Please sign — ${req.title}`,
        emailBody({ title: req.title, signerName: signer.name, message: req.message, link, senderName: opts.senderName, property: req.propertyAddress }),
      );
      patch.emailedAt = new Date();
      patch.emailError = null;
    } catch (e: any) {
      // The provider's own words can name internal configuration ("No key or
      // keyFile set."), which is no use to a rep and does not belong on their
      // screen. They get a sentence; the raw reason goes to the write log.
      const raw = str(e?.message || 'Gmail refused the message', 300);
      console.error('[signatures] email to', signer.email, 'failed:', raw);
      rawErrors.push(`email ${signer.email}: ${raw}`);
      patch.emailError = `The email to ${signer.email} didn't go out.`;
      errors.push(patch.emailError);
    }
  }

  if (opts.text && signer.phone) {
    const to = normalizePhone(signer.phone);
    if (!to) {
      patch.textError = 'Not a phone number we can text';
      errors.push(`${signer.name}'s phone number isn't textable.`);
    } else {
      const r: { success: boolean; error?: string } = await new GoHighLevelClient()
        .sendSms(to, smsBody(req.title, link, opts.reminder))
        .catch((e: any) => ({ success: false, error: str(e?.message || 'GoHighLevel is not responding', 300) }));
      if (r.success) { patch.textedAt = new Date(); patch.textError = null; }
      else {
        const raw = str(r.error || 'GoHighLevel refused the message', 300);
        console.error('[signatures] text to', signer.phone, 'failed:', raw);
        rawErrors.push(`text ${signer.phone}: ${raw}`);
        patch.textError = `The text to ${signer.phone} didn't go out.`;
        errors.push(patch.textError);
      }
    }
  }

  if (opts.reminder) {
    patch.remindedAt = new Date();
    patch.remindCount = (signer.remindCount ?? 0) + 1;
  }
  if (Object.keys(patch).length) {
    await db.update(signatureSigners).set(patch).where(eq(signatureSigners.id, signer.id));
  }
  return { emailed: !!patch.emailedAt, texted: !!patch.textedAt, errors, rawErrors };
}

/**
 * A failed filing or copy is tried again the next time someone opens the job,
 * this many times. Past that it is a real fault (a deleted JobTread job, a
 * mailbox that refuses us) for a person to look at in the write log.
 */
const MAX_COMPLETION_ATTEMPTS = 5;
/** How long after signing a stalled completion is still picked up again. */
const RETRY_COMPLETION_FOR_MS = 7 * 24 * 60 * 60 * 1000;
/** The first key of the advisory lock that lets one run at a time claim a request's steps. */
const COMPLETION_LOCK = 7_316_001;
/**
 * How long a claimed step belongs to the run that claimed it. Longer than a
 * Vercel function can live (300s), so a claim older than this belongs to a run
 * that was killed part-way: it counts as a failed attempt and is tried again.
 */
const CLAIM_LEASE_SECONDS = 10 * 60;
/** What a claim says until its step has an outcome. */
const IN_PROGRESS = 'in progress';
const STEP_ACTIONS = ['signature_completed', 'signature_filed', 'signature_copy_sent'] as const;
type StepAction = typeof STEP_ACTIONS[number];

/**
 * Each step of finishing a request leaves a row in the write log under its own
 * key, and that row is how a later run knows the step is done. The request row
 * has no column for "the copies went out", and the write log is already where
 * the question "did we try?" is answered.
 */
const completedKey = (id: number): string => `request #${id}`;
const filedKey = (id: number, filename: string): string => `${filename} — request #${id}`;
const copyKey = (id: number, to: string): string => `request #${id}: signed copy to ${to}`;

/** The database, or the short claim transaction on it. */
type Exec = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

interface StepState { done: boolean; running: boolean; failures: number }
interface Step { action: StepAction; summary: string; to?: string }
interface Claim extends Step { id: number }

const NO_STEP: StepState = { done: false, running: false, failures: 0 };
const stepId = (action: string, summary: string | null): string => `${action}\n${summary ?? ''}`;
const pendingStep = (s: StepState): boolean => !s.done && !s.running && s.failures < MAX_COMPLETION_ATTEMPTS;

/**
 * Every step recorded on a job, in one query.
 *
 * It used to be one query per step, each filtering the log on its free-text
 * summary with no index to help: a scan of the whole log per signer, on every
 * view of the job. The index on (action, target_id) (migration 0042) narrows
 * it to the job's own few rows, and the summary is matched here.
 */
async function stepStates(exec: Exec, jobExternalId: string): Promise<(step: Step) => StepState> {
  const rows = await exec.select({
    action: writeLog.action, summary: writeLog.summary, ok: writeLog.ok, error: writeLog.error,
    fresh: sql<boolean>`${writeLog.createdAt} > localtimestamp - make_interval(secs => ${CLAIM_LEASE_SECONDS})`,
  }).from(writeLog)
    .where(and(inArray(writeLog.action, [...STEP_ACTIONS]), eq(writeLog.targetId, jobExternalId)));
  const states = new Map<string, StepState>();
  for (const r of rows) {
    const key = stepId(r.action, r.summary);
    const s = { ...(states.get(key) ?? NO_STEP) };
    if (r.ok) s.done = true;
    else if (r.error === IN_PROGRESS && r.fresh) s.running = true;
    else s.failures++;
    states.set(key, s);
  }
  return (step) => states.get(stepId(step.action, step.summary)) ?? NO_STEP;
}

/**
 * Take the steps still to do, so no other run does them as well.
 *
 * A claim is a row in the write log, written before the work and settled
 * after it. The lock that makes claiming one-at-a-time lives only for this
 * short transaction. It used to be held for the whole of finishing — the PDF,
 * the JobTread upload, every email — on a connection out of a pool of ten,
 * while every query inside went back to the pool for a second connection:
 * five job views at once and every connection was a transaction waiting for
 * another, until they all timed out.
 *
 * The inserts throw. A claim that cannot be written means nothing would record
 * that the step was tried, and a step done without a record is done again on
 * every view of the job for a week — so the step is not done at all.
 */
async function claimSteps(request: typeof signatureRequests.$inferSelect, wanted: Step[]): Promise<Claim[]> {
  return db.transaction(async (tx) => {
    const lock = await tx.execute(sql`select pg_try_advisory_xact_lock(${COMPLETION_LOCK}::int, ${request.id}::int) as got`);
    // Another run is claiming this request right now; what is left is its to do.
    if (!(lock.rows[0] as { got?: boolean } | undefined)?.got) return [];
    // Read again under the lock: another run may have claimed or finished a step since.
    const state = await stepStates(tx, request.jobExternalId);
    const still = wanted.filter((w) => pendingStep(state(w)));
    if (!still.length) return [];
    const rows = await tx.insert(writeLog).values(still.map((w) => ({
      actor: 'system:signatures', system: w.action === 'signature_filed' ? 'jobtread' : 'google', action: w.action,
      targetId: request.jobExternalId, summary: w.summary, ok: false, error: IN_PROGRESS,
    }))).returning({ id: writeLog.id, action: writeLog.action, summary: writeLog.summary });
    const ids = new Map(rows.map((r) => [stepId(r.action, r.summary), r.id]));
    return still.map((w) => ({ ...w, id: ids.get(stepId(w.action, w.summary))! }));
  });
}

/** Record how a claimed step came out. */
async function settleClaim(claim: Claim, ok: boolean, error: string | null): Promise<void> {
  try {
    await db.update(writeLog).set({ ok, error }).where(eq(writeLog.id, claim.id));
  } catch (e: any) {
    // The step ran but the log could not say how. Once its lease runs out the
    // claim reads as a failed attempt — at worst one more try, never a loop.
    console.error('[signatures] could not record', claim.summary, 'as', ok ? 'done' : 'failed:', e?.message || e);
  }
}

const signedFilename = (title: string): string =>
  `${title.replace(/[^\w \-.]+/g, '').slice(0, 80) || 'Signed document'} (signed).pdf`;

/**
 * Everybody has signed: freeze the status, then finish it — build the signed
 * PDF, file it on the job and send every signer their copy.
 *
 * Best effort past the status write. The signatures are already recorded, and
 * a JobTread hiccup or a bounced mailbox must not be able to lose one.
 */
async function completeIfDone(requestId: number): Promise<void> {
  const loaded = await loadRequest(requestId);
  if (!loaded) return;
  const { request, signers } = loaded;
  if (request.status === 'voided') return;
  // Already signed: the status moved, but the run that moved it may have been
  // frozen before the PDF was filed or the copies went out. Finish what is left.
  if (request.status === 'signed') return finishSigned(requestId, false);

  if (!signers.length || !signers.every((s) => s.signedAt)) {
    // Somebody signed a link that never reported as delivered — a rep copied
    // it out of the app by hand, or the send half-failed. It plainly reached
    // them, so the board should stop calling it a draft.
    if (request.status === 'draft') {
      await db.update(signatureRequests).set({ status: 'sent', updatedAt: new Date() }).where(eq(signatureRequests.id, requestId));
    }
    return;
  }

  const [updated] = await db.update(signatureRequests)
    .set({ status: 'signed', completedAt: new Date(), updatedAt: new Date() })
    // Whichever request state we came from, only one writer gets to move it to
    // signed — the loser of the race must not file a second PDF.
    .where(and(eq(signatureRequests.id, requestId), inArray(signatureRequests.status, ['draft', 'sent'])))
    .returning();
  if (!updated) return;   // somebody else got there first

  // The mark that this completion is tracked step by step. A request signed
  // before the steps were recorded has no such row and is never re-run: its
  // copies went out back then, and nothing here could tell which.
  try {
    await db.insert(writeLog).values({
      actor: 'system:signatures', system: 'app', action: 'signature_completed', targetId: updated.jobExternalId,
      summary: completedKey(requestId), ok: true, error: null,
    });
  } catch (e: any) {
    // Without the mark a later job view will not resume this one, but this run
    // still finishes it: every step is claimed before it is done, and a claim
    // that cannot be written stops its step rather than letting it repeat.
    console.error('[signatures] could not mark request', requestId, 'completed:', e?.message || e);
  }
  await finishSigned(requestId, true);
}

/**
 * The steps after the status flip, each done at most once.
 *
 * It used to run once, after the response, and return early on any request
 * already marked signed — so a function frozen between the flip and the email
 * left the customer without their copy, and nothing ever tried again. Now each
 * step is claimed before it runs and settled after, a later run does only what
 * is left, and no lock or transaction is held across the upload or the emails.
 */
async function finishSigned(requestId: number, fresh: boolean): Promise<void> {
  // The cheap question first, outside any transaction. On nearly every job
  // view the answer is "nothing left", and that costs three reads.
  const loaded = await loadRequest(requestId);
  if (!loaded || loaded.request.status !== 'signed' || !loaded.signers.length) return;
  const { request, signers } = loaded;
  const state = await stepStates(db, request.jobExternalId);
  if (!fresh && !state({ action: 'signature_completed', summary: completedKey(requestId) }).done) return;

  const filename = signedFilename(request.title);
  const recipients = Array.from(new Set(
    signers.map((s) => s.email).filter((e): e is string => !!e && EMAIL_RE.test(e)),
  ));
  const steps: Step[] = [
    ...(request.jobtreadFileId ? [] : [{ action: 'signature_filed' as const, summary: filedKey(requestId, filename) }]),
    ...recipients.map((to) => ({ action: 'signature_copy_sent' as const, summary: copyKey(requestId, to), to })),
  ];
  const todo = steps.filter((s) => pendingStep(state(s)));

  if (request.sourceKind === 'certificate' && (fresh || todo.length)) await recordOnCertificate(request, signers);
  if (!todo.length) return;

  const claims = await claimSteps(request, todo);
  if (!claims.length) return;

  const view = requestView(request, signers, { withImages: true });
  const documentUrl = `${signUrl(signers[0].token)}/document`;
  let pdf: Buffer;
  try {
    pdf = signedPdf(view, request.html, documentUrl);
  } catch (e: any) {
    console.error('[signatures] could not build the signed PDF:', e?.message || e);
    // Every claimed step counts it as a failure, so a document that can never
    // be drawn stops being retried instead of being rebuilt on every page load.
    const why = str(`PDF: ${e?.message || 'could not be built'}`, 300);
    for (const c of claims) await settleClaim(c, false, why);
    return;
  }

  const filing = claims.find((c) => c.action === 'signature_filed');
  if (filing) await fileSigned(request, signers, filename, pdf, filing);

  // The signed copy back to everyone who signed — the law expects the signer
  // to end up holding the document, not just a receipt for it.
  const copies = claims.filter((c) => c.action === 'signature_copy_sent');
  if (!copies.length) return;
  const mailbox = await sendingMailboxFor(request.sentBy || request.createdBy);
  const attachment = { filename, contentType: 'application/pdf', base64: pdf.toString('base64') };
  for (const copy of copies) {
    try {
      await sendAsMailboxWithAttachments(
        mailbox, copy.to!, `Signed — ${request.title}`,
        `<p>Thank you — everyone has now signed <b>${escapeHtml(request.title)}</b>.</p>`
        + '<p>The signed copy is attached for your records, with the signature record on the last page.</p>'
        + '<p>Best Roofing Now</p>',
        [attachment],
        request.sentBy && EMAIL_RE.test(request.sentBy) ? request.sentBy : undefined,
      );
      await settleClaim(copy, true, null);
    } catch (e: any) {
      console.warn('[signatures] signed copy to', copy.to, 'failed:', e?.message || e);
      await settleClaim(copy, false, str(e?.message || 'send failed', 300));
    }
  }
}

/** File the signed PDF on the JobTread job, once. */
async function fileSigned(
  request: typeof signatureRequests.$inferSelect,
  signers: Array<typeof signatureSigners.$inferSelect>,
  filename: string,
  pdf: Buffer,
  claim: Claim,
): Promise<void> {
  let saved: { ok: boolean; fileId?: string | null; error?: string | null };
  try {
    saved = await new JobTreadClient().uploadJobFile(request.jobExternalId, {
      name: filename, contentType: 'application/pdf', data: pdf,
      description: `Signed by ${signers.map((s) => s.signedName || s.name).join(', ')}`,
      folder: 'Signed documents',
    });
  } catch (e: any) {
    await settleClaim(claim, false, str(e?.message || 'upload failed', 300));
    return;
  }
  // Settled before anything else is written, so a hiccup below cannot leave
  // the step looking untried and file the PDF a second time.
  await settleClaim(claim, saved.ok, saved.error ?? null);
  if (!saved.ok || !saved.fileId) return;
  try {
    await db.update(signatureRequests).set({ jobtreadFileId: saved.fileId, updatedAt: new Date() }).where(eq(signatureRequests.id, request.id));
    if (request.sourceKind === 'certificate') {
      await recordCertificateSignatures(request.jobExternalId, {
        homeowner: null, company: null, jobtreadFileId: saved.fileId, requestCreatedAt: request.createdAt ?? null,
      });
    }
  } catch (e: any) {
    // The file is on the job and the log says so; the copies still go out.
    console.error('[signatures] filed request', request.id, 'but could not record the file id:', e?.message || e);
  }
}

/**
 * Requests this instance is already resuming, so a run of job views does not
 * stack one completion on top of another.
 */
const resuming = new Set<number>();

/**
 * Pick up the completions a job's list turned up, one after another.
 *
 * The list used to fire one run per signed request of the last week, all at
 * once, on every view of the job — each wanting connections from a pool of ten.
 */
async function resumeCompletions(ids: number[]): Promise<void> {
  for (const id of ids) {
    if (resuming.has(id)) continue;
    resuming.add(id);
    try {
      await finishSigned(id, false);
    } catch (e: any) {
      console.error('[signatures] resuming request', id, 'failed:', e?.message || e);
    } finally {
      resuming.delete(id);
    }
  }
}

/**
 * A certificate signed here rather than through its own link used to leave the
 * certificate on the job reading unsigned — so the insurance letter left it
 * off, and the panel offered to send it all over again. The names go back onto
 * it; recordCertificateSignatures never writes over a signature already there.
 */
async function recordOnCertificate(
  request: typeof signatureRequests.$inferSelect,
  signers: Array<typeof signatureSigners.$inferSelect>,
): Promise<void> {
  const customers = signers.filter((s) => s.role !== 'company' && s.signedAt);
  const company = signers.find((s) => s.role === 'company' && s.signedAt);
  // Two owners on one deed sign one certificate: both names, the later time.
  const last = customers.reduce<typeof customers[number] | null>(
    (a, s) => (!a || s.signedAt!.getTime() > a.signedAt!.getTime() ? s : a), null,
  );
  await recordCertificateSignatures(request.jobExternalId, {
    homeowner: last ? {
      name: customers.map((s) => s.signedName || s.name).join(' and '),
      at: last.signedAt!, ip: last.ip, email: customers.find((s) => s.email)?.email ?? null,
    } : null,
    company: company ? { name: company.signedName || company.name, at: company.signedAt! } : null,
    jobtreadFileId: request.jobtreadFileId,
    requestCreatedAt: request.createdAt ?? null,
  });
}

// ---- Routes ---------------------------------------------------------------

export function registerSignatureRoutes(app: Express) {
  /** What this job has that can go out for signature, and who to send it to. */
  app.get('/api/clients/:externalId/signature-docs', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const user = req.session.user! as SessionUser;
    const externalId = req.params.externalId;
    if (!(await ownsLead(user, externalId))) return res.status(404).json({ error: 'not found' });

    const [lead] = await db.select().from(leads).where(eq(leads.externalId, externalId));
    const [me] = await db.select({ name: teamMembers.name }).from(teamMembers).where(eq(teamMembers.email, user.email));
    res.json({
      options: await listSignable(externalId),
      customer: {
        name: [lead?.firstName, lead?.lastName].filter(Boolean).join(' ').trim() || lead?.jobName || '',
        email: lead?.email || '',
        phone: lead?.phone || '',
      },
      me: { name: me?.name || user.name || '', email: user.email },
      propertyAddress: await propertyAddressFor(externalId),
    });
  }));

  /** Everything sent out for this job. */
  app.get('/api/clients/:externalId/signature-requests', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const user = req.session.user! as SessionUser;
    const externalId = req.params.externalId;
    if (!(await ownsLead(user, externalId))) return res.status(404).json({ error: 'not found' });

    const rows = await db.select().from(signatureRequests)
      .where(eq(signatureRequests.jobExternalId, externalId))
      .orderBy(desc(signatureRequests.createdAt)).limit(50);
    if (!rows.length) return res.json({ requests: [] });

    const all = await db.select().from(signatureSigners)
      .where(inArray(signatureSigners.requestId, rows.map((r) => r.id)))
      .orderBy(asc(signatureSigners.ordinal), asc(signatureSigners.id));
    const byRequest = new Map<number, Array<typeof signatureSigners.$inferSelect>>();
    for (const s of all) {
      if (!byRequest.has(s.requestId)) byRequest.set(s.requestId, []);
      byRequest.get(s.requestId)!.push(s);
    }
    // A completion frozen part-way (see finishSigned) picks up again the next
    // time someone opens the job — there is no other moment that would.
    const stalled = rows
      .filter((r) => r.status === 'signed' && r.completedAt && Date.now() - r.completedAt.getTime() < RETRY_COMPLETION_FOR_MS)
      .map((r) => r.id);
    if (stalled.length) afterResponse(resumeCompletions(stalled), 'resuming completion');
    res.json({ requests: rows.map((r) => requestView(r, byRequest.get(r.id) || [])) });
  }));

  /**
   * Build the document, freeze it, and send every signer their link.
   *
   * The document is rendered here from the job's own data — the browser sends
   * which document, never the document itself.
   */
  app.post('/api/clients/:externalId/signature-requests', requireAuth, sendLimiter, asyncHandler(async (req: Request, res: Response) => {
    const user = req.session.user! as SessionUser;
    const externalId = req.params.externalId;
    if (!(await ownsLead(user, externalId))) return res.status(404).json({ error: 'not found' });

    const b = req.body || {};
    const kind = str(b.kind, 40) as SignatureSourceKind;
    const ref = b.ref ? str(b.ref, 120) : null;
    const message = str(b.message, 600) || null;
    const wantEmail = b.channels?.email !== false;
    const wantText = b.channels?.text !== false;

    const incoming = Array.isArray(b.signers) ? b.signers.slice(0, MAX_SIGNERS) : [];
    const signerInputs = incoming
      .map((s: any, i: number) => ({
        name: str(s?.name, 120),
        email: str(s?.email, 160).toLowerCase(),
        phone: str(s?.phone, 40),
        role: (s?.role === 'company' ? 'company' : 'customer') as SignerRole,
        ordinal: i,
      }))
      .filter((s: { name: string }) => s.name.length >= 2);

    if (!signerInputs.length) return res.status(400).json({ error: 'Add at least one person to sign, with their name.' });
    for (const s of signerInputs) {
      if (s.email && !EMAIL_RE.test(s.email)) return res.status(400).json({ error: `${s.name}'s email doesn't look right.` });
      if (s.phone && !normalizePhone(s.phone)) return res.status(400).json({ error: `${s.name}'s phone number doesn't look like one we can text.` });
      if (!s.email && !s.phone) return res.status(400).json({ error: `${s.name} needs an email address or a mobile number — otherwise there's nowhere to send the link.` });
      if (wantEmail && !wantText && !s.email) return res.status(400).json({ error: `${s.name} has no email address. Turn on the text message, or add one.` });
      if (wantText && !wantEmail && !s.phone) return res.status(400).json({ error: `${s.name} has no mobile number. Turn on the email, or add one.` });
    }
    if (!wantEmail && !wantText) return res.status(400).json({ error: 'Pick at least one way to send it — text, email, or both.' });

    const built = await buildSignable(externalId, kind, ref);
    if (!built.ok) return res.status(400).json({ error: built.error });

    const propertyAddress = await propertyAddressFor(externalId);
    // Geocoded once, here, so the signing page never waits on it: the signer's
    // distance from the roof is the one measurement that can't be redone later.
    const point = propertyAddress ? await geocodeProperty(propertyAddress).catch(() => null) : null;

    const [created] = await db.insert(signatureRequests).values({
      jobExternalId: externalId,
      sourceKind: built.doc.kind,
      sourceRef: built.doc.ref,
      title: built.doc.title,
      html: built.doc.html,
      docHash: crypto.createHash('sha256').update(built.doc.html, 'utf8').digest('hex'),
      message,
      propertyAddress: propertyAddress || null,
      propertyLat: point?.lat ?? null,
      propertyLng: point?.lng ?? null,
      status: 'draft',
      createdBy: user.email,
    }).returning();

    const signers = await db.insert(signatureSigners).values(
      signerInputs.map((s: { name: string; email: string; phone: string; role: SignerRole; ordinal: number }) => ({
        requestId: created.id,
        ordinal: s.ordinal,
        name: s.name,
        email: s.email || null,
        phone: s.phone || null,
        role: s.role,
        token: crypto.randomBytes(16).toString('hex'),
      })),
    ).returning();

    const mailbox = await sendingMailboxFor(user.email);
    const errors: string[] = [];
    const rawErrors: string[] = [];
    let delivered = 0;
    for (const s of signers) {
      const r = await deliver(s, created, { email: wantEmail, text: wantText, mailbox, senderName: str(user.name, 120) || user.email, reminder: false });
      if (r.emailed || r.texted) delivered++;
      errors.push(...r.errors);
      rawErrors.push(...r.rawErrors);
    }

    // Nothing reached anybody. Not a document that is out for signature, and
    // not one worth keeping either: nobody holds a link to it and nothing can
    // be signed against it, so leaving it on the board is only clutter the rep
    // has to tidy. The attempt survives in the write log, which is where the
    // question "did we try?" is actually answered.
    if (!delivered) {
      await db.delete(signatureRequests).where(eq(signatureRequests.id, created.id));
      await logWrite({
        actor: user.email, system: 'app', action: 'signature_sent', targetId: externalId,
        summary: `${created.title} → ${signers.map((sg) => sg.name).join(', ')} — nothing delivered`,
        ok: false, error: rawErrors.join('; ').slice(0, 400) || 'no channel succeeded',
      });
      return res.status(502).json({ error: `Couldn't send it: ${errors[0] || 'no email or text went out.'}`, errors });
    }

    await db.update(signatureRequests)
      .set({ status: 'sent', sentAt: new Date(), sentBy: user.email, updatedAt: new Date() })
      .where(eq(signatureRequests.id, created.id));

    await logWrite({
      actor: user.email, system: 'app', action: 'signature_sent', targetId: externalId,
      summary: `${created.title} → ${signers.map((sg) => sg.name).join(', ')}`,
      ok: true, error: rawErrors.length ? rawErrors.join('; ').slice(0, 400) : null,
    });

    const loaded = await loadRequest(created.id);
    res.json({ ok: true, request: loaded ? requestView(loaded.request, loaded.signers) : null, warnings: errors });
  }));

  /** Nudge whoever hasn't signed yet. */
  app.post('/api/signature-requests/:id/remind', requireAuth, sendLimiter, asyncHandler(async (req: Request, res: Response) => {
    const user = req.session.user! as SessionUser;
    const loaded = await loadRequest(Number(req.params.id));
    if (!loaded || !(await ownsLead(user, loaded.request.jobExternalId))) return res.status(404).json({ error: 'not found' });
    if (!isOpen(loaded.request.status as SignatureStatus)) return res.status(400).json({ error: `This one is ${loaded.request.status}, so there is nobody to remind.` });

    const waiting = loaded.signers.filter((s) => !s.signedAt && !s.declinedAt);
    if (!waiting.length) return res.status(400).json({ error: 'Everyone has already signed.' });

    const mailbox = await sendingMailboxFor(user.email);
    const errors: string[] = [];
    const rawErrors: string[] = [];
    let sent = 0;
    for (const s of waiting) {
      const r = await deliver(s, loaded.request, {
        email: req.body?.channels?.email !== false, text: req.body?.channels?.text !== false,
        mailbox, senderName: str(user.name, 120) || user.email, reminder: true,
      });
      if (r.emailed || r.texted) sent++;
      errors.push(...r.errors);
      rawErrors.push(...r.rawErrors);
    }

    await logWrite({
      actor: user.email, system: 'app', action: 'signature_reminded', targetId: loaded.request.jobExternalId,
      summary: `${loaded.request.title} → ${waiting.map((sg) => sg.name).join(', ')}`, ok: sent > 0, error: rawErrors.join('; ').slice(0, 400) || null,
    });
    if (!sent) return res.status(502).json({ error: errors[0] || 'The reminder did not go out.', errors });

    const after = await loadRequest(loaded.request.id);
    res.json({ ok: true, reminded: sent, warnings: errors, request: after ? requestView(after.request, after.signers) : null });
  }));

  /** Pull it back. The links stop working immediately. */
  app.post('/api/signature-requests/:id/void', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const user = req.session.user! as SessionUser;
    const loaded = await loadRequest(Number(req.params.id));
    if (!loaded || !(await ownsLead(user, loaded.request.jobExternalId))) return res.status(404).json({ error: 'not found' });
    if (loaded.request.status === 'signed') return res.status(409).json({ error: 'This is signed. A signed document is a record of what was signed — send a replacement instead of cancelling it.' });

    const reason = str(req.body?.reason, 300) || null;
    const [updated] = await db.update(signatureRequests)
      .set({ status: 'voided', voidedAt: new Date(), voidedBy: user.email, voidReason: reason, updatedAt: new Date() })
      .where(eq(signatureRequests.id, loaded.request.id)).returning();
    await logWrite({ actor: user.email, system: 'app', action: 'signature_voided', targetId: loaded.request.jobExternalId, summary: `${loaded.request.title}${reason ? ` — ${reason}` : ''}`, ok: true, error: null });
    res.json({ ok: true, request: requestView(updated, loaded.signers) });
  }));

  /** The signed document, or the record so far. */
  app.get('/api/signature-requests/:id/pdf', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const user = req.session.user! as SessionUser;
    const loaded = await loadRequest(Number(req.params.id));
    if (!loaded || !(await ownsLead(user, loaded.request.jobExternalId))) return res.status(404).json({ error: 'not found' });

    const view = requestView(loaded.request, loaded.signers, { withImages: true });
    const documentUrl = loaded.signers.length ? `${signUrl(loaded.signers[0].token)}/document` : '';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${loaded.request.title.replace(/[^\w \-.]+/g, '').slice(0, 60) || 'Signature record'}.pdf"`);
    res.send(signedPdf(view, loaded.request.html, documentUrl));
  }));

  // ---- The signer's side. No login: the token in the link is the capability. ----

  /** The frozen document on its own, for the frame and for a full-screen read. */
  app.get('/r/s/:token/document', viewLimiter, signerLinkCompany(), asyncHandler(async (req: Request, res: Response) => {
    const found = await bySignerToken(req.params.token);
    if (!found) return res.status(404).send('Not found.');
    const { request } = found;
    // The signing page already refused a cancelled request, but the frame's own
    // link kept serving the document — so a voided one could still be read and
    // passed around as if it stood.
    if (request.status === 'voided') {
      return res.status(410).set('Content-Type', 'text/html; charset=utf-8').send(voidedPage(request.title, request.voidReason));
    }

    // The certificate is a fragment; a report is a whole page. Wrapping a
    // fragment is safe, wrapping a full document is not, so the frozen HTML
    // says which it is.
    // Once it is signed the document carries its signatures, so the copy
    // linked from the PDF and re-opened from an email is the signed one.
    const block = request.status === 'signed' ? signatureBlockHtml(found.signers.map((s) => signerView(s, false))) : '';
    const html = block
      ? (/<\/body>/i.test(request.html)
        ? request.html.replace(/<\/body>/i, `${block}</body>`)
        : `${request.html}${block}`)
      : request.html;

    const isDocument = /<html[\s>]/i.test(html);
    const body = isDocument ? html : `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(request.title)}</title>
<style>body{font:15px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#1a1a1a;margin:0;padding:22px 18px;background:#fff}
h1,h2,h3{line-height:1.25} table{border-collapse:collapse} img{max-width:100%}</style></head><body>${html}</body></html>`;
    // After the last </body>, not the first: a report can carry the string in a script.
    const end = body.toLowerCase().lastIndexOf('</body>');
    const sized = end === -1 ? `${body}${DOCUMENT_HEIGHT_SCRIPT}` : `${body.slice(0, end)}${DOCUMENT_HEIGHT_SCRIPT}${body.slice(end)}`;

    res
      .set('Content-Type', 'text/html; charset=utf-8')
      .set('Cache-Control', 'no-store')
      // A stored report with inline scripts, served from the app's origin, ran
      // as the app — framed in the signing page or opened full screen. The CSP
      // sandbox gives it an origin of its own either way. No fetch allowlist:
      // stored reports pull fonts, maps and photos from more hosts than can be
      // confirmed for every copy already frozen, and a blocked photo in a
      // signed document is worse than the gap.
      .set('Content-Security-Policy', `sandbox ${DOCUMENT_SANDBOX}; object-src 'none'; frame-ancestors 'self'`)
      .send(sized);
  }));

  /** The signing page. Opening it is itself part of the record. */
  app.get('/r/s/:token', viewLimiter, signerLinkCompany(), asyncHandler(async (req: Request, res: Response) => {
    const found = await bySignerToken(req.params.token);
    if (!found) return res.status(404).send(notFoundPage());
    const { request, signer, signers } = found;

    if (request.status === 'voided') return res.status(410).send(voidedPage(request.title, request.voidReason));

    // Opening it is recorded whatever state it is in — including after
    // signing, because "they came back and read it again" is worth knowing.
    const now = new Date();
    await db.update(signatureSigners).set({
      firstViewedAt: signer.firstViewedAt ?? now,
      lastViewedAt: now,
      viewCount: (signer.viewCount ?? 0) + 1,
      viewGeo: signer.viewGeo ?? (networkGeo(req) as unknown as Record<string, any>),
    }).where(eq(signatureSigners.id, signer.id)).catch(() => {});

    if (signer.declinedAt) return res.send(declinedPage(request.title));
    if (signer.signedAt) return res.send(signedPage(request.title, signerView(signer, false), !!signer.email));

    res
      .set('Content-Type', 'text/html; charset=utf-8')
      .set('Cache-Control', 'no-store')
      .set('Content-Security-Policy', SIGN_PAGE_CSP)
      .send(signPage({
        token: req.params.token,
        title: request.title,
        propertyAddress: request.propertyAddress,
        message: request.message,
        signer: signerView(signer, false),
        signers: signers.map((s) => signerView(s, false)),
        framed: /<html[\s>]/i.test(request.html),
        inlineHtml: request.html,
        // Express has already decoded the query string. Decoding it a second
        // time mangles any literal percent sign the message carries, and
        // throws URIError on a bare one — which turned the signing page into a
        // 500 for anyone who arrived at `?e=%`.
        error: typeof req.query.e === 'string' ? req.query.e.slice(0, 200) : null,
      }));
  }));

  /** The signature itself. */
  app.post('/r/s/:token', signFloodLimiter, signLimiter, signerLinkCompany(), asyncHandler(async (req: Request, res: Response) => {
    const found = await bySignerToken(req.params.token);
    if (!found) return res.status(404).send(notFoundPage());
    const { request, signer } = found;
    if (request.status === 'voided') return res.status(410).send(voidedPage(request.title, request.voidReason));

    const back = (msg: string) => res.redirect(303, `/r/s/${encodeURIComponent(req.params.token)}?e=${encodeURIComponent(msg)}`);

    // Re-opening the link from an email after signing is ordinary, not an
    // error — show the thank-you rather than writing a second name over the first.
    if (signer.signedAt) return res.send(signedPage(request.title, signerView(signer, false), !!signer.email));
    if (signer.declinedAt) return res.send(declinedPage(request.title));

    const drawn = str(req.body?.kind, 20) === 'drawn';
    const name = str(req.body?.name, 120) || (drawn ? signer.name : '');
    if (req.body?.affirm !== 'yes') return back('Please tick the box to confirm you are signing.');
    if (name.trim().length < 3) return back('Please type your full name.');

    const image = drawn ? jpegBase64(req.body?.signature) : null;
    if (drawn && !image) return back("That signature didn't come through. Draw it again, or type your name instead.");

    const geo = await resolveSignerGeo(
      req,
      { lat: req.body?.lat, lng: req.body?.lng, accuracy: req.body?.accuracy },
      { lat: request.propertyLat ?? null, lng: request.propertyLng ?? null },
    );

    const [updated] = await db.update(signatureSigners).set({
      signedAt: new Date(),
      signedName: name,
      signatureKind: image ? 'drawn' : 'typed',
      signatureImage: image,
      ip: clientIp(req),
      userAgent: str(req.headers['user-agent'], 400) || null,
      geo: geo as unknown as Record<string, any>,
    })
      // Only if it is still unsigned: two taps on a slow phone must not record
      // two signatures, and the second write would overwrite the first's time.
      .where(and(eq(signatureSigners.id, signer.id), isNull(signatureSigners.signedAt)))
      .returning();

    // The other tap won. Its signature stands; show the same thank-you.
    if (!updated) {
      const again = await bySignerToken(req.params.token);
      return res.send(signedPage(request.title, signerView(again?.signer ?? signer, false), !!signer.email));
    }

    await logWrite({
      actor: signer.email || signer.name, system: 'app', action: 'signature_signed', targetId: request.jobExternalId,
      summary: `${request.title} signed by ${name}${geo.source === 'gps' ? ' (location shared)' : ''}`, ok: true, error: null,
    });

    // completeIfDone owns every status move from here: it is the only writer
    // that may mark a request signed, so the PDF is filed exactly once.
    afterResponse(completeIfDone(request.id), 'completion');

    res
      .set('Content-Type', 'text/html; charset=utf-8')
      .send(signedPage(request.title, signerView(updated, false), !!signer.email));
  }));

  app.get('/r/s/:token/decline', viewLimiter, signerLinkCompany(), asyncHandler(async (req: Request, res: Response) => {
    const found = await bySignerToken(req.params.token);
    if (!found) return res.status(404).send(notFoundPage());
    if (found.request.status === 'voided') return res.status(410).send(voidedPage(found.request.title, found.request.voidReason));
    if (found.signer.signedAt) return res.send(signedPage(found.request.title, signerView(found.signer, false), !!found.signer.email));
    res.set('Cache-Control', 'no-store').send(declinePage(req.params.token, found.request.title));
  }));

  app.post('/r/s/:token/decline', signFloodLimiter, signLimiter, signerLinkCompany(), asyncHandler(async (req: Request, res: Response) => {
    const found = await bySignerToken(req.params.token);
    if (!found) return res.status(404).send(notFoundPage());
    const { request, signer } = found;
    // A cancelled request has nothing left to decline. Declining it anyway
    // flipped a voided request to "declined" and emailed the rep about a
    // document they had already pulled back.
    if (request.status === 'voided') return res.status(410).send(voidedPage(request.title, request.voidReason));
    if (signer.signedAt) return res.send(signedPage(request.title, signerView(signer, false), !!signer.email));

    const reason = str(req.body?.reason, 300) || null;
    if (!signer.declinedAt) {
      const [declined] = await db.update(signatureSigners)
        .set({ declinedAt: new Date(), declineReason: reason, ip: clientIp(req), userAgent: str(req.headers['user-agent'], 400) || null })
        // Only a signer who has neither signed nor declined: a double tap must
        // not email the rep twice, and a signature that landed meanwhile stands.
        .where(and(eq(signatureSigners.id, signer.id), isNull(signatureSigners.signedAt), isNull(signatureSigners.declinedAt)))
        .returning();
      if (declined) {
        // Only from a request still out for signature — never over one that
        // was voided or completed between the read above and this write.
        await db.update(signatureRequests).set({ status: 'declined', updatedAt: new Date() })
          .where(and(eq(signatureRequests.id, request.id), inArray(signatureRequests.status, ['draft', 'sent'])));
        await logWrite({
          actor: signer.email || signer.name, system: 'app', action: 'signature_declined', targetId: request.jobExternalId,
          summary: `${request.title} declined by ${signer.name}${reason ? ` — ${reason}` : ''}`, ok: true, error: null,
        });
        afterResponse(notifyDecline(request, signer, reason), 'decline notice');
      }
    }
    res.send(declinedPage(request.title));
  }));
}

/** Tell the rep, in their own inbox, that somebody would not sign. */
async function notifyDecline(
  request: typeof signatureRequests.$inferSelect,
  signer: typeof signatureSigners.$inferSelect,
  reason: string | null,
): Promise<void> {
  const to = request.sentBy || request.createdBy;
  if (!to || !EMAIL_RE.test(to)) return;
  await sendAsMailbox(
    OFFICE_CALENDAR, to, `Not signed — ${request.title}`,
    `<p><b>${escapeHtml(signer.name)}</b> did not sign <b>${escapeHtml(request.title)}</b>${request.propertyAddress ? ` for ${escapeHtml(request.propertyAddress)}` : ''}.</p>`
    + (reason ? `<p>What they said: “${escapeHtml(reason)}”</p>` : '<p>They gave no reason.</p>')
    + `<p><a href="${appBase()}/clients/${encodeURIComponent(request.jobExternalId)}">Open the job</a></p>`,
  );
}

/** The signer behind a token, with their document and everyone else on it. */
async function bySignerToken(token: string) {
  const clean = String(token || '').trim();
  if (!/^[a-f0-9]{16,64}$/i.test(clean)) return null;
  const [signer] = await db.select().from(signatureSigners).where(eq(signatureSigners.token, clean));
  if (!signer) return null;
  const [request] = await db.select().from(signatureRequests).where(eq(signatureRequests.id, signer.requestId));
  if (!request) return null;
  const signers = await db.select().from(signatureSigners)
    .where(eq(signatureSigners.requestId, request.id)).orderBy(asc(signatureSigners.ordinal), asc(signatureSigners.id));
  return { request, signer, signers };
}

/**
 * The data URL the signing page posts, reduced to base64 JPEG — and only
 * that. This arrives on a public, unauthenticated form, so the magic bytes are
 * checked rather than the label the browser put on it.
 */
export function jpegBase64(value: unknown): string | null {
  const s = String(value ?? '');
  if (!s || s.length > MAX_SIGNATURE_BASE64) return null;
  const m = /^data:image\/jpe?g;base64,([A-Za-z0-9+/=\s]+)$/.exec(s);
  if (!m) return null;
  const b64 = m[1].replace(/\s+/g, '');
  try {
    const buf = Buffer.from(b64, 'base64');
    if (buf.length < 200 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
    return buf.toString('base64');
  } catch {
    return null;
  }
}

export { requestView, signerView, deliver, completeIfDone, finishSigned };
