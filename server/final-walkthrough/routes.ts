/**
 * In-app final walkthrough (shared/final-walkthrough.ts has the field
 * schema). Done by the sales rep or the project manager once the crew is off
 * the roof: magnetic nail sweep, cleanup and leftovers, property and roof
 * damage checks, the homeowner conversation. Autosaved draft → locked
 * submit. On submit every "Issue found" becomes a follow-up (assigned to
 * whoever walked it, due in two days) and a summary lands on the JobTread
 * job so the office sees it there.
 *
 * Access: a sales rep reaches their own jobs (ownsLead); the production role
 * is scoped to "self" in shared/rbac.ts, which would lock a PM out of every
 * job they didn't sell — so production may walk any job. It is their step.
 */
import type { Express, Request, Response } from 'express';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '../db';
import { finalWalkthroughs, followUps, leads } from '../../shared/schema';
import { requireAuth } from '../auth/middleware';
import { isScoped, ownsLead, teamMemberIdByEmail, type SessionUser } from '../access/rep-scope';
import {
  WALKTHROUGH_FIELDS, missingRequiredWalkthroughFields, walkthroughIssues, walkthroughTally, verifyAnswer, VERIFY_LABELS,
} from '../../shared/final-walkthrough';
import { JobTreadClient } from '../integrations/jobtread';
import { sendFailure } from '../lib/failure';
import { etPlusDays } from '../../shared/et-periods';
import { mergeAnswers } from '../../shared/form-answers';

export async function canWalkThrough(user: SessionUser, jobExternalId: string): Promise<boolean> {
  if (user.role === 'production') return true;
  return ownsLead(user, jobExternalId);
}

/** The comment the office reads on the JobTread job. */
export function formatWalkthroughForJobTread(answers: Record<string, any>): string {
  const t = walkthroughTally(answers);
  const issues = walkthroughIssues(answers);
  const head = [
    `Walked by: ${answers['Walked by'] || '—'}${answers['Role'] ? ` (${answers['Role']})` : ''}`,
    `Date: ${answers['Date'] || '—'} · Homeowner present: ${answers['Homeowner present'] || '—'}`,
    `Checks: ${t.ok} passed · ${t.issue} issue${t.issue === 1 ? '' : 's'} · ${t.na} n/a`,
    answers['Final balance'] ? `Final balance: ${answers['Final balance']}` : null,
  ].filter(Boolean);
  const issueLines = issues.length
    ? ['', `ISSUES (${issues.length}) — follow-ups created:`, ...issues.map((i) => `• [${i.section}] ${i.item} — ${i.note}`)]
    : ['', 'No issues found.'];
  const extras = WALKTHROUGH_FIELDS
    .filter((f) => f.type === 'longString' || (f.type === 'checkbox' && f.isRequired))
    .map((f) => {
      const val = answers[f.name];
      if (f.type === 'checkbox') return `${f.name}: ${val === true ? 'Yes' : 'No'}`;
      return val && String(val).trim() ? `${f.name}: ${String(val).trim()}` : null;
    })
    .filter(Boolean) as string[];
  return [...head, ...issueLines, ...(extras.length ? ['', ...extras] : [])].join('\n');
}

/** Sanitize the answers blob so a bad client can't store junk states. */
export function cleanAnswers(raw: unknown): Record<string, any> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, any> = {};
  for (const f of WALKTHROUGH_FIELDS) {
    const val = (raw as any)[f.name];
    if (val === undefined) continue;
    // A save is merged onto what is stored, so null has to survive here: it
    // is how a patch clears a point, and dropping it would leave the old answer.
    if (f.type === 'verify') { const a = val === null ? null : verifyAnswer(val); if (a || val === null) out[f.name] = a; continue; }
    out[f.name] = val;
  }
  return out;
}

