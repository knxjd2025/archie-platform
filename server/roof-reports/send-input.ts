/**
 * What a person may type into "Email this report", and the email it makes: plain
 * functions, no database, no network.
 *
 * The address and the name go into the headers of a real email, so a line break
 * or a control character in either is refused, never cleaned up. The optional
 * personal message is plain text: its line breaks are kept, control characters
 * are taken out, it is cut to a length, and wherever it lands in the email it is
 * escaped. The body takes exactly three fields, so nothing in it can name a
 * sender, a copy, a subject, a company or a report.
 *
 * The address is a credential-grade personal detail: nothing here logs it, and
 * no error carries it.
 */
import { BAD_EMAIL, BAD_REQUEST_KEY, MAX_SEND_MESSAGE, SEND_BAD_NAME, SEND_MESSAGE_TOO_LONG } from '../../shared/roof-reports';
import { escapeHtml } from '../lib/roof-reports/escape-html.js';

export interface SendBody { email: string; customerName: string; message: string }
export type SendChecked = { ok: true; value: SendBody } | { ok: false; error: string };

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f\u0085\u2028\u2029]/;
// eslint-disable-next-line no-control-regex
const CONTROL_KEEPING_NEWLINE = /[\u0000-\u0008\u000b-\u001f\u007f\u0085\u2028\u2029]/g;
const LOCAL = /^[A-Za-z0-9._%+-]+$/;
const LABEL = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/i;
const KEY = /^[A-Za-z0-9_.:-]{8,200}$/;
const BODY_FIELDS = ['email', 'customerName', 'message'];

/** One plain address, in lower case, or null. No names, brackets, quotes, lists or line breaks. */
function cleanAddress(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const text = v.trim();
  if (text.length < 6 || text.length > 254) return null;
  const parts = text.split('@');
  if (parts.length !== 2) return null;
  const [local, domain] = parts;
  if (!local || local.length > 64 || !LOCAL.test(local) || local.startsWith('.') || local.endsWith('.') || local.includes('..')) return null;
  const labels = domain.split('.');
  if (labels.length < 2 || labels.some((l) => l.length === 0 || l.length > 63 || !LABEL.test(l))) return null;
  if (!/^[a-z]{2,}$/i.test(labels[labels.length - 1])) return null;
  return text.toLowerCase();
}

/** The message as plain text: one kind of line break, no control characters, never more than one blank line in a row. */
function cleanMessage(v: string): string {
  return v.replace(/\r\n?/g, '\n').replace(CONTROL_KEEPING_NEWLINE, '').replace(/\n[ \t]*(?:\n[ \t]*){2,}/g, '\n\n').trim();
}

export function parseSendBody(input: unknown): SendChecked {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, error: BAD_REQUEST_KEY };
  const body = input as Record<string, unknown>;
  if (Object.keys(body).some((k) => !BODY_FIELDS.includes(k))) return { ok: false, error: BAD_REQUEST_KEY };
  const email = cleanAddress(body.email);
  if (email === null) return { ok: false, error: BAD_EMAIL };

  let customerName = '';
  if (body.customerName !== undefined && body.customerName !== null) {
    if (typeof body.customerName !== 'string') return { ok: false, error: SEND_BAD_NAME };
    customerName = body.customerName.trim();
    if (customerName.length > 200 || CONTROL.test(customerName)) return { ok: false, error: SEND_BAD_NAME };
  }

  let message = '';
  if (body.message !== undefined && body.message !== null) {
    if (typeof body.message !== 'string') return { ok: false, error: SEND_MESSAGE_TOO_LONG };
    message = cleanMessage(body.message);
    if (message.length > MAX_SEND_MESSAGE) return { ok: false, error: SEND_MESSAGE_TOO_LONG };
  }
  return { ok: true, value: { email, customerName, message } };
}

/** The request key the screen made for one click: 8 to 200 plain characters, or null. */
export function readSendKey(raw: unknown): string | null {
  return typeof raw === 'string' && KEY.test(raw) ? raw : null;
}

/** Fit to go in an email header: one line, nothing that is not printable. */
const headerSafe = (v: string): boolean => v.length > 0 && v.length <= 120 && !CONTROL.test(v);

export interface ReportEmailInput {
  company: string;
  customerName: string;
  link: string;
  message: string;
  phone: string;
}

/** The whole email: a plain subject and a short body. The report itself and its photos stay behind the link. */
export function buildReportEmail(i: ReportEmailInput): { subject: string; html: string } {
  const company = i.company.trim();
  const subject = headerSafe(company) ? `Your roof report from ${company}` : 'Your roof report';
  const first = i.customerName.trim().split(/\s+/)[0] ?? '';
  const greeting = first ? `Hi ${escapeHtml(first)},` : 'Hello,';
  const who = company ? escapeHtml(company) : 'Your roofing company';
  const link = escapeHtml(i.link);
  const note = i.message
    ? `<p style="margin:0 0 16px;padding:10px 14px;background:#f3f4f6;border-radius:6px">${escapeHtml(i.message).replace(/\n/g, '<br>')}</p>`
    : '';
  const phone = i.phone.trim() ? `<p style="margin:16px 0 0">Questions? Call ${who} at ${escapeHtml(i.phone.trim())}.</p>` : '';
  const html = `<div style="font-family:Arial,sans-serif;font-size:15px;color:#222;max-width:520px">
<p>${greeting}</p>
<p>${who} has finished your roof report. You can read it online whenever you like.</p>
${note}<p><a href="${link}" style="display:inline-block;background:#1d4ed8;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">Open your roof report</a></p>
<p style="color:#666;font-size:13px">If the button does not work, copy this address into your browser:<br>${link}</p>
${phone}</div>`;
  return { subject, html };
}
