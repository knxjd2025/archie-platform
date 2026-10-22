/**
 * Vapi.ai voice assistant tool endpoints.
 * Each route accepts a Vapi tool-calls payload and returns Vapi-shaped results.
 */
import { Router, Request, Response } from 'express';
import { eq } from 'drizzle-orm';
import { GoHighLevelClient, GHLContact } from '../integrations/gohighlevel';
import { JobTreadClient } from '../integrations/jobtread';
import { createAgent, toAgentConfig } from '../agents/base-agent';
import { CEOAgent } from '../agents/ceo-agent';
import { db } from '../db';
import { agents } from '../../shared/schema';
import { voiceGoogleReady, voiceCalendarEvents, voiceUnreadEmail, voiceEmail, voiceMailbox, voiceViewerRepNames } from './vapi-google';
import { timingSafeEqualStr } from '../security-config';
import { rateLimit } from '../lib/rate-limit';
import { fetchWithTimeout } from '../lib/fetch-timeout';
import { toE164, last10Digits } from '../../shared/comms';

// SMS/calls cost real money per send — bound abuse (e.g. a leaked
// VAPI_SECRET) without getting in the way of normal voice-assistant use.
const outboundLimiter = rateLimit(30, 10 * 60 * 1000);

const router = Router();

interface VapiToolCall {
  id: string;
  type?: string;
  function?: { name?: string; arguments?: string | Record<string, any> };
}

interface ParsedVapi {
  toolCallId: string;
  args: Record<string, any>;
}

const EASTERN_TZ = 'America/New_York';

const AGENT_ROLE_ALIASES: Record<string, string> = {
  alex: 'ceo',
  ceo: 'ceo',
  chiefexecutiveofficer: 'ceo',
  morgan: 'cfo',
  cfo: 'cfo',
  finance: 'cfo',
  accountant: 'cpa',
  cpa: 'cpa',
  bookkeeper: 'cpa',
  marketing: 'cmo',
  jordan: 'cmo',
  cmo: 'cmo',
  tax: 'tax_accountant',
  taxaccountant: 'tax_accountant',
  taxlawyer: 'tax_lawyer',
  taxattorney: 'tax_lawyer',
  lawyer: 'tax_lawyer',
};

function normalizeWhitespace(value: string): string {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeSearchText(value: string): string {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/[^\w\s@.+-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function parseJsonObject(raw: unknown): Record<string, any> {
  if (!raw) return {};
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed as Record<string, any> : {};
    } catch {
      return {};
    }
  }
  return raw && typeof raw === 'object' ? raw as Record<string, any> : {};
}

function parseVapi(req: Request): ParsedVapi {
  const body = req.body || {};
  const message = body.message || body || {};
  const calls: VapiToolCall[] =
    message.toolCallList ||
    message.toolCalls ||
    body.toolCallList ||
    body.toolCalls ||
    [];
  const call = calls[0] || ({} as VapiToolCall);
  const toolCallId = call.id || '';
  const args = parseJsonObject(
    call.function?.arguments ||
    message.function?.arguments ||
    body.arguments
  );
  return { toolCallId: toolCallId || 'tool-call', args };
}

function reply(res: Response, toolCallId: string, result: string) {
  res.json({ results: [{ toolCallId, result }] });
}

function argString(args: Record<string, any>, ...keys: string[]): string {
  for (const key of keys) {
    const value = args?.[key];
    if (typeof value === 'string' && normalizeWhitespace(value)) {
      return normalizeWhitespace(value);
    }
  }
  return '';
}

function argNumber(args: Record<string, any>, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const value = Number(args?.[key]);
    if (Number.isFinite(value)) return value;
  }
  return undefined;
}

function argBoolean(args: Record<string, any>, ...keys: string[]): boolean {
  for (const key of keys) {
    const value = args?.[key];
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      const normalized = normalizeSearchText(value);
      if (['true', 'yes', '1'].includes(normalized)) return true;
      if (['false', 'no', '0'].includes(normalized)) return false;
    }
  }
  return false;
}

function compactAddress(address?: string): string {
  return normalizeWhitespace(
    String(address || '')
      .replace(/,\s*USA$/i, '')
      .replace(/,\s*[A-Z]{2}\s+\d{5}(-\d{4})?\s*$/i, '')
  );
}

function humanizeStatus(status?: string): string {
  return normalizeWhitespace(String(status || '').replace(/_/g, ' ')) || 'unknown';
}

function joinNatural(items: string[], conjunction: 'and' | 'or' = 'and'): string {
  const clean = items.map(item => normalizeWhitespace(item)).filter(Boolean);
  if (clean.length === 0) return '';
  if (clean.length === 1) return clean[0];
  if (clean.length === 2) return `${clean[0]} ${conjunction} ${clean[1]}`;
  return `${clean.slice(0, -1).join(', ')}, ${conjunction} ${clean[clean.length - 1]}`;
}

function summarizeItems(items: string[], maxShown: number): string {
  const clean = items.map(item => normalizeWhitespace(item)).filter(Boolean);
  if (clean.length <= maxShown) return joinNatural(clean);
  return `${joinNatural(clean.slice(0, maxShown))}, and ${clean.length - maxShown} more`;
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(amount || 0);
}

function formatPercent(value: number): string {
  return `${Math.round((value || 0) * 100)}%`;
}

function formatDelta(current: number, previous: number, valueFormatter: (value: number) => string): string {
  const delta = current - previous;
  if (!delta) return 'flat versus the prior period';
  const direction = delta > 0 ? 'up' : 'down';
  return `${direction} ${valueFormatter(Math.abs(delta))} versus the prior period`;
}

