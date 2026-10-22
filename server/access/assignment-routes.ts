/**
 * Unassigned-client triage: see what has nobody on it, review a suggested
 * owner with its evidence, and accept or override.
 *
 * Manager+ only. Assignment decides whose book a job is in and therefore who
 * is paid for it, so a rep must not be able to move one onto themselves.
 */
import type { Express, Request, Response } from 'express';
import { requireAuth, requireRole } from '../auth/middleware';
import { db } from '../db';
import { teamMembers, repAssignments } from '../../shared/schema';
import { eq, inArray } from 'drizzle-orm';
import {
  suggestOwners, findUnassigned, applyAssignment, unassignedCount, loadRepIdentities,
} from './assignment-service';
import { logWrite } from '../writes/log';
import { JobTreadClient } from '../integrations/jobtread';
import { sendFailure } from '../lib/failure';

export function registerAssignmentRoutes(app: Express): void {
  /**
   * Count of jobs with nobody on them, for the dashboard flag.
   * Cheap enough to poll; deliberately separate from the suggestion sweep,
   * which hits JobTread once per job.
   */
  app.get('/api/assignments/unassigned/count', requireAuth, requireRole('manager'), async (_req, res: Response) => {
    try {
      res.json(await unassignedCount());
    } catch (e: any) {
      return sendFailure(res, e, 'GET /api/assignments/unassigned/count', 500, 'Could not count unassigned jobs.');
    }
  });

  /** The unassigned list without touching JobTread — fast, no suggestions. */
  app.get('/api/assignments/unassigned', requireAuth, requireRole('manager'), async (req: Request, res: Response) => {
    try {
      const activeOnly = req.query.all !== 'true';
      res.json({ jobs: await findUnassigned({ activeOnly, limit: Number(req.query.limit) || 200 }) });
    } catch (e: any) {
      return sendFailure(res, e, 'GET /api/assignments/unassigned', 500, 'Could not list unassigned jobs.');
    }
  });

  /**
   * Suggested owners with evidence. Slower — one JobTread read per job — so
   * it is capped and asked for explicitly rather than run on page load.
   */
  app.get('/api/assignments/suggestions', requireAuth, requireRole('manager'), async (req: Request, res: Response) => {
    try {
      const limit = Math.min(Number(req.query.limit) || 25, 60);
      const activeOnly = req.query.all !== 'true';
      const [jobs, reps] = await Promise.all([
        suggestOwners({ activeOnly, limit }),
        loadRepIdentities(),
      ]);
      res.json({ jobs, reps });
    } catch (e: any) {
      return sendFailure(res, e, 'GET /api/assignments/suggestions', 502, 'Could not work out who owns these jobs.');
    }
  });

  /**
   * Assign one job. `secondaryTeamMemberIds` shares it — the primary owns it
   * for commission and "my book", the others get visibility.
   */
  app.post('/api/assignments', requireAuth, requireRole('manager'), async (req: Request, res: Response) => {
    try {
      const user = req.session.user!;
      const jobExternalId = String(req.body?.jobExternalId || '').trim();
      const primary = Number(req.body?.primaryTeamMemberId);
      if (!jobExternalId || !Number.isFinite(primary)) {
        return res.status(400).json({ error: 'jobExternalId and primaryTeamMemberId are required.' });
      }

      const secondary = Array.isArray(req.body?.secondaryTeamMemberIds)
        ? req.body.secondaryTeamMemberIds.map(Number).filter(Number.isFinite)
        : [];

      // Every id must be a real, active team member — a bad id would otherwise
      // create an assignment nobody owns.
      const ids = Array.from(new Set([primary, ...secondary]));
      if (ids.length > 3) {
        return res.status(400).json({ error: 'A job can have at most 3 reps (1 primary + up to 2 shared).' });
      }
      const found = await db.select({ id: teamMembers.id, active: teamMembers.active, jobtreadSalesRep: teamMembers.jobtreadSalesRep })
        .from(teamMembers).where(inArray(teamMembers.id, ids));
      if (found.length !== ids.length || found.some((m) => !m.active)) {
        return res.status(400).json({ error: 'One of those people is not an active team member.' });
      }

      await applyAssignment({
        jobExternalId,
        primaryTeamMemberId: primary,
        secondaryTeamMemberIds: secondary,
        source: String(req.body?.source || 'manual'),
        confidence: req.body?.confidence ?? null,
        evidence: req.body?.evidence ?? null,
        assignedBy: user.email,
      });

      await logWrite({
        actor: user.email, system: 'app', action: 'assign_rep', targetId: jobExternalId,
        summary: `primary=${primary}${secondary.length ? ` shared=${secondary.join(',')}` : ''}`,
        ok: true, error: null,
      });

      // Best-effort: push the primary to JobTread's "Sales Rep" field too, so
      // it's 2-way. Non-blocking — the in-app assignment stands regardless.
      const primaryRepName = found.find((m) => m.id === primary)?.jobtreadSalesRep;
      if (primaryRepName) {
        const r = await new JobTreadClient().setJobSalesRep(jobExternalId, primaryRepName);
        await logWrite({
          actor: user.email, system: 'jobtread', action: 'set_sales_rep',
          targetId: jobExternalId, summary: `Sales Rep → ${primaryRepName}`, ok: r.ok, error: r.error || null,
        });
      }

      res.json({ ok: true });
    } catch (e: any) {
      return sendFailure(res, e, 'POST /api/assignments', 500, 'Could not save that assignment.');
    }
  });

  /** Who is on a job now (primary + anyone sharing it). Manager+, same as every other route in this file. */
  app.get('/api/assignments/:externalId', requireAuth, requireRole('manager'), async (req: Request, res: Response) => {
    try {
      const rows = await db
        .select({
          teamMemberId: repAssignments.teamMemberId, role: repAssignments.role,
          source: repAssignments.source, confidence: repAssignments.confidence,
          evidence: repAssignments.evidence, name: teamMembers.name,
        })
        .from(repAssignments)
        .leftJoin(teamMembers, eq(repAssignments.teamMemberId, teamMembers.id))
        .where(eq(repAssignments.jobExternalId, req.params.externalId));
      res.json({ assignments: rows });
    } catch (e: any) {
      return sendFailure(res, e, 'GET /api/assignments/:externalId', 500, 'Could not read that assignment.');
    }
  });

  /** Clear a job back to unassigned (falls back to JobTread's own Sales Rep field, if any). */
  app.delete('/api/assignments/:externalId', requireAuth, requireRole('manager'), async (req: Request, res: Response) => {
    try {
      await db.delete(repAssignments).where(eq(repAssignments.jobExternalId, req.params.externalId));
      await logWrite({
        actor: req.session.user!.email, system: 'app', action: 'unassign_rep',
        targetId: req.params.externalId, summary: 'cleared', ok: true, error: null,
      });
      res.json({ ok: true });
    } catch (e: any) {
      return sendFailure(res, e, 'DELETE /api/assignments/:externalId', 500, 'Could not clear that assignment.');
    }
  });
}
