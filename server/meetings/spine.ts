/**
 * Reading and writing the meeting spine: scorecard, rocks, issues, ratings.
 *
 * The one idea worth holding on to: the pack RECOMPUTES its findings every
 * Monday, so before this existed an unsolved problem was never solved — it was
 * read out again. An issue raised here is raised ONCE per finding and stays up
 * until somebody solves or drops it, carrying the week it first appeared. That
 * age is the whole point; it is what turns "680 leads nobody has picked up"
 * from a line people nod at into a number with a date on it.
 */
import { and, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { db } from '../db';
import { meetingIssues, meetingRatings, rocks, scorecardMetrics, teamMembers } from '../../shared/schema';
import {
  quarterOf, scorecardStatus, type MeetingIssue, type MeetingKey, type Rock,
  type ScorecardDirection, type ScorecardRow,
} from '../../shared/monday-meetings';
import { MEASURES, MEASURE_BY_KEY, measureWindows, type RepIdentity } from './measures';

const num = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  const x = typeof v === 'string' ? Number(v) : (v as number);
  return Number.isFinite(x) ? x : null;
};
const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

async function nameByEmail(): Promise<Map<string, string>> {
  const rows = await db.select({ email: teamMembers.email, name: teamMembers.name }).from(teamMembers);
  return new Map(rows.map((r) => [r.email, r.name]));
}

// ------------------------------------------------------------------ scorecard

/**
 * This week's reading for every metric configured in a room.
 *
 * A configured key with no measure behind it reads `nodata` rather than being
 * dropped: a scorecard quietly missing a row is worse than one admitting it
 * cannot compute one.
 */
export async function loadScorecard(meeting: MeetingKey, mondayIso: string): Promise<ScorecardRow[]> {
  return readScorecard(meeting, mondayIso, 'company');
}

/**
 * The reps a per-rep scorecard is computed for.
 *
 * Anyone active who carries a JobTread rep name — NOT `role = 'sales'`. James
 * sells more than anyone (eleven approved proposals against Banning's five)
 * but his role is admin, so filtering on the role dropped his numbers out of
 * every rep card while still counting them in the company total. Carrying a
 * rep name is what makes the data attributable, so that is the test. The
 * office account has no rep name and is correctly left out.
 */
export async function scorecardReps(): Promise<RepIdentity[]> {
  const rows = await db.select({ email: teamMembers.email, name: teamMembers.name, rep: teamMembers.jobtreadSalesRep })
    .from(teamMembers)
    .where(and(eq(teamMembers.active, true), isNotNull(teamMembers.jobtreadSalesRep)))
    .orderBy(teamMembers.name);
  return rows
    .filter((r) => (r.rep ?? '').trim().length > 0)
    .map((r) => ({ email: r.email, name: r.name, repName: r.rep!.trim() }));
}

export interface RepScorecard { rep: { email: string; name: string }; rows: ScorecardRow[] }

/**
 * One scorecard per rep, each holding only that rep's numbers.
 *
 * `only` narrows it to a single person — which is how a rep sees their own
 * week and nobody else's. An admin passes nothing and gets the room.
 */
export async function loadRepScorecards(
  meeting: MeetingKey,
  mondayIso: string,
  only?: string,
): Promise<RepScorecard[]> {
  const defs = await db.select().from(scorecardMetrics)
    .where(and(eq(scorecardMetrics.meeting, meeting), eq(scorecardMetrics.scope, 'rep'), eq(scorecardMetrics.active, true)))
    .orderBy(scorecardMetrics.sortOrder, scorecardMetrics.id);
  if (!defs.length) return [];

  const all = await scorecardReps();
  const reps = only ? all.filter((r) => r.email.toLowerCase() === only.toLowerCase()) : all;
  if (!reps.length) return [];

  const ctx = measureWindows(mondayIso);
  return Promise.all(reps.map(async (rep) => ({
    rep: { email: rep.email, name: rep.name },
    rows: await Promise.all(defs.map(async (d) => {
      const measure = MEASURE_BY_KEY.get(d.key);
      let actual: number | null = null;
      if (measure?.computeForRep) {
        try { actual = await measure.computeForRep(ctx, rep); }
        catch (e: any) { console.warn(`[scorecard] ${d.key} for ${rep.email}: ${e?.message || 'compute failed'}`); }
      }
      return rowFrom(d, actual, null);
    })),
  })));
}

