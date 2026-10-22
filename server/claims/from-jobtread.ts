import { eq, inArray } from 'drizzle-orm';
import { db } from '../db';
import { claims, leads, teamMembers } from '../../shared/schema';
import {
  JT_STATUS_TO_CLAIM, CLAIM_NEXT_ACTION as NEXT_ACTION, CLAIM_DUE_DAYS as DUE_DAYS,
  claimStageIndex, freshDisputeSteps,
} from '../../shared/claims-pipeline';
import { jumpToStep } from '../../shared/pipeline-core';
import type { ClaimStage } from './columns';

/**
 * JobTread job stage -> claim stage (+ dispute step). Keys are matched
 * case-insensitively after trimming. Anything absent is NOT a claim: retail
 * sales, general construction and closed-won work must not appear on a
 * claims board, or the board stops meaning anything.
 */
export const JT_STAGE_TO_CLAIM_STAGE: Record<string, ClaimStage> = Object.fromEntries(
  Object.entries(JT_STATUS_TO_CLAIM).map(([k, v]) => [k, v.stage]),
);

export function isClaimJobStage(stage: string | null | undefined): boolean {
  return !!claimStageFor(stage);
}

export function claimStageFor(stage: string | null | undefined): ClaimStage | null {
  if (!stage) return null;
  return JT_STATUS_TO_CLAIM[stage.trim().toLowerCase()]?.stage ?? null;
}

/** The dispute step JobTread's status implies, if any (e.g. "NTS Sent"). */
export function disputeStepFor(stage: string | null | undefined): string | null {
  if (!stage) return null;
  return JT_STATUS_TO_CLAIM[stage.trim().toLowerCase()]?.step ?? null;
}

export interface RosterEntry { email: string; name: string; jobtreadSalesRep?: string | null }

const norm = (v: string | null | undefined) => (v || '').trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * The team member (by email) who owns a job's claim: the one whose JobTread
 * sales-rep name, or failing that whose own name, matches the job's rep.
 * Null when nobody matches; most jobs have no rep.
 */
export function ownerFor(repName: string | null | undefined, roster: RosterEntry[]): string | null {
  const n = norm(repName);
  if (!n) return null;
  const hit = roster.find((m) => norm(m.jobtreadSalesRep) === n) ?? roster.find((m) => norm(m.name) === n);
  return hit?.email ?? null;
}

export interface SyncClaimsResult {
  created: number;
  stageUpdated: number;
  scanned: number;
  /** Jobs whose JobTread stage stopped being claim-related. */
  noLongerClaims: number;
}

/**
 * Mirror claim-stage JobTread jobs onto the board.
 *
 * Only the STAGE is pushed on an update — carrier, adjuster, amounts and the
 * next action are worked by hand on the board and must survive a resync.
 */
export async function syncClaimsFromJobTread(now: Date = new Date()): Promise<SyncClaimsResult> {
  const out: SyncClaimsResult = { created: 0, stageUpdated: 0, scanned: 0, noLongerClaims: 0 };

  const rows = await db
    .select({
      externalId: leads.externalId, jobName: leads.jobName, stage: leads.stage,
      firstName: leads.firstName, lastName: leads.lastName,
      phone: leads.phone, email: leads.email, jtSalesRep: leads.jtSalesRep,
    })
    .from(leads);

  const claimJobs = rows.filter((r) => r.externalId && isClaimJobStage(r.stage));
  out.scanned = claimJobs.length;
  if (!claimJobs.length) return out;

  const existing = await db
    .select({ id: claims.id, jobtreadJobId: claims.jobtreadJobId, stage: claims.stage })
    .from(claims)
    .where(inArray(claims.jobtreadJobId, claimJobs.map((c) => c.externalId as string)));
  const byJob = new Map(existing.map((e) => [e.jobtreadJobId as string, e]));

  const roster = await db.select({ email: teamMembers.email, name: teamMembers.name, jobtreadSalesRep: teamMembers.jobtreadSalesRep }).from(teamMembers);
  for (const job of claimJobs) {
    const stage = claimStageFor(job.stage)!;
    const found = byJob.get(job.externalId as string);

    if (!found) {
      const customerName = [job.firstName, job.lastName]
        .filter((x) => x && String(x).toLowerCase() !== 'null')
        .join(' ')
        .trim() || job.jobName || 'Customer';
      const step = disputeStepFor(job.stage);
      await db.insert(claims).values({
        customerName,
        contact: { phone: job.phone || undefined, email: job.email || undefined },
        jobtreadJobId: job.externalId as string,
        stage,
        disputeSteps: step ? jumpToStep(freshDisputeSteps(), step) : freshDisputeSteps(),
        history: [{ stage, at: now.toISOString(), by: 'system:jobtread-sync' }],
        stageEnteredAt: now,
        nextAction: NEXT_ACTION[stage],
        nextActionOwner: ownerFor(job.jtSalesRep, roster),
        nextActionDue: new Date(now.getTime() + (DUE_DAYS[stage] ?? 7) * 864e5),
      });
      out.created++;
      continue;
    }

    // JobTread moved the job FORWARD: follow it, and reset the clock so a
    // stage that just changed does not immediately read as overdue. Never
    // backward — the board's stages are finer than JobTread's, so a claim
    // moved to "SA Signed" here still reads "Claim Filed" in JobTread, and
    // pulling it back every hour would undo every move made on the board.
    if (found.stage !== stage && claimStageIndex(stage) > claimStageIndex(found.stage)) {
      const step = disputeStepFor(job.stage);
      await db.update(claims)
        .set({
          stage,
          ...(step ? { disputeSteps: jumpToStep(freshDisputeSteps(), step) } : {}),
          stageEnteredAt: now,
          nextAction: NEXT_ACTION[stage],
          nextActionDue: new Date(now.getTime() + (DUE_DAYS[stage] ?? 7) * 864e5),
          updatedAt: now,
        })
        .where(eq(claims.id, found.id));
      out.stageUpdated++;
    }
  }

  // A job that left the claim stages is closed on the board rather than
  // deleted — the history of a disputed claim is worth keeping.
  const activeIds = new Set(claimJobs.map((c) => c.externalId as string));
  const boarded = await db.select({ id: claims.id, jobtreadJobId: claims.jobtreadJobId, stage: claims.stage }).from(claims);
  for (const c of boarded) {
    // A claim still being worked up (inspect / SA / report) has no claim
    // status in JobTread yet — that's expected, not "no longer a claim".
    if (!c.jobtreadJobId || activeIds.has(c.jobtreadJobId) || c.stage === 'closed') continue;
    if (claimStageIndex(c.stage) < claimStageIndex('adjuster_appt')) continue;
    await db.update(claims).set({ stage: 'closed', updatedAt: now }).where(eq(claims.id, c.id));
    out.noLongerClaims++;
  }
  return out;
}
