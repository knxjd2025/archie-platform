import type { Express, Request, Response } from 'express';
import { and, or, eq, desc, asc, sql } from 'drizzle-orm';
import { db } from '../db';
import { followUps, teamMembers } from '../../shared/schema';
import { requireAuth } from '../auth/middleware';
import { teamMemberIdByEmail, type SessionUser } from '../access/rep-scope';
import { JobTreadClient } from '../integrations/jobtread';
import { sendFailure } from '../lib/failure';
import { etToday } from '../../shared/schedule-board';
import { isIsoDate } from '../../shared/et-periods';

export type FollowUpFieldCheck =
  | { ok: true; dueDate: string | null; assignedTo: number | null }
  | { ok: false; error: string };

/**
 * The due date and assignee as stored. Anything used to go straight in —
 * "next week" as a due date, "abc" as an assignee (NaN) — and a bad due date
 * then broke the overdue count on the Monday scorecard for everyone.
 */
export function checkFollowUpFields(body: { dueDate?: unknown; assignedTo?: unknown }): FollowUpFieldCheck {
  const { dueDate, assignedTo } = body;
  const due = dueDate === undefined || dueDate === null || dueDate === '' ? null : isIsoDate(dueDate) ? dueDate : undefined;
  if (due === undefined) return { ok: false, error: 'dueDate must be a real date written YYYY-MM-DD.' };
  const who = assignedTo === undefined || assignedTo === null || assignedTo === '' ? null
    : typeof assignedTo === 'number' || (typeof assignedTo === 'string' && /^\d+$/.test(assignedTo)) ? Number(assignedTo) : NaN;
  if (who !== null && !(Number.isSafeInteger(who) && who > 0)) return { ok: false, error: 'assignedTo must be a team member id.' };
  return { ok: true, dueDate: due, assignedTo: who };
}