/** Best-effort — a JobTread outage should never block the submission. */
async function syncToJobTread(id: number, jobExternalId: string, answers: Record<string, any>) {
  try {
    const result = await new JobTreadClient().addJobComment(jobExternalId, formatWalkthroughForJobTread(answers), 'Final Walkthrough');
    if (result.ok) {
      await db.update(finalWalkthroughs).set({ jobtreadSyncedAt: new Date() }).where(eq(finalWalkthroughs.id, id));
    } else {
      console.error('[final-walkthrough] JobTread sync failed:', result.error);
    }
  } catch (e: any) {
    console.error('[final-walkthrough] JobTread sync failed:', e?.message || e);
  }
}

export function registerFinalWalkthroughRoutes(app: Express) {
  app.get('/api/final-walkthrough/fields', requireAuth, (_req: Request, res: Response) => {
    res.json({ fields: WALKTHROUGH_FIELDS, labels: VERIFY_LABELS });
  });

  // Start a draft for a job.
  app.post('/api/final-walkthrough', requireAuth, async (req: Request, res: Response) => {
    try {
      const user = req.session.user! as SessionUser;
      const jobExternalId = String(req.body?.jobExternalId || '').trim();
      if (!jobExternalId) return res.status(400).json({ error: 'jobExternalId is required.' });
      if (!(await canWalkThrough(user, jobExternalId))) return res.status(404).json({ error: 'Job not found.' });

      const teamMemberId = await teamMemberIdByEmail(user.email);
      const answers = cleanAnswers(req.body?.answers);
      const [row] = await db.insert(finalWalkthroughs).values({
        jobExternalId, teamMemberId,
        walkedBy: answers['Walked by'] || user.name,
        answers, createdBy: user.email,
      }).returning();
      res.json({ ok: true, walkthrough: row });
    } catch (error: any) {
      return sendFailure(res, error, 'POST /api/final-walkthrough');
    }
  });

  // A job's walkthroughs, newest first. A rep sees their own; production and
  // unscoped roles see all of them — the PM needs the rep's, and vice versa.
  app.get('/api/final-walkthrough', requireAuth, async (req: Request, res: Response) => {
    try {
      const user = req.session.user! as SessionUser;
      const jobExternalId = String(req.query.jobExternalId || '').trim();
      if (!jobExternalId) return res.status(400).json({ error: 'jobExternalId is required.' });
      if (!(await canWalkThrough(user, jobExternalId))) return res.json({ walkthroughs: [] });

      const rows = await db.select().from(finalWalkthroughs)
        .where(eq(finalWalkthroughs.jobExternalId, jobExternalId))
        .orderBy(desc(finalWalkthroughs.createdAt))
        .limit(20);
      res.json({ walkthroughs: rows });
    } catch (error: any) {
      return sendFailure(res, error, 'GET /api/final-walkthrough');
    }
  });

  // Autosave the draft. Only its author (or an unscoped role) may edit it.
  app.patch('/api/final-walkthrough/:id', requireAuth, async (req: Request, res: Response) => {
    try {
      const user = req.session.user! as SessionUser;
      const id = Number(req.params.id);
      if (!req.body?.answers || typeof req.body.answers !== 'object') return res.status(400).json({ error: 'answers is required.' });
      const patch = cleanAnswers(req.body.answers);

      const clauses = [eq(finalWalkthroughs.id, id), eq(finalWalkthroughs.status, 'draft')];
      if (isScoped(user)) clauses.push(eq(finalWalkthroughs.createdBy, user.email));

      // Merged onto what is stored, under a row lock, so a save carrying only
      // some answers can't wipe the rest (see shared/form-answers.ts).
      const row = await db.transaction(async (tx) => {
        const [cur] = await tx.select({ answers: finalWalkthroughs.answers }).from(finalWalkthroughs).where(and(...clauses)).for('update');
        if (!cur) return undefined;
        const answers = mergeAnswers(cur.answers as Record<string, any>, patch) as Record<string, any>;
        const [updated] = await tx.update(finalWalkthroughs)
          .set({ answers, walkedBy: answers['Walked by'] || undefined, issueCount: walkthroughIssues(answers).length, updatedAt: new Date() })
          .where(eq(finalWalkthroughs.id, id))
          .returning();
        return updated;
      });
      if (!row) return res.status(404).json({ error: 'Draft not found (already submitted, or not yours).' });
      res.json({ ok: true, walkthrough: row });
    } catch (error: any) {
      return sendFailure(res, error, 'PATCH /api/final-walkthrough/:id');
    }
  });

  // Finalize: every required point answered, then lock it, turn each issue
  // into a follow-up, and post the summary to JobTread.
  app.post('/api/final-walkthrough/:id/submit', requireAuth, async (req: Request, res: Response) => {
    try {
      const user = req.session.user! as SessionUser;
      const id = Number(req.params.id);
      const clauses = [eq(finalWalkthroughs.id, id)];
      if (isScoped(user)) clauses.push(eq(finalWalkthroughs.createdBy, user.email));
      const [existing] = await db.select().from(finalWalkthroughs).where(and(...clauses));
      if (!existing) return res.status(404).json({ error: 'Walkthrough not found.' });
      if (existing.status !== 'draft') return res.json({ ok: true, walkthrough: existing, followUps: 0 }); // idempotent

      const answers = (existing.answers as Record<string, any>) || {};
      const missing = missingRequiredWalkthroughFields(answers);
      if (missing.length) return res.status(400).json({ error: 'Missing required items.', missing });

      const issues = walkthroughIssues(answers);
      // Only a draft can be submitted. Two taps on Submit both passed the
      // status check above, so both created the follow-ups, posted to
      // JobTread and moved the board; the one that loses this update now
      // answers as the idempotent case and does none of that.
      const [row] = await db.update(finalWalkthroughs)
        .set({ status: 'submitted', issueCount: issues.length, submittedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(finalWalkthroughs.id, id), eq(finalWalkthroughs.status, 'draft')))
        .returning();
      if (!row) {
        const [now] = await db.select().from(finalWalkthroughs).where(eq(finalWalkthroughs.id, id));
        return res.json({ ok: true, walkthrough: now ?? existing, followUps: 0 });
      }

      // One follow-up per issue, on the person who walked it. Best-effort:
      // the walkthrough is already locked; a failed follow-up is logged, not fatal.
      let created = 0;
      const assignee = existing.teamMemberId ?? (await teamMemberIdByEmail(user.email));
      // The dashboard lists a follow-up by its stored client name, not by the
      // job id, so a walkthrough issue carries the job's name the same way a
      // hand-made follow-up does — otherwise it reads "No client".
      const [job] = await db.select({ firstName: leads.firstName, lastName: leads.lastName, jobName: leads.jobName })
        .from(leads).where(eq(leads.externalId, existing.jobExternalId)).limit(1);
      const clientName = [job?.firstName, job?.lastName].filter(Boolean).join(' ').trim() || job?.jobName || null;
      for (const issue of issues) {
        try {
          await db.insert(followUps).values({
            jobExternalId: existing.jobExternalId,
            clientName,
            note: `Final walkthrough — ${issue.item}: ${issue.note}`,
            // Two Eastern days. The old UTC date math made an evening
            // walkthrough's issues come due a day late.
            dueDate: etPlusDays(2),
            assignedTo: assignee,
            createdBy: user.email,
          });
          created++;
        } catch (e: any) {
          console.error('[final-walkthrough] follow-up insert failed:', e?.message || e);
        }
      }

      syncToJobTread(id, row.jobExternalId, answers);
      // Walkthrough done: the production board moves the job to Final Invoice.
      const { onWalkthroughSubmitted } = await import('../pipelines/automation');
      const automation = await onWalkthroughSubmitted(row.jobExternalId, user.email);
      res.json({ ok: true, walkthrough: row, followUps: created, automation });
    } catch (error: any) {
      return sendFailure(res, error, 'POST /api/final-walkthrough/:id/submit');
    }
  });
}
