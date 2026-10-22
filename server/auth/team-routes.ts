import { calendarSeeAllEmails, setCalendarSeeAll } from '../calendar/access';
import type { Express, Request, Response } from 'express';
import { clearSessionRevalidationCache, requireRole } from './middleware';
import { asyncHandler } from '../lib/async-handler';
import { validateTeamMemberInput, validateTeamMemberPatch } from '../storage/team-validate';
import { listTeamMembers, createTeamMember, updateTeamMember, memberByJobtreadRep, getTeamMemberById } from '../storage/team';
import { syncSalesRepsFromJobTread } from '../sync/jobtread-reps';
import { pushRoleToJobTread } from '../sync/jobtread-roles';
import { sendUpstreamFailure } from '../lib/upstream';

/** Postgres unique_violation. team_members.email is NOT NULL UNIQUE. */
const DUPLICATE_KEY = '23505';

export function registerTeamRoutes(app: Express) {
  app.get('/api/team', requireRole('admin'), asyncHandler(async (_req: Request, res: Response) => {
    const [members, seeAll] = await Promise.all([listTeamMembers(), calendarSeeAllEmails().catch((): string[] => [])]);
    res.json(members.map((m: any) => ({ ...m, seesAllCalendars: seeAll.includes(String(m.email || '').toLowerCase()) })));
  }));

  // "Sees all calendars" — for a cold caller or coordinator who books for the
  // whole team. Kept in settings, not on the roster row.
  app.patch('/api/team/:id/calendar-access', requireRole('admin'), asyncHandler(async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ message: 'Bad id' });
    const members = await listTeamMembers();
    const m: any = members.find((x: any) => x.id === id);
    if (!m) return res.status(404).json({ message: 'Not on the team' });
    const on = req.body?.seesAllCalendars === true;
    await setCalendarSeeAll(m.email, on);
    res.json({ ok: true, id, seesAllCalendars: on });
  }));

  // JobTread's Sales Rep dropdown against the roster: who is mapped to which
  // name, which names nobody in the app is yet, and which app mappings
  // JobTread no longer offers. Read-only (the POST /api/sync/jobtread-reps
  // route applies the safe exact-name links).
  app.get('/api/team/jobtread-reps', requireRole('admin'), async (_req: Request, res: Response) => {
    try {
      res.json(await syncSalesRepsFromJobTread({ dryRun: true }));
    } catch (e) {
      return sendUpstreamFailure(res, e, 'JobTread', 'GET /api/team/jobtread-reps');
    }
  });

  app.post('/api/team', requireRole('admin'), asyncHandler(async (req: Request, res: Response) => {
    const parsed = validateTeamMemberInput(req.body);
    if (!parsed.ok) return res.status(400).json({ message: parsed.error });
    if (parsed.value.jobtreadSalesRep) {
      const taken = await memberByJobtreadRep(parsed.value.jobtreadSalesRep);
      if (taken) return res.status(409).json({ message: `"${parsed.value.jobtreadSalesRep}" is already mapped to ${taken.name}.` });
    }
    try {
      const created = await createTeamMember(parsed.value, req.session.user!.email);
      res.status(201).json(created);
    } catch (e: any) {
      // Re-adding someone already on the roster is the ordinary way to hit
      // this; say so instead of surfacing a Postgres constraint name.
      if (e?.code === DUPLICATE_KEY) {
        return res.status(409).json({ message: `${parsed.value.email} is already on the team.` });
      }
      throw e;
    }
  }));

  app.patch('/api/team/:id', requireRole('admin'), asyncHandler(async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ message: 'Bad id' });
    const parsed = validateTeamMemberPatch(req.body ?? {});
    if (!parsed.ok) return res.status(400).json({ message: parsed.error });

    // One JobTread name maps to one person — two members claiming the same
    // dropdown value would both own the same jobs and both be paid for them.
    if (parsed.value.jobtreadSalesRep) {
      const taken = await memberByJobtreadRep(parsed.value.jobtreadSalesRep, id);
      if (taken) return res.status(409).json({ message: `"${parsed.value.jobtreadSalesRep}" is already mapped to ${taken.name}.` });
    }
    if (parsed.value.reportsTo != null) {
      if (parsed.value.reportsTo === id) return res.status(400).json({ message: 'Someone cannot report to themselves.' });
      if (!(await getTeamMemberById(parsed.value.reportsTo))) return res.status(400).json({ message: 'reportsTo is not a team member.' });
    }

    const before = await getTeamMemberById(id);
    if (!before) return res.status(404).json({ message: 'Not found' });
    let updated;
    try {
      updated = await updateTeamMember(id, parsed.value);
    } catch (e: any) {
      if (e?.code === DUPLICATE_KEY) return res.status(409).json({ message: `${parsed.value.email} is already on the team.` });
      throw e;
    }
    if (!updated) return res.status(404).json({ message: 'Not found' });
    // Sessions re-read the roster through a short cache; drop this person's
    // entry so switching them off or changing their role applies right away.
    clearSessionRevalidationCache(before.email);
    clearSessionRevalidationCache(updated.email);

    // Role syncs both ways with JobTread (see sync/jobtread-roles.ts). Best
    // effort: a JobTread hiccup must never block an app role change.
    let jobtreadRole: { ok: boolean; reason?: string } | undefined;
    if (parsed.value.role && parsed.value.role !== before.role) {
      jobtreadRole = await pushRoleToJobTread(id).catch((e: any) => ({ ok: false, reason: e?.message || 'failed' }));
    }
    res.json({ ...updated, ...(jobtreadRole ? { jobtreadRole } : {}), roleChangeNote: parsed.value.role && parsed.value.role !== before.role ? 'Takes effect within a minute.' : undefined });
  }));
}
