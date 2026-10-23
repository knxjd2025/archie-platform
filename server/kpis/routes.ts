/**
 * Sales-activity KPI dashboard: doors knocked, leads run (contacted), reports
 * made, reports presented. Admin/manager see every rep; a sales rep sees only
 * their own row (same scoping convention as server/access/rep-scope.ts).
 */
import type { Express, Request, Response } from 'express';
import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import { db } from '../db';
import { kpiEvents, leads, teamMembers } from '../../shared/schema';
import { requireAuth } from '../auth/middleware';
import { rateLimit } from '../lib/rate-limit';

// count is clamped 1-50, but nothing stopped calling this in a tight loop to
// inflate a rep's own referral/lead-given numbers, which likely feed comp.
const kpiLogLimiter = rateLimit(60, 60 * 60 * 1000);
import { isScoped, teamMemberIdByEmail, type SessionUser } from '../access/rep-scope';
import { visibleIdsFor } from '../access/team-scope';
import { sendFailure } from '../lib/failure';
import { etDayStart, etMonthStart, etWeekStart } from '../../shared/et-periods';

const RANGES = ['today', 'week', 'month'] as const;
type Range = (typeof RANGES)[number];

/**
 * Where each tab's count starts, in company time. This used the server's
 * midnight (UTC on Vercel, so "Today" began at 8pm the evening before) and a
 * rolling seven and thirty days for tabs labelled "This week" and "This
 * month". Now: the company's day, the Monday-to-Sunday week the playbook's
 * goal tracker uses, and the calendar month — so both screens agree.
 */
export function sinceFor(range: Range, now: Date = new Date()): Date {
  if (range === 'today') return etDayStart(now);
  if (range === 'week') return etWeekStart(now);
  return etMonthStart(now);
}

export interface RepKpis {
  teamMemberId: number | null;
  name: string;
  doorKnocks: number;
  leadsContacted: number;
  reportsCreated: number;
  reportsPresented: number;
  /** Referrals this rep brought in. */
  referralsReceived: number;
  /** Leads the company handed to this rep — attributed to the RECEIVER, so the
   *  column reads as "how many this rep was given", not "how many they gave". */
  leadsGiven: number;
  /** Leads this person typed in — the call-center credit for taking the call,
   *  counted off the lead rows themselves rather than a separate event, so it
   *  can never drift from the leads it claims to count. */
  leadsEntered: number;
}

const METRICS = ['doorKnocks', 'leadsContacted', 'reportsCreated', 'reportsPresented', 'referralsReceived', 'leadsGiven', 'leadsEntered'] as const;
type Metric = (typeof METRICS)[number];

const emptyKpis = (teamMemberId: number | null, name: string): RepKpis => ({
  teamMemberId, name,
  doorKnocks: 0, leadsContacted: 0, reportsCreated: 0, reportsPresented: 0,
  referralsReceived: 0, leadsGiven: 0, leadsEntered: 0,
});

const COLUMN_FOR_TYPE: Record<string, Metric> = {
  door_knock: 'doorKnocks',
  lead_contacted: 'leadsContacted',
  report_created: 'reportsCreated',
  report_presented: 'reportsPresented',
  referral_received: 'referralsReceived',
  lead_given: 'leadsGiven',
};

export interface EventCount { teamMemberId: number | null; repName: string | null; type: string; count: number }

/**
 * Fold the grouped event counts into the per-person rows. The query groups by
 * member AND the rep name stamped on the event, so one person whose events
 * carry two spellings of their name comes back as two rows of the same type —
 * assigning (rather than adding) kept only whichever came last and dropped
 * the rest of their doors.
 */
export function addEventCounts(byMember: Map<number | string, RepKpis>, counts: readonly EventCount[]): Map<number | string, RepKpis> {
  for (const c of counts) {
    const key = c.teamMemberId ?? `unattributed:${c.repName || 'unknown'}`;
    const row = byMember.get(key) ?? emptyKpis(c.teamMemberId, c.repName || 'Unattributed');
    const col = COLUMN_FOR_TYPE[c.type];
    byMember.set(key, col ? { ...row, [col]: row[col] + Number(c.count) } : row);
  }
  return byMember;
}

/** The activities a person logs by hand — the rest are recorded automatically. */
export const MANUAL_TYPES = ['referral_received', 'lead_given'] as const;
export type ManualType = (typeof MANUAL_TYPES)[number];
// Strict: String(['lead_given']) is 'lead_given', so coercing here would let a
// JSON array through the guard. Only an actual string counts.
export const isManualType = (t: unknown): t is ManualType =>
  typeof t === 'string' && MANUAL_TYPES.includes(t as ManualType);

