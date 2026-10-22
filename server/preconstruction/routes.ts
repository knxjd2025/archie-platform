/**
 * In-app pre-construction checklist (shared/preconstruction-checklist.ts has
 * the field schema). Filled by the rep on the job's detail page at the point
 * they collect the down payment — site photos plus confirmation the standard
 * pre-install talking points were covered with the homeowner. No review
 * step: the rep submits and it's done.
 */
import type { Express, Request, Response } from 'express';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '../db';
import { preConstructionChecklists } from '../../shared/schema';
import { requireAuth } from '../auth/middleware';
import { isScoped, ownsLead, teamMemberIdByEmail, type SessionUser } from '../access/rep-scope';
import { PRECON_CHECKLIST_FIELDS, missingRequiredPreconFields } from '../../shared/preconstruction-checklist';
import { JobTreadClient } from '../integrations/jobtread';
import { sendFailure } from '../lib/failure';
import { mergeAnswers } from '../../shared/form-answers';

function formatAnswersForJobTread(answers: Record<string, any>): string {
  const lines = PRECON_CHECKLIST_FIELDS
    .filter((f) => f.type !== 'signature' && f.type !== 'photo')
    .map((f) => {
      const v = answers[f.name];
      if (v === undefined || v === null || String(v).trim() === '') return null;
      if (f.type === 'checkbox') return `${f.name}: ${v === true ? 'Yes' : 'No'}`;
      return `${f.name}: ${v}`;
    })
    .filter(Boolean);
  return lines.join('\n');
}

/** Best-effort — a JobTread outage should never block the rep's submission. */
async function syncToJobTread(id: number, jobExternalId: string, answers: Record<string, any>) {
  try {
    const client = new JobTreadClient();
    const summary = formatAnswersForJobTread(answers);
    if (!summary) return;
    const result = await client.addJobComment(jobExternalId, summary, 'Pre-Construction Checklist');
    if (result.ok) {
      await db.update(preConstructionChecklists).set({ jobtreadSyncedAt: new Date() }).where(eq(preConstructionChecklists.id, id));
    } else {
      console.error('[preconstruction] JobTread sync failed:', result.error);
    }
  } catch (e: any) {
    console.error('[preconstruction] JobTread sync failed:', e?.message || e);
  }
}