function formatDateForSpeech(iso?: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: EASTERN_TZ,
  });
}

function parseDateOnly(value?: string): Date | null {
  if (!value) return null;
  const trimmed = normalizeWhitespace(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  const date = new Date(`${trimmed}T12:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function resolveCalendarWindow(args: Record<string, any>): { start: Date; end: Date; label: string } {
  const requestedDay = normalizeSearchText(argString(args, 'day', 'date', 'when'));
  const nowInTz = new Date(new Date().toLocaleString('en-US', { timeZone: EASTERN_TZ }));
  const target = new Date(nowInTz);

  if (requestedDay === 'tomorrow') {
    target.setDate(target.getDate() + 1);
  } else if (requestedDay && requestedDay !== 'today') {
    const parsed = parseDateOnly(requestedDay);
    if (parsed) {
      target.setFullYear(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
    }
  }

  const start = new Date(target);
  start.setHours(0, 0, 0, 0);
  const end = new Date(target);
  end.setHours(23, 59, 59, 999);

  const today = new Date(nowInTz);
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const label =
    start.getTime() === today.getTime()
      ? 'today'
      : start.getTime() === tomorrow.getTime()
        ? 'tomorrow'
        : start.toLocaleDateString('en-US', {
            weekday: 'long',
            month: 'short',
            day: 'numeric',
            timeZone: EASTERN_TZ,
          });

  return { start, end, label };
}

function resolveLeadWindow(args: Record<string, any>): {
  period?: 'month' | 'year';
  startDate?: string;
  endDate?: string;
  compare: boolean;
} {
  const explicitPeriod = normalizeSearchText(argString(args, 'period', 'timeframe', 'range'));
  const text = normalizeSearchText(
    `${argString(args, 'question', 'query', 'request', 'prompt')} ${explicitPeriod}`
  );
  const startDate = argString(args, 'startDate', 'start_date');
  const endDate = argString(args, 'endDate', 'end_date');
  const compare =
    argBoolean(args, 'compare', 'includeComparison') ||
    /\b(compare|versus|vs|trend|change|month over month|mom|year over year|yoy)\b/.test(text);

  if (startDate || endDate) {
    return { startDate, endDate, compare };
  }
  if (/\b(last 90 days|past 90 days|previous 90 days)\b/.test(text)) {
    const now = new Date();
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - 89);
    return {
      startDate: start.toISOString().slice(0, 10),
      endDate: end.toISOString().slice(0, 10),
      compare,
    };
  }
  if (/\b(last 30 days|past 30 days|previous 30 days)\b/.test(text)) {
    const now = new Date();
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - 29);
    return {
      startDate: start.toISOString().slice(0, 10),
      endDate: end.toISOString().slice(0, 10),
      compare,
    };
  }
  if (/\blast year\b/.test(text)) {
    const now = new Date();
    const start = `${now.getUTCFullYear() - 1}-01-01`;
    const end = `${now.getUTCFullYear() - 1}-12-31`;
    return { startDate: start, endDate: end, compare };
  }
  if (/\blast month\b/.test(text)) {
    const now = new Date();
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
    return {
      startDate: start.toISOString().slice(0, 10),
      endDate: end.toISOString().slice(0, 10),
      compare,
    };
  }
  if (explicitPeriod === 'year' || /\b(ytd|year|year to date|this year)\b/.test(text)) {
    return { period: 'year', compare };
  }
  return { period: 'month', compare };
}

function buildPreviousLeadWindow(startDate: string, endDate: string): { startDate: string; endDate: string } {
  const start = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T23:59:59.999Z`);
  const duration = end.getTime() - start.getTime();
  const previousEnd = new Date(start.getTime() - 1);
  const previousStart = new Date(previousEnd.getTime() - duration);
  return {
    startDate: previousStart.toISOString().slice(0, 10),
    endDate: previousEnd.toISOString().slice(0, 10),
  };
}

function inferJobStatusFilter(args: Record<string, any>, rawQuery: string): string | undefined {
  const explicit = normalizeSearchText(argString(args, 'status'));
  if (explicit) return explicit;

  const query = normalizeSearchText(rawQuery);
  const candidates = ['open', 'active', 'approved', 'paid', 'closed', 'won', 'completed'];
  return candidates.find(candidate => new RegExp(`\\b${candidate}\\b`).test(query));
}

function simplifyJobLookupQuery(rawQuery: string, statusFilter?: string): string {
  let query = normalizeSearchText(rawQuery);
  const boilerplate = [
    'look up',
    'lookup',
    'find',
    'search',
    'show me',
    'tell me',
    'do we have',
    'what jobs do we have',
    'what jobs are',
    'what is',
    'what are',
    'give me',
    'jobs',
    'job',
    'status',
    'for',
    'the',
    'our',
    'all',
    'any',
  ];
  for (const phrase of boilerplate) {
    query = query.replace(new RegExp(`\\b${phrase}\\b`, 'g'), ' ');
  }
  if (statusFilter) {
    query = query.replace(new RegExp(`\\b${statusFilter}\\b`, 'g'), ' ');
  }
  return normalizeWhitespace(query);
}

function getContactDisplayName(contact: Partial<GHLContact>): string {
  return (
    normalizeWhitespace(`${contact.firstName || ''} ${contact.lastName || ''}`) ||
    normalizeWhitespace(String(contact.email || contact.phone || ''))
  );
}

function scoreContactMatch(contact: GHLContact, input: string, type: 'phone' | 'email'): number {
  const query = normalizeSearchText(input);
  const digits = input.replace(/\D/g, '');
  const name = normalizeSearchText(getContactDisplayName(contact));
  const email = normalizeSearchText(contact.email || '');
  const phoneDigits = String(contact.phone || '').replace(/\D/g, '');
  let score = 0;

  if (type === 'phone' && !phoneDigits) return -1000;
  if (type === 'email' && !email) return -1000;

  if (name && name === query) score += 120;
  if (name && query && name.includes(query)) score += 80;
  if (email && query && email === query) score += 120;
  if (email && query && email.includes(query)) score += 70;
  if (phoneDigits && digits && phoneDigits.endsWith(digits)) score += digits.length >= 7 ? 100 : 50;
  if (contact.firstName && query && normalizeSearchText(contact.firstName).startsWith(query)) score += 30;
  if (contact.lastName && query && normalizeSearchText(contact.lastName).startsWith(query)) score += 30;

  return score;
}

function deriveAgentRole(args: Record<string, any>): string {
  const explicit = normalizeSearchText(argString(args, 'role', 'agent')).replace(/\s+/g, '');
  if (explicit && AGENT_ROLE_ALIASES[explicit]) return AGENT_ROLE_ALIASES[explicit];

  const question = normalizeSearchText(argString(args, 'question', 'message', 'query'));
  const heuristicMatches: Array<[RegExp, string]> = [
    [/\b(cash flow|revenue|profit|finance|financial|margin|budget)\b/, 'cfo'],
    [/\b(marketing|leads|ads|campaign|seo|ppc)\b/, 'cmo'],
    [/\b(bookkeeping|books|reconcile|quickbooks|journal)\b/, 'cpa'],
    [/\b(tax|irs|deduction|filing)\b/, 'tax_accountant'],
    [/\b(lawsuit|legal|attorney|lawyer|liability)\b/, 'tax_lawyer'],
  ];
  for (const [pattern, role] of heuristicMatches) {
    if (pattern.test(question)) return role;
  }
  return explicit || 'ceo';
}

function escapeHtml(value: string): string {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderEmailHtml(body: string): string {
  return String(body || '')
    .split(/\n{2,}/)
    .map(block => `<p>${escapeHtml(block).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

function deriveEmailSubject(explicitSubject: string, body: string, purpose?: string): string {
  if (normalizeWhitespace(explicitSubject)) return normalizeWhitespace(explicitSubject);
  const seed = normalizeWhitespace(purpose || body.split(/\r?\n|\.\s|!\s|\?\s/)[0] || '');
  if (!seed) return 'Quick note';
  return seed.length > 72 ? `${seed.slice(0, 69)}...` : seed;
}

type JobReplyFocus = 'overview' | 'status' | 'value' | 'closed_date';

function inferJobReplyFocus(args: Record<string, any>, rawQuery: string): JobReplyFocus {
  const text = normalizeSearchText(
    `${rawQuery} ${argString(args, 'question', 'prompt', 'request', 'focus')}`
  );
  if (/\b(when did|closed on|close date|sold on|when was.*closed)\b/.test(text)) {
    return 'closed_date';
  }
  if (/\b(how much|price|value|amount|dollar|revenue|worth)\b/.test(text)) {
    return 'value';
  }
  if (/\b(status|where is it at|stage|approved|paid|closed|pending|open)\b/.test(text)) {
    return 'status';
  }
  return 'overview';
}

type LeadKpiFocus =
  | 'overview'
  | 'count'
  | 'open'
  | 'won'
  | 'win_rate'
  | 'projected'
  | 'sold'
  | 'paid'
  | 'average'
  | 'status_mix'
  | 'recent_leads';

function inferLeadKpiFocus(args: Record<string, any>): LeadKpiFocus {
  const text = normalizeSearchText(
    `${argString(args, 'question', 'query', 'request', 'prompt', 'focus')} ${argString(args, 'period', 'timeframe', 'range')}`
  );
  if (/\b(all leads|show .*leads|list .*leads|which leads|who are the leads|recent leads)\b/.test(text)) {
    return 'recent_leads';
  }
  if (/\b(win rate|close rate|conversion)\b/.test(text)) return 'win_rate';
  if (/\b(open leads|still open|open count)\b/.test(text)) return 'open';
  if (/\b(won leads|sold leads|closed leads)\b/.test(text)) return 'won';
  if (/\b(approved value|sold value|closed value|won value)\b/.test(text)) return 'sold';
  if (/\b(paid value|paid amount|cash in|collected)\b/.test(text)) return 'paid';
  if (/\b(average|avg)\b/.test(text)) return 'average';
  if (/\b(status mix|status breakdown|breakdown|by status|mix)\b/.test(text)) return 'status_mix';
  if (/\b(how many|lead count|number of leads|count)\b/.test(text)) return 'count';
  if (/\b(dollar|amount|value|revenue|pipeline|projected)\b/.test(text)) return 'projected';
  return 'overview';
}

function wantsExpandedLeadList(args: Record<string, any>): boolean {
  const text = normalizeSearchText(
    `${argString(args, 'question', 'query', 'request', 'prompt')} ${argString(args, 'period', 'timeframe', 'range')}`
  );
  return /\b(all leads|show .*leads|list .*leads|recent leads|every lead)\b/.test(text);
}

function requireSecret(req: Request, res: Response): boolean {
  const expected = process.env.VAPI_SECRET;
  // Fail closed: an unset secret used to mean "let everyone through," which
  // would leave every /api/vapi/* tool (SMS/email send, outbound calls,
  // financial + KPI reads) open to the internet if this env var were ever
  // deleted or missed in a new environment.
  if (!expected) {
    res.status(503).json({ error: 'VAPI_SECRET is not configured' });
    return false;
  }
  const got = req.header('x-vapi-secret') || req.header('x-vapi-signature');
  if (!got || !timingSafeEqualStr(got, expected)) {
    res.status(401).json({ error: 'invalid secret' });
    return false;
  }
  return true;
}

/**
 * The voice agent reaches Google through the service account's domain-wide
 * delegation, acting as one configured mailbox (VOICE_MAILBOX). There is no
 * per-call "connect" step — this only reports whether the server has the
 * delegation credentials at all.
 */
function ensureGoogleAuth(): boolean {
  return voiceGoogleReady();
}

/** Two candidates scoring within this of each other are too close to pick between. */
const AMBIGUOUS_SCORE_GAP = 20;

export interface PhonePick {
  phone?: string;
  name?: string;
  contactId?: string;
  error?: string;
}

/**
 * Choose which GHL contact a spoken name means, or say it can't be told.
 *
 * This used to take the top score and dial or text it. "Text Mike the
 * signing link" with two Mikes on file sent the link to whichever GHL listed
 * first — a stranger's phone, holding a customer's contract. Two different
 * numbers scoring within AMBIGUOUS_SCORE_GAP, or the same name on two
 * different numbers, now comes back as a question instead.
 */
export function pickPhoneContact(contacts: GHLContact[], input: string): PhonePick {
  const scored = contacts
    .map((contact) => ({ contact, phone: toE164(contact.phone), score: scoreContactMatch(contact, input, 'phone') }))
    .filter((c): c is { contact: GHLContact; phone: string; score: number } => !!c.phone && c.score > 0)
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  if (!best) return { error: `I couldn't find a phone number for "${input}" in GoHighLevel.` };

  const bestName = normalizeSearchText(getContactDisplayName(best.contact));
  const rivals = scored.slice(1).filter((c) =>
    last10Digits(c.phone) !== last10Digits(best.phone) &&
    (best.score - c.score < AMBIGUOUS_SCORE_GAP ||
      (bestName !== '' && normalizeSearchText(getContactDisplayName(c.contact)) === bestName)),
  );
  if (rivals.length) {
    const options = [best, ...rivals].slice(0, 3).map((c) => {
      const name = getContactDisplayName(c.contact) || 'a contact';
      return `${name} ending in ${last10Digits(c.phone).slice(-4)}`;
    });
    return { error: `I found more than one match for "${input}": ${joinNatural(options, 'or')}. Which one did you mean?` };
  }

  return {
    phone: best.phone,
    name: getContactDisplayName(best.contact) || best.phone,
    contactId: best.contact.id,
  };
}

/**
 * Resolve a user-supplied recipient string to an E.164 phone number.
 * Accepts either a phone number (any format) or a contact name to look up in GHL.
 */
async function resolvePhone(input: string): Promise<PhonePick> {
  const s = normalizeWhitespace(input);
  const digits = s.replace(/[^\d+]/g, '');
  if (digits.length >= 10) {
    const phone = toE164(s);
    if (!phone || phone.includes('@')) return { error: `"${input}" doesn't look like a phone number I can use.` };
    return { phone, name: input };
  }

  const ghl = new GoHighLevelClient();
  try {
    const result = await ghl.getContacts({ query: s, limit: 6 });
    return pickPhoneContact(result?.contacts || [], s);
  } catch (err: any) {
    console.error('[vapi] resolvePhone GHL error', err);
    return { error: `I couldn't look up "${input}" right now.` };
  }
}

/**
 * Resolve a user-supplied recipient string to an email address.
 * Accepts either an email (detected by @) or a contact name to look up in GHL.
 */
async function resolveEmail(input: string): Promise<{ email?: string; name?: string; error?: string }> {
  const s = normalizeWhitespace(input);
  if (s.includes('@')) {
    return { email: s, name: s };
  }

  const ghl = new GoHighLevelClient();
  try {
    const result = await ghl.getContacts({ query: s, limit: 6 });
    const best = (result?.contacts || [])
      .sort((a, b) => scoreContactMatch(b, s, 'email') - scoreContactMatch(a, s, 'email'))
      .find(contact => contact?.email);
    if (!best?.email) {
      return { error: `I couldn't find an email address for "${input}" in GoHighLevel.` };
    }
    return { email: best.email, name: getContactDisplayName(best) || best.email };
  } catch (err: any) {
    console.error('[vapi] resolveEmail GHL error', err);
    return { error: `I couldn't look up "${input}" right now.` };
  }
}

router.post('/calendar-today', async (req: Request, res: Response) => {
  if (!requireSecret(req, res)) return;
  const { toolCallId, args } = parseVapi(req);
  try {
    if (!ensureGoogleAuth()) {
      return reply(res, toolCallId, "Google Calendar isn't connected yet. Hook it back up in the dashboard first.");
    }
    const { start, end, label } = resolveCalendarWindow(args);

    const events = await voiceCalendarEvents(start, end);

    if (events.length === 0) {
      return reply(res, toolCallId, `Your calendar is clear ${label}.`);
    }

    const fmt = (iso: string) =>
      new Date(iso).toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        timeZone: EASTERN_TZ,
      });

    const lines = events.slice(0, 4).map(e => {
      const timeLabel = e.start?.includes('T') ? fmt(e.start) : 'all day';
      const location = e.location ? ` at ${e.location}` : '';
      return `${timeLabel} ${e.summary}${location}`;
    });

    const n = events.length;
    if (n === 1) {
      return reply(res, toolCallId, `You have one thing ${label}: ${lines[0]}.`);
    }
    return reply(
      res,
      toolCallId,
      `You have ${n} events ${label}. ${summarizeItems(lines, 4)}.`
    );
  } catch (err: any) {
    console.error('[vapi] calendar-today error', err);
    return reply(res, toolCallId, 'I had trouble reading your calendar. Try again in a moment.');
  }
});

router.post('/recent-email', async (req: Request, res: Response) => {
  if (!requireSecret(req, res)) return;
  const { toolCallId, args } = parseVapi(req);
  const limit = clamp(argNumber(args, 'limit') || 5, 1, 10);
  const senderFilter = argString(args, 'from', 'sender');
  const searchFilter = argString(args, 'query', 'search');

  try {
    if (!ensureGoogleAuth()) {
      return reply(res, toolCallId, "Gmail isn't connected yet, so I can't check it from here.");
    }
    const gmailQuery = [
      'is:unread',
      senderFilter ? `from:${senderFilter}` : '',
      searchFilter,
    ]
      .filter(Boolean)
      .join(' ');

    const messages = await voiceUnreadEmail(gmailQuery, limit);
    if (!messages.length) {
      const filterLabel = senderFilter || searchFilter;
      return reply(
        res,
        toolCallId,
        filterLabel ? `Nothing unread matched ${filterLabel} right now.` : "You don't have any unread email right now."
      );
    }

    const summaries = messages.map((m) =>
      m.snippet ? `${m.fromName} about ${m.subject}: ${m.snippet}` : `${m.fromName} about ${m.subject}`
    );

    const n = summaries.length;
    if (n === 1) {
      return reply(res, toolCallId, `You have one unread email. ${summaries[0]}.`);
    }
    return reply(
      res,
      toolCallId,
      `You have ${n} unread emails. ${summarizeItems(summaries, 3)}.`
    );
  } catch (err: any) {
    console.error('[vapi] recent-email error', err);
    return reply(res, toolCallId, 'I had trouble reading your email.');
  }
});

router.post('/lookup-job', async (req: Request, res: Response) => {
  if (!requireSecret(req, res)) return;
  const { toolCallId, args } = parseVapi(req);
  const rawQuery = argString(args, 'query', 'name', 'job_name', 'job', 'customer', 'address');
  const statusFilter = inferJobStatusFilter(args, rawQuery);
  const replyFocus = inferJobReplyFocus(args, rawQuery);
  const query = simplifyJobLookupQuery(rawQuery, statusFilter);
  const limit = clamp(argNumber(args, 'limit') || 5, 1, 8);
  const showValues =
    argBoolean(args, 'include_values', 'show_values') ||
    replyFocus === 'value' ||
    /\b(value|amount|price|revenue|dollar)\b/.test(normalizeSearchText(rawQuery));

  try {
    const jt = new JobTreadClient();
    const matches = await jt.searchJobs(query, limit, { status: statusFilter });

    if (matches.length === 0) {
      const label = rawQuery || statusFilter || 'that';
      return reply(res, toolCallId, `I couldn't find any jobs matching ${label}.`);
    }

    if (matches.length === 1) {
      const job = matches[0];
      const customer = job.customerName || 'unknown customer';
      const address = compactAddress(job.address);
      const amountText = job.projectedPriceWithTax > 0 ? formatCurrency(job.projectedPriceWithTax) : '';
      if (replyFocus === 'closed_date') {
        if (job.closedOn) {
          return reply(
            res,
            toolCallId,
            `${job.name} for ${customer} closed on ${formatDateForSpeech(job.closedOn)}.`
          );
        }
        return reply(
          res,
          toolCallId,
          `${job.name} for ${customer} isn't marked closed yet. It's ${humanizeStatus(job.status)}.`
        );
      }
      if (replyFocus === 'value' && amountText) {
        return reply(
          res,
          toolCallId,
          `${job.name} for ${customer}${address ? ` at ${address}` : ''} is sitting at about ${amountText}. It's ${humanizeStatus(job.status)}.`
        );
      }
      if (replyFocus === 'status') {
        const amount = showValues && amountText ? ` at about ${amountText}` : '';
        return reply(
          res,
          toolCallId,
          `${job.name} for ${customer}${address ? ` at ${address}` : ''} is ${humanizeStatus(job.status)}${amount}.`
        );
      }
      return reply(
        res,
        toolCallId,
        `${job.name} for ${customer}${address ? ` at ${address}` : ''} is ${humanizeStatus(job.status)}${amountText && showValues ? ` at about ${amountText}` : ''}.`
      );
    }

    const lines = matches.slice(0, 4).map(j => {
      const customer = j.customerName || 'unknown customer';
      const address = compactAddress(j.address);
      const amount =
        showValues && j.projectedPriceWithTax > 0
          ? ` at about ${formatCurrency(j.projectedPriceWithTax)}`
          : '';
      return `${j.name} for ${customer}${address ? ` at ${address}` : ''}, ${humanizeStatus(j.status)}${amount}`;
    });

    const n = matches.length;
    const intro = statusFilter && !query
      ? `Here are the ${n} most recent ${statusFilter} jobs I found`
      : `I found ${n} matching jobs`;
    return reply(res, toolCallId, `${intro}: ${summarizeItems(lines, 4)}.`);
  } catch (err: any) {
    console.error('[vapi] lookup-job error', err);
    return reply(res, toolCallId, 'I had trouble looking up jobs right now.');
  }
});

router.post('/jt-lead-kpis', async (req: Request, res: Response) => {
  if (!requireSecret(req, res)) return;
  const { toolCallId, args } = parseVapi(req);
  const focus = inferLeadKpiFocus(args);
  const defaultLimit = wantsExpandedLeadList(args) ? 8 : 5;
  const limit = clamp(argNumber(args, 'limit') || defaultLimit, 1, 10);
  const leadWindow = resolveLeadWindow(args);

  try {
    const jt = new JobTreadClient();
    const kpis = await jt.getLeadKpis({
      period: leadWindow.period,
      startDate: leadWindow.startDate,
      endDate: leadWindow.endDate,
      limit,
    });
    const statusBits = Object.entries(kpis.byStatus)
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 3)
      .map(([status, data]) => `${data.count} ${humanizeStatus(status)}`)
      .join(', ');

    const recentBits = kpis.recentLeads
      .slice(0, Math.min(limit, focus === 'recent_leads' ? 6 : 2))
      .map(lead => {
        const customer = lead.customerName || lead.name || 'unknown customer';
        const address = compactAddress(lead.address);
        return `${customer}${address ? ` at ${address}` : ''}, ${humanizeStatus(lead.status)}`;
      })
      .join('. ');

    const focusSummary: Record<LeadKpiFocus, string[]> = {
      overview: [
        `${kpis.period.label} shows ${kpis.totals.leads} leads.`,
        `${kpis.totals.open} are still open and ${kpis.totals.won} are won, so win rate is ${formatPercent(kpis.rates.winRate)}.`,
        `Projected value is ${formatCurrency(kpis.values.totalProjected)}, with ${formatCurrency(kpis.values.wonProjected)} approved, paid, or closed and ${formatCurrency(kpis.values.paidProjected)} already paid.`,
        kpis.values.averageProjected > 0
          ? `Average priced lead value is ${formatCurrency(kpis.values.averageProjected)}.`
          : '',
        statusBits ? `Status mix: ${statusBits}.` : '',
        recentBits ? `Most recent leads: ${recentBits}.` : '',
      ],
      count: [
        `${kpis.period.label} has ${kpis.totals.leads} leads.`,
        `${kpis.totals.open} are still open and ${kpis.totals.won} are won.`,
        recentBits ? `Most recent leads: ${recentBits}.` : '',
      ],
      open: [
        `${kpis.period.label}, ${kpis.totals.open} leads are still open.`,
        statusBits ? `Status mix: ${statusBits}.` : '',
        recentBits ? `Most recent leads: ${recentBits}.` : '',
      ],
      won: [
        `${kpis.period.label}, ${kpis.totals.won} leads are won.`,
        `Sold value is ${formatCurrency(kpis.values.wonProjected)}.`,
      ],
      win_rate: [
        `${kpis.period.label}, win rate is ${formatPercent(kpis.rates.winRate)}.`,
        `That's ${kpis.totals.won} won out of ${kpis.totals.leads} total leads.`,
      ],
      projected: [
        `${kpis.period.label}, projected value is ${formatCurrency(kpis.values.totalProjected)}.`,
        `${formatCurrency(kpis.values.wonProjected)} is already approved, paid, or closed, and ${formatCurrency(kpis.values.paidProjected)} is already paid.`,
      ],
      sold: [
        `${kpis.period.label}, approved, paid, or closed value is ${formatCurrency(kpis.values.wonProjected)}.`,
        `That's across ${kpis.totals.won} won leads.`,
      ],
      paid: [
        `${kpis.period.label}, paid value is ${formatCurrency(kpis.values.paidProjected)}.`,
        `That's across ${kpis.totals.paid} paid leads.`,
      ],
      average: [
        `${kpis.period.label}, average priced lead value is ${formatCurrency(kpis.values.averageProjected)}.`,
        kpis.values.averageWonProjected > 0
          ? `Average won lead value is ${formatCurrency(kpis.values.averageWonProjected)}.`
          : '',
      ],
      status_mix: [
        `${kpis.period.label}, the status mix is ${statusBits || 'not available'}.`,
        `${kpis.totals.leads} total leads, with ${kpis.totals.open} still open.`,
      ],
      recent_leads: [
        `${kpis.period.label} has ${kpis.totals.leads} leads.`,
        recentBits ? `Most recent leads: ${recentBits}.` : '',
        statusBits ? `Status mix: ${statusBits}.` : '',
      ],
    };

    const summaryParts = focusSummary[focus].filter(Boolean);

    if (leadWindow.compare) {
      const previousWindow = buildPreviousLeadWindow(
        kpis.period.startDate.slice(0, 10),
        kpis.period.endDate.slice(0, 10)
      );
      const previous = await jt.getLeadKpis({
        startDate: previousWindow.startDate,
        endDate: previousWindow.endDate,
        limit: 1,
      });
      summaryParts.push(
        `Versus the prior period, lead count is ${formatDelta(kpis.totals.leads, previous.totals.leads, value => `${value}`)} and sold value is ${formatDelta(kpis.values.wonProjected, previous.values.wonProjected, formatCurrency)}.`
      );
    }

    return reply(res, toolCallId, summaryParts.join(' '));
  } catch (err: any) {
    console.error('[vapi] jt-lead-kpis error', err);
    return reply(res, toolCallId, 'I had trouble pulling JobTread lead KPIs right now.');
  }
});

