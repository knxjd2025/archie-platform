/**
 * Insurance claims board — the claim pipeline (shared/claims-pipeline.ts)
 * over this app's own `claims` table. JobTread has no idea of a claim's
 * lifecycle beyond a few coarse statuses, so the board is the authority and
 * every move writes the nearest JobTread status back (best-effort). Backs the
 * ops-brain claim rules (server/brain/claims.ts) too.
 */
import type { Express, Request, Response } from 'express';
import { desc, eq, ne } from 'drizzle-orm';
import { db } from '../db';
import { claims, personEnum } from '../../shared/schema';
import { requireAuth } from '../auth/middleware';
import { isIsoDate } from '../../shared/et-periods';
import { etInstant } from '../../shared/schedule-board';
import { asyncHandler } from '../lib/async-handler';
import { logWrite } from '../writes/log';
import {
  CLAIM_PIPELINE_STAGES, DISPUTE_STEPS, CLAIM_STAGE_CHECKS, CLAIM_CHECK_KEYS, CLAIM_NEXT_ACTION, CLAIM_DUE_DAYS,
  isClaimPipelineStage, isDisputeStep, freshDisputeSteps, claimMoveBlocker, type ClaimGateContext,
} from '../../shared/claims-pipeline';
import { nextOf, completeCurrentStep, jumpToStep, currentStep } from '../../shared/pipeline-core';
import { type ClaimRow, claimStageOf as stageOf, claimStepsOf as stepsOf, claimContexts as contextFor, mirrorClaimToJobTread as mirrorToJobTread, moveClaimStage } from './store';

const isPerson = (v: unknown): v is (typeof personEnum.enumValues)[number] => personEnum.enumValues.includes(v as any);

function toRow(c: ClaimRow, ctx: ClaimGateContext, jtStage: string | null = null) {
  const stage = stageOf(c);
  const disputeSteps = stepsOf(c);
  const state = { stage, disputeSteps, checks: c.checks || {} };
  const next = nextOf(CLAIM_PIPELINE_STAGES, stage);
  return {
    id: c.id,
    customerName: c.customerName,
    contact: c.contact,
    jobtreadJobId: c.jobtreadJobId,
    jtStage,
    carrier: c.carrier,
    policyNumber: c.policyNumber,
    claimNumber: c.claimNumber,
    dateOfLoss: c.dateOfLoss ? c.dateOfLoss.toISOString() : null,
    adjuster: c.adjuster,
    amounts: c.amounts,
    stage,
    disputeSteps,
    currentDisputeStep: currentStep(disputeSteps),
    checks: c.checks || {},
    gates: ctx,
    nextBlocker: next ? claimMoveBlocker(next, state, ctx) : null,
    stageEnteredAt: c.stageEnteredAt.toISOString(),
    nextAction: c.nextAction,
    nextActionOwner: c.nextActionOwner,
    nextActionDue: c.nextActionDue.toISOString(),
  };
}

/**
 * A next-action due date as the rep picked it. The form sends "2026-10-16";
 * new Date() reads that as UTC midnight — 8pm on the 15th in Charlotte — so
 * the card said "due Oct 15" and went red the evening before. Store a bare
 * date as noon Charlotte time instead: it is the 16th in every US zone and
 * its UTC date is still the 16th. Full timestamps pass through unchanged.
 */
function dueFrom(v: unknown): Date {
  return isIsoDate(v) ? etInstant(v, '12:00') : new Date(v as string);
}

async function rowOut(c: ClaimRow) {
  const { ctx, jt } = await contextFor([c]);
  return toRow(c, ctx.get(c.id)!, c.jobtreadJobId ? jt.get(c.jobtreadJobId) ?? null : null);
}

