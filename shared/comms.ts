/**
 * Turning a provider's message record into one of our call or message rows.
 *
 * Kept pure and shared so the same rules apply whether a row arrives from the
 * GoHighLevel mirror today or from a Twilio webhook after the cutover. The two
 * providers agree on the one field that matters — GHL's `altId` on a call is
 * the Twilio Call SID — so a call mirrored from GHL and the same call seen
 * later from Twilio collapse onto one row instead of doubling up.
 */

/** What we store. Deliberately smaller than what either provider sends. */
export interface CallRow {
  provider: 'ghl' | 'twilio';
  providerSid: string | null;
  direction: 'inbound' | 'outbound';
  fromE164: string;
  toE164: string;
  ourNumber: string | null;
  status: string | null;
  startedAt: Date | null;
  endedAt: Date | null;
  durationSeconds: number | null;
  answeredBy: 'human' | 'ai' | null;
  recordingUrl: string | null;
}

export interface MessageRow {
  provider: 'ghl' | 'twilio' | 'gmail';
  providerSid: string | null;
  channel: 'sms' | 'mms' | 'email';
  direction: 'inbound' | 'outbound';
  fromAddr: string;
  toAddr: string;
  ourNumber: string | null;
  subject: string | null;
  body: string | null;
  status: string | null;
  sentAt: Date | null;
}

/** Where an extension starts: "x12", "ext. 12", "extension 12", "#12". */
const EXTENSION = /\s*(?:ext\.?|extension|x|#).*$/i;

/**
 * +1 (704) 368-3951 and 7043683951 are the same number; store one spelling.
 *
 * Null for anything that is not a dialable number. This used to put a `+` in
 * front of whatever digits it found, so "704-555-1234 x12" became
 * +170455512341 and "555-1234" became +5551234 — numbers that do not exist,
 * handed to Twilio and GHL as if they did. Callers must treat null as "no
 * number" and never dial the raw string instead.
 */
export function toE164(raw: unknown): string | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  if (s.includes('@')) return s.toLowerCase(); // an email address, left alone
  const number = s.replace(EXTENSION, '');
  const digits = number.replace(/\D/g, '');
  if (!digits) return null;
  if (number.startsWith('+')) {
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  }
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return null;
}

/**
 * The last ten digits of a number, or '' when it has none. The rule every
 * phone match in the app uses: stored numbers keep whatever punctuation
 * someone typed, providers send E.164, and the last ten digits are what the
 * two agree on.
 */
export function last10Digits(raw: unknown): string {
  return String(raw ?? '').replace(/\D/g, '').slice(-10);
}

/** Which of these two numbers is ours, given the numbers we own. */
export function ourSide(from: string | null, to: string | null, ours: Iterable<string>): string | null {
  const set = new Set([...ours].map((n) => toE164(n)).filter(Boolean) as string[]);
  if (from && set.has(from)) return from;
  if (to && set.has(to)) return to;
  return null;
}

const CALL = /CALL/i;
const SMS = /SMS/i;
const EMAIL = /EMAIL/i;

export function isCall(messageType: unknown): boolean {
  return CALL.test(String(messageType ?? ''));
}

/**
 * A GoHighLevel conversation message. `altId` carries the Twilio Call SID on
 * calls, which is the whole reason the mirror and the cutover can share a
 * table.
 */
export interface GhlMessage {
  id?: string;
  altId?: string;
  direction?: string;
  status?: string;
  messageType?: string;
  type?: string | number;
  from?: string;
  to?: string;
  body?: string;
  subject?: string;
  dateAdded?: string;
  dateUpdated?: string;
  attachments?: unknown[];
  meta?: { call?: { duration?: number; status?: string } };
}

const when = (v: unknown): Date | null => {
  if (!v) return null;
  const d = new Date(String(v));
  return isNaN(d.getTime()) ? null : d;
};

const direction = (v: unknown): 'inbound' | 'outbound' =>
  String(v ?? '').toLowerCase() === 'inbound' ? 'inbound' : 'outbound';

