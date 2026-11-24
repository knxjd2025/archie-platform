/**
 * Emailing a report to the customer (D5): POST /api/roof-reports/:id/send.
 *
 * Only a person's click sends. Nothing sends when a report is made, edited,
 * shared or archived, and nothing sends on a schedule: this route is the only
 * caller of the sender for a roof report, and it is only reached by a request.
 *
 * What is sent is short and plain: a greeting, the company's name, the person's
 * optional message and the report's share link, made through the same code as
 * "Copy link" when none is on. Never the report's contents, never a photo.
 *
 * The recipient address comes from the request, is checked (one plain address,
 * no line breaks or lists) and is used only to call the sender. It is never
 * logged, never stored, and never put in an error, a log line, a record or an
 * answer: every failure is the same few plain sentences. The `roof_report_uses`
 * row records the report, who pressed Send and a fingerprint, never the address.
 *
 * The request key (a header the screen makes for each click) makes a double
 * click send once: the second request finds the first and sends nothing. The
 * report's and the company's daily limits are counted and a place is taken in one
 * locked step (uses.ts), so requests that arrive together cannot overrun them.
 * The report's counters move only after the sender hands back a message id.
 */
import type { Router } from 'express';
import { createHash } from 'node:crypto';
import {
  BAD_REQUEST_KEY, MAX_SENDS_PER_COMPANY_PER_DAY, MAX_SENDS_PER_REPORT_PER_DAY, NOT_FOUND, SEND_COMPANY_CAPPED, SEND_FAILED, SEND_KEY_REUSED, SEND_NOT_READY,
  SEND_NOT_SET_UP, SEND_REPORT_CAPPED, SEND_SENDING, SEND_TOO_FAST, SHARE_NOT_READY,
} from '../../shared/roof-reports';
import { sendCompanyEmail, type CompanyEmail, type CompanyEmailResult } from '../integrations/company-mail';
import { GhlNotConnectedError } from '../integrations/ghl/connection';
import { teamMemberIdByEmail } from '../access/rep-scope';
import { sendFailure } from '../lib/failure';
import { rateLimit } from '../lib/rate-limit';
import { currentProfile } from '../tenant/context';
import { logWrite } from '../writes/log';
import { decisionFor, roofReportFor, roofReportUser } from './access';
import { kindOf } from './failure-kind';
import { appOrigin } from './page';
import { buildReportEmail, parseSendBody, readSendKey } from './send-input';
import { effectiveState, ensureShareToken } from './store';
import { finishSend, finishUse, reserveUse } from './uses';

/** The one thing that sends. A test hands in a fake; nothing else in a roof report ever calls the real one. */
export type MailSender = (message: CompanyEmail) => Promise<CompanyEmailResult>;

export interface SendCaps { perReport: number; perCompany: number }

export interface SendOptions {
  mail?: MailSender;
  caps?: () => SendCaps;
}

const DEFAULT_CAPS = (): SendCaps => ({ perReport: MAX_SENDS_PER_REPORT_PER_DAY, perCompany: MAX_SENDS_PER_COMPANY_PER_DAY });

/** A fingerprint of what one click asked for, so the same key asking for something else is told apart from a repeat. It never leaves the database layer. */
const fingerprint = (value: { email: string; customerName: string; message: string }): string =>
  createHash('sha256').update(JSON.stringify([value.email, value.customerName, value.message])).digest('hex');

