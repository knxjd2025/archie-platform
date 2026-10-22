/**
 * In-app field inspection form (shared/inspection-form.ts has the field
 * schema). Filled by a rep on-site instead of in JobTread — see that file's
 * header for why — then read back by report generation for the job-type
 * framing and repair/replacement default, so a rep never re-answers the same
 * questions per report type.
 */
import type { Express, Request, Response } from 'express';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '../db';
import { inspectionSubmissions, leads } from '../../shared/schema';
import { requireAuth, requireRole } from '../auth/middleware';
import { isScoped, ownsLead, teamMemberIdByEmail, type SessionUser } from '../access/rep-scope';
import { INSPECTION_FORM_FIELDS, missingRequiredFields } from '../../shared/inspection-form';
import { COMMERCIAL_INSPECTION_FIELDS, missingRequiredCommercialFields } from '../../shared/commercial-inspection-form';
import { JobTreadClient } from '../integrations/jobtread';
import { generateStormReport } from '../lib/reports/storm-history-service';
import { parseUsAddress } from '../lib/reports/address-utils';
import { googleMapsKey } from '../lib/reports/google-key';
import { asFormKind, inferFormKind, FORM_KIND_KEY, type InspectionFormKind } from './lookup';
import { sendFailure } from '../lib/failure';
import { mergeAnswers } from '../../shared/form-answers';

/** The checklist a submission follows — residential (the default) or the commercial low-slope one. */
const fieldsFor = (kind: InspectionFormKind) => (kind === 'commercial' ? COMMERCIAL_INSPECTION_FIELDS : INSPECTION_FORM_FIELDS);
const missingFor = (kind: InspectionFormKind, answers: Record<string, any>) =>
  (kind === 'commercial' ? missingRequiredCommercialFields(answers) : missingRequiredFields(answers));

function formatAnswersForJobTread(answers: Record<string, any>, kind: InspectionFormKind = 'residential'): string {
  const lines = fieldsFor(kind)
    .filter((f) => f.type !== 'signature')
    .map((f) => {
      const v = answers[f.name];
      if (v === undefined || v === null || String(v).trim() === '') return null;
      return `${f.name}: ${v}`;
    })
    .filter(Boolean);
  return lines.join('\n');
}

/** Best-effort — a JobTread outage should never block the rep's submission. */
async function syncToJobTread(id: number, jobExternalId: string, answers: Record<string, any>, kind: InspectionFormKind = 'residential') {
  try {
    const client = new JobTreadClient();
    const summary = formatAnswersForJobTread(answers, kind);
    if (!summary) return;
    const result = await client.addJobComment(jobExternalId, summary, kind === 'commercial' ? 'Commercial Roof Inspection' : 'Field Inspection Form');
    if (result.ok) {
      await db.update(inspectionSubmissions).set({ jobtreadSyncedAt: new Date() }).where(eq(inspectionSubmissions.id, id));
    } else {
      console.error('[inspections] JobTread sync failed:', result.error);
    }
  } catch (e: any) {
    console.error('[inspections] JobTread sync failed:', e?.message || e);
  }
}