/** A GHL call record → a call row, or null if this message isn't a call. */
export function ghlCallToRow(m: GhlMessage, ours: Iterable<string> = []): CallRow | null {
  if (!isCall(m.messageType ?? m.type)) return null;
  const from = toE164(m.from);
  const to = toE164(m.to);
  if (!from || !to) return null;

  const started = when(m.dateAdded);
  const secs = typeof m.meta?.call?.duration === 'number' ? m.meta.call.duration : null;

  return {
    provider: 'ghl',
    // Prefer the Twilio SID; fall back to GHL's own id so the row is still
    // deduplicated, just on a GHL-shaped key.
    providerSid: m.altId?.startsWith('CA') ? m.altId : (m.id ?? null),
    direction: direction(m.direction),
    fromE164: from,
    toE164: to,
    ourNumber: ourSide(from, to, ours),
    status: m.meta?.call?.status ?? m.status ?? null,
    startedAt: started,
    endedAt: started && secs != null ? new Date(started.getTime() + secs * 1000) : when(m.dateUpdated),
    durationSeconds: secs,
    // GHL does not say, and guessing would put a number on a dashboard that
    // nobody could defend. Filled in by the Twilio path, which does know.
    answeredBy: null,
    recordingUrl: null,
  };
}

/** A GHL text or email → a message row, or null if it's a call. */
export function ghlMessageToRow(m: GhlMessage, ours: Iterable<string> = []): MessageRow | null {
  const t = String(m.messageType ?? m.type ?? '');
  if (isCall(t)) return null;

  const channel: MessageRow['channel'] = EMAIL.test(t)
    ? 'email'
    : (m.attachments?.length ? 'mms' : SMS.test(t) ? 'sms' : 'sms');

  const from = toE164(m.from) ?? String(m.from ?? '');
  const to = toE164(m.to) ?? String(m.to ?? '');
  if (!from && !to) return null;

  return {
    provider: 'ghl',
    providerSid: m.id ?? null,
    channel,
    direction: direction(m.direction),
    fromAddr: from,
    toAddr: to,
    ourNumber: ourSide(toE164(m.from), toE164(m.to), ours),
    subject: m.subject ?? null,
    body: m.body ?? null,
    status: m.status ?? null,
    sentAt: when(m.dateAdded),
  };
}

/**
 * How a call went, from what the provider tells us. Deliberately conservative:
 * anything we can't place stays null rather than being filed as a real outcome,
 * because a wrong outcome on a dashboard is worse than a blank one.
 */
export function callOutcome(row: Pick<CallRow, 'status' | 'durationSeconds' | 'direction'>): string | null {
  const s = String(row.status ?? '').toLowerCase();
  if (s === 'no-answer' || s === 'noanswer') return 'no_answer';
  if (s === 'busy') return 'busy';
  if (s === 'failed' || s === 'canceled' || s === 'cancelled') return 'failed';
  if (s !== 'completed') return null;
  const secs = row.durationSeconds ?? 0;
  // A "completed" call of a few seconds is a pickup-and-hang-up or a
  // voicemail beep, not a conversation. Counting those as connects is how a
  // connect rate ends up flattering.
  if (secs > 0 && secs < 20) return 'no_conversation';
  return secs > 0 ? 'connected' : null;
}

/** The connect rate a dialling day actually produced. */
export function connectStats(rows: Array<Pick<CallRow, 'status' | 'durationSeconds' | 'direction'>>): {
  dials: number; connected: number; talkSeconds: number; connectRate: number;
} {
  const out = rows.filter((r) => r.direction === 'outbound');
  const connected = out.filter((r) => callOutcome(r) === 'connected');
  const talkSeconds = connected.reduce((n, r) => n + (r.durationSeconds ?? 0), 0);
  return {
    dials: out.length,
    connected: connected.length,
    talkSeconds,
    connectRate: out.length ? connected.length / out.length : 0,
  };
}
