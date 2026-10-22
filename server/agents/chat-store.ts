/**
 * Daily chat memory for every AI agent (Archie, the team advisor, + the exec/team advisors).
 *
 * Model: one thread per (user, agent, business day). A new day therefore starts a
 * fresh conversation automatically — no manual reset — and yesterday's thread is
 * summarized once and kept forever, so an agent can look back at what was
 * discussed on any past date.
 */
import { and, eq, desc, isNull, lt, sql } from 'drizzle-orm';
import { db } from '../db';
import { agentChats, agentChatMessages } from '../../shared/schema';
import { assistConfigured, summarizeConversation } from '../ai/assist-service';
import { currentProfile } from '../tenant/context';

/**
 * The business day in the company's time zone (its profile; America/New_York
 * when none is set) as YYYY-MM-DD — the daily reset boundary.
 */
export function businessDay(d: Date = new Date()): string {
  try {
    return d.toLocaleDateString('en-CA', { timeZone: currentProfile().timeZone });
  } catch {
    // A time zone the runtime doesn't know: fall back rather than break chat.
    return d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  }
}

/** Most of a day's transcript the summarizer is handed. */
export const TRANSCRIPT_CAP = 24000;

/**
 * Build the transcript we hand the summarizer. A long day keeps its END, not
 * its start: the cap used to cut the tail, so the decisions and promises made
 * at the close of a long chat were exactly what the summary lost.
 */
export function buildTranscript(msgs: { role: string; content: string }[], cap = TRANSCRIPT_CAP): string {
  const full = msgs
    .map((m) => `${m.role === 'assistant' ? 'Assistant' : 'Team member'}: ${m.content.trim()}`)
    .join('\n');
  if (full.length <= cap) return full;
  const marker = '[…earlier part of the day trimmed…]\n';
  return marker + full.slice(full.length - (cap - marker.length));
}

/** Deterministic fallback when the AI summarizer isn't available. */
export function fallbackSummary(msgs: { role: string; content: string }[]): string {
  const asked = msgs.filter((m) => m.role === 'user').map((m) => m.content.trim().replace(/\s+/g, ' '));
  const lines = asked.slice(0, 6).map((q) => `- Asked: ${q.slice(0, 160)}`);
  if (asked.length > 6) lines.push(`- …and ${asked.length - 6} more questions`);
  return lines.join('\n') || '- (no questions logged)';
}

/** Find (or open) today's thread for this person + agent. */
export async function getOrCreateChat(userEmail: string, agentKey: string, day = businessDay()): Promise<number> {
  // Insert-first against the DB-level unique index (user_email, agent_key, day),
  // rather than select-then-insert: two concurrent first messages of the day
  // from the same user/agent used to both pass the select and both create a
  // thread row.
  //
  // No explicit conflict target: ON CONFLICT (cols) is a hard error when the
  // matching unique index is missing, which it was until migration 0041, and
  // production migrations are run by hand and lag. A bare ON CONFLICT DO
  // NOTHING uses the index when it exists and is harmless when it doesn't.
  const [inserted] = await db.insert(agentChats)
    .values({ userEmail, agentKey, day })
    .onConflictDoNothing()
    .returning({ id: agentChats.id });
  if (inserted) return inserted.id;

  // Earliest row wins, matching the merge 0041 does on old duplicates.
  const [existing] = await db
    .select({ id: agentChats.id })
    .from(agentChats)
    .where(and(eq(agentChats.userEmail, userEmail), eq(agentChats.agentKey, agentKey), eq(agentChats.day, day)))
    .orderBy(agentChats.id)
    .limit(1);
  return existing!.id;
}

/** Persist one turn and bump the thread's updatedAt. */
export async function saveTurn(chatId: number, role: 'user' | 'assistant', content: string): Promise<void> {
  if (!content?.trim()) return;
  await db.insert(agentChatMessages).values({ chatId, role, content });
  await db.update(agentChats).set({ updatedAt: new Date() }).where(eq(agentChats.id, chatId));
}

/** Today's messages for this person + agent (what the UI restores on load). */
export async function todaysMessages(userEmail: string, agentKey: string): Promise<{ role: string; content: string }[]> {
  const day = businessDay();
  const [chat] = await db
    .select({ id: agentChats.id })
    .from(agentChats)
    .where(and(eq(agentChats.userEmail, userEmail), eq(agentChats.agentKey, agentKey), eq(agentChats.day, day)));
  if (!chat) return [];
  return db
    .select({ role: agentChatMessages.role, content: agentChatMessages.content })
    .from(agentChatMessages)
    .where(eq(agentChatMessages.chatId, chat.id))
    .orderBy(agentChatMessages.createdAt);
}

/** Per-thread ceiling on the summarizer call. */
const SUMMARY_CALL_TIMEOUT_MS = 45_000;
/** A day the AI still can't summarize after this long gets the plain fallback. */
const SUMMARY_GIVE_UP_DAYS = 7;

