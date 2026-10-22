/**
 * The morning rep check-in: the cron that sends it, and the record leaders
 * read to see who was reminded and what they had outstanding.
 */
import { timingSafeEqual } from 'node:crypto';
import type { Express, Request, Response } from 'express';
import { desc, eq } from 'drizzle-orm';
import { db } from '../db';
import { repDailyReminders, teamMembers } from '../../shared/schema';
import { requireAuth } from '../auth/middleware';
import type { SessionUser } from '../access/rep-scope';
import { visibleIdsFor } from '../access/team-scope';
import { dataScope } from '../../shared/rbac';
import { sendFailure } from '../lib/failure';
import { logWrite } from '../writes/log';
import { easternNow, isSendWindow, runRepReminders } from './daily-reminder';

/** Constant-time, so the secret can't be guessed a character at a time from response timing. */
function cronAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = Buffer.from(String(req.headers['authorization'] ?? ''));
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

const appUrl = (): string => (process.env.APP_BASE_URL || 'https://app.bestroofingnow.com').replace(/\/+$/, '');

export function registerRepReminderRoutes(app: Express) {
  // Scheduled at 12:00 and 13:00 UTC; only the run at 8 AM Eastern sends.
  // `?force=1` skips the clock for a manual run — still one message per rep per day.
  app.get('/api/cron/rep-daily-reminder', async (req: Request, res: Response) => {
    if (!cronAuthorized(req)) return res.status(401).json({ error: 'unauthorized' });
    try {
      const now = new Date();
      if (req.query.force !== '1' && !isSendWindow(now)) {
        return res.json({ ok: true, skipped: 'outside the 8 AM Eastern window', eastern: easternNow(now) });
      }
      const result = await runRepReminders(now, appUrl());
      await logWrite({
        actor: 'system:cron', system: 'app', action: 'rep_daily_reminder', targetId: result.date,
        summary: `${result.sent} sent, ${result.nothingToDo} with nothing to do, ${result.failed} failed (${result.reps} reps)`,
        ok: result.failed === 0, error: null,
      });
      res.json({ ok: true, ...result });
    } catch (error: any) {
      return sendFailure(res, error, 'GET /api/cron/rep-daily-reminder');
    }
  });

  // Who got a check-in, and what was outstanding — for the reps a leader can see.
  app.get('/api/canvass/reminders', requireAuth, async (req: Request, res: Response) => {
    try {
      const user = req.session.user! as SessionUser;
      if (dataScope(user.role) === 'self') return res.status(403).json({ error: 'Leaders and admins only.' });
      const ids = await visibleIdsFor(user);
      const rows = await db.select({
        date: repDailyReminders.reminderDate, repName: teamMembers.name, teamMemberId: repDailyReminders.teamMemberId,
        counts: repDailyReminders.counts, emailStatus: repDailyReminders.emailStatus, smsStatus: repDailyReminders.smsStatus,
        error: repDailyReminders.error, sentAt: repDailyReminders.sentAt,
      })
        .from(repDailyReminders)
        .innerJoin(teamMembers, eq(teamMembers.id, repDailyReminders.teamMemberId))
        .orderBy(desc(repDailyReminders.sentAt))
        .limit(300);
      res.json({ reminders: ids === null ? rows : rows.filter((r) => ids.includes(r.teamMemberId)) });
    } catch (error: any) {
      return sendFailure(res, error, 'GET /api/canvass/reminders');
    }
  });
}