export function registerClaimsRoutes(app: Express) {
  // Open to everyone signed in, same posture as /api/production — an
  // insurance claim isn't rep-private the way commission numbers are, and
  // office staff coordinating a claim need to see it regardless of whose
  // book the job is in.
  app.post('/api/claims/sync-jobtread', requireAuth, asyncHandler(async (_req: Request, res: Response) => {
    const { syncClaimsFromJobTread } = await import('./from-jobtread');
    res.json(await syncClaimsFromJobTread());
  }));

  app.get('/api/claims', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const includeClosed = req.query.all === 'true';
    const rows = includeClosed
      ? await db.select().from(claims).orderBy(desc(claims.updatedAt))
      : await db.select().from(claims).where(ne(claims.stage, 'closed')).orderBy(desc(claims.updatedAt));
    const { ctx, jt } = await contextFor(rows);
    res.json({
      stages: CLAIM_PIPELINE_STAGES, disputeSteps: DISPUTE_STEPS, checks: CLAIM_STAGE_CHECKS,
      claims: rows.map((c) => toRow(c, ctx.get(c.id)!, c.jobtreadJobId ? jt.get(c.jobtreadJobId) ?? null : null)),
    });
  }));

  app.post('/api/claims', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const user = req.session.user!;
    const b = req.body || {};
    const customerName = String(b.customerName || '').trim();
    const stage = isClaimPipelineStage(b.stage) ? b.stage : 'inspect';
    const nextAction = String(b.nextAction || '').trim() || CLAIM_NEXT_ACTION[stage];
    const nextActionOwner = isPerson(b.nextActionOwner) ? b.nextActionOwner : 'james';
    const nextActionDue = b.nextActionDue ? dueFrom(b.nextActionDue) : new Date(Date.now() + (CLAIM_DUE_DAYS[stage] ?? 7) * 864e5);
    if (!customerName) return res.status(400).json({ error: 'Customer name is required.' });
    if (Number.isNaN(nextActionDue.getTime())) return res.status(400).json({ error: 'A valid next-action due date is required.' });

    const [row] = await db.insert(claims).values({
      customerName,
      contact: (b.phone || b.email) ? { phone: b.phone || undefined, email: b.email || undefined } : null,
      jobtreadJobId: String(b.jobtreadJobId || '').trim() || null,
      carrier: String(b.carrier || '').trim() || null,
      policyNumber: String(b.policyNumber || '').trim() || null,
      claimNumber: String(b.claimNumber || '').trim() || null,
      dateOfLoss: b.dateOfLoss ? new Date(b.dateOfLoss) : null,
      stage,
      disputeSteps: freshDisputeSteps(),
      history: [{ stage, at: new Date().toISOString(), by: user.email }],
      nextAction,
      nextActionOwner,
      nextActionDue,
    }).returning();

    await logWrite({
      actor: user.email, system: 'app', action: 'create_claim', targetId: String(row.id),
      summary: customerName, ok: true, error: null,
    });
    res.json({ ok: true, claim: await rowOut(row) });
  }));

  const loadClaim = async (req: Request, res: Response): Promise<ClaimRow | null> => {
    const [row] = await db.select().from(claims).where(eq(claims.id, Number(req.params.id)));
    if (!row) { res.status(404).json({ error: 'Claim not found.' }); return null; }
    return row;
  };

  // Move stage. Gated (409 with the reason), resets the next action to the
  // new stage's default and the clock the ops-brain's days-in-stage rules
  // count from, and mirrors the nearest status to JobTread.
  app.patch('/api/claims/:id/stage', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const c = await loadClaim(req, res); if (!c) return;
    const r = await moveClaimStage(c, req.body?.stage, req.session.user!.email);
    if (!r.ok) return res.status(r.status).json({ error: r.error });
    res.json({ ok: true, claim: await rowOut(r.row), jobtread: r.jobtread, automation: r.automation });
  }));

  // Disputing steps: finish the current one, or jump to a specific one.
  app.post('/api/claims/:id/dispute-step', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const c = await loadClaim(req, res); if (!c) return;
    const before = stepsOf(c);
    const step = req.body?.step;
    let steps = before;
    if (step === undefined || step === null || step === '') steps = completeCurrentStep(before);
    else if (isDisputeStep(step)) steps = jumpToStep(before, step);
    else return res.status(400).json({ error: 'Unknown dispute step.' });
    const [row] = await db.update(claims).set({ disputeSteps: steps, updatedAt: new Date() }).where(eq(claims.id, c.id)).returning();
    const jobtread = stageOf(row) === 'disputing' ? await mirrorToJobTread(row, 'disputing', req.session.user!.email, `dispute step → ${currentStep(steps) || 'all done'}`) : { ok: true };
    res.json({ ok: true, claim: await rowOut(row), jobtread });
  }));

  app.post('/api/claims/:id/check', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const c = await loadClaim(req, res); if (!c) return;
    const key = req.body?.key;
    if (typeof key !== 'string' || !CLAIM_CHECK_KEYS.has(key)) return res.status(400).json({ error: 'Unknown check.' });
    const checks = { ...(c.checks || {}), [key]: req.body?.value === true };
    const [row] = await db.update(claims).set({ checks, updatedAt: new Date() }).where(eq(claims.id, c.id)).returning();
    res.json({ ok: true, claim: await rowOut(row) });
  }));

  // General edit — carrier/policy/claim#, date of loss, adjuster contact,
  // dollar amounts, and the next action. Anything omitted is left as-is.
  app.patch('/api/claims/:id', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    const b = req.body || {};
    const set: Partial<typeof claims.$inferInsert> = { updatedAt: new Date() };

    if (b.carrier !== undefined) set.carrier = String(b.carrier || '').trim() || null;
    if (b.policyNumber !== undefined) set.policyNumber = String(b.policyNumber || '').trim() || null;
    if (b.claimNumber !== undefined) set.claimNumber = String(b.claimNumber || '').trim() || null;
    if (b.dateOfLoss !== undefined) set.dateOfLoss = b.dateOfLoss ? new Date(b.dateOfLoss) : null;
    if (b.jobtreadJobId !== undefined) set.jobtreadJobId = String(b.jobtreadJobId || '').trim() || null;
    if (b.phone !== undefined || b.email !== undefined) {
      set.contact = (b.phone || b.email) ? { phone: b.phone || undefined, email: b.email || undefined } : null;
    }
    if (b.adjusterName !== undefined || b.adjusterPhone !== undefined || b.adjusterEmail !== undefined) {
      set.adjuster = (b.adjusterName || b.adjusterPhone || b.adjusterEmail)
        ? { name: b.adjusterName || undefined, phone: b.adjusterPhone || undefined, email: b.adjusterEmail || undefined }
        : null;
    }
    if (b.amounts !== undefined) {
      const a = b.amounts || {};
      const num = (v: unknown) => (v === '' || v == null ? undefined : Number(v));
      set.amounts = {
        deductible: num(a.deductible), acv: num(a.acv), rcv: num(a.rcv),
        firstCheck: num(a.firstCheck), supplements: num(a.supplements),
      };
    }
    if (b.nextAction !== undefined) {
      const na = String(b.nextAction || '').trim();
      if (!na) return res.status(400).json({ error: "What happens next can't be blank." });
      set.nextAction = na;
    }
    if (b.nextActionOwner !== undefined) {
      if (!isPerson(b.nextActionOwner)) return res.status(400).json({ error: 'Invalid next-action owner.' });
      set.nextActionOwner = b.nextActionOwner;
    }
    if (b.nextActionDue !== undefined) {
      const d = dueFrom(b.nextActionDue);
      if (Number.isNaN(d.getTime())) return res.status(400).json({ error: 'Invalid next-action due date.' });
      set.nextActionDue = d;
    }

    const [row] = await db.update(claims).set(set).where(eq(claims.id, id)).returning();
    if (!row) return res.status(404).json({ error: 'Claim not found.' });
    res.json({ ok: true, claim: await rowOut(row) });
  }));
}
