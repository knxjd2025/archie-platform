/**
 * The Certificate of Completion (shared/certificate-of-completion.ts).
 *
 * It builds itself from the job's submitted final walkthrough, so nobody types
 * out what the walkthrough already recorded. We sign it, the homeowner signs it
 * through a link emailed from our own mailbox, and once both names are on it
 * the signed PDF is filed on the JobTread job and can travel with the
 * depreciation request.
 *
 * The homeowner's signing page is public — the random token in the link is the
 * capability, the same model as the shared report pages at /r/:token. It lives
 * at /r/sign/:token so it rides the rewrite that already routes /r/* here.
 */
import crypto from 'node:crypto';
import type { Express, Request, Response } from 'express';
import { waitUntil } from '@vercel/functions';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { db } from '../db';
import { claims, finalWalkthroughs, jobCertificates, leads, settings, signatureRequests, teamMembers } from '../../shared/schema';
import { escapeHtml } from '../../shared/signatures';
import { requireAuth } from '../auth/middleware';
import { ownsLead, type SessionUser } from '../access/rep-scope';
import { asyncHandler } from '../lib/async-handler';
import { logWrite } from '../writes/log';
import { officeAddressOf } from '../../shared/neighbor-letters';
import { currentProfile, currentTenant } from '../tenant/context';
import {
  certificateFromWalkthrough, certificateHtml, certificateStatement, certDate,
  type CertificateData, type CertificateSignatures, type CertificateStatus,
} from '../../shared/certificate-of-completion';
import { certificatePdf } from './pdf';
import { sendAsMailbox } from '../brain/gmail-delegated';
import { memberByEmail } from '../access/team-scope';
import { COMPANY_DOMAIN, OFFICE_CALENDAR } from '../calendar/access';
import { JobTreadClient } from '../integrations/jobtread';
import { rateLimit } from '../lib/rate-limit';
import { certificateLinkCompany } from '../tenant/public-links';

const NEIGHBOR_SETTINGS_KEY = 'neighbor_letters';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * The signing link is a 32-character hex token (createCertificate, and the
 * restart that rotates it). Anything else is refused before it reaches the
 * database, so the public page is not a free query for whatever is typed
 * into the address bar.
 */
const SIGN_TOKEN_RE = /^[0-9a-f]{32}$/;

/**
 * The page has no script, so none may run on it: the certificate is built
 * from names and notes anyone on the team can type, and this is the app's own
 * origin.
 */
const SIGN_PAGE_CSP = "script-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'";

// A homeowner who has been rate-limited is looking at a browser window, so
// the refusal is a page, not the JSON the app's own routes get.
const tooManyPage = (req: Request, res: Response) => {
  res.set('Content-Type', 'text/html; charset=utf-8').send(publicPage('Please wait',
    '<h1>Please wait a moment</h1><p>This link has been opened a lot in a short time. Try again in a few minutes, or call your roofer.</p>'));
};

// The signing page is public, so the write behind it is rate-limited like the
// other unauthenticated write path (the report engagement beacon). It used to
// answer a limited homeowner with raw JSON in the browser.
const signLimiter = rateLimit(20, 60 * 60 * 1000, tooManyPage);
// Reading it was not limited at all, so the link could be walked for tokens
// at whatever rate a script liked. Generous enough for a family passing one
// phone around; per IP, its own bucket.
const viewLimiter = rateLimit(240, 60 * 60 * 1000, tooManyPage);

const str = (v: unknown, max = 200): string => String(v ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, max);
const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

async function company() {
  const [row] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, NEIGHBOR_SETTINGS_KEY));
  const v = (row?.value ?? {}) as { officeAddress?: string };
  const p = currentProfile();
  return { companyName: p.legalName, officeAddress: v.officeAddress || officeAddressOf(p), companyPhone: p.phone };
}

/** The mailbox the signing link goes out from — the sender's own where they have one. */
async function sendingMailboxFor(email: string): Promise<string> {
  const e = (email || '').trim().toLowerCase();
  const me = await memberByEmail(e).catch(() => null);
  return me?.active && e.endsWith(COMPANY_DOMAIN) ? e : OFFICE_CALENDAR;
}

