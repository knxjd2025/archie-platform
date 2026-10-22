import { google } from 'googleapis';
import { getDelegatedGmail } from '../brain/gmail-delegated';

export interface EmailItem {
  from: string;
  subject: string;
  date: string;
  snippet: string;
  unread: boolean;
}

/**
 * Read the signed-in user's OWN Gmail inbox via the company service account's
 * domain-wide delegation (internal-only — impersonates the caller's mailbox).
 * `query` accepts Gmail search syntax (e.g. "from:kevin", "is:unread",
 * "newer_than:3d"); blank defaults to the last week's inbox.
 *
 * Always call with the caller's own email as `mailbox` so a user can only read
 * their own inbox.
 */
export async function searchEmail(
  mailbox: string,
  query: string | undefined,
  limit: number | undefined,
): Promise<EmailItem[] | { error: string }> {
  try {
    if (!mailbox) return { error: 'no mailbox for the signed-in user' };
    const gmail = getDelegatedGmail(mailbox);
    const max = Math.min(Math.max(limit || 10, 1), 25);
    const list = await gmail.users.messages.list({
      userId: 'me',
      q: query && query.trim() ? query : 'in:inbox newer_than:7d',
      maxResults: max,
    });
    const ids = (list.data.messages || []).map((m) => m.id).filter((x): x is string => !!x);
    const out: EmailItem[] = [];
    for (const id of ids) {
      const msg = await gmail.users.messages.get({
        userId: 'me',
        id,
        format: 'metadata',
        metadataHeaders: ['From', 'Subject', 'Date'],
      });
      const headers = msg.data.payload?.headers || [];
      const h = (n: string) => headers.find((x) => x.name === n)?.value || '';
      out.push({
        from: h('From'),
        subject: h('Subject'),
        date: h('Date'),
        snippet: msg.data.snippet || '',
        unread: (msg.data.labelIds || []).includes('UNREAD'),
      });
    }
    return out;
  } catch (e: any) {
    return { error: e?.message || 'could not read email' };
  }
}

export interface GmailInboxItem {
  id: string;
  threadId: string;
  from: string; // raw From header, e.g. "Jane Doe <jane@x.com>"
  subject: string;
  snippet: string;
  date: string; // raw Date header
  unread: boolean;
}

/**
 * List recent inbox messages from the signed-in user's OWN Gmail (via the
 * company service account's domain-wide delegation — impersonates `mailbox`).
 * Used by the unified Conversations screen. Filters out promotions/social so
 * the feed stays to real human email. Fails soft to {error}.
 */
export async function fetchGmailInbox(
  mailbox: string,
  limit: number | undefined,
): Promise<GmailInboxItem[] | { error: string }> {
  try {
    if (!mailbox) return { error: 'no mailbox for the signed-in user' };
    const gmail = getDelegatedGmail(mailbox);
    const max = Math.min(Math.max(limit || 25, 1), 40);
    const list = await gmail.users.messages.list({
      userId: 'me',
      q: 'in:inbox -category:promotions -category:social newer_than:60d',
      maxResults: max,
    });
    const ids = (list.data.messages || []).map((m) => m.id).filter((x): x is string => !!x);
    const out: GmailInboxItem[] = [];
    for (const id of ids) {
      const msg = await gmail.users.messages.get({
        userId: 'me',
        id,
        format: 'metadata',
        metadataHeaders: ['From', 'Subject', 'Date'],
      });
      const headers = msg.data.payload?.headers || [];
      const h = (n: string) => headers.find((x) => x.name === n)?.value || '';
      out.push({
        id,
        threadId: msg.data.threadId || id,
        from: h('From'),
        subject: h('Subject'),
        snippet: msg.data.snippet || '',
        date: h('Date'),
        unread: (msg.data.labelIds || []).includes('UNREAD'),
      });
    }
    return out;
  } catch (e: any) {
    return { error: e?.message || 'could not read email' };
  }
}

