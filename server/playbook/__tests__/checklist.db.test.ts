import { describe, it, expect, beforeAll, afterAll } from 'vitest';

// Runs only against the local throwaway database — never whatever .env points at.
const url = process.env.DATABASE_URL || '';
const LOCAL = /localhost|127\.0\.0\.1/.test(url) && url.includes('bra_e2e');

describe.skipIf(!LOCAL)('stage checklist ticks (database)', async () => {
  const { db } = await import('../../db');
  const { followUps, jobChecklists } = await import('../../../shared/schema');
  const { and, eq, like } = await import('drizzle-orm');
  const { tickChecklistItem } = await import('../routes');
  const { etPlusDays } = await import('../../../shared/et-periods');
  const PREFIX = `test-checklist-${process.pid}-`;
  const user = { email: 'tester@example.com', name: 'Tester' };
  let n = 0;
  const lead = () => ({ externalId: `${PREFIX}${n++}`, firstName: 'Pat', lastName: 'Lee', jobName: null });
  const stored = async (id: string, key: string) =>
    (await db.select().from(jobChecklists).where(and(eq(jobChecklists.jobExternalId, id), eq(jobChecklists.checklistKey, key))))[0]?.items ?? {};

  const clean = async () => {
    await db.delete(followUps).where(like(followUps.jobExternalId, `${PREFIX}%`));
    await db.delete(jobChecklists).where(like(jobChecklists.jobExternalId, `${PREFIX}%`));
  };
  beforeAll(clean);
  afterAll(clean);

  it('keeps every tick when several boxes are ticked at once, including the first write', async () => {
    const l = lead();
    await Promise.all(['job_complete_email', 'review_request', 'thank_you_letter', 'warranty']
      .map((k) => tickChecklistItem(l, 'paid_in_full', k, true, user)));
    expect(Object.keys(await stored(l.externalId, 'paid_in_full')).sort())
      .toEqual(['job_complete_email', 'review_request', 'thank_you_letter', 'warranty']);
  });

  it('unticks only the one item', async () => {
    const l = lead();
    await tickChecklistItem(l, 'paid_in_full', 'review_request', true, user);
    await tickChecklistItem(l, 'paid_in_full', 'warranty', true, user);
    await tickChecklistItem(l, 'paid_in_full', 'review_request', false, user);
    expect(Object.keys(await stored(l.externalId, 'paid_in_full'))).toEqual(['warranty']);
  });

  it('a double tap creates the follow-ups once, due on Charlotte dates', async () => {
    const l = lead();
    const results = await Promise.all([
      tickChecklistItem(l, 'paid_in_full', 'referral_emails', true, user),
      tickChecklistItem(l, 'paid_in_full', 'referral_emails', true, user),
    ]);
    const made = await db.select().from(followUps).where(eq(followUps.jobExternalId, l.externalId));
    expect(results.map((r) => r.created).sort()).toEqual([0, made.length]);
    expect(made.length).toBeGreaterThan(0);
    const items = await stored(l.externalId, 'paid_in_full');
    expect(items.referral_emails.followUpIds?.sort()).toEqual(made.map((m) => m.id).sort());
    // Every due date is a Charlotte "today + n" date.
    for (const m of made) expect(String(m.dueDate) >= etPlusDays(0)).toBe(true);
  });
});
