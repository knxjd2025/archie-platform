/**
 * The morning rep check-in across several companies: each company's reps get
 * it once a day, in that company's own morning, even when a run is cut off or
 * the company is only reached late in the morning.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';

const url = process.env.DATABASE_URL || '';
const local = /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url);

const mail = vi.hoisted(() => ({ hangFor: new Set<string>(), sent: [] as string[] }));
vi.mock('../../integrations/company-mail', () => ({
  sendCompanyEmail: vi.fn(async ({ to }: { to: string }) => {
    if (mail.hangFor.has(to)) return new Promise(() => {}); // a send that never comes back
    mail.sent.push(to);
    return { ok: true };
  }),
}));
vi.mock('../../integrations/ghl/messaging', () => ({ sendGhlSms: vi.fn(), upsertContactByPhone: vi.fn() }));

describe.skipIf(!local)('rep reminder cron', async () => {
  const { db } = await import('../../db');
  const schema = await import('../../../shared/schema');
  const { eq, sql } = await import('drizzle-orm');
  const { runAsCompany } = await import('../../tenant/context');
  const { createCompany } = await import('../../tenant/companies');
  const { runCompanyJob } = await import('../../tenant/fan-out');
  const { repReminderJob } = await import('../reminder-routes');

  const tag = `remind-${process.pid}-${Date.now()}`;
  // Wednesday 2026-07-15. 9:30 AM in New York; 6:30 AM in Los Angeles.
  const at930et = new Date('2026-07-15T13:30:00Z');
  const ids: Record<'a' | 'b' | 'la', string> = { a: '', b: '', la: '' };
  const email = (k: string) => `${tag}-${k}@example.test`;

  beforeAll(async () => {
    ids.a = (await createCompany({ slug: `${tag}-a`, name: 'A Roofing', status: 'active' })).id;
    ids.b = (await createCompany({ slug: `${tag}-b`, name: 'B Roofing', status: 'active' })).id;
    ids.la = (await createCompany({ slug: `${tag}-la`, name: 'LA Roofing', status: 'active', settings: { timeZone: 'America/Los_Angeles' } as any })).id;
    for (const k of ['a', 'b', 'la'] as const) {
      await runAsCompany(ids[k], async () => {
        await db.insert(schema.teamMembers).values({ name: `Rep ${k}`, email: email(k), role: 'sales', canLogin: true, notifyEmail: true });
        // An appointment today gives the rep something to update.
        await db.insert(schema.appointments).values({
          sourceId: `${email(k)}:${tag}`, title: 'Inspection', start: new Date('2026-07-15T19:00:00Z'),
          calendarSource: email(k), kind: 'inspection',
        });
      });
    }
  });

  const run = (now: Date, perCompanyMs?: number) =>
    runCompanyJob(repReminderJob({ perCompanyMs }), { now, onlyCompanyIds: [ids.a, ids.b, ids.la] });
  const statusOf = (r: Awaited<ReturnType<typeof run>>, id: string) => r.companies.find((c) => c.companyId === id)?.status;

  it('sends late in the morning, once per company, and resumes after a cut-off', async () => {
    // B's send hangs past its per-company cap: the stand-in for a run killed mid-company.
    mail.hangFor.add(email('b'));
    const r1 = await run(at930et, 1_000);
    expect(statusOf(r1, ids.a)).toBe('done');
    expect(statusOf(r1, ids.b)).toBe('timed_out');
    expect(statusOf(r1, ids.la)).toBe('not_due'); // 6:30 AM there
    expect(mail.sent).toEqual([email('a')]);

    // Right away, B's timed-out run still holds the job's lease (its send may
    // still be running): nobody starts B, nothing is resent.
    mail.hangFor.clear();
    const r2a = await run(new Date(at930et.getTime() + 1 * 60_000));
    expect(statusOf(r2a, ids.b)).toBe('in_progress');
    expect(mail.sent).toEqual([email('a')]);

    // Time passes: the job lease expires (it lasts the per-company cap plus a margin).
    await runAsCompany(ids.b, () => db.update(schema.companyJobRuns)
      .set({ leaseUntil: sql`now() - interval '1 second'` })
      .where(eq(schema.companyJobRuns.job, repReminderJob().name)));

    // 15 minutes later B's per-rep claim is still fresh: B is not finished, nothing is resent.
    const r2 = await run(new Date(at930et.getTime() + 15 * 60_000));
    expect(statusOf(r2, ids.a)).toBe('already_done');
    expect(statusOf(r2, ids.b)).toBe('partial');
    expect(mail.sent).toEqual([email('a')]);

    // Once B's claim is abandoned, the next run sends it, and only once.
    await runAsCompany(ids.b, () => db.update(schema.repDailyReminders)
      .set({ sentAt: sql`now() - interval '11 minutes'` })
      .where(eq(schema.repDailyReminders.reminderDate, '2026-07-15')));
    const r3 = await run(new Date(at930et.getTime() + 30 * 60_000));
    expect(statusOf(r3, ids.b)).toBe('done');
    expect(mail.sent.sort()).toEqual([email('a'), email('b')].sort());

    // Los Angeles is reminded in its own morning (8:30 AM there).
    const r4 = await run(new Date('2026-07-15T15:30:00Z'));
    expect(statusOf(r4, ids.la)).toBe('done');
    expect(statusOf(r4, ids.a)).toBe('already_done');

    // More runs that day send nothing more to anyone.
    await run(new Date('2026-07-15T15:45:00Z'));
    await runCompanyJob(repReminderJob({ force: true }), { now: new Date('2026-07-15T15:50:00Z'), ignoreDone: true, onlyCompanyIds: [ids.a, ids.b, ids.la] });
    expect(mail.sent.sort()).toEqual([email('a'), email('b'), email('la')].sort());
  }, 30_000);
});
