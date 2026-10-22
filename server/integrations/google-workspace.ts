/**
 * Google Workspace access by domain-wide delegation: a service account
 * (GOOGLE_SA_EMAIL + GOOGLE_SA_KEY, base64 PEM) acting as a mailbox in one
 * Workspace domain, for Gmail and Calendar.
 *
 * One service account can only be delegated by one Workspace, so in a
 * multi-company app it must never act for a mailbox outside the company that
 * owns the delegation. The operator grants it per company in
 * ARCHIE_GOOGLE_DWD: `<company id>=<domain>[;<company id>=<domain>...]`.
 * Anything else (no grant, another company, another domain) is refused with
 * GoogleWorkspaceUnavailableError, and email goes out through the company's
 * GHL instead (server/integrations/company-mail.ts).
 */
import { google } from 'googleapis';
import { currentCompanyId } from '../tenant/context';

export class GoogleWorkspaceUnavailableError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = 'GoogleWorkspaceUnavailableError';
  }
}

/** The Workspace domain the operator has delegated to the current company, or null. */
export function delegatedDomainForCurrentCompany(): string | null {
  const companyId = currentCompanyId();
  if (!companyId || !process.env.GOOGLE_SA_KEY || !process.env.GOOGLE_SA_EMAIL) return null;
  for (const pair of (process.env.ARCHIE_GOOGLE_DWD || '').split(';')) {
    const [id, domain] = pair.split('=').map((x) => x?.trim().toLowerCase());
    if (id && domain && id === companyId.toLowerCase()) return domain;
  }
  return null;
}

/** True when the current company may act as this mailbox through delegation. */
export function canDelegateMailbox(mailbox: string): boolean {
  const domain = delegatedDomainForCurrentCompany();
  return !!domain && String(mailbox).trim().toLowerCase().endsWith(`@${domain}`);
}

function assertDelegable(mailbox: string): void {
  if (!canDelegateMailbox(mailbox)) {
    throw new GoogleWorkspaceUnavailableError('Google Workspace access is not set up for this company and mailbox.');
  }
}

const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.compose',
];

/** Per request. googleapis has no default timeout. */
export const GOOGLE_TIMEOUT_MS = 20_000;
/** Sending photos is an upload of several MB — give it longer than a read. */
const ATTACHMENT_SEND_TIMEOUT_MS = 60_000;

function serviceAccountJwt(scopes: string[], subject: string) {
  const key = Buffer.from(process.env.GOOGLE_SA_KEY || '', 'base64').toString('utf8');
  return new google.auth.JWT({ email: process.env.GOOGLE_SA_EMAIL, key, scopes, subject });
}

export function getDelegatedGmail(mailbox: string) {
  assertDelegable(mailbox);
  return google.gmail({ version: 'v1', auth: serviceAccountJwt(GMAIL_SCOPES, mailbox), timeout: GOOGLE_TIMEOUT_MS });
}

export function getDelegatedCalendar(mailbox: string) {
  assertDelegable(mailbox);
  // Must exactly match a scope string authorized in the Workspace admin
  // delegation grant — calendar.readonly is not in the usual grant, /auth/calendar is.
  return google.calendar({ version: 'v3', auth: serviceAccountJwt(['https://www.googleapis.com/auth/calendar'], mailbox), timeout: GOOGLE_TIMEOUT_MS });
}

/**
 * Build the MIME message. Header values are stripped of CR/LF: an address or
 * subject carrying a newline would otherwise inject extra headers (a Bcc, a
 * different From) into the message — the classic header-injection bug. These
 * values can come from a voice transcript, so they are not trustworthy.
 */
const headerSafe = (v: string) => String(v ?? '').replace(/[\r\n]+/g, ' ').trim();

