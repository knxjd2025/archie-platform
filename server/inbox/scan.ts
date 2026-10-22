/**
 * Inbox watch — scan one mailbox for leads and must-not-miss email.
 * Window rule and classification live in ./rules.ts (pure, tested).
 */
import { and, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { currentProfile } from '../tenant/context';
import { db } from '../db';
import { inboxItems, inboxScans, leads } from '../../shared/schema';
import { getDelegatedGmail } from '../brain/gmail-delegated';
import { completeJson } from '../lib/llm-json';
import {
  scanWindow, readWindowOldestFirst, gmailQuery, parseFrom, heuristicClassify, needsModel, classifyPrompt, parseClassifications, classifySystem, isActionable,
  type InboxMessage, type KnownContact, type Classification, type ScanWindow,
} from './rules';

const MAX_MESSAGES = 150;
/** How many ids one listing of a window slice returns (ids are cheap; each message read is a request). */
const MAX_LISTED = 2000;

export async function lastScanTo(mailbox: string): Promise<Date | null> {
  const [row] = await db.select({ toAt: inboxScans.toAt }).from(inboxScans).where(eq(inboxScans.mailbox, mailbox)).orderBy(desc(inboxScans.toAt)).limit(1);
  return row?.toAt ?? null;
}

async function knownContacts(emails: string[]): Promise<Map<string, KnownContact>> {
  const map = new Map<string, KnownContact>();
  const wanted = Array.from(new Set(emails.filter(Boolean).map((e) => e.toLowerCase())));
  if (!wanted.length) return map;
  const rows = await db.select({ email: leads.email, firstName: leads.firstName, lastName: leads.lastName, jobName: leads.jobName, externalId: leads.externalId })
    .from(leads).where(and(isNotNull(leads.email), inArray(sql`lower(${leads.email})`, wanted)));
  for (const r of rows) {
    const email = String(r.email).toLowerCase();
    if (!map.has(email)) map.set(email, { email, name: [r.firstName, r.lastName].filter(Boolean).join(' ') || r.jobName || null, externalId: r.externalId });
  }
  return map;
}

async function fetchMessages(mailbox: string, w: ScanWindow): Promise<{ messages: InboxMessage[]; reachedTo: Date }> {
  const gmail = getDelegatedGmail(mailbox);
  const { items, reachedTo } = await readWindowOldestFirst<InboxMessage>(w, {
    async list(from, before) {
      const ids: string[] = [];
      let pageToken: string | undefined;
      do {
        const list = await gmail.users.messages.list({ userId: 'me', q: gmailQuery(from, before), maxResults: 500, pageToken });
        for (const m of list.data.messages || []) if (m.id) ids.push(m.id);
        pageToken = list.data.nextPageToken ?? undefined;
      } while (pageToken && ids.length < MAX_LISTED);
      if (pageToken && before.getTime() - from.getTime() <= 60_000) {
        console.warn(`[inbox] ${mailbox}: more than ${MAX_LISTED} messages in one minute — some of that minute is skipped`);
      }
      return { ids, truncated: Boolean(pageToken) };
    },
    async read(id) {
      const msg = await gmail.users.messages.get({ userId: 'me', id, format: 'metadata', metadataHeaders: ['From', 'Subject', 'Date'] });
      const headers = msg.data.payload?.headers || [];
      const h = (n: string) => headers.find((x) => (x.name || '').toLowerCase() === n.toLowerCase())?.value || '';
      const from = parseFrom(h('From'));
      return {
        messageId: id, threadId: msg.data.threadId || id,
        fromName: from.name, fromEmail: from.email, subject: h('Subject'), snippet: msg.data.snippet || '',
        receivedAt: new Date(Number(msg.data.internalDate || Date.now())), labelIds: msg.data.labelIds || [],
      };
    },
  }, { maxRead: MAX_MESSAGES });
  return { messages: items, reachedTo };
}

async function refineWithModel(items: InboxMessage[], first: Map<string, Classification>): Promise<void> {
  if (!process.env.ANTHROPIC_API_KEY) return;
  const unsure = items.filter((m) => needsModel(first.get(m.messageId)!)).slice(0, 25);
  if (!unsure.length) return;
  try {
    const raw = await completeJson(classifySystem(currentProfile()), classifyPrompt(unsure));
    for (const [id, c] of parseClassifications(raw)) {
      const h = first.get(id);
      if (h) first.set(id, { ...c, matched: h.matched });
    }
  } catch (e: any) {
    console.warn('[inbox] model pass skipped:', e?.message || e);
  }
}

export interface ScanResult { window: { from: string; to: string; firstScan: boolean }; seen: number; added: number; flagged: number }

export async function scanMailbox(mailbox: string, startedBy: string, now = new Date()): Promise<ScanResult> {
  const w = scanWindow(now, await lastScanTo(mailbox));
  const { messages, reachedTo } = await fetchMessages(mailbox, w);
  const known = await knownContacts(messages.map((m) => m.fromEmail));
  const cls = new Map<string, Classification>(messages.map((m) => [m.messageId, heuristicClassify(m, known, mailbox)]));
  await refineWithModel(messages, cls);

  const existing = messages.length
    ? new Set((await db.select({ id: inboxItems.messageId }).from(inboxItems).where(and(eq(inboxItems.mailbox, mailbox), inArray(inboxItems.messageId, messages.map((m) => m.messageId))))).map((r) => r.id))
    : new Set<string>();
  let added = 0, flagged = 0;
  for (const m of messages) {
    if (existing.has(m.messageId)) continue;
    const c = cls.get(m.messageId)!;
    if (c.category === 'other' && c.score < 25) continue; // noise is not worth a row
    await db.insert(inboxItems).values({
      mailbox, messageId: m.messageId, threadId: m.threadId,
      fromName: m.fromName || null, fromEmail: m.fromEmail || null, subject: m.subject || null, snippet: m.snippet.slice(0, 600) || null,
      receivedAt: m.receivedAt, category: c.category, score: c.score, reason: c.reason || null,
      matchedExternalId: c.matched?.externalId ?? null, matchedName: c.matched?.name ?? null,
      status: 'new', unread: m.labelIds.includes('UNREAD'),
    }).onConflictDoNothing();
    added++;
    if (isActionable(c)) flagged++;
  }
  await db.insert(inboxScans).values({ mailbox, fromAt: w.from, toAt: reachedTo, messagesSeen: messages.length, itemsAdded: added, flagged, startedBy });
  return { window: { from: w.from.toISOString(), to: reachedTo.toISOString(), firstScan: w.firstScan }, seen: messages.length, added, flagged };
}
