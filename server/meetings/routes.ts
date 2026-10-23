/**
 * Monday's meeting pack.
 *
 * Assembled on Sunday evening by the cron, opened on Monday morning by whoever
 * is running the room. The numbers are then refreshed hourly through the week
 * (just after the syncs) so no room works from a week-old picture, with a
 * Refresh for when the 8am meeting can't wait for the next hour.
 *
 * Access follows the room: leadership and payroll carry pay figures and are
 * admin-only; claims is sales and up; the sales meeting is open to everyone,
 * so a rep can see their own week before they walk in.
 */
import type { Express, Request, Response } from 'express';
import { forEachLiveCompany } from '../tenant/companies';
import { etParts } from '../../shared/schedule-board';
import { dayOfWeek } from '../../shared/et-periods';
import { and, asc, desc, eq, isNull, ne } from 'drizzle-orm';
import { db } from '../db';
import { meetingActions, meetingNotes, meetingWeeks, teamMembers } from '../../shared/schema';
import { requireAuth } from '../auth/middleware';
import { asyncHandler } from '../lib/async-handler';
import { timingSafeEqualStr } from '../security-config';
import { logWrite } from '../writes/log';
import type { SessionUser } from '../access/rep-scope';
import {
  type MeetingAction as MeetingActionView, type MeetingKey, type MeetingPack,
  canOpenMeeting, isMeetingKey, mondayFor, visibleMeetings, weekBefore,
} from '../../shared/monday-meetings';
import { buildAgendas } from './build';
import {
  loadScorecard, loadRepScorecards, loadRocks, loadIssues, currentQuarter, autoFileIssues, raiseIssue,
  setIssuePriority, solveIssue, dropIssue, rateMeeting, ratingsFor, seedScorecard, L10_MEETINGS,
} from './spine';
import { MEASURES } from './measures';
import { scorecardMetrics, rocks as rocksTable, meetingIssues, meetingRatings } from '../../shared/schema';
import { topIssues, todoCompletion, averageRating, isValidRating, quarterOf, type MeetingSpine } from '../../shared/monday-meetings';

const str = (v: unknown, max = 500): string => String(v ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, max);
const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);
const isDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

// Constant-time: a plain === leaks how many leading characters of a guess
// were right, which is enough to recover the secret one byte at a time.
const cronAuthorized = (req: Request): boolean =>
  !!process.env.CRON_SECRET && timingSafeEqualStr(String(req.headers['authorization'] || ''), `Bearer ${process.env.CRON_SECRET}`);

/**
 * Build (or rebuild) the pack for a Monday, and return its row.
 *
 * `fileIssues: false` refreshes the numbers only. The hourly refresh uses it:
 * an issue solved or dropped mid-week must not come straight back an hour
 * later just because the finding behind it still holds.
 */
export async function generatePack(mondayIso: string, by: string, { fileIssues = true } = {}) {
  const agendas = await buildAgendas(mondayIso);

  // Every measure exists in its room before anybody can set a goal on it, and
  // this week's findings become issues that persist. Best-effort on purpose:
  // the pack is what the meeting needs most, and neither of these failing is a
  // reason to leave the room without one.
  try {
    await seedScorecard(by);
    if (fileIssues) await autoFileIssues(mondayIso, agendas as any, by);
  } catch (e: any) {
    console.error('[meetings] spine update failed:', e?.message || e);
  }

  const { from, to } = weekBefore(mondayIso);
  const [existing] = await db.select().from(meetingWeeks).where(eq(meetingWeeks.monday, mondayIso));

  if (existing) {
    const [updated] = await db.update(meetingWeeks)
      .set({ agendas: agendas as any, weekFrom: from, weekTo: to, generatedAt: new Date(), generatedBy: by, updatedAt: new Date() })
      .where(eq(meetingWeeks.id, existing.id)).returning();
    return updated;
  }
  const [created] = await db.insert(meetingWeeks)
    .values({ monday: mondayIso, agendas: agendas as any, weekFrom: from, weekTo: to, generatedAt: new Date(), generatedBy: by })
    .returning();
  return created;
}

const actionView = (a: typeof meetingActions.$inferSelect, names: Map<string, string>, fromWeek?: string | null): MeetingActionView => ({
  id: a.id,
  meeting: a.meeting as MeetingKey,
  text: a.actionText,
  ownerEmail: a.ownerEmail,
  ownerName: a.ownerEmail ? names.get(a.ownerEmail) ?? a.ownerEmail : null,
  dueDate: a.dueDate,
  doneAt: iso(a.doneAt),
  createdBy: a.createdBy,
  fromWeek: fromWeek ?? null,
});