const signaturesOf = (row: typeof jobCertificates.$inferSelect): CertificateSignatures => ({
  companySigner: row.companySigner || '',
  companySignedAt: iso(row.companySignedAt),
  homeownerSigner: row.homeownerSigner || '',
  homeownerSignedAt: iso(row.homeownerSignedAt),
});

/**
 * Build (or rebuild) the certificate data for a job from its most recent
 * submitted walkthrough. Null when the walkthrough hasn't been submitted —
 * there is nothing honest to certify before someone has walked the job.
 */
async function buildFor(externalId: string): Promise<{ data: CertificateData; walkthroughId: number } | null> {
  const [walk] = await db.select().from(finalWalkthroughs)
    .where(eq(finalWalkthroughs.jobExternalId, externalId))
    .orderBy(desc(finalWalkthroughs.submittedAt));
  if (!walk || walk.status !== 'submitted') return null;

  const [lead] = await db.select().from(leads).where(eq(leads.externalId, externalId));
  const [claim] = await db.select({ claimNumber: claims.claimNumber }).from(claims).where(eq(claims.jobtreadJobId, externalId));
  const address = [lead?.address, [lead?.city, lead?.state].filter(Boolean).join(', '), lead?.zip].filter(Boolean).join(', ');

  return {
    walkthroughId: walk.id,
    data: certificateFromWalkthrough(walk.answers || {}, {
      customerName: [lead?.firstName, lead?.lastName].filter(Boolean).join(' ').trim() || lead?.jobName || '',
      propertyAddress: address,
      jobName: lead?.jobName || '',
      claimNumber: claim?.claimNumber || '',
    }, await company()),
  };
}

/** The certificate on a job, or null. Reading never creates one. */
async function certificateFor(externalId: string) {
  const [row] = await db.select().from(jobCertificates).where(eq(jobCertificates.jobExternalId, externalId));
  return row ?? null;
}

/**
 * Create the certificate for a job — only ever from the Create button.
 *
 * It used to be created the first moment anyone opened the client's page,
 * which meant a job nobody had decided to certify still had a certificate
 * sitting on it, created by whoever happened to look. A document that says
 * the work is complete should exist because someone said so.
 *
 * Returns null when there is no submitted walkthrough to build it from: the
 * certificate is written by the walkthrough, and there is nothing honest to
 * certify before someone has walked the job.
 */
async function createCertificate(externalId: string, createdBy: string) {
  const existing = await certificateFor(externalId);
  if (existing) return existing;
  const built = await buildFor(externalId);
  if (!built) return null;
  const [row] = await db.insert(jobCertificates).values({
    jobExternalId: externalId, walkthroughId: built.walkthroughId, data: built.data,
    signToken: crypto.randomBytes(16).toString('hex'), createdBy,
  }).onConflictDoNothing({ target: [jobCertificates.companyId, jobCertificates.jobExternalId] }).returning();
  if (row) return row;
  const [raced] = await db.select().from(jobCertificates).where(eq(jobCertificates.jobExternalId, externalId));
  return raced ?? null;
}

const publicPage = (title: string, body: string) => `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
  :root { color-scheme: light }
  body { font: 15px/1.6 -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; color: #1a1a1a; background: #f5f1ea; margin: 0; padding: 20px 14px 56px }
  .sheet { max-width: 760px; margin: 0 auto; background: #fff; border-radius: 14px; padding: 26px 22px; box-shadow: 0 1px 3px rgba(0,0,0,.08) }
  h1 { font-size: 21px }
  ul { margin: 0 0 14px 20px; padding: 0 } li { margin: 0 0 4px }
  table { border-collapse: collapse }
  label { display: block; font-weight: 600; font-size: 13px; margin: 14px 0 4px }
  input[type=text] { width: 100%; box-sizing: border-box; font: 17px Georgia, serif; padding: 10px 12px; border: 1px solid #cfcfcf; border-radius: 9px }
  .affirm { display: flex; gap: 9px; align-items: flex-start; font-weight: 400; font-size: 13px; color: #444; margin-top: 12px }
  button { margin-top: 16px; width: 100%; padding: 14px; font-size: 16px; font-weight: 600; color: #fff; background: ${currentTenant()?.profile?.colors.primary ?? '#1F3A5F'}; border: 0; border-radius: 10px }
  button:disabled { opacity: .5 }
  .done { background: #ecfdf5; border: 1px solid #a7f3d0; color: #065f46; border-radius: 10px; padding: 12px 14px; margin-bottom: 16px }
  .err { background: #fef2f2; border: 1px solid #fecaca; color: #991b1b; border-radius: 10px; padding: 12px 14px; margin-bottom: 16px }
</style></head><body><div class="sheet">${body}</div></body></html>`;

