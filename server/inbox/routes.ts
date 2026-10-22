/**
 * Inbox watch routes: scan my mailbox for leads and must-not-miss email,
 * list what was found, act on it, and a cron that watches every mailbox.
 */
import type { Express, Request, Response } from 'express';
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { db } from '../db';
import { inboxItems, inboxScans, followUps, teamMembers } from '../../shared/schema';
import { requireAuth } from '../auth/middleware';
import { teamMemberIdByEmail, type SessionUser } from '../access/rep-scope';
import { timingSafeEqualStr } from '../security-config';
import { scanMailbox, lastScanTo } from './scan';
import { scanWindow, LOOKBACK_HOURS } from './rules';
import { canDelegateMailbox } from '../integrations/google-workspace';
import { sendFailure } from '../lib/failure';
import { asyncHandler } from '../lib/async-handler';


function cronAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = String(req.headers.authorization || '');
  return header.startsWith('Bearer ') && timingSafeEqualStr(header.slice(7), secret);
}

export function registerInboxRoutes(app: Express) {
  // What the next scan would cover, and how many items are waiting. Free.
  app.get('/api/inbox/summary', requireAuth, async (req: Request, res: Response) => {
    try {
      const user = req.session.user! as SessionUser;
      const mailbox = user.email.toLowerCase();
      const last = await lastScanTo(mailbox);
      const w = scanWindow(new Date(), last);
      const rows = await db.select({ category: inboxItems.category, n: sql<number>`count(*)` }).from(inboxItems)
        .where(and(eq(inboxItems.mailbox, mailbox), eq(inboxItems.status, 'new'), gte(inboxItems.score, 50))).groupBy(inboxItems.category);
      const counts: Record<string, number> = {};
      for (const r of rows) counts[r.category] = Number(r.n);
      res.json({ mailbox, canScan: canDelegateMailbox(mailbox), lastScanAt: last?.toISOString() ?? null, nextWindow: { from: w.from.toISOString(), to: w.to.toISOString(), firstScan: w.firstScan, hours: Math.round((w.to.getTime() - w.from.getTime()) / 36e5) }, counts, lookbackHours: LOOKBACK_HOURS });
    } catch (e: any) { return sendFailure(res, e, 'GET /api/inbox/summary', 500); }
  });

  // Scan my inbox now: the past 72 hours the first time, then only what is new since the last scan.
  app.post('/api/inbox/scan', requireAuth, async (req: Request, res: Response) => {
    try {
      const user = req.session.user! as SessionUser;
      const mailbox = user.email.toLowerCase();
      // Only a mailbox on the Google Workspace domain delegated to this company.
      if (!canDelegateMailbox(mailbox)) return res.status(400).json({ error: 'Inbox watch needs Google Workspace connected for your company and a mailbox on its domain.' });
      const result = await scanMailbox(mailbox, user.email);
      res.json({ ok: true, ...result });
    } catch (e: any) { return sendFailure(res, e, 'POST /api/inbox/scan', 502, 'Could not read the mailbox.'); }
  });

  app.get('/api/inbox', requireAuth, async (req: Request, res: Response) => {
    try {
      const user = req.session.user! as SessionUser;
      const mailbox = user.email.toLowerCase();
      const status = req.query.status === 'handled' ? 'handled' : req.query.status === 'dismissed' ? 'dismissed' : req.query.status === 'all' ? null : 'new';
      const clauses: any[] = [eq(inboxItems.mailbox, mailbox)];
      if (status) clauses.push(eq(inboxItems.status, status));
      const items = await db.select().from(inboxItems).where(and(...clauses)).orderBy(desc(inboxItems.score), desc(inboxItems.receivedAt)).limit(300);
      const scans = await db.select().from(inboxScans).where(eq(inboxScans.mailbox, mailbox)).orderBy(desc(inboxScans.toAt)).limit(5);
      res.json({ items, scans });
    } catch (e: any) { return sendFailure(res, e, 'GET /api/inbox', 500); }
  });

  app.patch('/api/inbox/:id', requireAuth, async (req: Request, res: Response) => {
    try {
      const user = req.session.user! as SessionUser;
      const status = String(req.body?.status || '');
      if (!['new', 'handled', 'dismissed'].includes(status)) return res.status(400).json({ error: 'status must be new, handled or dismissed' });
      const [row] = await db.update(inboxItems)
        .set({ status, handledBy: status === 'new' ? null : user.email, handledAt: status === 'new' ? null : new Date() })
        .where(and(eq(inboxItems.id, Number(req.params.id)), eq(inboxItems.mailbox, user.email.toLowerCase()))).returning();
      if (!row) return res.status(404).json({ error: 'not found' });
      res.json({ ok: true, item: row });
    } catch (e: any) { return sendFailure(res, e, 'PATCH /api/inbox/:id', 500); }
  });

  // Turn an email into a follow-up on my list (and mark the email handled).
  app.post('/api/inbox/:id/follow-up', requireAuth, async (req: Request, res: Response) => {
    try {
      const user = req.session.user! as SessionUser;
      const [item] = await db.select().from(inboxItems).where(and(eq(inboxItems.id, Number(req.params.id)), eq(inboxItems.mailbox, user.email.toLowerCase())));
      if (!item) return res.status(404).json({ error: 'not found' });
      const due = String(req.body?.dueDate || '').trim() || new Date(Date.now() + 864e5).toISOString().slice(0, 10);
      const note = String(req.body?.note || '').trim() || `Email from ${item.fromName || item.fromEmail}: ${item.subject || '(no subject)'}`;
      const [fu] = await db.insert(followUps).values({
        jobExternalId: item.matchedExternalId, clientName: item.matchedName || item.fromName || item.fromEmail,
        note: note.slice(0, 500), dueDate: due, assignedTo: await teamMemberIdByEmail(user.email), createdBy: user.email,
      }).returning();
      const [updated] = await db.update(inboxItems).set({ status: 'handled', handledBy: user.email, handledAt: new Date(), followUpId: fu.id }).where(eq(inboxItems.id, item.id)).returning();
      res.json({ ok: true, item: updated, followUp: fu });
    } catch (e: any) { return sendFailure(res, e, 'POST /api/inbox/:id/follow-up', 500); }
  });

  // Every company mailbox, every run — so nobody has to remember to click.
  // asyncHandler: the team-members query sits outside the per-mailbox try, and
  // Express 4 drops a rejected async handler — a DB error hung the request.
  app.get('/api/cron/inbox-watch', asyncHandler(async (req: Request, res: Response) => {
    if (!cronAuthorized(req)) return res.status(401).json({ error: 'unauthorized' });
    if (!process.env.GOOGLE_SA_KEY) return res.json({ ok: false, reason: 'no Google Workspace access configured' });
    const members = await db.select({ email: teamMembers.email }).from(teamMembers).where(and(eq(teamMembers.active, true), eq(teamMembers.canLogin, true)));
    const out: Record<string, any> = {};
    for (const m of members) {
      const mailbox = m.email.toLowerCase();
      if (!canDelegateMailbox(mailbox)) continue;
      try { out[mailbox] = await scanMailbox(mailbox, 'cron'); }
      catch (e: any) { out[mailbox] = { error: e?.message || 'failed' }; }
    }
    res.json({ ok: true, mailboxes: out });
  }));
}
