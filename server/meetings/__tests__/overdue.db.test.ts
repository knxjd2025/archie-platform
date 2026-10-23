import { describe, it, expect } from 'vitest';

// Runs only against the local throwaway database — never whatever .env points at.
const url = process.env.DATABASE_URL || '';
const LOCAL = /localhost|127\.0\.0\.1/.test(url) && url.includes('bra_e2e');

describe.skipIf(!LOCAL)('overdue follow-ups in SQL (database)', async () => {
  const { db } = await import('../../db');
  const { sql } = await import('drizzle-orm');
  const { overdueFollowUpSql, etTodaySql } = await import('../measures');
  const { etToday, addDays } = await import('../../../shared/schedule-board');

  const isOverdue = async (due: string | null) => {
    const r = await db.execute(sql`select ${overdueFollowUpSql(sql`${due}::text`)} as v`);
    return (r.rows[0] as { v: boolean | null }).v === true;
  };

  it("uses the company's today, not the database's", async () => {
    const r = await db.execute(sql`select ${etTodaySql()} as d`);
    expect((r.rows[0] as { d: string }).d).toBe(etToday());
  });

  it('counts a real past date, and not today or later', async () => {
    expect(await isOverdue(addDays(etToday(), -1))).toBe(true);
    expect(await isOverdue(etToday())).toBe(false);
    expect(await isOverdue(addDays(etToday(), 3))).toBe(false);
  });

  it('skips junk a legacy row holds, instead of throwing', async () => {
    // A ::date cast on "next week" threw and took the whole scorecard down.
    for (const junk of ['next week', 'ASAP', '10/2/2026', '', null]) expect(await isOverdue(junk), String(junk)).toBe(false);
  });
});