/**
 * Scorecard, rocks, issues and rating for each room this person may open.
 *
 * Payroll is skipped on purpose: it is a processing meeting, not a leadership
 * room, and giving it an issues list would add ceremony to the one meeting
 * whose job is simply to get money out of the door.
 */
async function loadSpine(
  mondayIso: string,
  viewer: string,
  role: string,
  allowed: MeetingKey[],
  actionsThisWeek: Array<{ meeting: string; doneAt: Date | null }>,
): Promise<Partial<Record<MeetingKey, MeetingSpine>>> {
  const isAdminRole = role === 'admin' || role === 'sales_director';
  const rooms = L10_MEETINGS.filter((m) => allowed.includes(m));
  const out: Partial<Record<MeetingKey, MeetingSpine>> = {};
  await Promise.all(rooms.map(async (meeting) => {
    // Company numbers are the admin room's. A rep gets their own scorecard and
    // nobody else's — decided here rather than in the page, so a rep's browser
    // never receives a colleague's week at all.
    const [scorecard, repScorecards, rocksNow, issues, scores] = await Promise.all([
      isAdminRole ? loadScorecard(meeting, mondayIso) : Promise.resolve([]),
      loadRepScorecards(meeting, mondayIso, isAdminRole ? undefined : viewer),
      loadRocks(meeting, currentQuarter(mondayIso)),
      loadIssues(meeting),
      ratingsFor(meeting, mondayIso),
    ]);
    const mine = await db.select({ score: meetingRatings.score }).from(meetingRatings)
      .where(and(eq(meetingRatings.meeting, meeting), eq(meetingRatings.monday, mondayIso), eq(meetingRatings.raterEmail, viewer)));
    out[meeting] = {
      scorecard,
      repScorecards,
      rocks: rocksNow,
      issues,
      top: topIssues(issues, mondayIso),
      rating: { mine: mine[0]?.score ?? null, average: averageRating(scores), count: scores.length },
      todos: todoCompletion(actionsThisWeek.filter((a) => a.meeting === meeting).map((a) => ({ doneAt: a.doneAt ? a.doneAt.toISOString() : null }))),
    };
  }));
  return out;
}