export function registerCertificateRoutes(app: Express) {
  /**
   * What this job has. Reading never creates anything — see createCertificate.
   *
   * `canCreate` is the Create button's own answer: there is a submitted
   * walkthrough to build from and no certificate yet.
   */
  app.get('/api/clients/:externalId/certificate', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const user = req.session.user! as SessionUser;
    const externalId = req.params.externalId;
    if (!(await ownsLead(user, externalId))) return res.status(404).json({ error: 'not found' });

    const [lead] = await db.select({ email: leads.email }).from(leads).where(eq(leads.externalId, externalId));
    const row = await certificateFor(externalId);
    const walkthroughSubmitted = row ? true : !!(await buildFor(externalId));

    if (!row) {
      return res.json({
        certificate: null,
        walkthroughSubmitted,
        canCreate: walkthroughSubmitted,
        homeownerEmail: lead?.email || '',
      });
    }
    res.json({
      certificate: {
        id: row.id, status: row.status as CertificateStatus, data: row.data as CertificateData,
        signatures: signaturesOf(row), homeownerEmail: row.homeownerEmail || lead?.email || '',
        sentAt: iso(row.sentAt), sentBy: row.sentBy, signUrl: signUrlFor(row.signToken),
        html: certificateHtml(row.data as CertificateData, signaturesOf(row)),
      },
      walkthroughSubmitted: true,
      canCreate: false,
      homeownerEmail: lead?.email || '',
    });
  }));

  /**
   * Create it — the Create button, and the only thing that creates one.
   *
   * Refused until the final walkthrough is submitted, because the certificate
   * is written by the walkthrough: the completion date, who walked it, what
   * passed, what is still open and the homeowner's own words all come from
   * there, and none of it exists before then.
   */
  app.post('/api/clients/:externalId/certificate', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const user = req.session.user! as SessionUser;
    const externalId = req.params.externalId;
    if (!(await ownsLead(user, externalId))) return res.status(404).json({ error: 'not found' });

    const existing = await certificateFor(externalId);
    // A second click is not an error — it is the same certificate.
    if (existing) return res.json({ ok: true, created: false, id: existing.id });

    const row = await createCertificate(externalId, user.email);
    if (!row) {
      return res.status(400).json({
        error: 'Submit the final walkthrough first — the certificate is written from it.',
      });
    }
    const data = row.data as CertificateData;
    await logWrite({
      actor: user.email, system: 'app', action: 'certificate_created', targetId: externalId,
      summary: `Built from the walkthrough of ${certDate(data.completedOn) || 'an unknown date'}`
        + `${data.walkedBy ? `, walked by ${data.walkedBy}` : ''}`
        + `${data.openItems.length ? ` — ${data.openItems.length} item(s) still open` : ''}`,
      ok: true, error: null,
    });
    res.json({ ok: true, created: true, id: row.id });
  }));

  /**
   * Pull the walkthrough in again — for a walkthrough corrected after the
   * certificate was built.
   *
   * Once we have signed it or the homeowner holds the link, it cannot simply
   * change: that would rewrite the document under our signature and under the
   * page they are about to sign. It used to be refused there with no way
   * forward, so a walkthrough corrected after the link went out left a wrong
   * certificate stuck on the job. `restart: true` is that way forward, and it
   * is open about what it costs: our signature comes off, the link already
   * sent stops working (a new one replaces it), and it is signed and sent
   * again. Never once the homeowner has signed — that is a record.
   */
  app.post('/api/clients/:externalId/certificate/refresh', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const user = req.session.user! as SessionUser;
    const externalId = req.params.externalId;
    if (!(await ownsLead(user, externalId))) return res.status(404).json({ error: 'not found' });
    const row = await certificateFor(externalId);
    if (!row) return res.status(400).json({ error: 'There is no certificate on this job yet — create it first.' });
    // A signed certificate is a record of what was signed. Rebuilding it under
    // the signatures would change a document two people already put their names
    // to, so it is refused rather than quietly rewritten.
    if (row.status === 'signed' || row.homeownerSignedAt) {
      return res.status(409).json({ error: 'This certificate is signed. Reopen the walkthrough and start a new certificate if it has to change.' });
    }
    const [open] = await db.select({ id: signatureRequests.id }).from(signatureRequests).where(and(
      eq(signatureRequests.jobExternalId, externalId), eq(signatureRequests.sourceKind, 'certificate'),
      inArray(signatureRequests.status, ['draft', 'sent']),
    )).limit(1);
    if (open) {
      return res.status(409).json({ error: 'This certificate is out for signature. Cancel that request first if the certificate has to change.' });
    }
    // Only refusing a signed one was not enough: once we had signed it, or the
    // homeowner held the link, a refresh changed the document under our
    // signature and under the page they were about to sign. Now it takes an
    // explicit start-over.
    const restart = req.body?.restart === true;
    if ((row.companySignedAt || row.sentAt) && !restart) {
      return res.status(409).json({
        error: row.sentAt
          ? 'This certificate has already gone to the homeowner, so it can no longer change as it is — they would be signing something different from what they were sent. Start it over to pull the walkthrough in again: the link they have stops working, and you sign it and send it again.'
          : 'This certificate already carries your signature, so it can no longer change under it. Start it over to pull the walkthrough in again: your signature comes off and you sign it again.',
        canRestart: true,
      });
    }
    const built = await buildFor(externalId);
    if (!built) return res.status(400).json({ error: 'The final walkthrough has not been submitted yet.' });
    const restarting = restart && !!(row.companySignedAt || row.sentAt);
    const [updated] = await db.update(jobCertificates)
      .set({
        data: built.data, walkthroughId: built.walkthroughId, updatedAt: new Date(),
        ...(restarting ? {
          companySigner: null, companySignedAt: null, sentAt: null, sentBy: null, status: 'draft',
          // A new link, so the one in the homeowner's inbox can no longer open
          // the old document and sign it.
          signToken: crypto.randomBytes(16).toString('hex'),
        } : {}),
      })
      // Only while the homeowner still has not signed: a signature that lands
      // between the read above and this write stands, and nothing is rebuilt.
      .where(and(eq(jobCertificates.id, row.id), isNull(jobCertificates.homeownerSignedAt))).returning();
    if (!updated) return res.status(409).json({ error: 'The homeowner has just signed this certificate, so it can no longer change.' });
    if (restarting) {
      await logWrite({
        actor: user.email, system: 'app', action: 'certificate_restarted', targetId: externalId,
        summary: `Started over from the walkthrough${row.sentAt ? '; the link sent to the homeowner no longer works' : ''}`,
        ok: true, error: null,
      });
    }
    res.json({ ok: true, restarted: restarting, data: updated.data, html: certificateHtml(updated.data as CertificateData, signaturesOf(updated)) });
  }));

  /** We sign it — typed name, the same convention the walkthrough uses. */
  app.post('/api/clients/:externalId/certificate/sign', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const user = req.session.user! as SessionUser;
    const externalId = req.params.externalId;
    if (!(await ownsLead(user, externalId))) return res.status(404).json({ error: 'not found' });
    const name = str(req.body?.name, 120);
    if (name.length < 3) return res.status(400).json({ error: 'Type your full name to sign.' });

    const row = await certificateFor(externalId);
    if (!row) return res.status(400).json({ error: 'There is no certificate on this job yet — create it first.' });

    const [updated] = await db.update(jobCertificates)
      .set({ companySigner: name, companySignedAt: new Date(), updatedAt: new Date() })
      .where(eq(jobCertificates.id, row.id)).returning();
    await logWrite({ actor: user.email, system: 'app', action: 'certificate_signed', targetId: externalId, summary: `Signed by ${name}`, ok: true, error: null });
    res.json({ ok: true, signatures: signaturesOf(updated) });
  }));

  /** Email the homeowner the link so they can sign it themselves. */
  app.post('/api/clients/:externalId/certificate/send', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const user = req.session.user! as SessionUser;
    const externalId = req.params.externalId;
    if (!(await ownsLead(user, externalId))) return res.status(404).json({ error: 'not found' });

    const to = str(req.body?.email, 160).toLowerCase();
    if (!EMAIL_RE.test(to)) return res.status(400).json({ error: "That doesn't look like an email address." });

    const row = await certificateFor(externalId);
    if (!row) return res.status(400).json({ error: 'There is no certificate on this job yet — create it first.' });
    if (!row.companySigner) return res.status(400).json({ error: 'Sign it yourself first — the homeowner should be signing a countersigned document.' });
    if (!row.signToken) return res.status(500).json({ error: 'This certificate has no signing link.' });

    const data = row.data as CertificateData;
    const link = signUrlFor(row.signToken)!;
    const mailbox = await sendingMailboxFor(user.email);
    // Every name and address here came from the job or the walkthrough, which
    // anyone on the team can type into — so it is escaped before it becomes
    // the HTML of an email that goes out under our name.
    const html = [
      `<p>Hi${data.customerName ? ` ${escapeHtml(data.customerName.split(/\s+/)[0])}` : ''},</p>`,
      `<p>Your roof at ${escapeHtml(data.propertyAddress || 'your property')} was completed on ${escapeHtml(certDate(data.completedOn))}, and we've put together the Certificate of Completion.</p>`,
      `<p>Please take a look and add your signature here:</p>`,
      `<p><a href="${link}" style="display:inline-block;background:${currentProfile().colors.primary};color:#fff;padding:12px 20px;border-radius:9px;text-decoration:none;font-weight:600">Review and sign</a></p>`,
      `<p style="color:#666;font-size:13px">Or paste this into your browser: ${link}</p>`,
      `<p>Thank you,<br>${escapeHtml(str(user.name, 120))}<br>${escapeHtml([data.companyName, data.companyPhone].filter(Boolean).join(' · '))}</p>`,
    ].join('\n');

    try {
      await sendAsMailbox(mailbox, to, `Certificate of Completion — ${data.propertyAddress || data.jobName || 'your roof'}`, html);
    } catch (e: any) {
      await logWrite({ actor: user.email, system: 'google', action: 'certificate_sent', targetId: externalId, summary: `to ${to} FAILED`, ok: false, error: e?.message || 'send failed' });
      return res.status(502).json({ error: `Couldn't send: ${e?.message || 'Gmail refused the message'}` });
    }

    const [updated] = await db.update(jobCertificates)
      .set({ status: row.status === 'signed' ? 'signed' : 'sent', homeownerEmail: to, sentAt: new Date(), sentBy: user.email, updatedAt: new Date() })
      .where(eq(jobCertificates.id, row.id)).returning();
    await logWrite({ actor: user.email, system: 'google', action: 'certificate_sent', targetId: externalId, summary: `Signing link to ${to} from ${mailbox}`, ok: true, error: null });
    res.json({ ok: true, status: updated.status, sentTo: to, sentFrom: mailbox, signUrl: link });
  }));

  /** The certificate as a PDF, for reading, printing, or attaching by hand. */
  app.get('/api/clients/:externalId/certificate/pdf', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const user = req.session.user! as SessionUser;
    const externalId = req.params.externalId;
    if (!(await ownsLead(user, externalId))) return res.status(404).json({ error: 'not found' });
    const [row] = await db.select().from(jobCertificates).where(eq(jobCertificates.jobExternalId, externalId));
    if (!row) return res.status(404).json({ error: 'No certificate for this job yet.' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="Certificate of completion.pdf"');
    res.send(certificatePdf(row.data as CertificateData, signaturesOf(row)));
  }));

  // ---- The homeowner's side. No login: the token in the link is the capability. ----

  app.get('/r/sign/:token', viewLimiter, certificateLinkCompany(), asyncHandler(async (req: Request, res: Response) => {
    const row = await certificateBySignToken(req.params.token);
    if (!row) return res.status(404).set('Content-Security-Policy', SIGN_PAGE_CSP).send(publicPage('Not found', '<h1>That link has expired</h1><p>Ask your roofer to send it again.</p>'));

    const data = row.data as CertificateData;
    const sigs = signaturesOf(row);
    const signed = !!row.homeownerSignedAt;
    if (!signed && !readyToSign(row)) return res.status(409).set('Content-Security-Policy', SIGN_PAGE_CSP).send(notReadyPage());
    const form = signed
      ? '<div class="done"><b>Thank you — this is signed.</b><br>A copy has gone back to your roofer. You can close this page.</div>'
      : `<form method="post" action="/r/sign/${encodeURIComponent(req.params.token)}">
          <label for="name">Type your full name to sign</label>
          <input id="name" name="name" type="text" autocomplete="name" placeholder="${escapeAttr(data.customerName)}" required minlength="3">
          <label class="affirm"><input type="checkbox" name="affirm" value="yes" required>
            I confirm the work described above has been completed to my satisfaction, and that typing my name here is my signature.</label>
          <button type="submit">Sign the certificate</button>
        </form>`;

    res
      .set('Content-Type', 'text/html; charset=utf-8')
      .set('Cache-Control', 'no-store')
      .set('Content-Security-Policy', SIGN_PAGE_CSP)
      .send(publicPage('Certificate of Completion', `${certificateHtml(data, sigs)}<hr style="border:0;border-top:1px solid #eee;margin:22px 0">${form}`));
  }));

  app.post('/r/sign/:token', signLimiter, certificateLinkCompany(), asyncHandler(async (req: Request, res: Response) => {
    const row = await certificateBySignToken(req.params.token);
    if (!row) return res.status(404).send(publicPage('Not found', '<h1>That link has expired</h1>'));
    // Refused here too, not only on the page: the form is a plain POST, and
    // anyone holding the token could send it without ever loading the page.
    if (!row.homeownerSignedAt && !readyToSign(row)) return res.status(409).send(notReadyPage());

    const name = str(req.body?.name, 120);
    if (name.length < 3 || req.body?.affirm !== 'yes') {
      return res.status(400).send(publicPage('Certificate of Completion',
        '<div class="err">Please type your full name and tick the confirmation.</div>'
        + `<p><a href="/r/sign/${encodeURIComponent(req.params.token)}">Go back</a></p>`));
    }

    // Already signed: show the thank-you rather than recording a second name
    // over the first. A homeowner re-opening the link from their email is the
    // ordinary case, not an error.
    if (!row.homeownerSignedAt) {
      const ip = str((req.headers['x-forwarded-for'] as string || '').split(',')[0] || req.ip || '', 60);
      const [signedNow] = await db.update(jobCertificates)
        .set({ homeownerSigner: name, homeownerSignedAt: new Date(), homeownerIp: ip || null, status: 'signed', updatedAt: new Date() })
        // Only if it is still unsigned: two taps on a slow phone read the row
        // before either wrote, and the second would overwrite the first's name
        // and time and file a second PDF.
        .where(and(eq(jobCertificates.id, row.id), isNull(jobCertificates.homeownerSignedAt)))
        .returning();
      if (signedNow) {
        await logWrite({ actor: row.homeownerEmail || 'homeowner', system: 'app', action: 'certificate_signed', targetId: row.jobExternalId, summary: `Homeowner signed: ${name}`, ok: true, error: null });
        // File the signed copy on the job. Best effort: the signature is already
        // recorded here, and a JobTread hiccup must not lose it. Vercel may
        // freeze the function once the page is sent, so it is kept alive.
        waitUntil(fileSignedCertificate(row.id).catch((e) => console.error('[certificates] filing failed:', e instanceof Error ? e.message : e)));
      }
    }

    res
      .set('Content-Type', 'text/html; charset=utf-8')
      .send(publicPage('Signed', '<div class="done"><b>Thank you — this is signed.</b><br>A copy has gone back to your roofer.</div>'));
  }));
}

