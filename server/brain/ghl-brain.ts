/**
 * GHL access for the Ops Brain. Uses the NEW Private Integration token
 * (GHL_PIT_TOKEN) — the legacy env keys in server/integrations/gohighlevel.ts
 * are dead (401 since July 2026).
 */
import type { BrainEvent } from './types';

const BASE = 'https://services.leadconnectorhq.com';
const NOISE_BODY = [/here is our booking link/i, /you have a new call from/i];
const NOISE_NAMES = [/^smartcare$/i, /^toll free call$/i, /^pch$/i, /^qrg/i];

function headers() {
  return {
    Authorization: `Bearer ${process.env.GHL_PIT_TOKEN}`,
    Version: '2021-04-15',
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

/** No plain fetch() in this file had a timeout — a hung GHL response during the
 *  hourly sweep could burn the whole sweep's time budget against one call. */
async function fetchWithTimeout(url: string, init: RequestInit, ms = 20_000): Promise<globalThis.Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export interface GhlConvSummary {
  id: string;
  contactId?: string;
  contactName?: string;
  phone?: string;
  email?: string;
  lastMessageBody?: string;
  lastMessageDirection?: 'inbound' | 'outbound';
  lastMessageDate: number; // epoch ms
}

export function isNoiseConversation(conv: { contactName?: string; lastMessageBody?: string }): boolean {
  if (NOISE_NAMES.some((re) => re.test((conv.contactName ?? '').trim()))) return true;
  if (NOISE_BODY.some((re) => re.test(conv.lastMessageBody ?? ''))) return true;
  return false;
}

export function conversationToEvent(conv: GhlConvSummary): BrainEvent {
  return {
    source: 'ghl',
    sourceRef: conv.id,
    occurredAt: new Date(conv.lastMessageDate).toISOString(),
    direction: conv.lastMessageDirection,
    contact: { name: conv.contactName || undefined, phone: conv.phone || undefined, email: conv.email || undefined },
    text: conv.lastMessageBody ?? '',
    raw: conv,
  };
}

export async function fetchGhlDelta(sinceEpochMs: number): Promise<{ events: BrainEvent[]; newCursor: string }> {
  const events: BrainEvent[] = [];
  let startAfterDate: number | undefined;
  let newest = sinceEpochMs;
  for (let page = 0; page < 10; page++) {
    const params = new URLSearchParams({
      locationId: process.env.GHL_LOCATION_ID || '',
      sortBy: 'last_message_date',
      sort: 'desc',
      limit: '100',
      status: 'all',
    });
    if (startAfterDate) params.set('startAfterDate', String(startAfterDate));
    const res = await fetchWithTimeout(`${BASE}/conversations/search?${params}`, { headers: headers() });
    if (!res.ok) throw new Error(`GHL conversations ${res.status}: ${await res.text()}`);
    const data = await res.json();
    const convs: any[] = data.conversations ?? [];
    if (convs.length === 0) break;
    let crossed = false;
    for (const c of convs) {
      const ts = Number(c.lastMessageDate);
      newest = Math.max(newest, ts);
      if (ts <= sinceEpochMs) { crossed = true; break; }
      if (isNoiseConversation(c)) continue;
      events.push(conversationToEvent({
        id: c.id, contactId: c.contactId, contactName: c.contactName || c.fullName,
        phone: c.phone, email: c.email, lastMessageBody: c.lastMessageBody,
        lastMessageDirection: c.lastMessageDirection, lastMessageDate: ts,
      }));
    }
    if (crossed) break;
    startAfterDate = Number(convs[convs.length - 1].lastMessageDate);
  }
  return { events, newCursor: String(newest) };
}

/** GHL answered a send with an error status. The status tells the actor
 *  whether the message certainly did not go (4xx) or might have (5xx). */
export class GhlSendError extends Error {
  constructor(readonly status: number, detail: string) {
    super(`GHL send ${status}: ${detail}`);
    this.name = 'GhlSendError';
  }
}

async function sendMessage(body: Record<string, unknown>): Promise<{ messageId: string }> {
  const res = await fetchWithTimeout(`${BASE}/conversations/messages`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new GhlSendError(res.status, await res.text().catch(() => ''));
  const data = await res.json();
  return { messageId: data.messageId ?? data.msg ?? '' };
}

export function sendGhlSms(contactId: string, body: string) {
  if (body.length > 1200) throw new Error('SMS body exceeds 1200-char cap; use email');
  return sendMessage({ type: 'SMS', contactId, message: body });
}

export function sendGhlEmail(contactId: string, emailTo: string, subject: string, html: string) {
  return sendMessage({ type: 'Email', contactId, emailTo, subject, html, emailFrom: 'james@bestroofingnow.com' });
}

export async function getMessageStatus(conversationId: string, messageId: string): Promise<'delivered' | 'failed' | 'pending'> {
  const res = await fetchWithTimeout(`${BASE}/conversations/${conversationId}/messages?limit=25`, { headers: headers() });
  if (!res.ok) return 'pending';
  const data = await res.json();
  const msgs: any[] = data.messages?.messages ?? [];
  const m = msgs.find((x) => x.id === messageId || x.altId === messageId);
  if (!m) return 'pending';
  if (m.status === 'failed' || m.error) return 'failed';
  if (['delivered', 'sent', 'read'].includes(m.status)) return 'delivered';
  return 'pending';
}

const contactIdCache = new Map<string, string>();

/** Resolve (or create) a GHL contact for a team member's cell. Team nudges go out
 *  through GHL conversations like every other SMS, so each recipient needs a
 *  contactId; upsert is atomic (returns the existing contact when the phone matches). */
export async function upsertContactByPhone(name: string, phone: string): Promise<string | null> {
  const cached = contactIdCache.get(phone);
  if (cached) return cached;
  try {
    const res = await fetchWithTimeout(`${BASE}/contacts/upsert`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ locationId: process.env.GHL_LOCATION_ID || '', name, phone }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const id = data.contact?.id ?? null;
    if (id) contactIdCache.set(phone, id);
    return id;
  } catch (e: any) {
    // Every caller of this treats null as "fall back to a degraded path" —
    // without a log line, a full GHL outage looks identical to "contact not
    // found" from the caller's perspective.
    console.error('[ghl-brain] upsertContactByPhone failed:', e?.message || e);
    return null;
  }
}

export async function getConversationContactId(conversationId: string): Promise<string | null> {
  try {
    const res = await fetchWithTimeout(`${BASE}/conversations/${conversationId}`, { headers: headers() });
    if (!res.ok) return null;
    const data = await res.json();
    return data.conversation?.contactId ?? data.contactId ?? null;
  } catch (e: any) {
    console.error('[ghl-brain] getConversationContactId failed:', e?.message || e);
    return null;
  }
}

/** Inverse of getConversationContactId — needed to check delivery status of a
 *  just-sent team nudge, which only has the recipient's contactId. */
export async function getConversationIdByContact(contactId: string): Promise<string | null> {
  try {
    const params = new URLSearchParams({ locationId: process.env.GHL_LOCATION_ID || '', contactId, limit: '1' });
    const res = await fetchWithTimeout(`${BASE}/conversations/search?${params}`, { headers: headers() });
    if (!res.ok) return null;
    const data = await res.json();
    return data.conversations?.[0]?.id ?? null;
  } catch (e: any) {
    console.error('[ghl-brain] getConversationIdByContact failed:', e?.message || e);
    return null;
  }
}
