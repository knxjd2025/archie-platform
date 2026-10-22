/**
 * Inbox watch — the pure rules: which window a scan covers, what to ask Gmail
 * for, and how an email is sorted into lead / customer / important / other.
 *
 * Window rule: a scan looks back 72 hours the first time;
 * after that it starts where the last scan stopped, because that time was
 * already looked at. A gap longer than 72 hours is still capped at 72 hours.
 */

export const LOOKBACK_HOURS = 72;

export type InboxCategory = 'lead' | 'customer' | 'important' | 'other';

export interface ScanWindow { from: Date; to: Date; firstScan: boolean }

export function scanWindow(now: Date, lastScanTo: Date | null): ScanWindow {
  const floor = new Date(now.getTime() - LOOKBACK_HOURS * 3600 * 1000);
  if (!lastScanTo || Number.isNaN(lastScanTo.getTime())) return { from: floor, to: now, firstScan: true };
  const from = lastScanTo > floor ? lastScanTo : floor;
  return { from: from < now ? from : now, to: now, firstScan: false };
}

/**
 * Where a scan may say it reached. Gmail lists newest first, and a scan reads
 * at most a capped number of messages; it used to read the NEWEST ones and
 * record the window as done up to now, so whatever was older than them was
 * never read by any scan. The scan now reads the OLDEST it can and, when it
 * was capped, records only as far as the newest message it actually read
 * (less a second: Gmail's `after:` is whole seconds, and a re-read message is
 * skipped as already stored) — the next scan carries on from there.
 */
export function scanReachedTo(w: ScanWindow, readAt: Date[], capped: boolean): Date {
  if (!capped || readAt.length === 0) return w.to;
  const newest = Math.max(...readAt.map((d) => d.getTime()));
  const reached = new Date(newest - 1000);
  return reached > w.from ? reached : w.from;
}

/** Gmail search: inbox mail newer than the window start, and older than
 *  `before` when given (Gmail's `after:`/`before:` are whole seconds). */
export function gmailQuery(from: Date, before?: Date): string {
  const epoch = Math.floor(from.getTime() / 1000);
  const upper = before ? ` before:${Math.ceil(before.getTime() / 1000)}` : '';
  return `in:inbox -category:promotions -category:social -category:forums after:${epoch}${upper}`;
}

/** A scan lists its window this many hours at a time, oldest slice first. */
export const SCAN_CHUNK_HOURS = 6;
/** A slice is halved while it holds more than one listing can return, down to this. */
const MIN_CHUNK_MS = 60_000;

export interface WindowReader<T> {
  /** Message ids in [from, before), newest first as Gmail lists them, and
   *  whether more were left unlisted. */
  list(from: Date, before: Date): Promise<{ ids: string[]; truncated: boolean }>;
  read(id: string): Promise<T>;
}

/**
 * Read a scan window oldest first, at most `maxRead` messages, and say how
 * far it got. One listing of the whole window used to stop at 2,000 ids —
 * the NEWEST 2,000, since Gmail lists newest first — so on a busy window the
 * oldest mail was never listed, and the scan still recorded the window as done
 * past it. The window is now listed a slice at a time with an explicit
 * `before:`, a slice too full for one listing is halved, and the scan stops at
 * the end of the last slice it read whole, or (capped part-way through a slice)
 * at the newest message it read there.
 */
export async function readWindowOldestFirst<T extends { receivedAt: Date }>(
  w: ScanWindow,
  io: WindowReader<T>,
  opts: { maxRead: number; chunkMs?: number },
): Promise<{ items: T[]; reachedTo: Date }> {
  const chunkMs = opts.chunkMs ?? SCAN_CHUNK_HOURS * 3600 * 1000;
  const items: T[] = [];
  const seen = new Set<string>();
  let start = w.from;
  while (start < w.to) {
    if (items.length >= opts.maxRead) return { items, reachedTo: start };
    let end = new Date(Math.min(start.getTime() + chunkMs, w.to.getTime()));
    let listed = await io.list(start, end);
    while (listed.truncated && end.getTime() - start.getTime() > MIN_CHUNK_MS) {
      end = new Date(start.getTime() + Math.max(MIN_CHUNK_MS, Math.floor((end.getTime() - start.getTime()) / 2)));
      listed = await io.list(start, end);
    }
    // Slices overlap by up to a second (whole-second bounds): skip repeats.
    const ids = [...listed.ids].reverse().filter((id) => !seen.has(id));
    const take = ids.slice(0, opts.maxRead - items.length);
    const read: T[] = [];
    for (const id of take) {
      seen.add(id);
      const item = await io.read(id);
      items.push(item);
      read.push(item);
    }
    if (take.length < ids.length || listed.truncated) {
      return { items, reachedTo: scanReachedTo({ from: start, to: end, firstScan: false }, read.map((m) => m.receivedAt), true) };
    }
    start = end;
  }
  return { items, reachedTo: w.to };
}

export interface InboxMessage {
  messageId: string; threadId: string;
  fromName: string; fromEmail: string; subject: string; snippet: string;
  receivedAt: Date; labelIds: string[];
}