// ============================================================
// Google Drive (delegated, read-only) — requires the service account to have
// the drive.readonly scope added to its domain-wide delegation in Workspace admin.
// ============================================================

const DRIVE_SCOPES = ['https://www.googleapis.com/auth/drive.readonly'];

export function getDelegatedDrive(mailbox: string) {
  const key = Buffer.from(process.env.GOOGLE_SA_KEY || '', 'base64').toString('utf8');
  const jwt = new google.auth.JWT({
    email: process.env.GOOGLE_SA_EMAIL,
    key,
    scopes: DRIVE_SCOPES,
    subject: mailbox,
  });
  return google.drive({ version: 'v3', auth: jwt });
}

function simpleType(mime: string): string {
  const map: Record<string, string> = {
    'application/vnd.google-apps.document': 'Google Doc',
    'application/vnd.google-apps.spreadsheet': 'Google Sheet',
    'application/vnd.google-apps.presentation': 'Google Slides',
    'application/vnd.google-apps.folder': 'Folder',
    'application/pdf': 'PDF',
  };
  return map[mime] || mime.split('/').pop() || 'file';
}

// Escape single quotes for Drive query strings.
const esc = (s: string) => s.replace(/'/g, "\\'");

export interface DriveFileItem {
  id: string;
  name: string;
  type: string;
  modified: string;
  link: string;
}

/**
 * Search the signed-in user's OWN Google Drive (read-only, via delegation).
 * `query` matches file name and full text; blank lists recent files.
 */
export async function searchDrive(
  mailbox: string,
  query: string | undefined,
  limit: number | undefined,
): Promise<DriveFileItem[] | { error: string }> {
  try {
    if (!mailbox) return { error: 'no mailbox for the signed-in user' };
    const drive = getDelegatedDrive(mailbox);
    const max = Math.min(Math.max(limit || 10, 1), 25);
    const q = query && query.trim()
      ? `(name contains '${esc(query)}' or fullText contains '${esc(query)}') and trashed = false`
      : 'trashed = false';
    const res = await drive.files.list({
      q,
      pageSize: max,
      orderBy: 'modifiedTime desc',
      fields: 'files(id,name,mimeType,modifiedTime,webViewLink)',
    });
    return (res.data.files || []).map((f) => ({
      id: f.id || '',
      name: f.name || '',
      type: simpleType(f.mimeType || ''),
      modified: f.modifiedTime || '',
      link: f.webViewLink || '',
    }));
  } catch (e: any) {
    return { error: e?.message || 'could not read Drive' };
  }
}

/**
 * Read a Google Doc/Sheet/Slides (or plain-text/markdown/csv) file's text from
 * the signed-in user's Drive. Returns a link for binary types we can't read.
 */
export async function readDriveFile(
  mailbox: string,
  fileId: string,
): Promise<{ name: string; text: string } | { error: string }> {
  try {
    if (!mailbox || !fileId) return { error: 'mailbox and fileId are required' };
    const drive = getDelegatedDrive(mailbox);
    const meta = await drive.files.get({ fileId, fields: 'id,name,mimeType,webViewLink' });
    const mime = meta.data.mimeType || '';
    const name = meta.data.name || '';
    if (mime.startsWith('application/vnd.google-apps.')) {
      const exportMime = mime.includes('spreadsheet') ? 'text/csv' : 'text/plain';
      const exp = await drive.files.export({ fileId, mimeType: exportMime }, { responseType: 'text' });
      return { name, text: String(exp.data).slice(0, 12000) };
    }
    if (mime === 'text/plain' || mime === 'text/markdown' || mime === 'text/csv') {
      const dl = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'text' });
      return { name, text: String(dl.data).slice(0, 12000) };
    }
    return { error: `Can't read ${simpleType(mime)} as text — open it: ${meta.data.webViewLink}` };
  } catch (e: any) {
    return { error: e?.message || 'could not read the file' };
  }
}
