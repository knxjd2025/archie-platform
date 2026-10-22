import type { Express, Request, Response } from 'express';
import { requireAuth } from '../auth/middleware';
import { asyncHandler } from '../lib/async-handler';
import { GoHighLevelClient } from '../integrations/gohighlevel';
import { JobTreadClient } from '../integrations/jobtread';
import { fetchGmailInbox } from '../agents/google-tools';
import { imessageConversations } from '../imessage/routes';
import { isScoped, repClientIdentifiers } from '../access/rep-scope';

export interface ConversationItem {
  id: string;
  source: string; // 'ghl' | 'gmail' | 'jobtread'
  channel: string; // 'sms' | 'call' | 'email' | 'chat' | 'note' | 'other'
  contact: string;
  contactId: string;
  lastMessage: string;
  direction: string; // 'inbound' | 'outbound' | ''
  date: number; // epoch ms
  unread: number;
}

export interface SourceStatus {
  ok: boolean;
  count?: number;
  error?: string;
}

// GHL lastMessageType values -> our channel labels.
const CHANNEL: Record<string, string> = {
  TYPE_SMS: 'sms',
  TYPE_CALL: 'call',
  TYPE_PHONE: 'call',
  TYPE_EMAIL: 'email',
  TYPE_WEBCHAT: 'chat',
  TYPE_FB: 'chat',
  TYPE_IG: 'chat',
  TYPE_GMB: 'chat',
  TYPE_WHATSAPP: 'chat',
};

export function normalizeGhlConversation(c: any): ConversationItem {
  return {
    id: c.id || '',
    source: 'ghl',
    channel: CHANNEL[c.lastMessageType] || (c.type ? String(c.type).toLowerCase() : 'other'),
    contact: c.fullName || c.contactName || c.name || 'Unknown',
    contactId: c.contactId || '',
    lastMessage: c.lastMessageBody || '',
    direction: (c.lastMessageDirection || '').toLowerCase(),
    date: Number(c.lastMessageDate || c.dateUpdated || c.dateAdded || 0),
    unread: Number(c.unreadCount || 0),
  };
}

// "Jane Doe <jane@x.com>" -> "Jane Doe"; a bare address stays as-is.
function parseFromName(raw: string): string {
  const m = String(raw || '').match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m && m[1].trim()) return m[1].trim();
  if (m) return m[2].trim();
  return String(raw || '').trim();
}

export function normalizeGmailMessage(m: any): ConversationItem {
  const dateMs = m.date ? Date.parse(m.date) : 0;
  const subject = String(m.subject || '').trim();
  const snippet = String(m.snippet || '').trim();
  return {
    id: `gmail:${m.id || ''}`,
    source: 'gmail',
    channel: 'email',
    contact: parseFromName(m.from) || 'Unknown',
    contactId: '',
    lastMessage: subject ? (snippet ? `${subject} — ${snippet}` : subject) : snippet,
    direction: 'inbound',
    date: Number.isFinite(dateMs) ? dateMs : 0,
    unread: m.unread ? 1 : 0,
  };
}

export function normalizeJobTreadComment(c: any): ConversationItem {
  const dateMs = c.createdAt ? Date.parse(c.createdAt) : 0;
  const msg = String(c.message || '').replace(/\s+/g, ' ').trim().slice(0, 280);
  const author = c.author ? `${c.author}: ` : '';
  return {
    id: `jt:${c.id || ''}`,
    source: 'jobtread',
    // Comments that arrived as email read as inbound email; the rest are the
    // job's internal note/message feed.
    channel: c.isFromEmail ? 'email' : 'note',
    contact: c.accountName || c.jobName || 'JobTread',
    contactId: '',
    lastMessage: `${author}${msg}`,
    direction: c.isFromEmail ? 'inbound' : 'outbound',
    date: Number.isFinite(dateMs) ? dateMs : 0,
    unread: 0,
  };
}

/** GHL's largest conversations page. */
const GHL_PAGE = 100;
/**
 * Pages of GHL conversations read for a sales rep. The list is company-wide
 * and only filtered to the rep's clients afterwards, so a rep needs a deep
 * enough slice of it for their own clients to be in there at all.
 */
export const GHL_REP_PAGES = 5;

/**
 * The newest GHL conversations, `pages` pages of 100 deep.
 *
 * Called with no limit, GHL returned its default 20 for the whole company,
 * and a rep's view was those 20 filtered to their own clients — usually
 * nothing, so reps saw an empty inbox while their customers were texting.
 */