export function registerInspectionRoutes(app: Express) {
  // Schema for the client to render the form from — one source of truth.
  // ?kind=commercial returns the low-slope checklist.
  app.get('/api/inspections/fields', requireAuth, (req: Request, res: Response) => {
    const kind = asFormKind(req.query.kind);
    res.json({ kind, fields: fieldsFor(kind) });
  });

  // Verified NOAA storm dates near the job's address, for the rep to pick
  // from when filling in "Storm Date" / "Storm Type" — so the proposal's
  // storm timeline reflects a date the rep actually confirmed, not an
  // automatic nearest-event guess.
  app.get('/api/inspections/storm-lookup', requireAuth, async (req: Request, res: Response) => {
    try {
      const user = req.session.user! as SessionUser;
      const jobExternalId = String(req.query.jobExternalId || '').trim();
      if (!jobExternalId) return res.status(400).json({ error: 'jobExternalId is required.' });
      if (!(await ownsLead(user, jobExternalId))) return res.status(404).json({ error: 'Job not found.' });

      const [lead] = await db.select().from(leads).where(eq(leads.externalId, jobExternalId));
      if (!lead?.address) return res.status(400).json({ error: 'This job needs a street address before storm dates can be looked up.' });

      const parsed = parseUsAddress(lead.address);
      const stormReport = await generateStormReport(
        parsed.address || lead.address,
        parsed.city || lead.city || '',
        parsed.state || lead.state || '',
        parsed.zip || lead.zip || undefined,
        { yearsBack: 3, searchRadiusMiles: 5, googleApiKey: googleMapsKey() },
      );

      const candidates = stormReport.events
        .filter((e) => e.event_type === 'Hail' || e.event_type.includes('Wind') || e.event_type === 'Tornado')
        .slice(0, 15)
        .map((e) => ({
          date: e.date,
          type: e.event_type === 'Hail' ? 'Hail' : 'Wind',
          magnitude: e.hail_size_inches ? `${e.hail_size_inches}" hail` : e.wind_speed_mph ? `${e.wind_speed_mph} mph wind` : e.event_type,
          distanceMiles: e.distance_miles ?? null,
        }));

      res.json({ candidates, searchRadiusMiles: stormReport.search_radius_miles, yearsAnalyzed: stormReport.years_covered });
    } catch (error) {
      return sendFailure(res, error, 'GET /api/inspections/storm-dates', 500, "Couldn't look up storm dates.");
    }
  });

  // Start (or resume) a draft for a job.
  app.post('/api/inspections', requireAuth, async (req: Request, res: Response) => {
    try {
      const user = req.session.user! as SessionUser;
      const jobExternalId = String(req.body?.jobExternalId || '').trim();
      if (!jobExternalId) return res.status(400).json({ error: 'jobExternalId is required.' });
      // Every other mutating route in this file scopes by teamMemberId/createdBy
      // AFTER creation, but nothing stopped a rep from creating a submission
      // against a job outside their book in the first place.
      if (!(await ownsLead(user as SessionUser, jobExternalId))) return res.status(404).json({ error: 'Job not found.' });

      const teamMemberId = await teamMemberIdByEmail(user.email);
      const answers = (req.body?.answers && typeof req.body.answers === 'object') ? req.body.answers : {};
      // Which checklist this submission follows is fixed at creation — the
      // answers are keyed by that schema's field names from the first save.
      const formKind = asFormKind(req.body?.formKind);

      const [row] = await db.insert(inspectionSubmissions).values({
        jobExternalId,
        teamMemberId,
        inspectorName: answers['Inspector Name'] || user.name,
        inspectionType: answers['Inspection Type'] || null,
        answers: { ...answers, [FORM_KIND_KEY]: formKind },
        createdBy: user.email,
      }).returning();

      res.json({ ok: true, submission: row });
    } catch (error: any) {
      return sendFailure(res, error, 'POST /api/inspections');
    }
  });

  // A job's submissions, most recent first — used by the form (resume a draft)
  // and by report generation (pull the latest submitted answers).
  app.get('/api/inspections', requireAuth, async (req: Request, res: Response) => {
    try {
      const user = req.session.user! as SessionUser;
      const jobExternalId = String(req.query.jobExternalId || '').trim();
      if (!jobExternalId) return res.status(400).json({ error: 'jobExternalId is required.' });

      const clauses = [eq(inspectionSubmissions.jobExternalId, jobExternalId)];
      if (isScoped(user)) {
        const selfId = await teamMemberIdByEmail(user.email);
        clauses.push(selfId != null ? eq(inspectionSubmissions.teamMemberId, selfId) : eq(inspectionSubmissions.createdBy, user.email));
      }

      const rows = await db.select().from(inspectionSubmissions)
        .where(and(...clauses))
        .orderBy(desc(inspectionSubmissions.createdAt))
        .limit(20);
      res.json({ submissions: rows });
    } catch (error: any) {
      return sendFailure(res, error, 'GET /api/inspections');
    }
  });

  // Autosave the draft as the rep works through the checklist.
  app.patch('/api/inspections/:id', requireAuth, async (req: Request, res: Response) => {
    try {
      const user = req.session.user! as SessionUser;
      const id = Number(req.params.id);
      const answers = (req.body?.answers && typeof req.body.answers === 'object') ? req.body.answers : undefined;
      if (!answers) return res.status(400).json({ error: 'answers is required.' });

      const clauses = [eq(inspectionSubmissions.id, id), eq(inspectionSubmissions.status, 'draft')];
      if (isScoped(user)) {
        const selfId = await teamMemberIdByEmail(user.email);
        clauses.push(selfId != null ? eq(inspectionSubmissions.teamMemberId, selfId) : eq(inspectionSubmissions.createdBy, user.email));
      }

      // Merged onto what is stored, under a row lock, so a save carrying only
      // some answers can't wipe the rest (see shared/form-answers.ts).
      // The form kind is fixed at creation: a save that dropped __formKind
      // used to turn a commercial inspection back into a residential one.
      const row = await db.transaction(async (tx) => {
        const [cur] = await tx.select({ answers: inspectionSubmissions.answers }).from(inspectionSubmissions).where(and(...clauses)).for('update');
        if (!cur) return undefined;
        const merged = mergeAnswers(cur.answers as Record<string, any>, answers, [FORM_KIND_KEY]) as Record<string, any>;
        const [updated] = await tx.update(inspectionSubmissions)
          .set({
            answers: merged,
            inspectorName: merged['Inspector Name'] || undefined,
            inspectionType: merged['Inspection Type'] || undefined,
            updatedAt: new Date(),
          })
          .where(eq(inspectionSubmissions.id, id))
          .returning();
        return updated;
      });

      if (!row) return res.status(404).json({ error: 'Draft not found (already submitted, or not yours).' });
      res.json({ ok: true, submission: row });
    } catch (error: any) {
      return sendFailure(res, error, 'PATCH /api/inspections/:id');
    }
  });

  // Finalize: every required field must be answered, then it's locked and
  // synced to JobTread so the office can see it without leaving that app.
  app.post('/api/inspections/:id/submit', requireAuth, async (req: Request, res: Response) => {
    try {
      const user = req.session.user! as SessionUser;
      const id = Number(req.params.id);

      const clauses = [eq(inspectionSubmissions.id, id)];
      if (isScoped(user)) {
        const selfId = await teamMemberIdByEmail(user.email);
        clauses.push(selfId != null ? eq(inspectionSubmissions.teamMemberId, selfId) : eq(inspectionSubmissions.createdBy, user.email));
      }
      const [existing] = await db.select().from(inspectionSubmissions).where(and(...clauses));
      if (!existing) return res.status(404).json({ error: 'Submission not found.' });
      if (existing.status !== 'draft') return res.json({ ok: true, submission: existing }); // idempotent

      const kind = inferFormKind(existing.answers as Record<string, any>);
      const missing = missingFor(kind, (existing.answers as Record<string, any>) || {});
      if (missing.length) return res.status(400).json({ error: 'Missing required fields.', missing });

      // Only a draft can be submitted. Two taps on Submit both passed the
      // status check above and both posted the form to JobTread; the one that
      // loses this update now answers as the idempotent case.
      const [row] = await db.update(inspectionSubmissions)
        .set({ status: 'submitted', signedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(inspectionSubmissions.id, id), eq(inspectionSubmissions.status, 'draft')))
        .returning();
      if (!row) {
        const [now] = await db.select().from(inspectionSubmissions).where(eq(inspectionSubmissions.id, id));
        return res.json({ ok: true, submission: now ?? existing });
      }

      syncToJobTread(id, row.jobExternalId, (row.answers as Record<string, any>) || {}, kind);
      res.json({ ok: true, submission: row });
    } catch (error: any) {
      return sendFailure(res, error, 'POST /api/inspections/:id/submit');
    }
  });

  // Manager review: sets the Recommendation that Estimate/Proposal/Presentation
  // generation reads for a repair-vs-replacement default.
  app.patch('/api/inspections/:id/review', requireAuth, requireRole('manager'), async (req: Request, res: Response) => {
    try {
      const user = req.session.user!;
      const id = Number(req.params.id);
      const recommendation = String(req.body?.recommendation || '').trim() || null;

      const [row] = await db.update(inspectionSubmissions)
        .set({ recommendation, reviewedBy: user.email, reviewedAt: new Date(), status: 'reviewed', updatedAt: new Date() })
        .where(eq(inspectionSubmissions.id, id))
        .returning();
      if (!row) return res.status(404).json({ error: 'not found' });
      res.json({ ok: true, submission: row });
    } catch (error: any) {
      return sendFailure(res, error, 'PATCH /api/inspections/:id/review');
    }
  });
}
