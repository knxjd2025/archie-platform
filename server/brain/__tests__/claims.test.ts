import { describe, it, expect } from 'vitest';
import { evaluateClaimRules } from '../claims';

const base = {
  id: 1, customerName: 'Jeff Byrne', nextAction: 'Get SA signed', nextActionOwner: 'banning' as const,
  amounts: null,
};
const now = new Date('2026-07-18T12:00:00Z');

describe('evaluateClaimRules', () => {
  it('adjuster meeting within 48h prompts SA verification (honest wording, not a false "not signed" assertion)', () => {
    const alerts = evaluateClaimRules({
      ...base, stage: 'adjuster_appt', stageEnteredAt: new Date('2026-07-16'),
      nextActionDue: new Date('2026-07-19T14:00:00Z'), saSigned: false,
    } as any, now);
    expect(alerts.some((a) => a.urgency === 'urgent' && /verify.*service agreement.*before the adjuster meeting/i.test(a.summary))).toBe(true);
  });
  it('insurer silent 10+ days after adjuster met → chase', () => {
    const alerts = evaluateClaimRules({
      ...base, stage: 'waiting_results', stageEnteredAt: new Date('2026-07-01'),
      nextActionDue: new Date('2026-07-10'),
    } as any, now);
    expect(alerts.some((a) => /insurer|carrier/i.test(a.summary))).toBe(true);
  });
  it('overdue next action always alerts', () => {
    const alerts = evaluateClaimRules({
      ...base, stage: 'supplement', stageEnteredAt: new Date('2026-07-10'),
      nextActionDue: new Date('2026-07-17'),
    } as any, now);
    expect(alerts.length).toBeGreaterThan(0);
  });
  it('closed claims never alert', () => {
    expect(evaluateClaimRules({ ...base, stage: 'closed', stageEnteredAt: new Date(), nextActionDue: new Date('2026-01-01') } as any, now)).toHaveLength(0);
  });
});

describe('evaluateClaimRules: when each rule started holding', () => {
  // `since` is what lets a loop James closed stay closed while the rule merely
  // keeps holding, and reopen only when it starts over.
  it('next-action-overdue holds from the due date', () => {
    const due = new Date('2026-07-17T00:00:00Z');
    const alerts = evaluateClaimRules({ ...base, stage: 'supplement', stageEnteredAt: new Date('2026-07-10'), nextActionDue: due } as any, now);
    expect(alerts.find((a) => a.ruleId === 'next-action-overdue')?.since.toISOString()).toBe(due.toISOString());
  });
  it('insurer-silent holds from 10 days into the stage', () => {
    const alerts = evaluateClaimRules({
      ...base, stage: 'waiting_results', stageEnteredAt: new Date('2026-07-01T00:00:00Z'), nextActionDue: new Date('2026-08-10'),
    } as any, now);
    expect(alerts.find((a) => a.ruleId === 'insurer-silent')?.since.toISOString()).toBe('2026-07-11T00:00:00.000Z');
  });
});