export function registerSendRoute(router: Router, options: SendOptions = {}): void {
  const mail: MailSender = options.mail ?? sendCompanyEmail;
  const caps = options.caps ?? DEFAULT_CAPS;
  // Sending is the one route that reaches a customer. This stops a runaway, not ordinary work.
  const limiter = rateLimit(20, 10 * 60 * 1000, (_req, res) => { res.json({ error: SEND_TOO_FAST }); });

  router.post('/:id/send', limiter, async (req, res) => {
    try {
      const user = roofReportUser(req)!;
      const row = await roofReportFor(user, req.params.id);
      if (!row || decisionFor(user.role, 'send') === 'no') return res.status(404).json({ error: NOT_FOUND });
      if (effectiveState(row).status !== 'ready' || row.reportJson === null) return res.status(409).json({ error: SEND_NOT_READY });
      const key = readSendKey(req.get('idempotency-key'));
      if (key === null) return res.status(400).json({ error: BAD_REQUEST_KEY });
      const parsed = parseSendBody(req.body);
      if (!parsed.ok) return res.status(400).json({ error: parsed.error });
      const body = parsed.value;

      const limit = caps();
      const reserved = await reserveUse({
        kind: 'send', reportId: row.id, memberId: await teamMemberIdByEmail(user.email), key, hash: fingerprint(body),
        perReport: limit.perReport, perCompany: limit.perCompany,
      });
      if (reserved.kind === 'report_capped') return res.status(429).json({ error: SEND_REPORT_CAPPED });
      if (reserved.kind === 'company_capped') return res.status(429).json({ error: SEND_COMPANY_CAPPED });
      if (reserved.kind === 'key_reused') return res.status(409).json({ error: SEND_KEY_REUSED });
      if (reserved.kind === 'repeat') {
        // A double click: the first request is the one that sends. Say how it stands, and send nothing.
        return res.json(reserved.use.status === 'done' ? { status: 'sent' } : { status: 'sending', note: SEND_SENDING });
      }

      const useId = reserved.id;
      try {
        const token = await ensureShareToken(row.id);
        if (!token) { await finishUse(useId, 'failed'); return res.status(409).json({ error: SHARE_NOT_READY }); }
        const profile = currentProfile();
        const email = buildReportEmail({
          company: profile.displayName, customerName: body.customerName, message: body.message, phone: profile.phone,
          link: `${appOrigin(req)}/r/roof/${token}`,
        });
        let delivered: CompanyEmailResult;
        try {
          delivered = await mail({ to: body.email, toName: body.customerName || undefined, subject: email.subject, html: email.html, from: user.email });
        } catch (error) {
          // Never the error's own words: they can carry the address.
          await finishUse(useId, 'failed');
          const notSet = error instanceof GhlNotConnectedError;
          console.error('[roof-reports] a report email was not sent:', notSet ? 'not-connected' : kindOf(error));
          await logWrite({ actor: user.email, system: 'archie', action: 'roof_report_send', targetId: row.id, summary: 'roof report email not sent', ok: false, error: notSet ? 'not-connected' : kindOf(error) });
          return notSet ? res.status(409).json({ error: SEND_NOT_SET_UP }) : res.status(502).json({ error: SEND_FAILED });
        }
        if (typeof delivered?.messageId !== 'string' || delivered.messageId.length === 0) {
          // No message id means no proof it went: it is not counted.
          await finishUse(useId, 'failed');
          console.error('[roof-reports] a report email was not sent:', 'no-id');
          await logWrite({ actor: user.email, system: 'archie', action: 'roof_report_send', targetId: row.id, summary: 'roof report email not sent', ok: false, error: 'no-id' });
          return res.status(502).json({ error: SEND_FAILED });
        }
        // It went. The counters move now, and only now. If saving that fails the email is still out, so it is still said to be sent.
        try { await finishSend(useId, row.id); } catch (error) { console.error('[roof-reports] a sent report email could not be counted:', kindOf(error)); }
        await logWrite({ actor: user.email, system: 'archie', action: 'roof_report_send', targetId: row.id, summary: 'roof report emailed', ok: true, error: null });
        return res.json({ status: 'sent', sentAt: new Date().toISOString() });
      } catch (error) {
        try { await finishUse(useId, 'failed'); } catch { /* the place is let go of after ten minutes anyway */ }
        throw error;
      }
    } catch (error) {
      sendFailure(res, error, 'POST /api/roof-reports/:id/send', 500, SEND_FAILED);
    }
  });
}