export function parseFrom(raw: string): { name: string; email: string } {
  const m = raw.match(/<([^>]+)>/);
  const email = (m ? m[1] : raw).trim().toLowerCase().replace(/^mailto:/, '');
  const name = raw.replace(/<[^>]+>/, '').replace(/"/g, '').trim();
  return { name: name && name !== email ? name : '', email };
}

export interface KnownContact { email: string; name: string | null; externalId: string | null }

export interface Classification { category: InboxCategory; score: number; reason: string; matched?: KnownContact | null }

const LEAD_WORDS = /\b(roof|roofing|shingle|leak|leaking|estimate|quote|inspection|inspect|hail|storm|wind damage|gutter|repair|replace|replacement|skylight|siding|free inspection|schedule|appointment|new roof)\b/i;
const IMPORTANT_WORDS = /\b(adjuster|claim|insurance|supplement|permit|inspector|invoice|payment|deposit|contract|signed|signature|docusign|urgent|asap|cancel|complain|refund|warranty|lawsuit|attorney|deadline|past due)\b/i;
const NOISE_SENDER = /(no-?reply|noreply|donotreply|notifications?|newsletter|marketing|billing@|support@|updates@|info@|mailer-daemon|postmaster|alerts?@|calendar-notification)/i;
const NOISE_SUBJECT = /\b(unsubscribe|webinar|newsletter|% off|sale ends|your receipt|order confirmation|password|verify your|security alert|weekly digest|daily digest)\b/i;

/** Deterministic first pass; the LLM only refines what this leaves in doubt. */
export function heuristicClassify(m: InboxMessage, known: Map<string, KnownContact>, mailbox: string): Classification {
  const from = m.fromEmail.toLowerCase();
  // Mail from the mailbox's own domain is the team writing to itself.
  const ownDomain = mailbox.toLowerCase().split('@')[1] ?? '';
  if (!from || from === mailbox.toLowerCase() || (ownDomain && from.endsWith('@' + ownDomain))) return { category: 'other', score: 0, reason: 'internal mail' };
  const text = `${m.subject} ${m.snippet}`;
  const matched = known.get(from) || null;
  if (matched) {
    const hot = IMPORTANT_WORDS.test(text) || LEAD_WORDS.test(text);
    return { category: 'customer', score: hot ? 90 : 75, reason: `From ${matched.name || 'a client on file'}${hot ? ' — mentions ' + (text.match(IMPORTANT_WORDS) || text.match(LEAD_WORDS))?.[0].toLowerCase() : ''}`, matched };
  }
  if (NOISE_SENDER.test(from) || NOISE_SUBJECT.test(m.subject)) return { category: 'other', score: 5, reason: 'automated or promotional sender' };
  const imp = text.match(IMPORTANT_WORDS);
  const lead = text.match(LEAD_WORDS);
  if (imp && !lead) return { category: 'important', score: 70, reason: `mentions "${imp[0].toLowerCase()}"` };
  if (lead) {
    const asksForWork = /\b(need|looking for|would like|can you|could you|interested|price|cost|how much|come out|get a|want)\b/i.test(text);
    return { category: 'lead', score: asksForWork ? 85 : 60, reason: `mentions "${lead[0].toLowerCase()}"${asksForWork ? ' and asks for work' : ''}` };
  }
  if (imp) return { category: 'important', score: 55, reason: `mentions "${imp[0].toLowerCase()}"` };
  // A person writing from a normal address with no keywords at all: unsure, let the model look.
  return { category: 'other', score: 30, reason: 'no roofing or business signal found' };
}

/** Which heuristic results are worth a model pass: the unsure middle. */
export function needsModel(c: Classification): boolean {
  return c.score >= 25 && c.score < 80 && !c.matched;
}

/** The classifier's instructions, for the company whose inbox it is. */
export const classifySystem = (company: { displayName: string; trade: string; cityState: string }) => `You sort the inbox of ${company.displayName}, a ${company.trade} company${company.cityState ? ` in ${company.cityState}` : ''}. For each email decide:
- "lead": a homeowner or business asking about ${company.trade} work, an estimate, an inspection, a repair, storm damage, or wanting to be contacted.
- "customer": an existing customer or job contact writing about their job (scheduling, questions, complaints, payments).
- "important": not a lead but the team must not miss it — insurance adjusters and claims, permits and inspectors, supplier or crew issues, invoices, contracts and signatures, legal, deadlines, cancellations.
- "other": newsletters, receipts, notifications, vendors selling to us, anything that can wait.
Give a score 0-100 for how much a sales rep needs to act today, and a reason under 15 words.`;

export function classifyPrompt(items: InboxMessage[]): string {
  return JSON.stringify({
    emails: items.map((m) => ({ id: m.messageId, from: `${m.fromName} <${m.fromEmail}>`, subject: m.subject, snippet: m.snippet.slice(0, 400) })),
    answer_format: { results: [{ id: 'message id', category: 'lead|customer|important|other', score: 0, reason: 'short reason' }] },
  });
}

const CATS: InboxCategory[] = ['lead', 'customer', 'important', 'other'];

/** The model's answer, checked; anything malformed is dropped so the heuristic stands. */
export function parseClassifications(raw: unknown): Map<string, Classification> {
  const out = new Map<string, Classification>();
  const list = Array.isArray((raw as any)?.results) ? (raw as any).results : Array.isArray(raw) ? raw : [];
  for (const r of list) {
    const id = String(r?.id || '');
    const category = CATS.includes(r?.category) ? (r.category as InboxCategory) : null;
    const score = Number(r?.score);
    if (!id || !category || !Number.isFinite(score)) continue;
    out.set(id, { category, score: Math.min(Math.max(Math.round(score), 0), 100), reason: String(r?.reason || '').slice(0, 160) });
  }
  return out;
}

/** What the dashboard counts: anything a rep should act on. */
export function isActionable(c: { category: InboxCategory; score: number }): boolean {
  return c.category !== 'other' && c.score >= 50;
}
