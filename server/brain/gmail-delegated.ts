/**
 * Domain-wide-delegated Gmail access for the 4 company mailboxes.
 * Auth: service account (GOOGLE_SA_EMAIL + GOOGLE_SA_KEY, base64 PEM),
 * impersonating each mailbox via JWT `subject`.
 */
import { google } from 'googleapis';
import type { BrainEvent } from './types';

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.compose',
];

/** Per request. googleapis has no default timeout, and a hung Gmail call in
 *  the hourly sweep held the function until Vercel killed it at 300s. */
export const GOOGLE_TIMEOUT_MS = 20_000;
/** Sending photos is an upload of several MB — give it longer than a read. */
const ATTACHMENT_SEND_TIMEOUT_MS = 60_000;

export function getDelegatedGmail(mailbox: string) {
  const key = Buffer.from(process.env.GOOGLE_SA_KEY || '', 'base64').toString('utf8');
  const jwt = new google.auth.JWT({
    email: process.env.GOOGLE_SA_EMAIL,
    key,
    scopes: SCOPES,
    subject: mailbox,
  });
  return google.gmail({ version: 'v1', auth: jwt, timeout: GOOGLE_TIMEOUT_MS });
}

interface GmailApiMessage {
  id: string;
  threadId: string;
  internalDate?: string;
  labelIds?: string[];
  snippet?: string;
  payload?: { headers?: Array<{ name: string; value: string }> };
}

function header(msg: GmailApiMessage, name: string): string {
  return msg.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';
}

/**
 * `historyId` is the id of the history record that added the message. It is
 * where the mailbox cursor can be held back to when the sweep runs out of time
 * before triaging this event, so the next sweep reads it again.
 */
export function parseGmailMessage(msg: GmailApiMessage, mailbox: string, historyId?: string): BrainEvent {
  const from = header(msg, 'From');
  const emailMatch = from.match(/<([^>]+)>/);
  const fromEmail = (emailMatch ? emailMatch[1] : from).trim().toLowerCase();
  const fromName = from.replace(/<[^>]+>/, '').replace(/"/g, '').trim();
  const isOutbound = fromEmail === mailbox.toLowerCase() || (msg.labelIds ?? []).includes('SENT');
  return {
    source: 'gmail',
    sourceRef: msg.threadId,
    mailbox,
    occurredAt: new Date(Number(msg.internalDate ?? Date.now())).toISOString(),
    direction: isOutbound ? 'outbound' : 'inbound',
    contact: isOutbound ? undefined : { name: fromName || undefined, email: fromEmail || undefined },
    text: `Subject: ${header(msg, 'Subject')}\nFrom: ${from}\n${msg.snippet ?? ''}`,
    raw: { messageId: msg.id, labelIds: msg.labelIds, historyId },
  };
}

export async function fetchMailboxDelta(
  mailbox: string,
  historyId: string | null,
): Promise<{ events: BrainEvent[]; newCursor: string }> {
  const gmail = getDelegatedGmail(mailbox);
  const profile = await gmail.users.getProfile({ userId: 'me' });
  const latestHistoryId = String(profile.data.historyId);
  if (!historyId) return { events: [], newCursor: latestHistoryId }; // first run: set cursor only

  // Message id -> the history record that added it (first one wins: records
  // come oldest first).
  const messageIds = new Map<string, string | undefined>();
  let pageToken: string | undefined;
  do {
    const res = await gmail.users.history.list({
      userId: 'me',
      startHistoryId: historyId,
      historyTypes: ['messageAdded'],
      pageToken,
    });
    for (const h of res.data.history ?? [])
      for (const m of h.messagesAdded ?? []) {
        if (m.message?.id && !messageIds.has(m.message.id)) messageIds.set(m.message.id, h.id ? String(h.id) : undefined);
      }
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);

  const events: BrainEvent[] = [];
  for (const [id, addedAt] of messageIds) {
    const full = await gmail.users.messages.get({ userId: 'me', id, format: 'metadata', metadataHeaders: ['From', 'Subject'] });
    events.push(parseGmailMessage(full.data as GmailApiMessage, mailbox, addedAt));
  }
  return { events, newCursor: latestHistoryId };
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
