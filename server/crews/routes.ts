/**
 * Crews and install dates (Stage D), for a company that keeps its own jobs
 * (a company Roof Lee made, server/production/native-jobs.ts keepsOwnJobs).
 * Every other company gets 404 on every one of these, so nothing changes for
 * it. docs/archie/02-roof-lee-link.md, "Crews and install dates".
 *
 * Two kinds of route, with two separate checks:
 *
 *   /api/crews..., /api/jobs/{key}/install   the office: office staff and up
 *       (shared/crews.ts mayScheduleCrews), and for one job, someone who may
 *       open it (ownsLead).
 *
 *   /api/crew/...                            a crew member on their phone:
 *       ONLY through crewJobFor below, which asks one thing: is this job
 *       booked for the crew this person is on? It never asks ownsLead and
 *       nothing here widens ownsLead, because two routes that return money
 *       check only ownsLead. What a crew sees is built by crewJobView
 *       (./view.ts), an allow-list with no money in it.
 */
import type { Express, Request, Response } from 'express';
import type { Lead } from '../../shared/schema';
import { requireAuth } from '../auth/middleware';
import { ownsLead, type SessionUser } from '../access/rep-scope';
import { asyncHandler } from '../lib/async-handler';
import { completeTrade } from '../production/pipeline';
import { addNativePhoto, listNativePhotos, MAX_PHOTO_BYTES } from '../photos/native';
import { photoStore } from '../photos/store';
import { etToday } from '../../shared/schedule-board';
import {
  CREW_ROLE, checkCrewName, checkInstallBooking, isIsoDate, mayScheduleCrews, weekDates, weekStartOf,
} from '../../shared/crews';
import {
  assignmentFor, bookInstall, clearInstall, createCrew, crewAssignmentsOf, crewOfPerson, crewPeople, listCrews,
  setCrewMembers, setInstallStatus, updateCrew, weekBoard,
} from './store';
import { crewJobView } from './view';
import { crewJobFor, leadOf, ownJobsCompany, tradesOf } from './access';

/** Said when a crew ticks a trade on a job the office has not put on the Production board. */
export const CREW_NOT_ON_BOARD = 'This job isn\'t on the Production board yet. Ask the office to start production.';

/** Said when a crew photo names a phase other than During or After. */
export const CREW_PHOTO_PHASE = 'Pick During or After.';

const notFound = (res: Response) => res.status(404).json({ error: 'not found' });