/** The certificate behind a signing link, or null — a malformed token never reaches the database. */
async function certificateBySignToken(token: unknown) {
  const clean = String(token ?? '');
  if (!SIGN_TOKEN_RE.test(clean)) return null;
  const [row] = await db.select().from(jobCertificates).where(eq(jobCertificates.signToken, clean));
  return row ?? null;
}

/**
 * Whether the homeowner may sign yet: we have signed it and it has been sent.
 *
 * The link exists from the moment the certificate is created, and it used to
 * take a signature whenever the homeowner had not signed — so a certificate
 * still in draft, before we had countersigned it or anyone had decided to
 * send it, could be signed by whoever had the link. Send already refuses an
 * uncountersigned certificate; this holds the page to the same rule.
 */
function readyToSign(row: typeof jobCertificates.$inferSelect): boolean {
  return !!row.companySigner && !!row.companySignedAt && (!!row.sentAt || row.status === 'sent');
}

const notReadyPage = () => publicPage('Not ready yet',
  "<h1>This certificate isn't ready to sign yet</h1><p>Your roofer still has to finish it. Ask your rep to send it to you when it's ready.</p>");

/** Upload the signed certificate to the JobTread job, so it lives with the job's paperwork. */
async function fileSignedCertificate(id: number): Promise<void> {
  const [row] = await db.select().from(jobCertificates).where(eq(jobCertificates.id, id));
  if (!row || row.jobtreadFileId) return;
  const pdf = certificatePdf(row.data as CertificateData, signaturesOf(row));
  const saved = await new JobTreadClient().uploadJobFile(row.jobExternalId, {
    name: 'Certificate of completion (signed).pdf',
    contentType: 'application/pdf',
    data: pdf,
    description: `Signed by ${row.homeownerSigner} and ${row.companySigner}`,
    folder: 'Completion',
  });
  if (saved.ok && saved.fileId) {
    await db.update(jobCertificates).set({ jobtreadFileId: saved.fileId, updatedAt: new Date() }).where(eq(jobCertificates.id, id));
  }
  await logWrite({
    actor: 'system:certificate', system: 'jobtread', action: 'certificate_filed', targetId: row.jobExternalId,
    summary: 'Signed certificate of completion', ok: saved.ok, error: saved.error ?? null,
  });
}

