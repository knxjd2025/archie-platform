/**
 * The numbers a scorecard can be built from.
 *
 * A scorecard row in the database is a goal and an owner against one of these
 * keys; this file is the other half — what the number actually IS. Keeping the
 * catalogue here means a room can only ever set a goal against something the
 * app can genuinely compute, so a scorecard cannot quietly drift into
 * measuring nothing.
 *
 * Every measure answers for the week just finished, so the Monday pack reports
 * a closed week rather than a week in progress.
 */
import { and, eq, gte, isNotNull, isNull, lte, ne, sql, type SQL } from 'drizzle-orm';
import { db } from '../db';
import {
  appointments, claims, deals, followUps, inboxItems, jobCommissions, leads, repAssignments, teamMembers,
} from '../../shared/schema';
import { etDateRange } from '../../shared/et-periods';
import { addDays } from '../../shared/schedule-board';
import { weekBefore, type MeetingKey, type ScorecardDirection } from '../../shared/monday-meetings';

export interface MeasureWindow { from: Date; to: Date }
export interface MeasureCtx {
  mondayIso: string;
  last: MeasureWindow;
  prior: MeasureWindow;
  /** The same week as Charlotte calendar dates, for columns that store a date rather than an instant. */
  lastDates?: { from: string; to: string };
}

/** A rep, by every name the data knows them by. */
export interface RepIdentity {
  email: string;
  name: string;
  /** The JobTread "Sales Rep" value — how leads and deals actually reference them. */
  repName: string;
}

export interface MeasureDef {
  key: string;
  label: string;
  /** The room it most naturally belongs to — a hint for seeding, not a rule. */
  meeting: MeetingKey;
  unit: 'count' | 'money' | 'days';
  /** Which way is good. Fixed by the measure: "claims gone quiet" is never at_least. */
  direction: ScorecardDirection;
  /** What this number is, in one line, for whoever is setting the goal. */
  hint: string;
  compute(ctx: MeasureCtx): Promise<number>;
  /**
   * The same number for one rep. Present only where a per-rep reading is
   * meaningful — "open claims" belongs to the claims desk, not to a rep, and
   * inventing a per-rep split of it would put a number on a scorecard that
   * nobody could act on.
   */
  computeForRep?(ctx: MeasureCtx, rep: RepIdentity): Promise<number>;
}

const n = (v: unknown): number => {
  const x = typeof v === 'string' ? Number(v) : (v as number);
  return Number.isFinite(x) ? x : 0;
};
const count = async (table: any, where: any): Promise<number> => {
  const [row] = await db.select({ n: sql<number>`count(*)` }).from(table).where(where);
  return n(row?.n);
};
const daysSince = (d: Date | string | null): number => {
  if (!d) return 0;
  const t = typeof d === 'string' ? new Date(d) : d;
  return Math.floor((Date.now() - t.getTime()) / 86400000);
};

/**
 * The week just finished and the one before, as Charlotte days. These were
 * built with `new Date('…T00:00:00')`, which is the server's midnight — UTC
 * on Vercel — so every window started at 8pm Sunday Eastern and stopped at
 * 8pm the following Sunday, moving Sunday-evening leads into the wrong week.
 */
export function measureWindows(mondayIso: string): MeasureCtx {
  const last = weekBefore(mondayIso);
  const prior = weekBefore(last.from);
  return {
    mondayIso,
    lastDates: last,
    last: etDateRange(last.from, last.to),
    prior: etDateRange(prior.from, prior.to),
  };
}

const CUSTOMER_KINDS = ['inspection', 'adjuster'];

/** Charlotte's date in SQL, as yyyy-mm-dd text. */
export const ET_TODAY_SQL = sql`to_char((now() at time zone 'America/New_York')::date, 'YYYY-MM-DD')`;

/** A due-date column is past due: a real yyyy-mm-dd before Charlotte's today. Malformed values never match (and never throw). */
export function overdueFollowUpSql(due: SQL): SQL {
  return sql`(${due}::text ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' and ${due}::text < ${ET_TODAY_SQL})`;
}

/** The Monday-to-Sunday week starting on the meeting's Monday, Charlotte days (it used the server's midnight). */
function weekAhead(mondayIso: string): { from: Date; to: Date } {
  return etDateRange(mondayIso, addDays(mondayIso, 6));
}