async function readScorecard(meeting: MeetingKey, mondayIso: string, scope: 'company' | 'rep'): Promise<ScorecardRow[]> {
  const defs = await db.select().from(scorecardMetrics)
    .where(and(eq(scorecardMetrics.meeting, meeting), eq(scorecardMetrics.scope, scope), eq(scorecardMetrics.active, true)))
    .orderBy(scorecardMetrics.sortOrder, scorecardMetrics.id);
  if (!defs.length) return [];

  const ctx = measureWindows(mondayIso);
  const names = await nameByEmail();
  return Promise.all(defs.map(async (d) => {
    const measure = MEASURE_BY_KEY.get(d.key);
    let actual: number | null = null;
    if (measure) {
      try { actual = await measure.compute(ctx); }
      catch (e: any) {
        // One broken measure must not empty the whole scorecard.
        console.warn(`[scorecard] ${d.key}: ${e?.message || 'compute failed'}`);
      }
    }
    return rowFrom(d, actual, d.ownerEmail ? names.get(d.ownerEmail) ?? d.ownerEmail : null);
  }));
}

function rowFrom(d: typeof scorecardMetrics.$inferSelect, actual: number | null, ownerName: string | null): ScorecardRow {
  const goal = num(d.goal);
  const direction = (d.direction === 'at_most' ? 'at_most' : 'at_least') as ScorecardDirection;
  return {
    key: d.key, label: d.label, meeting: d.meeting as MeetingKey,
    ownerEmail: d.ownerEmail, ownerName,
    goal, direction, unit: (d.unit as ScorecardRow['unit']) ?? 'count', sortOrder: d.sortOrder,
    actual, status: scorecardStatus(actual, goal, direction),
  };
}

/**
 * Put every measure in front of its room, with no goal — setting one is the
 * room's job, and an unset goal is visible on purpose.
 *
 * Company-scoped for all of them, and rep-scoped as well for the ones that can
 * be read per person. A rep-scoped goal is the target for ONE rep.
 */
export async function seedScorecard(by: string): Promise<number> {
  const rows = [
    ...MEASURES.map((m, i) => ({
      key: m.key, label: m.label, meeting: m.meeting, scope: 'company',
      goal: null, direction: m.direction, unit: m.unit, sortOrder: i * 10, active: true,
    })),
    ...MEASURES.filter((m) => !!m.computeForRep).map((m, i) => ({
      key: m.key, label: m.label, meeting: m.meeting, scope: 'rep',
      goal: null, direction: m.direction, unit: m.unit, sortOrder: i * 10, active: true,
    })),
  ];
  const before = await db.select({ n: sql<number>`count(*)` }).from(scorecardMetrics);
  await db.insert(scorecardMetrics).values(rows as any).onConflictDoNothing();
  const after = await db.select({ n: sql<number>`count(*)` }).from(scorecardMetrics);
  return Number(after[0]?.n ?? 0) - Number(before[0]?.n ?? 0);
}

// ---------------------------------------------------------------------- rocks

export async function loadRocks(meeting: MeetingKey, quarter: string): Promise<Rock[]> {
  const names = await nameByEmail();
  const rows = await db.select().from(rocks)
    .where(and(eq(rocks.meeting, meeting), eq(rocks.quarter, quarter)))
    .orderBy(rocks.id);
  return rows.map((r) => ({
    id: r.id, meeting: r.meeting as MeetingKey, title: r.title,
    ownerEmail: r.ownerEmail, ownerName: r.ownerEmail ? names.get(r.ownerEmail) ?? r.ownerEmail : null,
    quarter: r.quarter, status: r.status as Rock['status'], dueDate: r.dueDate, notes: r.notes,
  }));
}

