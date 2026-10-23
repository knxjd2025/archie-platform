/**
 * Send an email from the current company: a signed document, a certificate,
 * a reminder to a rep, a bug digest to the admin.
 *
 * Two routes, picked per message:
 *   1. Google Workspace, when the operator has delegated the company's domain
 *      (google-workspace.ts) and `from` is a mailbox in it. The message lands
 *      in that person's Sent folder.
 *   2. Otherwise the company's GHL sub-account (ghl/messaging.ts), from its
 *      default sender. This is the normal route for every Archie company.
 *
 * Attachments: Gmail carries them in the MIME message. GHL needs them hosted,
 * so they are uploaded to the contact's GHL conversation first and the email
 * links them; an inline `cid:` image in the HTML is pointed at its upload.
 */
import { canDelegateMailbox, sendAsMailbox as gmailSend, sendAsMailboxWithAttachments as gmailSendWithAttachments, type MailAttachment } from './google-workspace';
import { GHL_API_BASE, ghlConnection, ghlHeaders } from './ghl/connection';
import { getConversationIdByContact, sendGhlEmail, upsertContactByEmail } from './ghl/messaging';

export type { MailAttachment };

export interface CompanyEmail {
  to: string;
  subject: string;
  html: string;
  cc?: string;
  /** The person sending, when there is one. Used for Google delegation; GHL sends from the sub-account. */
  from?: string;
  /** Name for a new GHL contact, when `to` is not one yet. */
  toName?: string;
  attachments?: MailAttachment[];
}

export interface CompanyEmailResult {
  via: 'google' | 'ghl';
  /** Provider message id. Never empty: a send without one throws. */
  messageId: string;
}

const splitAddresses = (v?: string) => (v ?? '').split(/[,;]/).map((s) => s.trim()).filter(Boolean);

export async function sendCompanyEmail(msg: CompanyEmail): Promise<CompanyEmailResult> {
  const to = msg.to.trim();
  if (!to) throw new Error('An email needs a recipient.');

  if (msg.from && canDelegateMailbox(msg.from)) {
    const messageId = msg.attachments?.length
      ? await gmailSendWithAttachments(msg.from, to, msg.subject, msg.html, msg.attachments, msg.cc)
      : await gmailSend(msg.from, to, msg.subject, msg.html, msg.cc);
    return { via: 'google', messageId };
  }

  const recipient = splitAddresses(to)[0];
  const contactId = await upsertContactByEmail(msg.toName ?? '', recipient);
  if (!contactId) throw new Error(`Could not find or create a GHL contact for ${recipient}.`);

  let html = msg.html;
  let attachmentUrls: string[] = [];
  if (msg.attachments?.length) {
    const uploaded = await uploadAttachments(contactId, msg.attachments);
    for (const a of msg.attachments) {
      const url = uploaded.get(a.filename);
      if (url && a.contentId) html = html.split(`cid:${a.contentId}`).join(url);
    }
    attachmentUrls = msg.attachments.filter((a) => !a.contentId).map((a) => uploaded.get(a.filename)).filter((u): u is string => !!u);
  }

  const { messageId } = await sendGhlEmail(contactId, recipient, msg.subject, html, {
    emailCc: [...splitAddresses(to).slice(1), ...splitAddresses(msg.cc)],
    attachments: attachmentUrls,
  });
  if (!messageId) throw new Error('GHL send returned no message id');
  return { via: 'ghl', messageId };
}

/** The contact's GHL conversation, created when there is none yet. */
async function conversationFor(contactId: string): Promise<string> {
  const existing = await getConversationIdByContact(contactId);
  if (existing) return existing;
  const conn = await ghlConnection();
  const res = await fetch(`${GHL_API_BASE}/conversations/`, {
    method: 'POST',
    headers: ghlHeaders(conn, '2021-04-15'),
    body: JSON.stringify({ locationId: conn.locationId, contactId }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`GHL create conversation ${res.status}: ${await res.text().catch(() => '')}`);
  const data = await res.json();
  const id = data.conversation?.id ?? data.id;
  if (!id) throw new Error('GHL create conversation returned no id');
  return id;
}

/** Upload files to the contact's conversation. Returns filename → hosted URL. */
async function uploadAttachments(contactId: string, attachments: MailAttachment[]): Promise<Map<string, string>> {
  const conn = await ghlConnection();
  const conversationId = await conversationFor(contactId);
  const out = new Map<string, string>();
  for (const a of attachments) {
    const form = new FormData();
    form.set('conversationId', conversationId);
    form.set('locationId', conn.locationId);
    const bytes = Buffer.from(a.base64.replace(/^data:[^;]+;base64,/, ''), 'base64');
    form.set('fileAttachment', new Blob([bytes], { type: a.contentType }), a.filename);
    const { 'Content-Type': _json, ...headers } = ghlHeaders(conn, '2021-04-15');
    const res = await fetch(`${GHL_API_BASE}/conversations/messages/upload`, {
      method: 'POST', headers, body: form, signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`GHL upload ${res.status}: ${await res.text().catch(() => '')}`);
    const data = await res.json();
    const files = data.uploadedFiles ?? {};
    const url = files[a.filename] ?? Object.values(files)[0];
    if (typeof url !== 'string' || !url) throw new Error(`GHL upload of ${a.filename} returned no URL`);
    out.set(a.filename, url);
  }
  return out;
}

/** sendCompanyEmail in the older (mailbox, to, subject, html, cc) shape. Returns the message id. */
export async function sendAsMailbox(mailbox: string, to: string, subject: string, html: string, cc?: string): Promise<string> {
  return (await sendCompanyEmail({ from: mailbox, to, subject, html, cc })).messageId;
}

/** sendAsMailbox with files. */
export async function sendAsMailboxWithAttachments(
  mailbox: string, to: string, subject: string, html: string, attachments: MailAttachment[], cc?: string,
): Promise<string> {
  return (await sendCompanyEmail({ from: mailbox, to, subject, html, cc, attachments })).messageId;
}
