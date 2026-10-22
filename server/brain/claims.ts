import { db } from '../db';
import { claims } from '../../shared/schema';
import { ne } from 'drizzle-orm';
import type { Person, Urgency } from './types';
import { upsertLoop } from './loop-store';

const DAY_MS = 86_400_000;

export interface ClaimRow {
  id: number;
  customerName: string;
  stage: string;
  stageEnteredAt: Date;
  nextAction: string;
  nextActionOwner: Person;
  nextActionDue: Date;
  amounts: { firstCheck?: number; supplements?: number } | null;
  saSigned?: boolean; // derived: stage has passed sa_signed
}

export interface ClaimAlert {
  ruleId: string;
  summary: string;
  urgency: Urgency;
  dueAt: Date;
  /** When this rule started holding. A loop James closed by hand reopens only
   *  if the rule starts over after that (a new due date, the claim re-entering
   *  the stage) — not because it is still true an hour later. */
  since: Date;
}

export function evaluateClaimRules(claim: ClaimRow, now: Date): ClaimAlert[] {
  if (claim.stage === 'closed') return [];
  const alerts: ClaimAlert[] = [];
  const daysInStage = (now.getTime() - new Date(claim.stageEnteredAt).getTime()) / DAY_MS;

  // Rule 1: adjuster meeting coming up within 48h — the pipeline puts
  // sa_signed before adjuster_appt, but a claim can be placed straight into
  // adjuster_appt from JobTread, so this is phrased as a verification prompt
  // rather than asserting the SA is unsigned.
  if (claim.stage === 'adjuster_appt') {
    const hoursToDue = (new Date(claim.nextActionDue).getTime() - now.getTime()) / 3_600_000;
    if (hoursToDue <= 48) {
      alerts.push({
        ruleId: 'sa-before-adjuster',
        summary: `${claim.customerName}: adjuster meeting within 48h — verify the service agreement (SA) is signed BEFORE the adjuster meeting`,
        urgency: 'urgent',
        dueAt: new Date(claim.nextActionDue),
        since: new Date(new Date(claim.nextActionDue).getTime() - 48 * 3_600_000),
      });
    }
  }

  // Rule 2: decision pending, insurer silent ≥10 days
  if (claim.stage === 'waiting_results' && daysInStage >= 10) {
    alerts.push({
      ruleId: 'insurer-silent',
      summary: `${claim.customerName}: insurer silent ${Math.floor(daysInStage)} days after adjuster — chase the carrier`,
      urgency: 'urgent',
      dueAt: now,
      since: new Date(new Date(claim.stageEnteredAt).getTime() + 10 * DAY_MS),
    });
  }

  // Rule 3: build done, depreciation unrecovered ≥14 days
  if (['post_supplementing', 'request_depreciation'].includes(claim.stage) && daysInStage >= 14) {
    alerts.push({
      ruleId: 'depreciation-unrecovered',
      summary: `${claim.customerName}: approved and built but depreciation not recovered for ${Math.floor(daysInStage)} days — money on the table`,
      urgency: 'urgent',
      dueAt: now,
      since: new Date(new Date(claim.stageEnteredAt).getTime() + 14 * DAY_MS),
    });
  }

  // Rule 4: next action overdue (any stage)
  if (new Date(claim.nextActionDue).getTime() < now.getTime()) {
    alerts.push({
      ruleId: 'next-action-overdue',
      summary: `${claim.customerName}: claim next action overdue — "${claim.nextAction}" (${claim.nextActionOwner})`,
      urgency: 'normal',
      dueAt: new Date(claim.nextActionDue),
      since: new Date(claim.nextActionDue),
    });
  }
  return alerts;
}

export async function sweepClaims(now: Date): Promise<number> {
  const rows = await db.select().from(claims).where(ne(claims.stage, 'closed'));
  let opened = 0;
  for (const c of rows) {
    const alerts = evaluateClaimRules(c as unknown as ClaimRow, now);
    for (const a of alerts) {
      const { created } = await upsertLoop({
        kind: 'claim_milestone',
        source: 'jobtread',
        sourceRef: `claim-${c.id}-${a.ruleId}`,
        summary: a.summary,
        owner: c.nextActionOwner as Person,
        urgency: a.urgency,
        dueAt: a.dueAt,
        occurredAt: a.since,
        claimId: c.id,
      });
      if (created) opened++;
    }
  }
  return opened;
}