export function registerMeetingRoutes(app: Express) {
  /**
   * The pack for a Monday — this week's unless one is asked for.
   *
   * Only the agendas this person may see are returned; a rep gets the sales
   * meeting and nothing else, rather than a payroll section hidden by CSS.
   */
  app.get('/api/meetings', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const user = req.session.user! as SessionUser;
    const mondayIso = isDate(req.query.monday) ? req.query.monday : mondayFor(new Date());
    const allowed = new Set(visibleMeetings(user.role).map((m) => m.key));

    const [week] = await db.select().from(meetingWeeks).where(eq(meetingWeeks.monday, mondayIso));
    const { from, to } = weekBefore(mondayIso);

    if (!week) {
      const pack: MeetingPack = {
        mondayIso, generatedAt: null, weekFrom: from, weekTo: to,
        agendas: [], notes: {}, actions: [], carriedOver: [], spine: {},
      };
      return res.json({ pack, meetings: visibleMeetings(user.role), generated: false });
    }

    const members = await db.select({ email: teamMembers.email, name: teamMembers.name }).from(teamMembers);
    const names = new Map(members.map((m) => [m.email, m.name]));

    const [noteRows, actionRows] = await Promise.all([
      db.select().from(meetingNotes).where(eq(meetingNotes.weekId, week.id)),
      db.select().from(meetingActions).where(eq(meetingActions.weekId, week.id)).orderBy(asc(meetingActions.id)),
    ]);

    // Anything still open from an earlier week, so nothing quietly drops.
    const earlier = await db.select({ a: meetingActions, monday: meetingWeeks.monday })
      .from(meetingActions)
      .innerJoin(meetingWeeks, eq(meetingActions.weekId, meetingWeeks.id))
      .where(and(isNull(meetingActions.doneAt), ne(meetingWeeks.monday, mondayIso)))
      .orderBy(asc(meetingWeeks.monday)).limit(50);

    const notes: Partial<Record<MeetingKey, string>> = {};
    for (const n of noteRows) if (allowed.has(n.meeting as MeetingKey)) notes[n.meeting as MeetingKey] = n.notes;

    const pack: MeetingPack = {
      mondayIso,
      generatedAt: iso(week.generatedAt),
      weekFrom: week.weekFrom ?? from,
      weekTo: week.weekTo ?? to,
      agendas: ((week.agendas as any[]) ?? []).filter((a) => allowed.has(a.key)),
      notes,
      actions: actionRows.filter((a) => allowed.has(a.meeting as MeetingKey)).map((a) => actionView(a, names)),
      carriedOver: earlier
        .filter((r) => allowed.has(r.a.meeting as MeetingKey) && r.monday < mondayIso)
        .map((r) => actionView(r.a, names, r.monday)),
      spine: await loadSpine(mondayIso, user.email, user.role, [...allowed], actionRows),
    };
    res.json({ pack, meetings: visibleMeetings(user.role), generated: true });
  }));

  /** Rebuild this Monday's numbers — for when something moved overnight. */
  app.post('/api/meetings/refresh', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const user = req.session.user! as SessionUser;
    if (user.role !== 'admin' && user.role !== 'sales_director') return res.status(403).json({ error: 'not authorized' });
    const mondayIso = isDate(req.body?.monday) ? req.body.monday : mondayFor(new Date());
    const week = await generatePack(mondayIso, user.email);
    await logWrite({ actor: user.email, system: 'app', action: 'meeting_pack_refreshed', targetId: mondayIso, summary: 'Rebuilt from live data', ok: true, error: null });
    res.json({ ok: true, generatedAt: iso(week.generatedAt) });
  }));

  /** What was said in one room. */
  app.put('/api/meetings/:meeting/notes', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const user = req.session.user! as SessionUser;
    const meeting = req.params.meeting;
    if (!isMeetingKey(meeting) || !canOpenMeeting(user.role, meeting)) return res.status(404).json({ error: 'not found' });

    const mondayIso = isDate(req.body?.monday) ? req.body.monday : mondayFor(new Date());
    const [week] = await db.select().from(meetingWeeks).where(eq(meetingWeeks.monday, mondayIso));
    if (!week) return res.status(400).json({ error: 'There is no meeting pack for that week yet.' });

    const notes = String(req.body?.notes ?? '').slice(0, 20000);
    await db.insert(meetingNotes)
      .values({ weekId: week.id, meeting, notes, updatedBy: user.email })
      .onConflictDoUpdate({
        target: [meetingNotes.weekId, meetingNotes.meeting],
        set: { notes, updatedBy: user.email, updatedAt: new Date() },
      });
    res.json({ ok: true });
  }));

  /** Something somebody agreed to do. */
  app.post('/api/meetings/:meeting/actions', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const user = req.session.user! as SessionUser;
    const meeting = req.params.meeting;
    if (!isMeetingKey(meeting) || !canOpenMeeting(user.role, meeting)) return res.status(404).json({ error: 'not found' });

    const text = str(req.body?.text, 500);
    if (text.length < 3) return res.status(400).json({ error: 'Write what needs doing.' });

    const mondayIso = isDate(req.body?.monday) ? req.body.monday : mondayFor(new Date());
    const [week] = await db.select().from(meetingWeeks).where(eq(meetingWeeks.monday, mondayIso));
    if (!week) return res.status(400).json({ error: 'There is no meeting pack for that week yet.' });

    const ownerEmail = str(req.body?.ownerEmail, 160).toLowerCase() || null;
    const dueDate = isDate(req.body?.dueDate) ? req.body.dueDate : null;
    const [row] = await db.insert(meetingActions)
      .values({ weekId: week.id, meeting, actionText: text, ownerEmail, dueDate, createdBy: user.email })
      .returning();

    const members = await db.select({ email: teamMembers.email, name: teamMembers.name }).from(teamMembers);
    res.json({ ok: true, action: actionView(row, new Map(members.map((m) => [m.email, m.name]))) });
  }));

  /** Tick it off, or put it back. */
  app.patch('/api/meetings/actions/:id', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const user = req.session.user! as SessionUser;
    const [existing] = await db.select().from(meetingActions).where(eq(meetingActions.id, Number(req.params.id)));
    if (!existing || !canOpenMeeting(user.role, existing.meeting as MeetingKey)) return res.status(404).json({ error: 'not found' });

    const done = req.body?.done === true;
    const [row] = await db.update(meetingActions)
      .set(done ? { doneAt: new Date(), doneBy: user.email } : { doneAt: null, doneBy: null })
      .where(eq(meetingActions.id, existing.id)).returning();

    const members = await db.select({ email: teamMembers.email, name: teamMembers.name }).from(teamMembers);
    res.json({ ok: true, action: actionView(row, new Map(members.map((m) => [m.email, m.name]))) });
  }));

  app.delete('/api/meetings/actions/:id', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const user = req.session.user! as SessionUser;
    const [existing] = await db.select().from(meetingActions).where(eq(meetingActions.id, Number(req.params.id)));
    if (!existing || !canOpenMeeting(user.role, existing.meeting as MeetingKey)) return res.status(404).json({ error: 'not found' });
    // Only whoever wrote it, or an admin, can take it away again.
    if (existing.createdBy !== user.email && user.role !== 'admin') return res.status(403).json({ error: 'not authorized' });
    await db.delete(meetingActions).where(eq(meetingActions.id, existing.id));
    res.json({ ok: true });
  }));

  /**
   * Sunday evening: build next morning's pack.
   *
   * Runs late on Sunday in the company's time zone, which is already Monday in UTC — see
   * mondayFor(), which files the pack under the local Monday rather than the
   * UTC day it happens to be.
   */
  // ------------------------------------------------------------- the spine

  const room = (req: Request): MeetingKey | null => {
    const m = req.params.meeting;
    const user = req.session.user! as SessionUser;
    return isMeetingKey(m) && canOpenMeeting(user.role, m) && L10_MEETINGS.includes(m) ? m : null;
  };
  const isLead = (u: SessionUser) => u.role === 'admin' || u.role === 'sales_director';

  /** Raise an issue by hand, in the room it belongs to. */
  app.post('/api/meetings/:meeting/issues', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const user = req.session.user! as SessionUser;
    const meeting = room(req);
    if (!meeting) return res.status(404).json({ error: 'not found' });
    const title = String(req.body?.title ?? '').trim();
    if (!title) return res.status(400).json({ error: 'An issue needs a sentence saying what it is.' });
    const mondayIso = isDate(req.body?.monday) ? req.body.monday : mondayFor(new Date());
    const issue = await raiseIssue({
      meeting, title, detail: String(req.body?.detail ?? '').trim() || null,
      source: 'manual', raisedBy: user.email, firstSeenWeek: mondayIso,
    });
    res.json({ ok: true, issue });
  }));

  /**
   * Work an issue: pick it for today, solve it, or drop it.
   *
   * Solving and dropping are one-way and only from open — a second solve must
   * not overwrite who closed it or when, which is the record of the decision.
   */
  app.patch('/api/meetings/issues/:id', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const user = req.session.user! as SessionUser;
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'bad id' });

    const [issue] = await db.select().from(meetingIssues).where(eq(meetingIssues.id, id));
    if (!issue || !canOpenMeeting(user.role, issue.meeting as MeetingKey)) return res.status(404).json({ error: 'not found' });

    const action = String(req.body?.action ?? '');
    const note = String(req.body?.note ?? '').trim() || null;
    if (action === 'priority') {
      const p = req.body?.priority;
      if (p !== null && !(Number.isInteger(p) && p >= 1 && p <= 3)) return res.status(400).json({ error: 'priority must be 1, 2, 3 or null' });
      await setIssuePriority(id, p ?? null);
    } else if (action === 'solve') {
      await solveIssue(id, user.email, note);
    } else if (action === 'drop') {
      if (!isLead(user)) return res.status(403).json({ error: 'Only a lead can drop an issue.' });
      await dropIssue(id, user.email, note);
    } else {
      return res.status(400).json({ error: 'action must be priority, solve or drop' });
    }
    await logWrite({ actor: user.email, system: 'app', action: `issue_${action}`, targetId: String(id), summary: issue.title.slice(0, 120), ok: true, error: null });
    res.json({ ok: true });
  }));

  /** A quarterly priority. */
  app.post('/api/meetings/:meeting/rocks', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const user = req.session.user! as SessionUser;
    const meeting = room(req);
    if (!meeting) return res.status(404).json({ error: 'not found' });
    if (!isLead(user)) return res.status(403).json({ error: 'Only a lead can set a rock.' });
    const title = String(req.body?.title ?? '').trim();
    if (!title) return res.status(400).json({ error: 'A rock needs a title.' });
    const mondayIso = isDate(req.body?.monday) ? req.body.monday : mondayFor(new Date());
    const [row] = await db.insert(rocksTable).values({
      meeting, title: title.slice(0, 300),
      ownerEmail: String(req.body?.ownerEmail ?? '').trim().toLowerCase() || null,
      quarter: String(req.body?.quarter ?? '').trim() || quarterOf(mondayIso),
      dueDate: isDate(req.body?.dueDate) ? req.body.dueDate : null,
      notes: String(req.body?.notes ?? '').trim() || null,
      createdBy: user.email,
    }).returning();
    res.json({ ok: true, rock: row });
  }));

  app.patch('/api/meetings/rocks/:id', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const user = req.session.user! as SessionUser;
    if (!isLead(user)) return res.status(403).json({ error: 'Only a lead can change a rock.' });
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'bad id' });
    const status = String(req.body?.status ?? '');
    if (status && !['on_track', 'off_track', 'done'].includes(status)) {
      return res.status(400).json({ error: 'status must be on_track, off_track or done' });
    }
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (status) patch.status = status;
    if (typeof req.body?.title === 'string' && req.body.title.trim()) patch.title = req.body.title.trim().slice(0, 300);
    if (typeof req.body?.ownerEmail === 'string') patch.ownerEmail = req.body.ownerEmail.trim().toLowerCase() || null;
    if (typeof req.body?.notes === 'string') patch.notes = req.body.notes.trim() || null;
    await db.update(rocksTable).set(patch).where(eq(rocksTable.id, id));
    res.json({ ok: true });
  }));

  /** The goal and the owner on one scorecard number. */
  app.patch('/api/meetings/scorecard/:id', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const user = req.session.user! as SessionUser;
    if (!isLead(user)) return res.status(403).json({ error: 'Only a lead can set a goal.' });
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'bad id' });

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if ('goal' in (req.body ?? {})) {
      const g = req.body.goal;
      if (g === null || g === '') patch.goal = null;
      else if (Number.isFinite(Number(g))) patch.goal = String(Number(g));
      else return res.status(400).json({ error: 'A goal must be a number, or empty to unset it.' });
    }
    if (typeof req.body?.ownerEmail === 'string') patch.ownerEmail = req.body.ownerEmail.trim().toLowerCase() || null;
    if (req.body?.direction === 'at_least' || req.body?.direction === 'at_most') patch.direction = req.body.direction;
    if (typeof req.body?.active === 'boolean') patch.active = req.body.active;
    await db.update(scorecardMetrics).set(patch).where(eq(scorecardMetrics.id, id));
    res.json({ ok: true });
  }));

  /** Everything the scorecard could measure, for the page that configures it. */
  app.get('/api/meetings/measures', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const user = req.session.user! as SessionUser;
    if (!isLead(user)) return res.status(403).json({ error: 'not authorized' });
    res.json({
      measures: MEASURES.map((m) => ({
        key: m.key, label: m.label, meeting: m.meeting, unit: m.unit,
        direction: m.direction, hint: m.hint,
        // Only these can carry a per-rep goal; the rest are desk numbers.
        perRep: !!m.computeForRep,
      })),
    });
  }));

  /** Rate the meeting on the way out. Rating again replaces your score. */
  app.post('/api/meetings/:meeting/rating', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const user = req.session.user! as SessionUser;
    const meeting = room(req);
    if (!meeting) return res.status(404).json({ error: 'not found' });
    const score = req.body?.score;
    if (!isValidRating(score)) return res.status(400).json({ error: 'A score is a whole number from 1 to 10.' });
    const mondayIso = isDate(req.body?.monday) ? req.body.monday : mondayFor(new Date());
    await rateMeeting(meeting, mondayIso, user.email, score, String(req.body?.note ?? '').trim() || null);
    res.json({ ok: true });
  }));

  /**
   * Hourly, for every live company, as that company and in its own time zone:
   *   - Sunday from 6 PM local, build next week's pack if it is not built yet;
   *   - otherwise refresh this week's pack so the rooms are never a week stale
   *     (a refresh never creates a pack early).
   */
  app.get('/api/cron/meetings', asyncHandler(async (req: Request, res: Response) => {
    if (!cronAuthorized(req)) return res.status(401).json({ error: 'unauthorized' });
    const now = new Date();
    const companies = await forEachLiveCompany(async () => {
      const mondayIso = mondayFor(now);
      const [existing] = await db.select({ id: meetingWeeks.id }).from(meetingWeeks).where(eq(meetingWeeks.monday, mondayIso));
      const local = etParts(now);
      const sundayEvening = dayOfWeek(local.date) === 0 && local.minutes >= 18 * 60;
      if (!existing) {
        if (!sundayEvening) return { monday: mondayIso, skipped: 'no pack yet' };
        const week = await generatePack(mondayIso, 'system:cron');
        await logWrite({
          actor: 'system:cron', system: 'app', action: 'meeting_pack_built', targetId: mondayIso,
          summary: `Pack for ${mondayIso}`, ok: true, error: null,
        });
        return { monday: mondayIso, built: iso(week.generatedAt) };
      }
      const week = await generatePack(mondayIso, 'system:refresh', { fileIssues: false });
      return { monday: mondayIso, refreshed: iso(week.generatedAt) };
    });
    res.json({ ok: companies.every((c) => c.ok), companies });
  }));
}
