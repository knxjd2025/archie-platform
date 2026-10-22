/**
 * Text and email through the current company's GHL sub-account
 * (connection.ts). Every message goes out from the company's own GHL
 * numbers and sending domain, so customers and team members see the
 * company, never Archie and never GHL.
 */
import { GHL_API_BASE, ghlConnection, ghlHeaders } from './connection';
import { currentCompanyId } from '../../tenant/context';

/** A plain fetch() has no timeout; one hung GHL call should not stall a whole job. */
async function fetchWithTimeout(url: string, init: RequestInit, ms = 20_000): Promise<globalThis.Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** GHL answered a send with an error status. 4xx: it certainly did not go. 5xx: it might have. */
export class GhlSendError extends Error {
  constructor(readonly status: number, detail: string) {
    super(`GHL send ${status}: ${detail}`);
    this.name = 'GhlSendError';
  }
}

async function sendMessage(body: Record<string, unknown>): Promise<{ messageId: string }> {
  const conn = await ghlConnection();
  const res = await fetchWithTimeout(`${GHL_API_BASE}/conversations/messages`, {
    method: 'POST',
    headers: ghlHeaders(conn, '2021-04-15'),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new GhlSendError(res.status, await res.text().catch(() => ''));
  const data = await res.json();
  return { messageId: data.messageId ?? data.msg ?? '' };
}

export const SMS_MAX_CHARS = 1200;

export function sendGhlSms(contactId: string, body: string): Promise<{ messageId: string }> {
  if (body.length > SMS_MAX_CHARS) throw new Error(`SMS body exceeds ${SMS_MAX_CHARS}-char cap; use email`);
  return sendMessage({ type: 'SMS', contactId, message: body });
}

export interface GhlEmailOptions {
  /** Sender address; leave out to use the sub-account's default sender. */
  emailFrom?: string;
  emailCc?: string[];
  /** Public URLs of files to attach (GHL fetches them). */
  attachments?: string[];
}

export function sendGhlEmail(contactId: string, emailTo: string, subject: string, html: string, opts: GhlEmailOptions = {}): Promise<{ messageId: string }> {
  return sendMessage({
    type: 'Email',
    contactId,
    emailTo,
    subject,
    html,
    ...(opts.emailFrom ? { emailFrom: opts.emailFrom } : {}),
    ...(opts.emailCc?.length ? { emailCc: opts.emailCc } : {}),
    ...(opts.attachments?.length ? { attachments: opts.attachments } : {}),
  });
}

export async function getMessageStatus(conversationId: string, messageId: string): Promise<'delivered' | 'failed' | 'pending'> {
  const conn = await ghlConnection();
  const res = await fetchWithTimeout(`${GHL_API_BASE}/conversations/${conversationId}/messages?limit=25`, { headers: ghlHeaders(conn, '2021-04-15') });
  if (!res.ok) return 'pending';
  const data = await res.json();
  const msgs: any[] = data.messages?.messages ?? [];
  const m = msgs.find((x) => x.id === messageId || x.altId === messageId);
  if (!m) return 'pending';
  if (m.status === 'failed' || m.error) return 'failed';
  if (['delivered', 'sent', 'read'].includes(m.status)) return 'delivered';
  return 'pending';
}

/** Contact ids per company: the same phone is a different contact in each sub-account. */
const contactIdCache = new Map<string, string>();
const cacheKey = (kind: string, value: string) => `${currentCompanyId() ?? '-'}|${kind}|${value.trim().toLowerCase()}`;

async function upsertContact(fields: Record<string, string>, key: string): Promise<string | null> {
  const cached = contactIdCache.get(key);
  if (cached) return cached;
  try {
    const conn = await ghlConnection();
    const res = await fetchWithTimeout(`${GHL_API_BASE}/contacts/upsert`, {
      method: 'POST',
      headers: ghlHeaders(conn, '2021-07-28'),
      body: JSON.stringify({ locationId: conn.locationId, ...fields }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const id = data.contact?.id ?? null;
    if (id) contactIdCache.set(key, id);
    return id;
  } catch (e: any) {
    // Callers treat null as "use a fallback"; log so an outage is visible.
    console.error('[ghl] upsertContact failed:', e?.message || e);
    return null;
  }
}

/** Find (or create) the company's GHL contact for a phone number. */
export function upsertContactByPhone(name: string, phone: string): Promise<string | null> {
  return upsertContact({ name, phone }, cacheKey('phone', phone));
}

/** Find (or create) the company's GHL contact for an email address. */
export function upsertContactByEmail(name: string, email: string): Promise<string | null> {
  return upsertContact({ ...(name ? { name } : {}), email }, cacheKey('email', email));
}

export async function getConversationContactId(conversationId: string): Promise<string | null> {
  try {
    const conn = await ghlConnection();
    const res = await fetchWithTimeout(`${GHL_API_BASE}/conversations/${conversationId}`, { headers: ghlHeaders(conn, '2021-04-15') });
    if (!res.ok) return null;
    const data = await res.json();
    return data.conversation?.contactId ?? data.contactId ?? null;
  } catch (e: any) {
    console.error('[ghl] getConversationContactId failed:', e?.message || e);
    return null;
  }
}

export async function getConversationIdByContact(contactId: string): Promise<string | null> {
  try {
    const conn = await ghlConnection();
    const params = new URLSearchParams({ locationId: conn.locationId, contactId, limit: '1' });
    const res = await fetchWithTimeout(`${GHL_API_BASE}/conversations/search?${params}`, { headers: ghlHeaders(conn, '2021-04-15') });
    if (!res.ok) return null;
    const data = await res.json();
    return data.conversations?.[0]?.id ?? null;
  } catch (e: any) {
    console.error('[ghl] getConversationIdByContact failed:', e?.message || e);
    return null;
  }
}

/** Forget cached contact ids (tests). */
export function clearGhlContactCache(): void {
  contactIdCache.clear();
}