router.post('/ceo-briefing', async (req: Request, res: Response) => {
  if (!requireSecret(req, res)) return;
  const { toolCallId, args } = parseVapi(req);
  const maxLength = normalizeSearchText(argString(args, 'length')) === 'short' ? 350 : 800;
  try {
    const [row] = await db.select().from(agents).where(eq(agents.role, 'ceo'));
    if (!row) return reply(res, toolCallId, 'CEO agent is not configured yet.');
    const ceo = new CEOAgent(toAgentConfig(row));
    const briefing: any = await ceo.generateDailyBriefing();
    const text =
      typeof briefing === 'string'
        ? briefing
        : briefing?.summary || briefing?.text || JSON.stringify(briefing);
    const capped = text.length > maxLength ? text.slice(0, maxLength) + '…' : text;
    return reply(res, toolCallId, capped);
  } catch (err: any) {
    console.error('[vapi] ceo-briefing error', err);
    return reply(res, toolCallId, 'I had trouble pulling the briefing.');
  }
});

router.post('/ask-agent', async (req: Request, res: Response) => {
  if (!requireSecret(req, res)) return;
  const { toolCallId, args } = parseVapi(req);
  const role = deriveAgentRole(args);
  const question = argString(args, 'question', 'message', 'query');
  if (!question) return reply(res, toolCallId, 'What would you like to ask?');

  try {
    // A phone call has no signed-in user, so the voice agent inherits the
    // identity of the mailbox it speaks for (VOICE_MAILBOX). Today that is the
    // owner, so nothing is narrowed — but if it is ever repointed at a rep,
    // its tools scope down automatically instead of staying company-wide.
    const agent = await createAgent(role, { repNames: await voiceViewerRepNames() });
    if (!agent) return reply(res, toolCallId, `I don't have an agent for ${role} yet.`);
    const result: any = await agent.chat(question, []);
    const text = result?.response || 'No response.';
    const capped = text.length > 800 ? text.slice(0, 800) + '…' : text;
    return reply(res, toolCallId, capped);
  } catch (err: any) {
    console.error('[vapi] ask-agent error', err);
    return reply(res, toolCallId, 'I had trouble reaching the team.');
  }
});