export const currentQuarter = (mondayIso: string): string => quarterOf(mondayIso);

// --------------------------------------------------------------------- issues

const rowToIssue = (r: typeof meetingIssues.$inferSelect): MeetingIssue => ({
  id: r.id, meeting: r.meeting as MeetingKey, title: r.title, detail: r.detail,
  source: r.source as MeetingIssue['source'], sourceKey: r.sourceKey,
  raisedBy: r.raisedBy, raisedAt: iso(r.raisedAt), firstSeenWeek: r.firstSeenWeek,
  priority: r.priority, solvedAt: iso(r.solvedAt), solvedNote: r.solvedNote, droppedAt: iso(r.droppedAt),
});

export async function loadIssues(meeting: MeetingKey, includeClosed = false): Promise<MeetingIssue[]> {
  const where = includeClosed
    ? eq(meetingIssues.meeting, meeting)
    : and(eq(meetingIssues.meeting, meeting), isNull(meetingIssues.solvedAt), isNull(meetingIssues.droppedAt));
  const rows = await db.select().from(meetingIssues).where(where)
    .orderBy(meetingIssues.priority, meetingIssues.firstSeenWeek, meetingIssues.id);
  return rows.map(rowToIssue);
}

export interface RaiseInput {
  meeting: MeetingKey;
  title: string;
  detail?: string | null;
  source?: MeetingIssue['source'];
  sourceKey?: string | null;
  raisedBy?: string | null;
  firstSeenWeek: string;
}

/**
 * Raise an issue, once.
 *
 * An auto-filed finding carries a sourceKey, and a second raise while the
 * first is still open is a no-op — otherwise the Sunday job would stack a
 * fresh copy of the same problem every week and the age would reset with it.
 * The partial unique index in migration 0032 is the backstop; this check is
 * what makes the behaviour true in the E2E database too, which is built from
 * the Drizzle schema and so has no partial index.
 */
export async function raiseIssue(input: RaiseInput): Promise<MeetingIssue | null> {
  const sourceKey = input.sourceKey ?? null;
  if (sourceKey) {
    const [open] = await db.select().from(meetingIssues).where(and(
      eq(meetingIssues.meeting, input.meeting), eq(meetingIssues.sourceKey, sourceKey),
      isNull(meetingIssues.solvedAt), isNull(meetingIssues.droppedAt),
    ));
    if (open) return rowToIssue(open);
  }
  const [row] = await db.insert(meetingIssues).values({
    meeting: input.meeting, title: input.title.slice(0, 500), detail: input.detail ?? null,
    source: input.source ?? 'manual', sourceKey, raisedBy: input.raisedBy ?? null,
    firstSeenWeek: input.firstSeenWeek,
  }).onConflictDoNothing().returning();
  return row ? rowToIssue(row) : null;
}

export async function setIssuePriority(id: number, priority: number | null): Promise<void> {
  await db.update(meetingIssues).set({ priority, updatedAt: new Date() }).where(eq(meetingIssues.id, id));
}

export async function solveIssue(id: number, by: string, note: string | null): Promise<void> {
  await db.update(meetingIssues)
    .set({ solvedAt: new Date(), solvedBy: by, solvedNote: note, priority: null, updatedAt: new Date() })
    .where(and(eq(meetingIssues.id, id), isNull(meetingIssues.solvedAt), isNull(meetingIssues.droppedAt)));
}

export async function dropIssue(id: number, by: string, note: string | null): Promise<void> {
  await db.update(meetingIssues)
    .set({ droppedAt: new Date(), droppedBy: by, solvedNote: note, priority: null, updatedAt: new Date() })
    .where(and(eq(meetingIssues.id, id), isNull(meetingIssues.solvedAt), isNull(meetingIssues.droppedAt)));
}

// -------------------------------------------------------------------- ratings