/**
 * Customer-facing appointments in a window. A rep's own are the ones on their
 * calendar — calendar_source is their mailbox — which is how the Schedule and
 * the availability board already attribute them.
 */
async function customerAppts(from: Date, to: Date, rep?: RepIdentity): Promise<number> {
  const rows = await db.select({ kind: appointments.kind, source: appointments.calendarSource })
    .from(appointments).where(and(gte(appointments.start, from), lte(appointments.start, to)));
  return rows.filter((r) =>
    r.kind && CUSTOMER_KINDS.includes(r.kind)
    && (!rep || (r.source ?? '').toLowerCase() === rep.email.toLowerCase())
  ).length;
}


/**
 * Proposals the customer approved, in the week, optionally for one rep.
 *
 * Two things this has to work around. `deals.signed_at` is never written by
 * the sync — every row is null — so an earlier version of this scorecard
 * reported zero sales for ever. And `deals.owner_id` is null on every row too,
 * so a deal reaches its rep the long way: job_ref -> leads.job_name ->
 * jt_sales_rep, which is the same route the sales agenda already takes.
 *
 * The date is the proposal's issue date, because JobTread gives us no approval
 * date. A proposal issued in July and approved this week therefore counts in
 * July, so this UNDERCOUNTS a week that closed old paper.
 */
async function approvedDeals(c: MeasureCtx, rep?: RepIdentity): Promise<Array<{ amount: string | null }>> {
  // issue_date is a plain yyyy-mm-dd, so it is compared with the week's
  // Charlotte dates. Slicing the UTC ISO string of the window's end gave
  // Monday, not Sunday, once the window was built in Eastern time.
  const { from, to } = c.lastDates ?? weekBefore(c.mondayIso);
  const rows = await db.select({ amount: deals.amount, jobRef: deals.jobRef })
    .from(deals)
    .where(and(eq(deals.status, 'approved'), gte(deals.issueDate, from), lte(deals.issueDate, to)));
  if (!rep) return rows;
  const mine = new Set((await db.select({ jobName: leads.jobName })
    .from(leads).where(eq(leads.jtSalesRep, rep.repName)))
    .map((l) => l.jobName).filter(Boolean) as string[]);
  return rows.filter((r) => r.jobRef && mine.has(r.jobRef));
}