function toRaw(mailbox: string, to: string, subject: string, html: string, cc?: string): string {
  const mime = [
    `From: ${headerSafe(mailbox)}`,
    `To: ${headerSafe(to)}`,
    ...(cc ? [`Cc: ${headerSafe(cc)}`] : []),
    `Subject: ${headerSafe(subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=utf-8',
    '',
    html,
  ].join('\r\n');
  return Buffer.from(mime).toString('base64url');
}

export { toRaw as buildMimeMessage };

export interface MailAttachment {
  filename: string;
  contentType: string;
  /** Raw bytes, base64 encoded (no data: prefix). */
  base64: string;
  /**
   * Set to reference the image from the HTML as `cid:<contentId>`, which shows
   * it in the body rather than only as a download.
   */
  contentId?: string;
}

/** A filename a mail client will accept: no quotes, no path, no CR/LF. */
const fileSafe = (v: string) => String(v ?? 'attachment').replace(/[\r\n"\\/]+/g, '_').trim().slice(0, 120) || 'attachment';

const boundaryFor = (tag: string) => `brn_${tag}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
/** Base64 bodies wrap at 76 characters: some mail servers still reject longer lines (RFC 2045). */
const wrapBase64 = (b64: string) => ((b64.replace(/^data:[^;]+;base64,/, '').replace(/\s+/g, '').match(/.{1,76}/g)) ?? []).join('\r\n');

function attachmentPart(boundary: string, a: MailAttachment): string[] {
  return [
    `--${boundary}`,
    `Content-Type: ${headerSafe(a.contentType)}; name="${fileSafe(a.filename)}"`,
    'Content-Transfer-Encoding: base64',
    ...(a.contentId ? [`Content-ID: <${headerSafe(a.contentId)}>`] : []),
    `Content-Disposition: ${a.contentId ? 'inline' : 'attachment'}; filename="${fileSafe(a.filename)}"`,
    '',
    wrapBase64(a.base64),
  ];
}

/**
 * The same message as toRaw, but carrying files.
 *
 * Two kinds of attachment need two different envelopes. A photo the HTML
 * references by `cid:` belongs in a multipart/related part with the HTML —
 * that is what tells a mail client the image is part of the body rather than a
 * download. A document (the final invoice, say) is a sibling of the whole body
 * and belongs in multipart/mixed. A message with both is mixed wrapping
 * related, which is the structure every mail client expects; flattening it
 * leaves some clients showing the invoice as a broken inline image.
 */
export function buildMimeWithAttachments(
  mailbox: string, to: string, subject: string, html: string, attachments: MailAttachment[], cc?: string,
): string {
  if (!attachments.length) return toRaw(mailbox, to, subject, html, cc);
  const inline = attachments.filter((a) => a.contentId);
  const files = attachments.filter((a) => !a.contentId);

  const related = boundaryFor('rel');
  const body: string[] = inline.length
    ? [
      `--${related}`,
      'Content-Type: text/html; charset=utf-8',
      'Content-Transfer-Encoding: 7bit',
      '',
      html,
      ...inline.flatMap((a) => attachmentPart(related, a)),
      `--${related}--`,
    ]
    : ['Content-Type: text/html; charset=utf-8', 'Content-Transfer-Encoding: 7bit', '', html];

  let contentType: string;
  let parts: string[];
  if (files.length) {
    const mixed = boundaryFor('mix');
    contentType = `multipart/mixed; boundary="${mixed}"`;
    parts = [
      `--${mixed}`,
      ...(inline.length ? [`Content-Type: multipart/related; type="text/html"; boundary="${related}"`, ''] : []),
      ...body,
      ...files.flatMap((a) => attachmentPart(mixed, a)),
      `--${mixed}--`,
      '',
    ];
  } else {
    contentType = `multipart/related; type="text/html"; boundary="${related}"`;
    parts = [...body, ''];
  }

  const mime = [
    `From: ${headerSafe(mailbox)}`,
    `To: ${headerSafe(to)}`,
    ...(cc ? [`Cc: ${headerSafe(cc)}`] : []),
    `Subject: ${headerSafe(subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: ${contentType}`,
    '',
    ...parts,
  ].join('\r\n');
  return Buffer.from(mime).toString('base64url');
}

/** Send with photos attached, from a company mailbox. Returns the Gmail message id. */
export async function sendAsMailboxWithAttachments(
  mailbox: string, to: string, subject: string, html: string, attachments: MailAttachment[], cc?: string,
): Promise<string> {
  const gmail = getDelegatedGmail(mailbox);
  const res = await gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw: buildMimeWithAttachments(mailbox, to, subject, html, attachments, cc) },
  }, { timeout: ATTACHMENT_SEND_TIMEOUT_MS });
  if (!res.data.id) throw new Error('Gmail send returned no message id');
  return res.data.id;
}

export async function sendAsMailbox(mailbox: string, to: string, subject: string, html: string, cc?: string): Promise<string> {
  const gmail = getDelegatedGmail(mailbox);
  const res = await gmail.users.messages.send({ userId: 'me', requestBody: { raw: toRaw(mailbox, to, subject, html, cc) } });
  // Callers treat any non-null providerRef as a successful send — an empty
  // string would slip past that `!== null` check and get recorded as
  // delivered, indistinguishable from a real send.
  if (!res.data.id) throw new Error('Gmail send returned no message id');
  return res.data.id;
}

export async function createDraftInMailbox(mailbox: string, to: string, subject: string, html: string, cc?: string): Promise<string> {
  const gmail = getDelegatedGmail(mailbox);
  const res = await gmail.users.drafts.create({ userId: 'me', requestBody: { message: { raw: toRaw(mailbox, to, subject, html, cc) } } });
  return res.data.id ?? '';
}