export async function fetchGhlConversations(
  getPage: (opts: { limit: number; startAfterDate?: number }) => Promise<{ conversations?: any[] }>,
  pages: number,
): Promise<any[]> {
  const all: any[] = [];
  let startAfterDate: number | undefined;
  for (let i = 0; i < pages; i++) {
    const r = await getPage({ limit: GHL_PAGE, startAfterDate });
    const list = r?.conversations || [];
    all.push(...list);
    const last = Number(list[list.length - 1]?.lastMessageDate || 0);
    if (list.length < GHL_PAGE || !last || last === startAfterDate) break;
    startAfterDate = last;
  }
  // A conversation on a page boundary can come back twice.
  const seen = new Set<string>();
  return all.filter((c) => !c?.id || (seen.has(c.id) ? false : (seen.add(c.id), true)));
}

const errText = (reason: any): string =>
  String(reason?.message || reason || 'failed').slice(0, 200);

/**
 * Limit a merged conversation list to a sales rep's own clients.
 *  - Gmail: always kept (it's the rep's own inbox already).
 *  - GHL / JobTread: kept only when the contact (or JobTread job) matches one of
 *    the rep's clients by name. Anything we can't confidently match is DROPPED —
 *    a rep must never see another rep's client. (Privacy-safe default.)
 */
export function filterConversationsForRep(
  items: ConversationItem[],
  scope: { names: string[]; jobNames: string[] },
): ConversationItem[] {
  const nameSet = new Set(scope.names.map((n) => n.trim().toLowerCase()).filter(Boolean));
  const jobSet = new Set(scope.jobNames.map((n) => n.trim().toLowerCase()).filter(Boolean));
  const matches = (c: ConversationItem) => {
    const contact = (c.contact || '').trim().toLowerCase();
    return (contact && nameSet.has(contact)) || (contact && jobSet.has(contact));
  };
  return items.filter((c) => {
    if (c.source === 'gmail') return true;
    return matches(c);
  });
}

export function registerConversationRoutes(app: Express) {
  // Unified client conversations across every channel we can reach:
  //  - GoHighLevel: texts, calls, GHL emails
  //  - Gmail: the signed-in user's own inbox (delegated, privacy-scoped to them)
  //  - JobTread: the per-job comment/message feed
  // Each source is fetched independently so one failing source never blanks the
  // whole screen — the response reports per-source status alongside the merged list.
  app.get('/api/conversations', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const user = req.session.user!;
    const mailbox = user.email || '';

    const [ghlR, gmailR, jtR] = await Promise.allSettled([
      (async () => {
        const ghl = new GoHighLevelClient();
        const list = await fetchGhlConversations(
          (opts) => ghl.getConversations(undefined, opts),
          isScoped(user) ? GHL_REP_PAGES : 1,
        );
        return list.map(normalizeGhlConversation);
      })(),
      (async () => {
        const r = await fetchGmailInbox(mailbox, 25);
        if (!Array.isArray(r)) throw new Error(r.error);
        return r.map(normalizeGmailMessage);
      })(),
      (async () => {
        const jt = new JobTreadClient();
        const r = await jt.getRecentComments(40);
        return r.comments.map(normalizeJobTreadComment);
      })(),
    ]);

    const val = (r: PromiseSettledResult<ConversationItem[]>): ConversationItem[] =>
      r.status === 'fulfilled' ? r.value : [];
    const status = (r: PromiseSettledResult<ConversationItem[]>): SourceStatus =>
      r.status === 'fulfilled' ? { ok: true, count: r.value.length } : { ok: false, error: errText(r.reason) };

    // The signed-in person's own iMessage threads (their Mac bridge), last 14 days.
    let im: ConversationItem[] = [];
    try { im = await imessageConversations(mailbox, new Date(Date.now() - 14 * 864e5)); } catch { /* no bridge */ }
    let items = [...val(ghlR), ...val(gmailR), ...val(jtR), ...im].sort((a, b) => b.date - a.date);

    // Sales reps: keep only their own clients' conversations.
    if (isScoped(user)) {
      const scope = await repClientIdentifiers(user);
      items = filterConversationsForRep(items, { names: scope?.names || [], jobNames: scope?.jobNames || [] });
    }

    items = items.slice(0, 150);

    res.json({
      conversations: items,
      sources: { ghl: status(ghlR), gmail: status(gmailR), jobtread: status(jtR), imessage: { ok: true, count: im.length } },
    });
  }));
}