// =============================================================================
// OUTBOUND ACTIONS — SMS, email, phone calls
// =============================================================================

router.post('/send-sms', outboundLimiter, async (req: Request, res: Response) => {
  if (!requireSecret(req, res)) return;
  const { toolCallId, args } = parseVapi(req);
  const to = argString(args, 'to', 'recipient', 'name', 'contact', 'phone');
  const message = normalizeWhitespace(argString(args, 'message', 'body', 'text'));

  if (!to) return reply(res, toolCallId, 'Who do you want me to text?');
  if (!message) return reply(res, toolCallId, 'What do you want the text to say?');

  try {
    const resolved = await resolvePhone(to);
    if (resolved.error) return reply(res, toolCallId, resolved.error);

    const ghl = new GoHighLevelClient();
    // The contact we resolved, so GHL texts that person rather than whoever
    // its own phone search turns up first.
    const result = await ghl.sendSms(resolved.phone!, message, resolved.contactId);
    if (!result.success) {
      return reply(res, toolCallId, `I couldn't send the text: ${result.error || 'unknown error'}.`);
    }
    return reply(res, toolCallId, `Done — I sent that text to ${resolved.name}.`);
  } catch (err: any) {
    console.error('[vapi] send-sms error', err);
    return reply(res, toolCallId, 'I had trouble sending the text.');
  }
});

