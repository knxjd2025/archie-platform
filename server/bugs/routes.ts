/**
 * Bugs: the "Report a bug" button, the errors the browser catches on its own,
 * the admin Bugs page, and the morning digest.
 *
 * Server failures do not come through here — sendFailure() and the Express
 * error handlers hand them to recordServerError() directly.
 */
import { timingSafeEqual } from 'node:crypto';
import type { Express, Request, Response } from 'express';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { waitUntil } from '@vercel/functions';
import { db } from '../db';
import { runAsSystem } from '../tenant/context';
import { requireAuth, requireRole } from '../auth/middleware';
import { rateLimit } from '../lib/rate-limit';
import { sendFailure, onServerFailure } from '../lib/failure';
import { sendOperatorEmail } from '../integrations/operator-mail';
import { parseNaiveTimestampAsUtc } from '../lib/pg-timestamps';
import { redactSecrets } from './fingerprint';
import { clip, ensureBugTable, recordCaughtError, recordPersonReport } from './store';
import { alertNewError, alertPersonReport, buildDigest, subjectLine, type DigestRow } from './notify';

const TEN_MINUTES = 10 * 60 * 1000;

/** A naive timestamp from a raw query, as the UTC instant it was written. */
function utcInstant(value: unknown): unknown {
  return typeof value === 'string' ? parseNaiveTimestampAsUtc(value).toISOString() : value;
}
/** A phone screenshot downscaled in the browser is ~200 KB; this leaves room without inviting a 10 MB paste. */
const MAX_SCREENSHOT_CHARS = 2_000_000;

const reportSchema = z.object({
  message: z.string().trim().min(3, 'Say a few words about what went wrong.').max(4000),
  details: z.string().trim().max(4000).optional().nullable(),
  page: z.string().max(100).optional().nullable(),
  url: z.string().max(2000).optional().nullable(),
  context: z.record(z.unknown()).optional(),
  screenshot: z.string().max(MAX_SCREENSHOT_CHARS).regex(/^data:image\/(png|jpeg|webp);base64,/, 'Screenshot must be an image.')
    .optional().nullable(),
});

const caughtSchema = z.object({
  source: z.string().max(60),
  message: z.string().max(4000),
  stack: z.string().max(12000).optional().nullable(),
  page: z.string().max(100).optional().nullable(),
  url: z.string().max(2000).optional().nullable(),
  context: z.record(z.unknown()).optional(),
});

const updateSchema = z.object({
  status: z.enum(['new', 'fixing', 'fixed', 'ignored']).optional(),
  notes: z.string().max(4000).optional().nullable(),
});

/** Context is whatever the browser sent; keep it to a size that is still readable. */
/**
 * The trail carries console errors and API error text, which can include a
 * token or a key; it is stored and emailed, so it is scrubbed the same way a
 * server error is.
 */
function boundedContext(ctx: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!ctx) return {};
  const text = redactSecrets(JSON.stringify(ctx));
  if (text.length > 20_000) return { truncated: true, preview: text.slice(0, 20_000) };
  try { return JSON.parse(text) as Record<string, unknown>; } catch { return { preview: text }; }
}