export const MEASURES: readonly MeasureDef[] = [
  {
    key: 'new_leads', label: 'New leads', meeting: 'leadership', unit: 'count', direction: 'at_least',
    hint: 'Leads created during the week, every source.',
    compute: (c) => count(leads, and(gte(leads.createdAt, c.last.from), lte(leads.createdAt, c.last.to))),
    computeForRep: (c, rep) => count(leads, and(
      gte(leads.createdAt, c.last.from), lte(leads.createdAt, c.last.to), eq(leads.jtSalesRep, rep.repName),
    )),
  },
  {
    key: 'sales_closed', label: 'Sales closed', meeting: 'leadership', unit: 'count', direction: 'at_least',
    hint: 'Proposals the customer approved during the week.',
    compute: (c) => approvedDeals(c).then((r) => r.length),
    computeForRep: (c, rep) => approvedDeals(c, rep).then((r) => r.length),
  },
  {
    key: 'revenue_closed', label: 'Revenue closed', meeting: 'leadership', unit: 'money', direction: 'at_least',
    hint: 'Value of the proposals approved during the week.',
    compute: (c) => approvedDeals(c).then((r) => r.reduce((s, d) => s + n(d.amount), 0)),
    computeForRep: (c, rep) => approvedDeals(c, rep).then((r) => r.reduce((s, d) => s + n(d.amount), 0)),
  },
  {
    key: 'customer_appts_run', label: 'Customer appointments run', meeting: 'sales', unit: 'count', direction: 'at_least',
    hint: 'Inspections and adjuster meetings that happened. Internal calendar time is not counted.',
    compute: (c) => customerAppts(c.last.from, c.last.to),
    computeForRep: (c, rep) => customerAppts(c.last.from, c.last.to, rep),
  },
  {
    key: 'customer_appts_booked', label: 'Customer appointments booked ahead', meeting: 'sales', unit: 'count', direction: 'at_least',
    hint: 'Inspections and adjuster meetings on the calendar for the coming week.',
    compute: (c) => { const w = weekAhead(c.mondayIso); return customerAppts(w.from, w.to); },
    computeForRep: (c, rep) => { const w = weekAhead(c.mondayIso); return customerAppts(w.from, w.to, rep); },
  },
  {
    key: 'overdue_followups', label: 'Follow-ups overdue', meeting: 'sales', unit: 'count', direction: 'at_most',
    hint: 'Open follow-ups past their due date. Should trend towards nothing.',
    async compute() {
      // due_date is TEXT in this database despite the schema calling it a date,
      // and old rows hold whatever was typed ("next week"), on which a ::date
      // cast throws and takes the whole scorecard down. Only well-formed
      // yyyy-mm-dd values are compared, as text (which sorts like the date),
      // against Charlotte's today — current_date is UTC's, a day ahead after 8pm.
      const [row] = await db.select({ n: sql<number>`count(*)` }).from(followUps)
        .where(and(eq(followUps.done, false), overdueFollowUpSql(sql`${followUps.dueDate}`)));
      return n(row?.n);
    },
  },
  {
    key: 'unassigned_jobs', label: 'Live jobs with no rep', meeting: 'leadership', unit: 'count', direction: 'at_most',
    hint: 'JobTread jobs with neither a Sales Rep field nor an in-app assignment. The target is zero.',
    compute: () => db.select({ n: sql<number>`count(*)` }).from(leads)
      .leftJoin(repAssignments, eq(repAssignments.jobExternalId, leads.externalId))
      .where(and(isNull(leads.jtSalesRep), isNull(leads.closedOn), isNull(repAssignments.id), eq(leads.source, 'jobtread')))
      .then((r) => n(r[0]?.n)),
  },
  {
    key: 'claims_open', label: 'Open claims', meeting: 'claims', unit: 'count', direction: 'at_most',
    hint: 'Every claim not yet closed.',
    compute: () => count(claims, ne(claims.stage, 'closed')),
  },
  {
    key: 'claims_gone_quiet', label: 'Claims gone quiet', meeting: 'claims', unit: 'count', direction: 'at_most',
    hint: 'Open claims with nothing recorded for ten days or more.',
    async compute() {
      const open = await db.select({ updatedAt: claims.updatedAt, createdAt: claims.createdAt })
        .from(claims).where(ne(claims.stage, 'closed'));
      return open.filter((c) => daysSince(c.updatedAt ?? c.createdAt) >= 10).length;
    },
  },
  {
    key: 'claims_waiting_carrier', label: 'Waiting on the carrier', meeting: 'claims', unit: 'count', direction: 'at_most',
    hint: 'Claims sitting with the insurer: waiting results, disputing, supplementing.',
    async compute() {
      const open = await db.select({ stage: claims.stage }).from(claims).where(ne(claims.stage, 'closed'));
      return open.filter((c) => ['waiting_results', 'disputing', 'supplement', 'post_supplementing'].includes(c.stage)).length;
    },
  },
  {
    key: 'emails_awaiting_reply', label: 'Client emails with no reply', meeting: 'sales', unit: 'count', direction: 'at_most',
    hint: 'Mail from a matched lead or customer still sitting unanswered.',
    compute: (c) => count(inboxItems, and(
      eq(inboxItems.status, 'new'), isNotNull(inboxItems.matchedExternalId), gte(inboxItems.receivedAt, c.last.from),
    )),
  },
  {
    key: 'commission_blocked', label: 'Commission records missing a number', meeting: 'leadership', unit: 'count', direction: 'at_most',
    hint: 'Open commission records that cannot be worked out — no revenue filed, or no lead source.',
    async compute() {
      const open = await db.select().from(jobCommissions).where(eq(jobCommissions.status, 'open'));
      return open.filter((r) => !(n(r.revenue) > 0 && !!r.leadSource)).length;
    },
  },
];

export const MEASURE_BY_KEY = new Map(MEASURES.map((m) => [m.key, m]));

/** Reps on the roster, for owning a number. */
export async function scorecardOwners(): Promise<Array<{ email: string; name: string }>> {
  const rows = await db.select({ email: teamMembers.email, name: teamMembers.name })
    .from(teamMembers).where(eq(teamMembers.active, true));
  return rows.map((r) => ({ email: r.email, name: r.name }));
}