router.post('/send-email', async (req: Request, res: Response) => {
  if (!requireSecret(req, res)) return;
  const { toolCallId, args } = parseVapi(req);
  const to = argString(args, 'to', 'recipient', 'email', 'contact');
  const subject = argString(args, 'subject');
  const purpose = argString(args, 'purpose');
  const body = String(args.body || args.message || args.text || '').trim();
  const cc = argString(args, 'cc');
  // Default behavior is DRAFT. Only send when explicitly requested.
  const sendNow = argBoolean(args, 'send_now', 'send');

  if (!to) return reply(res, toolCallId, 'Who do you want me to email?');
  if (!body) return reply(res, toolCallId, 'What do you want the email to say?');

  try {
    if (!ensureGoogleAuth()) {
      return reply(res, toolCallId, "Gmail isn't connected yet, so I can't draft that from here.");
    }

    const resolved = await resolveEmail(to);
    if (resolved.error) return reply(res, toolCallId, resolved.error);

    const params = {
      to: resolved.email!,
      subject: deriveEmailSubject(subject, body, purpose),
      cc: cc || undefined,
      html: renderEmailHtml(body),
    };

    if (sendNow) {
      await voiceEmail({ ...params, send: true });
      return reply(res, toolCallId, `Done — I sent the email to ${resolved.name} from ${voiceMailbox()}.`);
    }
    await voiceEmail({ ...params, send: false });
    return reply(
      res,
      toolCallId,
      `I drafted that email to ${resolved.name}. It's sitting in ${voiceMailbox()} drafts for a quick review.`
    );
  } catch (err: any) {
    console.error('[vapi] send-email error', err);
    return reply(res, toolCallId, 'I had trouble handling the email.');
  }
});