export function registerFollowUpRoutes(app: Express) {
  // List follow-ups. With ?jobExternalId=… → that client's items (open first).
  // Without → the current user's open follow-ups (managers/admin see everyone's).
  app.get('/api/follow-ups', requireAuth, async (req: Request, res: Response) => {
    try {
      const user = req.session.user! as SessionUser;
      const jobExternalId = req.query.jobExternalId as string | undefined;
      const isMgr = user.role === 'admin' || user.role === 'manager';
      const myId = await teamMemberIdByEmail(user.email);

      // Pushed into SQL rather than loading the whole table and filtering in
      // JS — that used to grow with every follow-up ever created, resolved or
      // not, across the company's entire history.
      const clauses = [];
      if (!isMgr) clauses.push(or(eq(followUps.assignedTo, myId ?? -1), eq(followUps.createdBy, user.email)));
      if (jobExternalId) clauses.push(eq(followUps.jobExternalId, jobExternalId));
      else clauses.push(eq(followUps.done, false)); // dashboard/global view = open only
      const where = clauses.length ? and(...clauses) : undefined;

      const base = db
        .select({
          id: followUps.id,
          jobExternalId: followUps.jobExternalId,
          clientName: followUps.clientName,
          note: followUps.note,
          dueDate: followUps.dueDate,
          assignedTo: followUps.assignedTo,
          assigneeName: teamMembers.name,
          createdBy: followUps.createdBy,
          done: followUps.done,
          createdAt: followUps.createdAt,
          completedAt: followUps.completedAt,
        })
        .from(followUps)
        .leftJoin(teamMembers, eq(followUps.assignedTo, teamMembers.id));

      const rows = await (where ? base.where(where) : base)
        .orderBy(asc(followUps.done), sql`${followUps.dueDate} asc nulls last`, desc(followUps.createdAt))
        .limit(500);

      // "due" flag: overdue or due today (date-only comparison). Charlotte's
      // today — the UTC date flipped at 8pm Eastern, so an evening glance showed
      // tomorrow's follow-ups as due today and today's as overdue.
      const today = etToday();
      const withFlags = rows.map((r) => ({ ...r, overdue: !!r.dueDate && r.dueDate < today, dueToday: r.dueDate === today }));
      res.json({ followUps: withFlags });
    } catch (e: any) {
      return sendFailure(res, e, 'GET /api/follow-ups');
    }
  });

  // Create a follow-up. Defaults assignee to the creator. Mirrors a note to
  // JobTread (best-effort) so it's visible there too.
  app.post('/api/follow-ups', requireAuth, async (req: Request, res: Response) => {
    try {
      const user = req.session.user! as SessionUser;
      const { jobExternalId, clientName, note, dueDate, assignedTo } = req.body || {};
      if (!note || !String(note).trim()) return res.status(400).json({ error: 'A note is required.' });
      const checked = checkFollowUpFields({ dueDate, assignedTo });
      if (!checked.ok) return res.status(400).json({ error: checked.error });
      if (checked.assignedTo != null) {
        const [member] = await db.select({ id: teamMembers.id }).from(teamMembers).where(eq(teamMembers.id, checked.assignedTo));
        if (!member) return res.status(400).json({ error: 'assignedTo is not a team member.' });
      }
      const myId = await teamMemberIdByEmail(user.email);

      const [row] = await db
        .insert(followUps)
        .values({
          jobExternalId: jobExternalId || null,
          clientName: clientName || null,
          note: String(note).trim(),
          dueDate: checked.dueDate,
          assignedTo: checked.assignedTo ?? myId,
          createdBy: user.email,
        })
        .returning();

      // Best-effort mirror to JobTread so the office sees it on the job too.
      if (jobExternalId) {
        try {
          const due = checked.dueDate ? ` (due ${checked.dueDate})` : '';
          await new JobTreadClient().addJobComment(jobExternalId, `📌 Follow-up${due}: ${String(note).trim()}`, user.name);
        } catch { /* non-fatal */ }
      }

      res.json({ followUp: row });
    } catch (e: any) {
      return sendFailure(res, e, 'POST /api/follow-ups');
    }
  });

  // Mark done (or reopen with { done: false }).
  app.post('/api/follow-ups/:id/done', requireAuth, async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad id' });
      const done = req.body?.done === false ? false : true;
      // The list route filters by assignee/creator, but this one keyed off the
      // id alone and RETURNED the updated row — so a sequential id was enough
      // to read another rep's note, client name and job, and toggling
      // {done:false} made it non-destructive to do repeatedly.
      if (!(await canTouchFollowUp(req, id))) return res.status(404).json({ error: 'not found' });
      const [row] = await db
        .update(followUps)
        .set({ done, completedAt: done ? new Date() : null })
        .where(eq(followUps.id, id))
        .returning();
      if (!row) return res.status(404).json({ error: 'not found' });
      res.json({ followUp: row });
    } catch (e: any) {
      return sendFailure(res, e, 'POST /api/follow-ups/:id/done');
    }
  });

  // Delete a follow-up.
  app.delete('/api/follow-ups/:id', requireAuth, async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad id' });
      if (!(await canTouchFollowUp(req, id))) return res.status(404).json({ error: 'not found' });
      await db.delete(followUps).where(eq(followUps.id, id));
      res.json({ ok: true });
    } catch (e: any) {
      return sendFailure(res, e, 'DELETE /api/follow-ups/:id');
    }
  });
}

/**
 * May this session act on the given follow-up? Mirrors the list route's
 * predicate: it is yours if you are assigned it, you created it, or it belongs
 * to someone in your data scope.
 */
async function canTouchFollowUp(req: any, id: number): Promise<boolean> {
  const user = req.session?.user;
  if (!user) return false;
  const [row] = await db
    .select({ assignedTo: followUps.assignedTo, createdBy: followUps.createdBy })
    .from(followUps)
    .where(eq(followUps.id, id));
  if (!row) return false;
  if (row.createdBy === user.email) return true;

  const { visibleIdsFor } = await import('../access/team-scope');
  const ids = await visibleIdsFor(user);
  if (ids === null) return true; // director/admin
  return row.assignedTo != null && ids.includes(row.assignedTo);
}
