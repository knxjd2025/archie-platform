import type { Express, NextFunction, Request, Response } from 'express';
import { requireAuth, requireRole } from '../auth/middleware';
import { buildArchieForRole } from './archie-agent';
import { getOrCreateChat, saveTurn, todaysMessages, recallPastDays, summarizePendingDays, businessDay } from './chat-store';
import { sendFailure } from '../lib/failure';
import { timingSafeEqualStr } from '../security-config';
import { buildAgentViewer, type AgentViewer } from './viewer';
import type { SessionUser } from '../access/rep-scope';
import { companyTimeZone, localParts, runCompanyJob, type CompanyJob } from '../tenant/fan-out';
import { currentCompanyId } from '../tenant/context';

export const ADVISOR_KEY = 'advisor';
/** A pasted adjuster scope fits comfortably; a whole document dump does not. */
export const MAX_MESSAGE_CHARS = 12_000;

/**
 * Keep only well-formed user/assistant turns from client-supplied history.
 * Drops `system`/`tool` roles (a client-injected `system` message would be
 * hoisted into Anthropic's system prompt and could override Archie's
 * guardrails) and any non-string content (which would 400 the LLM call).
 */
export function sanitizeHistory(history: unknown): { role: 'user' | 'assistant'; content: string }[] {
  if (!Array.isArray(history)) return [];
  return history
    .filter(
      (m: any) =>
        !!m &&
        typeof m === 'object' &&
        (m.role === 'user' || m.role === 'assistant') &&
        typeof m.content === 'string',
    )
    .map((m: any) => ({ role: m.role, content: m.content }));
}

export async function archieChatHandler(req: Request, res: Response) {
  try {
    const role = req.session.user!.role;
    const email = req.session.user!.email;
    const { message, history } = (req.body ?? {}) as { message?: unknown; history?: unknown };
    if (!message || typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ message: 'message (string) is required' });
    }
    if (message.length > MAX_MESSAGE_CHARS) {
      return res.status(400).json({ message: `Message is too long — keep it under ${MAX_MESSAGE_CHARS.toLocaleString()} characters.` });
    }
    // Today's thread is the source of truth for context (it also resets daily);
    // fall back to client-supplied history only if the store is unavailable.
    let chatId: number | null = null;
    let priorTurns: { role: 'user' | 'assistant'; content: string }[] = [];
    try {
      chatId = await getOrCreateChat(email, ADVISOR_KEY);
      priorTurns = (await todaysMessages(email, ADVISOR_KEY)) as typeof priorTurns;
    } catch (e) {
      console.error('[advisor] chat store unavailable', e);
      priorTurns = sanitizeHistory(history);
    }

    // The viewer scopes the book tools to this person. If it can't be built
    // the advisor still answers — knowledge, website, own calendar — just
    // without the book, never with an unscoped one.
    let viewer: AgentViewer | undefined;
    try {
      viewer = await buildAgentViewer(req.session.user! as SessionUser);
    } catch (e) {
      console.error('[advisor] could not build viewer; answering without the book', e);
    }
    const archie = buildArchieForRole(role, email, viewer);
    const result = await archie.chat(message, priorTurns as any);

    if (chatId != null) {
      try {
        await saveTurn(chatId, 'user', message);
        if (result?.response) await saveTurn(chatId, 'assistant', result.response);
      } catch (e) { console.error('[advisor] failed to save turn', e); }
    }
    return res.json(result);
  } catch (err: any) {
    console.error('[archie] chat error', err);
    return sendFailure(res, err, 'agents/archie-routes.ts', 500, 'Archie error');
  }
}

/**
 * Who may run the nightly summarization: the cron, with the CRON_SECRET bearer
 * (constant-time, so a guess cannot be refined from how long a refusal takes),
 * or an admin from a session. The session path used to accept
 * `req.session.user.role === 'admin'` as written at sign-in, so someone demoted
 * or switched off on Team & Roles kept it until their cookie expired. It now
 * goes through requireRole, which re-reads the roster first.
 */
const requireAdmin = requireRole('admin');
export function agentChatsCronGate(req: Request, res: Response, next: NextFunction) {
  const secret = process.env.CRON_SECRET;
  if (secret && timingSafeEqualStr(String(req.headers.authorization || ''), `Bearer ${secret}`)) return next();
  if (!req.session?.user) return res.status(401).json({ error: 'unauthorized' });
  return requireAdmin(req, res, next);
}

/**
 * Summarizing finished chat days, as a per-company job (server/tenant/fan-out.ts).
 * The period is the company's local date: once its backlog is clear, later
 * runs that day skip it. Each company gets a bounded slice (a batch of chats
 * and a time budget); a company with more waiting is left unfinished and the
 * next run continues it, so one busy company cannot starve the rest.
 */
export function chatSummaryJob(opts: { perCompanyMs?: number; batch?: number } = {}): CompanyJob<Awaited<ReturnType<typeof summarizePendingDays>>> {
  const perCompanyMs = opts.perCompanyMs ?? 90_000;
  return {
    name: 'agent-chat-summaries',
    period: (company, now) => localParts(now, companyTimeZone(company)).date,
    // Stop starting model calls a little before the hard per-company cap.
    run: ({ deadline }) => summarizePendingDays(opts.batch ?? 25, Math.max(0, deadline - Date.now() - 5_000)),
    // A day that failed to summarize is retried the next day, not every run.
    isComplete: (r) => r.deferred === 0 && !r.more,
    perCompanyMs,
    // Waiting on the model provider; a few at once, not more (shared account limits).
    concurrency: 3,
  };
}

export function registerArchieRoutes(app: Express) {
  app.post('/api/archie/chat', requireAuth, archieChatHandler);

  // Today's thread for an agent (the UI restores this on load; empty on a new day).
  app.get('/api/agent-chats/today', requireAuth, async (req: Request, res: Response) => {
    try {
      const email = req.session.user!.email;
      const agentKey = String(req.query.agent || ADVISOR_KEY);
      const messages = await todaysMessages(email, agentKey);
      res.json({ day: businessDay(), messages });
    } catch (err: any) {
      return sendFailure(res, err, 'GET /api/agent-chats/today', 500, 'failed');
    }
  });

  // Past daily summaries for the signed-in person (their own history only).
  app.get('/api/agent-chats/history', requireAuth, async (req: Request, res: Response) => {
    try {
      const email = req.session.user!.email;
      const days = await recallPastDays(email, {
        agentKey: req.query.agent ? String(req.query.agent) : undefined,
        query: req.query.q ? String(req.query.q) : undefined,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
      });
      res.json({ days });
    } catch (err: any) {
      return sendFailure(res, err, 'GET /api/agent-chats/history', 500, 'failed');
    }
  });

  // Nightly summarization. Cron calls it with the CRON_SECRET bearer (same
  // pattern as the sync/brain crons); admins can also trigger it from a session.
  app.get('/api/agent-chats/cron', agentChatsCronGate, async (_req: Request, res: Response) => {
    try {
      // An admin running it by hand runs it for their own company only. The
      // scheduled run (no session) runs once per company, as that company.
      const own = currentCompanyId();
      if (own) {
        const companies = [{ companyId: own, ok: true, value: await summarizePendingDays() }];
        return res.json({ ok: true, companies });
      }
      res.json(await runCompanyJob(chatSummaryJob()));
    } catch (err: any) {
      return sendFailure(res, err, 'GET /api/agent-chats/cron', 500, 'failed');
    }
  });
}