/** How long a placed call blocks an identical one. */
const CALL_DEDUPE_MS = 2 * 60 * 1000;
const placedCalls = new Map<string, number>();

/** True if this call was placed within the window; otherwise records it now. */
function recentlyPlaced(key: string, now: number = Date.now()): boolean {
  for (const [k, at] of placedCalls) if (now - at > CALL_DEDUPE_MS) placedCalls.delete(k);
  if (placedCalls.has(key)) return true;
  placedCalls.set(key, now);
  return false;
}

/** A call Vapi refused never rang, so it must not block a retry. */
function forgetPlaced(key: string): void {
  placedCalls.delete(key);
}

router.post('/make-call', outboundLimiter, async (req: Request, res: Response) => {
  if (!requireSecret(req, res)) return;
  const { toolCallId, args } = parseVapi(req);
  const to = argString(args, 'to', 'recipient', 'contact', 'name', 'phone');
  const purpose = argString(args, 'purpose', 'reason', 'message', 'context');
  const mode = (normalizeSearchText(argString(args, 'mode')) === 'bridge')
    ? 'bridge'
    : 'conversational';
  const voicemailMessage = argString(args, 'voicemail_message', 'voicemail');

  if (!to) return reply(res, toolCallId, 'Who do you want me to call?');
  if (mode === 'conversational' && !purpose) {
    return reply(res, toolCallId, "What's the quick reason for the call?");
  }

  const apiKey = process.env.VAPI_API_KEY;
  const phoneNumberId = process.env.VAPI_PHONE_NUMBER_ID;
  if (!apiKey || !phoneNumberId) {
    return reply(
      res,
      toolCallId,
      'Outbound calls are not configured. Need VAPI_API_KEY and VAPI_PHONE_NUMBER_ID.'
    );
  }

  try {
    const resolved = await resolvePhone(to);
    if (resolved.error) return reply(res, toolCallId, resolved.error);

    // The assistant sometimes issues the same tool call twice in one turn, and
    // Vapi retries a slow tool response; each of those rang the customer
    // again. Best effort and per instance — it covers the seconds-apart
    // repeats that actually happen, not a deliberate second call later.
    const callKey = `${resolved.phone}|${normalizeSearchText(purpose)}|${mode}`;
    if (recentlyPlaced(callKey)) {
      return reply(res, toolCallId, `I already started a call to ${resolved.name} a moment ago, so I didn't place another.`);
    }

    let body: Record<string, any>;

    if (mode === 'bridge') {
      // A personal cell number belongs in env config, not hardcoded in
      // source — fail closed instead of silently bridging to a fallback
      // number if JAMES_CELL is ever unset.
      const jamesCell = process.env.JAMES_CELL;
      if (!jamesCell) return reply(res, toolCallId, 'Bridge calling is not configured. Need JAMES_CELL.');
      const model =
        process.env.ANTHROPIC_MODEL_VAPI_OUTBOUND ||
        process.env.ANTHROPIC_MODEL ||
        'claude-sonnet-4-20250514';
      body = {
        phoneNumberId,
        customer: { number: resolved.phone },
        assistant: {
          firstMessage: `Hi, this is James Turner's assistant. James wants to connect with you${purpose ? ` about ${purpose}` : ''}. Hold on one second while I bring him in.`,
          model: {
            provider: 'anthropic',
            model,
            messages: [
              {
                role: 'system',
                content:
                  `You are placing an outbound call on James Turner's behalf. As soon as the call is answered, ` +
                  `briefly greet the person, mention James${purpose ? ` is calling about ${purpose}` : ' is calling'}, ` +
                  `and immediately call the transferCall tool. Do not engage in any other conversation first.`,
              },
            ],
          },
          voice: { provider: '11labs', voiceId: 'pNInz6obpgDQGcFmaJgB' },
          transcriber: { provider: 'deepgram', model: 'nova-2' },
          tools: [
            {
              type: 'transferCall',
              destinations: [
                {
                  type: 'number',
                  number: jamesCell,
                  message: 'Connecting you now.',
                },
              ],
            },
          ],
          endCallMessage: 'Goodbye.',
        },
      };
    } else {
      // Conversational: use the existing James's Assistant with context overrides.
      const assistantId = process.env.VAPI_ASSISTANT_ID;
      if (!assistantId) return reply(res, toolCallId, 'Conversational calling is not configured. Need VAPI_ASSISTANT_ID.');
      const systemOverride =
        `You are placing an outbound call to ${resolved.name} on behalf of James Turner, ` +
        `owner of Best Roofing Now. ${purpose ? `Purpose of the call: ${purpose}. ` : ''}` +
        `Be polite, calm, and conversational. Sound human, not scripted. Keep the conversation tight and practical. ` +
        `Match their pace. Don't over-explain. If they answer with a quick yes or no, move the call forward. ` +
        `If they have a simple question you can answer briefly, do it. If they are busy, offer a short callback path. ` +
        `If you reach voicemail, leave a short message and end the call. If it's clearly the wrong person, apologize and end the call.`;

      body = {
        phoneNumberId,
        customer: { number: resolved.phone },
        assistantId,
        assistantOverrides: {
          firstMessage: `Hi, this is James Turner's assistant${purpose ? ` calling for James about ${purpose}` : ''}. Do you have a quick minute?`,
          model: {
            messages: [{ role: 'system', content: systemOverride }],
          },
          voicemailMessage:
            voicemailMessage ||
            `Hi, this is James Turner's assistant${purpose ? ` calling for James about ${purpose}` : ''}. Please give James a call back when you get a chance. Thanks.`,
        },
      };
    }

    const response = await fetchWithTimeout('https://api.vapi.ai/call', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('[vapi] make-call Vapi API error', response.status, errText);
      forgetPlaced(callKey);
      return reply(res, toolCallId, "I had trouble placing that call — Vapi rejected the request.");
    }

    const data: any = await response.json();
    const callId: string = data?.id || '';
    const modeLabel = mode === 'bridge' ? 'and bridging to your cell' : 'for you';
    const shortId = callId ? ` Call ID ${callId.slice(0, 8)}.` : '';
    return reply(res, toolCallId, `Okay — I'm calling ${resolved.name} now ${modeLabel}.${shortId}`);
  } catch (err: any) {
    console.error('[vapi] make-call error', err);
    return reply(res, toolCallId, 'I had trouble setting up the call.');
  }
});

export default router;