export function registerCrewRoutes(app: Express) {
  // ---------------------------------------------------------------- the office

  /** Office staff and up in a company that keeps its own jobs, else null (answered 404). */
  const office = async (req: Request): Promise<SessionUser | null> => {
    const user = req.session.user as SessionUser | undefined;
    if (!user || !mayScheduleCrews(user.role)) return null;
    if (!(await ownJobsCompany())) return null;
    return user;
  };

  /** A job of Archie's own this office person may open, else null. */
  const officeJob = async (req: Request): Promise<{ user: SessionUser; lead: Lead } | null> => {
    const user = await office(req);
    if (!user) return null;
    const lead = await leadOf(req.params.key);
    if (!lead || !(await ownsLead(user, lead.externalId))) return null;
    return { user, lead };
  };

  // The company's crews and the people who can be on one.
  app.get('/api/crews', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    if (!(await office(req))) return notFound(res);
    const [list, people] = await Promise.all([listCrews(), crewPeople()]);
    res.json({ crews: list, people });
  }));

  app.post('/api/crews', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const user = await office(req);
    if (!user) return notFound(res);
    const name = checkCrewName(req.body?.name);
    if (!name.ok) return res.status(400).json({ error: name.error });
    const color = typeof req.body?.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(req.body.color) ? req.body.color : null;
    const r = await createCrew(name.value, color, user.email);
    if (!r.ok) return res.status(r.status).json({ error: r.error });
    res.json({ ok: true, crew: r.value });
  }));

  app.patch('/api/crews/:id', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const user = await office(req);
    if (!user) return notFound(res);
    const patch: { name?: string; color?: string | null; active?: boolean } = {};
    if (req.body?.name !== undefined) {
      const name = checkCrewName(req.body.name);
      if (!name.ok) return res.status(400).json({ error: name.error });
      patch.name = name.value;
    }
    if (typeof req.body?.active === 'boolean') patch.active = req.body.active;
    if (req.body?.color === null || (typeof req.body?.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(req.body.color))) patch.color = req.body.color;
    const r = await updateCrew(req.params.id, patch, user.email);
    if (!r.ok) return res.status(r.status).json({ error: r.error });
    res.json({ ok: true, crew: r.value });
  }));

  app.put('/api/crews/:id/members', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const user = await office(req);
    if (!user) return notFound(res);
    const r = await setCrewMembers(req.params.id, req.body?.memberIds, user.email);
    if (!r.ok) return res.status(r.status).json({ error: r.error });
    res.json({ ok: true, memberIds: r.value });
  }));

  // The crew week: every install from Monday to Sunday (company dates) and the jobs still waiting for one.
  app.get('/api/crews/week', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    if (!(await office(req))) return notFound(res);
    const asked = typeof req.query.week === 'string' && isIsoDate(req.query.week) ? req.query.week : etToday();
    const monday = weekStartOf(asked);
    const days = weekDates(monday);
    const [list, board] = await Promise.all([listCrews(), weekBoard(monday, days[6])]);
    res.json({
      weekStart: monday, days, today: etToday(),
      crews: list.filter((c) => c.active || board.installs.some((i) => i.crewId === c.id)).map((c) => ({ id: c.id, name: c.name, color: c.color, active: c.active, people: c.members.length })),
      installs: board.installs,
      unbooked: board.unbooked,
    });
  }));

  // One job's install.
  app.get('/api/jobs/:key/install', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const job = await officeJob(req);
    if (!job) return notFound(res);
    res.json({ install: await assignmentFor(job.lead.externalId!) });
  }));

  app.put('/api/jobs/:key/install', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const job = await officeJob(req);
    if (!job) return notFound(res);
    const booking = checkInstallBooking(req.body);
    if (!booking.ok) return res.status(400).json({ error: booking.error });
    const r = await bookInstall(job.lead.externalId!, booking.value, job.user.email);
    if (!r.ok) return res.status(r.status).json({ error: r.error });
    res.json({ ok: true, install: r.value });
  }));

  app.delete('/api/jobs/:key/install', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const job = await officeJob(req);
    if (!job) return notFound(res);
    const r = await clearInstall(job.lead.externalId!, job.user.email);
    if (!r.ok) return res.status(r.status).json({ error: r.error });
    res.json({ ok: true });
  }));

  app.post('/api/jobs/:key/install/status', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const job = await officeJob(req);
    if (!job) return notFound(res);
    const r = await setInstallStatus(job.lead.externalId!, req.body?.status, job.user.email, 'office');
    if (!r.ok) return res.status(r.status).json({ error: r.error });
    res.json({ ok: true, install: r.value });
  }));

  // ---------------------------------------------------------------- the crew's own phone

  /** The crew member's job, through crewJobFor only. */
  const crewJob = (req: Request) => crewJobFor(req.session.user as SessionUser, req.params.key);

  // The crew's installs, soonest first. Empty for anyone not on a crew.
  app.get('/api/crew/jobs', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const user = req.session.user as SessionUser;
    if (user?.role !== CREW_ROLE || !(await ownJobsCompany())) return notFound(res);
    const crew = await crewOfPerson(user.email);
    if (!crew) return res.json({ crewName: null, today: etToday(), jobs: [] });
    const today = etToday();
    const rows = await crewAssignmentsOf(crew.crewId, today);
    const jobs = [];
    for (const a of rows) {
      const lead = await leadOf(a.jobKey);
      if (!lead) continue;
      jobs.push(crewJobView(lead, a, crew.crewName, await tradesOf(a.jobKey), today));
    }
    res.json({ crewName: crew.crewName, today, jobs });
  }));

  app.get('/api/crew/jobs/:key', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const seen = await crewJob(req);
    if (!seen) return notFound(res);
    res.json({ job: crewJobView(seen.lead, seen.assignment, seen.crewName, await tradesOf(seen.assignment.jobKey), etToday()) });
  }));

  // Started, or done. Forward only, one step at a time.
  app.post('/api/crew/jobs/:key/status', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const seen = await crewJob(req);
    if (!seen) return notFound(res);
    const r = await setInstallStatus(seen.assignment.jobKey, req.body?.status, (req.session.user as SessionUser).email, 'crew');
    if (!r.ok) return res.status(r.status).json({ error: r.error });
    res.json({ job: crewJobView(seen.lead, r.value, seen.crewName, await tradesOf(seen.assignment.jobKey), etToday()) });
  }));

  // A trade finished: the same tick the production board makes, through the crew check.
  app.post('/api/crew/jobs/:key/trade-done', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const seen = await crewJob(req);
    if (!seen) return notFound(res);
    // A tick never puts a job on the board: only the office does that (Start production).
    if (!(await tradesOf(seen.assignment.jobKey))) return res.status(409).json({ error: CREW_NOT_ON_BOARD });
    const r = await completeTrade(seen.assignment.jobKey, req.body?.trade, (req.session.user as SessionUser).email);
    if (!r.ok) return res.status(r.status).json({ error: r.error });
    res.json({ completed: r.completed, job: crewJobView(seen.lead, seen.assignment, seen.crewName, r.row.trades, etToday()) });
  }));

  // The job's photos, as the job's other photos are shown.
  app.get('/api/crew/jobs/:key/photos', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const seen = await crewJob(req);
    if (!seen) return notFound(res);
    res.json(await listNativePhotos(seen.assignment.jobKey, req.session.user as SessionUser, { before: req.query.before, limit: req.query.limit, phase: req.query.phase }));
  }));

  // A photo from the roof: During or After, kept in Archie's own store with no location.
  app.post('/api/crew/jobs/:key/photos', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const seen = await crewJob(req);
    if (!seen) return notFound(res);
    const body = { ...(req.body ?? {}) } as Record<string, unknown>;
    if (body.phase === undefined || body.phase === null || body.phase === '') body.phase = 'during';
    if (body.phase !== 'during' && body.phase !== 'after') return res.status(400).json({ error: CREW_PHOTO_PHASE });
    const r = await addNativePhoto({ user: req.session.user as SessionUser, jobKey: seen.assignment.jobKey, body, store: photoStore(), maxBytes: MAX_PHOTO_BYTES });
    res.status(r.status).json(r.body);
  }));
}