export function registerPreConstructionRoutes(app: Express) {
  // Schema for the client to render the form from — one source of truth.
  app.get('/api/preconstruction/fields', requireAuth, (_req: Request, res: Response) => {
    res.json({ fields: PRECON_CHECKLIST_FIELDS });
  });

  // Start (or resume) a draft for a job.
  app.post('/api/preconstruction', requireAuth, async (req: Request, res: Response) => {
    try {
      const user = req.session.user! as SessionUser;
      const jobExternalId = String(req.body?.jobExternalId || '').trim();
      if (!jobExternalId) return res.status(400).json({ error: 'jobExternalId is required.' });
      if (!(await ownsLead(user as SessionUser, jobExternalId))) return res.status(404).json({ error: 'Job not found.' });

      const teamMemberId = await teamMemberIdByEmail(user.email);
      const answers = (req.body?.answers && typeof req.body.answers === 'object') ? req.body.answers : {};

      const [row] = await db.insert(preConstructionChecklists).values({
        jobExternalId,
        teamMemberId,
        repName: answers['Rep Name'] || user.name,
        answers,
        createdBy: user.email,
      }).returning();

      res.json({ ok: true, checklist: row });
    } catch (error: any) {
      return sendFailure(res, error, 'POST /api/preconstruction');
    }
  });

  // A job's checklists, most recent first — used by the form (resume a draft)
  // and by the client-detail page (has one been submitted yet?).
  app.get('/api/preconstruction', requireAuth, async (req: Request, res: Response) => {
    try {
      const user = req.session.user! as SessionUser;
      const jobExternalId = String(req.query.jobExternalId || '').trim();
      if (!jobExternalId) return res.status(400).json({ error: 'jobExternalId is required.' });

      const clauses = [eq(preConstructionChecklists.jobExternalId, jobExternalId)];
      if (isScoped(user)) {
        const selfId = await teamMemberIdByEmail(user.email);
        clauses.push(selfId != null ? eq(preConstructionChecklists.teamMemberId, selfId) : eq(preConstructionChecklists.createdBy, user.email));
      }

      const rows = await db.select().from(preConstructionChecklists)
        .where(and(...clauses))
        .orderBy(desc(preConstructionChecklists.createdAt))
        .limit(20);
      res.json({ checklists: rows });
    } catch (error: any) {
      return sendFailure(res, error, 'GET /api/preconstruction');
    }
  });

  // Autosave the draft as the rep works through the checklist.
  app.patch('/api/preconstruction/:id', requireAuth, async (req: Request, res: Response) => {
    try {
      const user = req.session.user! as SessionUser;
      const id = Number(req.params.id);
      const answers = (req.body?.answers && typeof req.body.answers === 'object') ? req.body.answers : undefined;
      if (!answers) return res.status(400).json({ error: 'answers is required.' });

      const clauses = [eq(preConstructionChecklists.id, id), eq(preConstructionChecklists.status, 'draft')];
      if (isScoped(user)) {
        const selfId = await teamMemberIdByEmail(user.email);
        clauses.push(selfId != null ? eq(preConstructionChecklists.teamMemberId, selfId) : eq(preConstructionChecklists.createdBy, user.email));
      }

      // Merged onto what is stored, under a row lock, so a save carrying only
      // some answers can't wipe the rest (see shared/form-answers.ts).
      const row = await db.transaction(async (tx) => {
        const [cur] = await tx.select({ answers: preConstructionChecklists.answers }).from(preConstructionChecklists).where(and(...clauses)).for('update');
        if (!cur) return undefined;
        const merged = mergeAnswers(cur.answers as Record<string, any>, answers) as Record<string, any>;
        const [updated] = await tx.update(preConstructionChecklists)
          .set({
            answers: merged,
            repName: merged['Rep Name'] || undefined,
            updatedAt: new Date(),
          })
          .where(eq(preConstructionChecklists.id, id))
          .returning();
        return updated;
      });

      if (!row) return res.status(404).json({ error: 'Draft not found (already submitted, or not yours).' });
      res.json({ ok: true, checklist: row });
    } catch (error: any) {
      return sendFailure(res, error, 'PATCH /api/preconstruction/:id');
    }
  });

  // Finalize: every required field must be answered, then it's locked and
  // synced to JobTread so the office can see it without leaving that app.
  app.post('/api/preconstruction/:id/submit', requireAuth, async (req: Request, res: Response) => {
    try {
      const user = req.session.user! as SessionUser;
      const id = Number(req.params.id);

      const clauses = [eq(preConstructionChecklists.id, id)];
      if (isScoped(user)) {
        const selfId = await teamMemberIdByEmail(user.email);
        clauses.push(selfId != null ? eq(preConstructionChecklists.teamMemberId, selfId) : eq(preConstructionChecklists.createdBy, user.email));
      }
      const [existing] = await db.select().from(preConstructionChecklists).where(and(...clauses));
      if (!existing) return res.status(404).json({ error: 'Checklist not found.' });
      if (existing.status !== 'draft') return res.json({ ok: true, checklist: existing }); // idempotent

      const missing = missingRequiredPreconFields((existing.answers as Record<string, any>) || {});
      if (missing.length) return res.status(400).json({ error: 'Missing required fields.', missing });

      // Only a draft can be submitted. Two taps on Submit both passed the
      // status check above, so both posted to JobTread and fired the board
      // move; the one that loses this update now answers as the idempotent
      // case and does neither.
      const [row] = await db.update(preConstructionChecklists)
        .set({ status: 'submitted', submittedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(preConstructionChecklists.id, id), eq(preConstructionChecklists.status, 'draft')))
        .returning();
      if (!row) {
        const [now] = await db.select().from(preConstructionChecklists).where(eq(preConstructionChecklists.id, id));
        return res.json({ ok: true, checklist: now ?? existing });
      }

      syncToJobTread(id, row.jobExternalId, (row.answers as Record<string, any>) || {});
      // The checklist is done at deposit time: the production board moves the job to Schedule.
      const { onPreconSubmitted } = await import('../pipelines/automation');
      const automation = await onPreconSubmitted(row.jobExternalId, user.email);
      res.json({ ok: true, checklist: row, automation });
    } catch (error: any) {
      return sendFailure(res, error, 'POST /api/preconstruction/:id/submit');
    }
  });
}