export async function rateMeeting(meeting: MeetingKey, monday: string, rater: string, score: number, note: string | null): Promise<void> {
  await db.insert(meetingRatings)
    .values({ meeting, monday, raterEmail: rater, score, note })
    .onConflictDoUpdate({
      target: [meetingRatings.meeting, meetingRatings.monday, meetingRatings.raterEmail],
      set: { score, note, createdAt: new Date() },
    });
}

export async function ratingsFor(meeting: MeetingKey, monday: string): Promise<number[]> {
  const rows = await db.select({ score: meetingRatings.score }).from(meetingRatings)
    .where(and(eq(meetingRatings.meeting, meeting), eq(meetingRatings.monday, monday)));
  return rows.map((r) => r.score);
}

// ---------------------------------------------------------------- auto-filing

/** The rooms that run an L10. Payroll is a processing meeting and stays as it was. */
export const L10_MEETINGS: MeetingKey[] = ['leadership', 'claims', 'sales'];

export interface AutoFileResult { raised: number; alreadyOpen: number }

/**
 * Turn this week's findings into issues the room can actually work.
 *
 * Three sources, each with a stable key so a finding is raised once and then
 * ages instead of being re-raised:
 *   scorecard:<key>  a number that missed its goal
 *   rock:<id>        a quarterly priority that has gone off track
 *   pack:<key>       something the Monday pack flagged for a decision
 *
 * Deliberately NOT raised: a metric with no goal. That is a gap in the
 * scorecard, not a problem with the business, and filing it as an issue would
 * bury the real ones under a pile of admin.
 */
export async function autoFileIssues(
  mondayIso: string,
  agendas: Array<{ key: MeetingKey; sections: Array<{ attention?: Array<{ text: string; key?: string; page?: string }> }> }>,
  by = 'system:pack',
): Promise<AutoFileResult> {
  let raised = 0, alreadyOpen = 0;

  for (const meeting of L10_MEETINGS) {
    const openNow = new Set((await loadIssues(meeting)).map((i) => i.sourceKey).filter(Boolean) as string[]);

    for (const row of await loadScorecard(meeting, mondayIso)) {
      if (row.status !== 'off') continue;
      const sourceKey = `scorecard:${row.key}`;
      const had = openNow.has(sourceKey);
      await raiseIssue({
        meeting, source: 'scorecard', sourceKey, raisedBy: by, firstSeenWeek: mondayIso,
        title: `${row.label} missed its goal`,
        detail: `${row.actual} against a goal of ${row.direction === 'at_most' ? 'no more than ' : ''}${row.goal}${row.ownerName ? ` · ${row.ownerName}'s number` : ''}`,
      });
      had ? alreadyOpen++ : raised++;
    }

    for (const rock of await loadRocks(meeting, currentQuarter(mondayIso))) {
      if (rock.status !== 'off_track') continue;
      const sourceKey = `rock:${rock.id}`;
      const had = openNow.has(sourceKey);
      await raiseIssue({
        meeting, source: 'rock', sourceKey, raisedBy: by, firstSeenWeek: mondayIso,
        title: `Rock off track: ${rock.title}`,
        detail: rock.ownerName ? `${rock.ownerName} · due ${rock.dueDate ?? 'no date'}` : null,
      });
      had ? alreadyOpen++ : raised++;
    }

    const agenda = agendas.find((a) => a.key === meeting);
    for (const section of agenda?.sections ?? []) {
      for (const a of section.attention ?? []) {
        if (!a.key) continue;                     // unkeyed findings are not stable enough to file
        const sourceKey = `pack:${a.key}`;
        const had = openNow.has(sourceKey);
        await raiseIssue({
          meeting, source: 'pack', sourceKey, raisedBy: by, firstSeenWeek: mondayIso,
          title: a.text, detail: a.page ? `See the ${a.page} page` : null,
        });
        had ? alreadyOpen++ : raised++;
      }
    }
  }
  return { raised, alreadyOpen };
}
