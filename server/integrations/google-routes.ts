/**
 * Google Workspace panel on the Integrations screen.
 *
 * Every route here reads the SIGNED-IN user's own Calendar/Drive through the
 * service account's domain-wide delegation, so there is no "connect" step and
 * no per-user OAuth token to store: the Workspace admin granted the delegation
 * once and each account on the company's delegated domain is reachable as itself.
 *
 * This replaced ~22 routes that shared one process-global OAuth token. Those
 * had two problems. None of them called requireAuth (auth in this app is
 * per-route; there is no global guard), and under Fluid Compute a function
 * instance is reused across requests — so a token established by one caller
 * could be read, or used to SEND mail, by any later unauthenticated caller.
 * Separately, nothing ever completed that OAuth flow in production, so the
 * panel showed "Not connected" permanently. Delegation fixes both.
 */
import type { Express, Request, Response } from 'express';
import { requireAuth } from '../auth/middleware';
import { getDelegatedCalendar } from '../integrations/google-workspace';
import { getDelegatedDrive } from '../agents/google-tools';
import { sendUpstreamFailure } from '../lib/upstream';

const clamp = (v: unknown, def: number, max: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(Math.max(Math.trunc(n), 1), max) : def;
};

/**
 * The caller's own mailbox. Delegation impersonates this and nothing else.
 * Sessions live on req.session.user (what requireAuth checks) — NOT req.user,
 * which passport would populate and this app never sets.
 */
export function callerMailbox(req: Pick<Request, 'session'> | any): string | null {
  return req?.session?.user?.email || null;
}

export function registerGoogleRoutes(app: Express): void {
  /**
   * Is Workspace actually reachable for THIS user? Answered by making a real
   * (tiny) delegated call rather than by checking that env vars exist — a
   * mailbox missing from the delegation grant has the env set and still fails.
   */
  app.get('/api/integrations/google/status', requireAuth, async (req: Request, res: Response) => {
    const mailbox = callerMailbox(req);
    if (!mailbox) return res.json({ connected: false, error: 'No mailbox on this account' });
    if (!process.env.GOOGLE_SA_EMAIL || !process.env.GOOGLE_SA_KEY) {
      return res.json({ connected: false, email: mailbox, error: 'Workspace delegation is not configured on the server' });
    }
    try {
      await getDelegatedCalendar(mailbox).events.list({
        calendarId: 'primary',
        timeMin: new Date().toISOString(),
        maxResults: 1,
        singleEvents: true,
      });
      res.json({ connected: true, email: mailbox });
    } catch (e: any) {
      res.json({ connected: false, email: mailbox, error: e?.message || 'Could not reach Google' });
    }
  });

  app.get('/api/integrations/google/calendar/events', requireAuth, async (req: Request, res: Response) => {
    const mailbox = callerMailbox(req);
    if (!mailbox) return res.status(400).json({ error: 'No mailbox on this account' });
    try {
      const now = new Date();
      const r = await getDelegatedCalendar(mailbox).events.list({
        calendarId: 'primary',
        timeMin: now.toISOString(),
        timeMax: new Date(now.getTime() + 30 * 864e5).toISOString(),
        singleEvents: true,
        orderBy: 'startTime',
        maxResults: clamp(req.query.maxResults, 10, 50),
      });
      const events = (r.data.items || [])
        .filter((e) => e.status !== 'cancelled')
        .map((e) => ({
          id: e.id,
          summary: e.summary || '(no title)',
          description: e.description || undefined,
          location: e.location || undefined,
          start: e.start || {},
          end: e.end || {},
          attendees: (e.attendees || [])
            .filter((a) => !!a.email)
            .map((a) => ({ email: a.email as string, displayName: a.displayName || undefined })),
          htmlLink: e.htmlLink || undefined,
        }));
      res.json({ events });
    } catch (e) {
      return sendUpstreamFailure(res, e, 'Google Calendar', 'GET /api/integrations/google/calendar/events');
    }
  });

  app.get('/api/integrations/google/drive/files', requireAuth, async (req: Request, res: Response) => {
    const mailbox = callerMailbox(req);
    if (!mailbox) return res.status(400).json({ error: 'No mailbox on this account' });
    try {
      const r = await getDelegatedDrive(mailbox).files.list({
        q: 'trashed = false',
        orderBy: 'modifiedTime desc',
        pageSize: clamp(req.query.maxResults, 15, 50),
        fields: 'files(id,name,mimeType,size,modifiedTime,createdTime,webViewLink)',
      });
      res.json({ files: r.data.files || [] });
    } catch (e) {
      return sendUpstreamFailure(res, e, 'Google Drive', 'GET /api/integrations/google/drive/files');
    }
  });
}