/** Is `day` (YYYY-MM-DD) at least `days` days before `today`? */
export function isOlderThan(day: string, days: number, today = businessDay()): boolean {
  const ms = Date.parse(`${today}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`);
  return Number.isFinite(ms) && ms >= days * 86_400_000;
}

/**
 * Summarize one thread and store it on the row. Returns the summary text.
 *
 * Throws, leaving summarizedAt null so the next nightly run tries again, when
 * the AI is configured but the call failed. It used to store the deterministic
 * fallback instead, and since summarizedAt was then set, one provider blip
 * replaced that day's real summary with a list of questions for good. The
 * fallback is still stored when the AI is not configured at all, when the day
 * had no messages, or once a day has kept failing for SUMMARY_GIVE_UP_DAYS.
 */
export async function summarizeChat(chatId: number, opts: { timeoutMs?: number } = {}): Promise<string> {
  const [chat] = await db.select({ day: agentChats.day }).from(agentChats).where(eq(agentChats.id, chatId));
  const msgs = await db
    .select({ role: agentChatMessages.role, content: agentChatMessages.content })
    .from(agentChatMessages)
    .where(eq(agentChatMessages.chatId, chatId))
    .orderBy(agentChatMessages.createdAt);

  let summary: string;
  if (!msgs.length || !assistConfigured()) {
    summary = fallbackSummary(msgs);
  } else {
    const ai = await summarizeConversation(buildTranscript(msgs), { timeoutMs: opts.timeoutMs ?? SUMMARY_CALL_TIMEOUT_MS });
    if (ai) summary = ai;
    else if (chat && isOlderThan(chat.day, SUMMARY_GIVE_UP_DAYS)) summary = fallbackSummary(msgs);
    else throw new Error('the summarizer failed or returned nothing; will retry on the next run');
  }
  await db.update(agentChats).set({ summary, summarizedAt: new Date() }).where(eq(agentChats.id, chatId));
  return summary;
}

/**
 * Summarize every finished day that hasn't been summarized yet (all users, all
 * agents). Runs from the daily cron; safe to run repeatedly.
 *
 * Bounded by `budgetMs` as well as `limit`: the cron runs inside a serverless
 * function capped at 300s, and fifty sequential model calls with no budget can
 * run past it, so the function is killed mid-batch and reports nothing.
 * Threads not reached are left for the next run.
 */
export async function summarizePendingDays(
  limit = 50,
  budgetMs = 200_000,
): Promise<{ summarized: number; failed: number; deferred: number }> {
  const today = businessDay();
  const pending = await db
    .select({ id: agentChats.id })
    .from(agentChats)
    .where(and(lt(agentChats.day, today), isNull(agentChats.summarizedAt)))
    .orderBy(desc(agentChats.day))
    .limit(limit);

  const started = Date.now();
  let n = 0;
  let failed = 0;
  let i = 0;
  for (; i < pending.length; i++) {
    const left = budgetMs - (Date.now() - started);
    // Don't start a call that can't finish inside the budget.
    if (left < 5_000) break;
    const c = pending[i];
    try { await summarizeChat(c.id, { timeoutMs: Math.min(SUMMARY_CALL_TIMEOUT_MS, left) }); n++; } catch (e: any) {
      // skip one bad day, keep going — but log it, since summarizedAt staying
      // null forever otherwise gave no indication anything had failed.
      failed++;
      console.error(`[chat-store] summarizeChat failed for chat ${c.id}:`, e?.message || e);
    }
  }
  return { summarized: n, failed, deferred: pending.length - i };
}

export interface PastDay { day: string; agentKey: string; summary: string | null }

/**
 * Past daily summaries for one person — how an agent "looks back". Optional
 * keyword filter and day window (default: the last 30 recorded days).
 */
export async function recallPastDays(
  userEmail: string,
  opts: { agentKey?: string; query?: string; limit?: number } = {},
): Promise<PastDay[]> {
  const limit = Math.min(Math.max(opts.limit ?? 14, 1), 60);
  const today = businessDay();

  const where = [eq(agentChats.userEmail, userEmail), lt(agentChats.day, today)];
  if (opts.agentKey) where.push(eq(agentChats.agentKey, opts.agentKey));
  if (opts.query?.trim()) where.push(sql`${agentChats.summary} ilike ${'%' + opts.query.trim() + '%'}`);

  const rows = await db
    .select({ day: agentChats.day, agentKey: agentChats.agentKey, summary: agentChats.summary })
    .from(agentChats)
    .where(and(...where))
    .orderBy(desc(agentChats.day))
    .limit(limit);

  // A day only has a summary once the nightly job has run; skip empty ones.
  return rows.filter((r) => !!r.summary);
}