/** An address without its query string, which is where a reset or sign-in token travels. */
const withoutQuery = (url: string | null | undefined): string | null => (url ? url.split(/[?#]/)[0] : null);

function cronAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = Buffer.from(String(req.headers['authorization'] ?? ''));
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

// ---------------------------------------------------------------------------
// Server failures
// ---------------------------------------------------------------------------

/**
 * If the database itself is what is failing, writing every failure to it adds
 * load to the thing that is already down. One failed write pauses recording
 * for a minute.
 */
let pausedUntil = 0;

/**
 * Vercel may freeze the function the moment the response is sent, which would
 * drop a write or an email still in flight. waitUntil keeps it alive until the
 * work finishes; outside Vercel the promise simply runs.
 */
function afterResponse(work: Promise<unknown>): void {
  waitUntil(work.catch((e) => console.error('[bugs] background work failed:', e instanceof Error ? e.message : e)));
}

export function recordServerError(where: string, error: unknown, req?: Request): void {
  if (Date.now() < pausedUntil) return;
  const err = error instanceof Error ? error : new Error(String(error ?? 'Unknown error'));
  // A Drizzle query error says "Failed query: …"; the reason is in its cause.
  const cause = (err as { cause?: unknown }).cause;
  const message = redactSecrets(cause instanceof Error && cause.message && !err.message.includes(cause.message)
    ? `${err.message}\n→ ${cause.message}` : err.message);
  afterResponse(recordCaughtError({
    kind: 'server_error',
    where,
    message: message || 'Unknown error',
    stack: err.stack ? redactSecrets(err.stack) : null,
    url: req?.originalUrl ? clip(req.originalUrl.split('?')[0], 500) : null,
    userEmail: req?.session?.user?.email ?? null,
    context: req ? { method: req.method } : {},
  })
    .then((r) => {
      if (r.firstTime || r.reopened) {
        return alertNewError({ id: r.id, kind: 'server_error', where, message, userEmail: req?.session?.user?.email, reopened: r.reopened });
      }
    })
    .catch((e) => {
      pausedUntil = Date.now() + 60_000;
      console.error('[bugs] could not record a server error:', e instanceof Error ? e.message : e);
    }));
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export function registerBugRoutes(app: Express) {
  onServerFailure((what, error, res) => recordServerError(what, error, res.req));

  // A person pressed "Report a bug".
  app.post('/api/bugs', requireAuth, rateLimit(10, TEN_MINUTES), async (req: Request, res: Response) => {
    const parsed = reportSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'That report did not look right.' });
    try {
      const userEmail = req.session.user!.email;
      const b = parsed.data;
      const id = await recordPersonReport({
        message: b.message, details: b.details, page: b.page, url: withoutQuery(b.url), userEmail,
        userAgent: clip(req.headers['user-agent'], 500), context: boundedContext(b.context), screenshot: b.screenshot,
      });
      // Not awaited for the answer: the report is saved, and the rep should not wait on Gmail.
      afterResponse(alertPersonReport({
        id, message: b.message, details: b.details, page: b.page, url: withoutQuery(b.url), userEmail, hasScreenshot: !!b.screenshot,
      }));
      res.json({ ok: true, id });
    } catch (e) {
      return sendFailure(res, e, 'POST /api/bugs', 500, 'Your report could not be saved. Try again in a minute.');
    }
  });

  // The browser caught an error by itself (a crashed screen, an unhandled promise, a timeout).
  app.post('/api/bugs/caught', requireAuth, rateLimit(30, TEN_MINUTES), async (req: Request, res: Response) => {
    const parsed = caughtSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'bad error payload' });
    try {
      const b = parsed.data;
      const userEmail = req.session.user!.email;
      const r = await recordCaughtError({
        kind: 'client_error', where: b.source, message: redactSecrets(b.message || 'Unknown error'),
        stack: b.stack ? redactSecrets(b.stack) : null, page: b.page, url: withoutQuery(b.url), userEmail, userAgent: clip(req.headers['user-agent'], 500), context: boundedContext(b.context),
      });
      if (r.firstTime || r.reopened) {
        afterResponse(alertNewError({
          id: r.id, kind: 'client_error', where: b.source, message: redactSecrets(b.message), page: b.page, userEmail, reopened: r.reopened,
        }));
      }
      res.json({ ok: true });
    } catch (e) {
      // Not sendFailure: a failure to record an error must not record an error.
      console.error('[bugs] could not record a browser error:', e instanceof Error ? e.message : e);
      res.status(500).json({ error: 'not recorded' });
    }
  });

  // The Bugs page. Screenshots are left out of the list — they are fetched one at a time.
  app.get('/api/bugs', requireRole('admin'), async (_req: Request, res: Response) => {
    try {
      await ensureBugTable();
      const result = await db.execute(sql`
        SELECT id, kind, status, message, details, page, url, user_email AS "userEmail", user_agent AS "userAgent",
               context, occurrences, first_seen AS "firstSeen", last_seen AS "lastSeen", notes,
               (screenshot IS NOT NULL) AS "hasScreenshot"
        FROM bug_reports ORDER BY last_seen DESC LIMIT 500`);
      // db.execute hands back naive timestamps as the bare text Postgres sent
      // ('2026-10-16 02:10:29.765', no zone) — Drizzle's raw path skips both its
      // own column mapping and pg's parser. The browser read that as its local
      // time, so every bug looked four hours newer than it was. Send the instant.
      const bugs = result.rows.map((row) => ({
        ...row,
        firstSeen: utcInstant(row.firstSeen),
        lastSeen: utcInstant(row.lastSeen),
      }));
      res.json({ bugs });
    } catch (e) {
      return sendFailure(res, e, 'GET /api/bugs', 500, 'Could not load the bug list.');
    }
  });

  app.get('/api/bugs/:id/screenshot', requireRole('admin'), async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Bad id' });
    try {
      const result = await db.execute(sql`SELECT screenshot FROM bug_reports WHERE id = ${id}`);
      const shot = (result.rows[0] as { screenshot: string | null } | undefined)?.screenshot;
      if (!shot) return res.status(404).json({ error: 'No screenshot on that report.' });
      res.json({ screenshot: shot });
    } catch (e) {
      return sendFailure(res, e, 'GET /api/bugs/:id/screenshot');
    }
  });

  app.patch('/api/bugs/:id', requireRole('admin'), async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    const parsed = updateSchema.safeParse(req.body);
    if (!Number.isInteger(id) || !parsed.success) return res.status(400).json({ error: 'Bad update' });
    const { status, notes } = parsed.data;
    try {
      const result = await db.execute(sql`
        UPDATE bug_reports SET
          status = COALESCE(${status ?? null}, status),
          notes = ${notes === undefined ? sql`notes` : notes}
        WHERE id = ${id} RETURNING id, status, notes`);
      if (!result.rows.length) return res.status(404).json({ error: 'That bug is gone.' });
      res.json({ ok: true, bug: result.rows[0] });
    } catch (e) {
      return sendFailure(res, e, 'PATCH /api/bugs/:id');
    }
  });

  // Every morning: what is open and was seen in the last day.
  app.get('/api/cron/bug-digest', async (req: Request, res: Response) => {
    if (!cronAuthorized(req)) return res.status(401).json({ error: 'unauthorized' });
    try {
      await ensureBugTable();
      // The digest is for the Archie operators, across every company.
      const result = await runAsSystem('morning bug digest', () => db.execute(sql`
        SELECT id, kind, status, message, page, user_email, occurrences
        FROM bug_reports
        WHERE status IN ('new', 'fixing') AND last_seen > NOW() - INTERVAL '24 hours'
        ORDER BY last_seen DESC LIMIT 200`));
      const digest = buildDigest(result.rows as unknown as DigestRow[]);
      if (!digest) return res.json({ ok: true, sent: false, reason: 'nothing open in the last 24 hours' });
      const sent = await sendOperatorEmail(subjectLine(digest.subject), digest.html);
      res.json({ ok: true, sent, rows: result.rows.length });
    } catch (e) {
      return sendFailure(res, e, 'GET /api/cron/bug-digest');
    }
  });
}
