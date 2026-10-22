import type { Express, Request, Response } from 'express';
import { requireAuth } from '../auth/middleware';
import type { SessionUser } from '../access/rep-scope';
import { loadBoard } from './board';
import { addDays, etInstant, etToday } from '../../shared/schedule-board';
import { sendFailure } from '../lib/failure';

export function registerBoardRoutes(app: Express) {
  /**
   * The calendars this person may see (Google live + GoHighLevel), with
   * everything on them for the requested Charlotte day(s). ?date=YYYY-MM-DD
   * (default today), ?days=1..7, ?everyone=1 adds the office calendars.
   */
  app.get('/api/schedule/board', requireAuth, async (req: Request, res: Response) => {
    try {
      const user = req.session.user! as SessionUser;
      const date = String(req.query.date || '').trim() || etToday();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(new Date(`${date}T12:00:00Z`).getTime())) return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
      const days = Math.min(Math.max(Math.round(Number(req.query.days)) || 1, 1), 7);
      const from = etInstant(date, '00:00');
      const to = etInstant(addDays(date, days), '00:00');
      const board = await loadBoard(user, from, to, req.query.everyone === '1');
      res.json({ date, days, from: from.toISOString(), to: to.toISOString(), ...board });
    } catch (error: any) {
      return sendFailure(res, error, 'GET /api/schedule/board');
    }
  });
}