export function registerKpiRoutes(app: Express) {
  app.get('/api/kpis/summary', requireAuth, async (req: Request, res: Response) => {
    try {
      const user = req.session.user! as SessionUser;
      const range: Range = RANGES.includes(req.query.range as Range) ? (req.query.range as Range) : 'today';
      const since = sinceFor(range);

      const scoped = isScoped(user);
      // 'self' (sales/production) or 'team' (manager) — same visibleIdsFor
      // helper `leads` already uses, so a Sales Leader sees their own reps'
      // KPI numbers too, not just their own row.
      const visibleIds = scoped ? await visibleIdsFor(user) : null;
      const where = scoped
        ? and(gte(kpiEvents.occurredAt, since), visibleIds && visibleIds.length ? inArray(kpiEvents.teamMemberId, visibleIds) : sql`false`)
        : gte(kpiEvents.occurredAt, since);

      const counts = await db
        .select({
          teamMemberId: kpiEvents.teamMemberId,
          repName: kpiEvents.repName,
          type: kpiEvents.type,
          count: sql<number>`count(*)::int`,
        })
        .from(kpiEvents)
        .where(where)
        .groupBy(kpiEvents.teamMemberId, kpiEvents.repName, kpiEvents.type);

      // Every active team member gets a row (even at zero), so an admin sees
      // the whole roster, not just whoever has activity in this window — and a
      // scoped user always sees their own (and, for a manager, their team's)
      // row, even with zero activity.
      const byMember = new Map<number | string, RepKpis>();
      if (scoped) {
        if (visibleIds && visibleIds.length) {
          const roster = await db.select({ id: teamMembers.id, name: teamMembers.name })
            .from(teamMembers).where(inArray(teamMembers.id, visibleIds));
          for (const m of roster) byMember.set(m.id, emptyKpis(m.id, m.name));
        }
        // Session isn't linked to a teamMembers row at all — still show one
        // row (keyed by email) rather than an empty screen.
        if (!byMember.size) byMember.set(user.email, emptyKpis(null, user.name));
      } else {
        const roster = await db.select({ id: teamMembers.id, name: teamMembers.name }).from(teamMembers).where(eq(teamMembers.active, true));
        for (const m of roster) byMember.set(m.id, emptyKpis(m.id, m.name));
      }

      // Leads entered: counted straight off the lead rows. A lead entered by
      // someone who isn't on the roster still counts — under their email —
      // rather than vanishing.
      const enteredRows = await db
        .select({ email: leads.enteredBy, name: leads.enteredByName, count: sql<number>`count(*)::int` })
        .from(leads)
        .where(and(gte(leads.createdAt, since), sql`${leads.enteredBy} is not null`))
        .groupBy(leads.enteredBy, leads.enteredByName);
      const roster = await db.select({ id: teamMembers.id, email: teamMembers.email, name: teamMembers.name }).from(teamMembers);
      const memberByEmail = new Map(roster.map((m) => [m.email.toLowerCase(), m]));

      addEventCounts(byMember, counts);

      for (const e of enteredRows) {
        const member = memberByEmail.get(String(e.email || '').toLowerCase());
        // Same visibility rule as the event counts: a scoped user sees their
        // own row and, for a manager, their team's — never the whole office.
        if (scoped && !(member && visibleIds?.includes(member.id))) continue;
        const key = member?.id ?? `entered:${String(e.email || '').toLowerCase()}`;
        if (!byMember.has(key)) byMember.set(key, emptyKpis(member?.id ?? null, member?.name || e.name || String(e.email || 'Unattributed')));
        byMember.get(key)!.leadsEntered += e.count;
      }

      const reps = Array.from(byMember.values()).sort((a, b) => a.name.localeCompare(b.name));
      // Summed over METRICS rather than a hand-written literal, so adding a
      // metric can't leave its total silently stuck at zero.
      const totals = reps.reduce((t, r) => {
        for (const m of METRICS) t[m] += r[m];
        return t;
      }, Object.fromEntries(METRICS.map((m) => [m, 0])) as Record<Metric, number>);

      res.json({ range, reps, totals });
    } catch (error: any) {
      return sendFailure(res, error, 'GET /api/kpis/summary');
    }
  });

  /**
   * Log a referral received, or a lead handed to a rep. Door knocks and reports
   * are recorded automatically as they happen; these two have no system event
   * behind them, so someone types them in.
   *
   * A lead_given is attributed to the rep who RECEIVED it, so the column answers
   * "how many has the company given this person" — which is the question asked.
   */
  app.post('/api/kpis/log', requireAuth, kpiLogLimiter, async (req: Request, res: Response) => {
    try {
      const user = req.session.user! as SessionUser;
      const type = req.body?.type;
      if (!isManualType(type)) {
        return res.status(400).json({ error: `type must be one of: ${MANUAL_TYPES.join(', ')}` });
      }

      const count = Math.min(Math.max(Math.round(Number(req.body?.count ?? 1)) || 1, 1), 50);
      const note = String(req.body?.note || '').trim().slice(0, 300) || null;

      // Who it belongs to. A sales rep can only ever log against themselves —
      // otherwise one rep could inflate or deflate another's numbers.
      const selfId = await teamMemberIdByEmail(user.email);
      let teamMemberId = selfId;
      const requested = req.body?.teamMemberId;
      if (requested != null && requested !== '') {
        if (isScoped(user)) return res.status(403).json({ error: 'You can only log activity for yourself.' });
        const wanted = Number(requested);
        if (!Number.isInteger(wanted)) return res.status(400).json({ error: 'teamMemberId must be a number.' });
        const [m] = await db.select({ id: teamMembers.id }).from(teamMembers).where(eq(teamMembers.id, wanted));
        if (!m) return res.status(404).json({ error: 'No such team member.' });
        teamMemberId = m.id;
      }
      if (teamMemberId == null) {
        return res.status(409).json({ error: 'Your login is not linked to a team member yet, so this cannot be attributed.' });
      }

      // One row per occurrence keeps every metric a plain count of events.
      await db.insert(kpiEvents).values(
        Array.from({ length: count }, () => ({
          teamMemberId, type: type as any, refTable: 'manual', note,
          repName: null, occurredAt: new Date(),
        })),
      );

      res.json({ ok: true, type, count, teamMemberId });
    } catch (error: any) {
      return sendFailure(res, error, 'POST /api/kpis/log', 500, 'could not log that');
    }
  });
}