/**
 * Signatures collected by "Send for signature" (server/signatures), written
 * back onto the certificate. Without this the certificate still read unsigned
 * after the homeowner had signed it there: the insurance letter left it off as
 * unsigned, and the panel offered to send it all over again.
 *
 * Never over a signature already on it — the certificate's own link may have
 * got there first, and the first signature is the one that stands.
 */
export async function recordCertificateSignatures(externalId: string, s: {
  homeowner: { name: string; at: Date; ip: string | null; email: string | null } | null;
  company: { name: string; at: Date } | null;
  jobtreadFileId: string | null;
  /** When the signature request was made — it only ever describes a certificate that existed then. */
  requestCreatedAt: Date | null;
}): Promise<void> {
  const row = await certificateFor(externalId);
  if (!row) return;
  // The request was for whichever certificate stood on the job when it went
  // out. A certificate created after that is a different document: a
  // completion retried in the background once used to stamp an old request's
  // signature onto a certificate made minutes later, so the new one read as
  // signed by someone who never saw it.
  if (s.requestCreatedAt && row.createdAt && row.createdAt.getTime() > s.requestCreatedAt.getTime()) return;
  if (s.homeowner) {
    await db.update(jobCertificates)
      .set({
        homeownerSigner: s.homeowner.name, homeownerSignedAt: s.homeowner.at, homeownerIp: s.homeowner.ip,
        homeownerEmail: row.homeownerEmail || s.homeowner.email, status: 'signed', updatedAt: new Date(),
      })
      .where(and(eq(jobCertificates.id, row.id), isNull(jobCertificates.homeownerSignedAt)));
  }
  if (s.company) {
    await db.update(jobCertificates)
      .set({ companySigner: s.company.name, companySignedAt: s.company.at, updatedAt: new Date() })
      .where(and(eq(jobCertificates.id, row.id), isNull(jobCertificates.companySignedAt)));
  }
  // The signed copy is already on the job, so the certificate's own filing
  // must not put a second one beside it.
  if (s.jobtreadFileId) {
    await db.update(jobCertificates)
      .set({ jobtreadFileId: s.jobtreadFileId, updatedAt: new Date() })
      .where(and(eq(jobCertificates.id, row.id), isNull(jobCertificates.jobtreadFileId)));
  }
}

/** Where the homeowner signs. Absolute, because it is pasted into an email. */
function signUrlFor(token: string | null): string | null {
  if (!token) return null;
  const base = (process.env.APP_BASE_URL || '').replace(/\/+$/, '');
  return `${base}/r/sign/${token}`;
}

const escapeAttr = (v: string) => String(v ?? '').replace(/"/g, '&quot;').replace(/</g, '&lt;');

export { buildFor as buildCertificateData, certificateFor, createCertificate, signaturesOf, certificateStatement };
