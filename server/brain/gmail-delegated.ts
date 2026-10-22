/**
 * Moved. Kept so older call sites keep compiling while they move to
 * server/integrations/company-mail.ts (sending) and
 * server/integrations/google-workspace.ts (Gmail access).
 *
 * sendAsMailbox / sendAsMailboxWithAttachments now send through the
 * company's mail route: Google when the mailbox is delegated to this
 * company, its GHL sub-account otherwise.
 */
import { sendCompanyEmail, type MailAttachment } from '../integrations/company-mail';

export { getDelegatedGmail, createDraftInMailbox, buildMimeMessage, buildMimeWithAttachments, GOOGLE_TIMEOUT_MS } from '../integrations/google-workspace';
export type { MailAttachment };

export async function sendAsMailbox(mailbox: string, to: string, subject: string, html: string, cc?: string): Promise<string> {
  return (await sendCompanyEmail({ from: mailbox, to, subject, html, cc })).messageId;
}

export async function sendAsMailboxWithAttachments(
  mailbox: string, to: string, subject: string, html: string, attachments: MailAttachment[], cc?: string,
): Promise<string> {
  return (await sendCompanyEmail({ from: mailbox, to, subject, html, cc, attachments })).messageId;
}
