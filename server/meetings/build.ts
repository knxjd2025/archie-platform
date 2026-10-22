/**
 * Assembling Monday's four agendas from what the app already knows.
 *
 * Each meeting gets the numbers its room actually argues about, and — more
 * usefully — the short list of things that need a decision. A page of figures
 * nobody acts on is a slower meeting, not a better one, so every section
 * either answers "how did we do" or names something to deal with.
 *
 * Everything is read-only. The pack is assembled, frozen and stored; nothing
 * here writes to a pipeline.
 */
import { and, desc, eq, gte, inArray, isNotNull, isNull, lt, lte, ne, sql } from 'drizzle-orm';
import { db } from '../db';
import {
  appointments, claims, deals, followUps, invoices, jobCommissions, imessages, inboxItems, leads,
  repAssignments, productionPipeline, salesPipeline, teamMembers,
} from '../../shared/schema';
import { CLAIM_PIPELINE_STAGES } from '../../shared/claims-pipeline';
import { SALES_PIPELINE_STAGES } from '../../shared/sales-pipeline';
import { PIPELINE_STAGES } from '../../shared/production-pipeline';
import {
  type Attention, type MeetingAgenda, type MeetingSection, type Metric, weekBefore,
} from '../../shared/monday-meetings';
import { etDateRange } from '../../shared/et-periods';
import { addDays, BOARD_TZ } from '../../shared/schedule-board';
import { measureWindows, overdueFollowUpSql } from './measures';

const money = (n: number): string =>
  n >= 1000 ? `$${Math.round(n).toLocaleString('en-US')}` : `$${n.toFixed(2)}`;

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number.parseFloat(String(v ?? '0'));
  return Number.isFinite(n) ? n : 0;
};

/** A day count that reads the way people say it. */
const daysAgo = (d: Date | string | null): number => {
  if (!d) return 0;
  const then = typeof d === 'string' ? new Date(d) : d;
  return Math.max(0, Math.floor((Date.now() - then.getTime()) / 86400000));
};

/** Comparison against the week before, so a number has a direction. */
function delta(now: number, before: number, moreIsBetter = true): Pick<Metric, 'previous' | 'better'> {
  if (before === 0 && now === 0) return { previous: '0', better: null };
  const better = now === before ? null : moreIsBetter ? now > before : now < before;
  return { previous: String(before), better };
}

/**
 * The two windows every "last week vs the week before" number needs, as
 * Charlotte days. These were built with `new Date('…T00:00:00')`, which is the
 * server's midnight — UTC on Vercel — so the agenda's week started at 8pm
 * Sunday Eastern and Sunday evening's leads and signings counted in the wrong
 * week, disagreeing with the scorecard that measures.ts already fixed.
 */
export function windows(mondayIso: string) {
  const m = measureWindows(mondayIso);
  return { last: { ...m.last, iso: m.lastDates ?? weekBefore(mondayIso) }, prior: m.prior };
}

/**
 * The Monday-to-Sunday week the meeting opens, Charlotte days. It used the
 * server's midnight and ran to the end of the following Monday, so "booked
 * this week" started at 8pm Sunday Eastern and counted next Monday's diary too.
 */
export function weekAhead(mondayIso: string): { from: Date; to: Date } {
  return etDateRange(mondayIso, addDays(mondayIso, 6));
}

/** A weekday label in Charlotte time — the server's would call a 9pm Friday appointment Saturday's. */
const etWeekday = (d: Date | string, extra: Intl.DateTimeFormatOptions = {}): string =>
  new Date(d).toLocaleDateString('en-US', { weekday: 'short', timeZone: BOARD_TZ, ...extra });

const countRows = async (table: any, where: any): Promise<number> => {
  const [row] = await db.select({ n: sql<number>`count(*)` }).from(table).where(where);
  return Number(row?.n ?? 0);
};


/**
 * Appointments that ran, and the ones booked next.
 *
 * Customer-facing only. The calendars carry a great deal that is not a job —
 * internal catch-ups, lunches, a Generative AI mastermind — and counting those
 * as "appointments" produced 105 for a week in which nine roofs were looked
 * at. Internal time is reported separately, as a load figure rather than as
 * work won.
 */
const CUSTOMER_KINDS = ['inspection', 'adjuster'];

/** Customer-facing appointments on the calendar for the week that is starting. */
async function customerAppointmentsAhead(mondayIso: string): Promise<number> {
  const { from, to } = weekAhead(mondayIso);
  const rows = await db.select({ kind: appointments.kind }).from(appointments)
    .where(and(gte(appointments.start, from), lte(appointments.start, to)));
  return rows.filter((r) => r.kind && CUSTOMER_KINDS.includes(r.kind)).length;
}

async function appointmentSections(mondayIso: string): Promise<MeetingSection[]> {
  const w = windows(mondayIso);
  const ahead = weekAhead(mondayIso);

  const inRange = async (from: Date, to: Date) => db
    .select({ title: appointments.title, start: appointments.start, kind: appointments.kind, address: appointments.address })
    .from(appointments)
    .where(and(gte(appointments.start, from), lte(appointments.start, to)))
    .orderBy(appointments.start);

  const ran = await inRange(w.last.from, w.last.to);
  const booked = await inRange(ahead.from, ahead.to);
  const customer = (rows: typeof ran) => rows.filter((r) => CUSTOMER_KINDS.includes(r.kind ?? ''));

  const ranCustomer = customer(ran);
  const bookedCustomer = customer(booked);

  const dayOrder = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const byDay = new Map<string, number>();
  for (const b of bookedCustomer) {
    if (!b.start) continue;
    const label = etWeekday(b.start);
    byDay.set(label, (byDay.get(label) ?? 0) + 1);
  }

  return [
    {
      heading: `Customer appointments last week · ${ranCustomer.length}`,
      rows: ranCustomer.slice(0, 15).map((r) => ({
        label: (r.title ?? 'appointment').slice(0, 60),
        value: r.start ? etWeekday(r.start) : '',
        note: r.kind ?? '',
      })),
      empty: `No inspections or adjuster meetings last week — ${ran.length - ranCustomer.length} internal events on the calendar.`,
    },
    {
      heading: `Booked this week · ${bookedCustomer.length} customer appointment${bookedCustomer.length === 1 ? '' : 's'}`,
      rows: dayOrder.filter((dd) => byDay.has(dd)).map((dd) => ({ label: dd, value: `${byDay.get(dd)} booked` })),
      empty: 'Nothing with a customer is booked this week — that is the first thing to fix.',
    },
  ];
}

/**
 * Customers who have written to us and not heard back.
 *
 * Email comes from the inbox watch, texts from the iMessage bridge. Only the
 * ones that look like a customer or a lead: the office inbox carries a great
 * deal that is neither.
 */
async function waitingOnUsSections(mondayIso: string): Promise<MeetingSection[]> {
  const w = windows(mondayIso);

  // Only mail that is actually from a client. The office inbox is full of
  // cold outreach the classifier files as a "lead" — listing that as somebody
  // waiting on us turns the section into noise and it stops being read.
  const emails = await db.select({
    from: inboxItems.fromName, fromEmail: inboxItems.fromEmail, subject: inboxItems.subject,
    receivedAt: inboxItems.receivedAt, category: inboxItems.category, matched: inboxItems.matchedName,
  })
    .from(inboxItems)
    .where(and(
      eq(inboxItems.status, 'new'),
      isNotNull(inboxItems.matchedExternalId),
      gte(inboxItems.receivedAt, w.last.from),
    ))
    .orderBy(desc(inboxItems.receivedAt)).limit(25);

  // An inbound text with nothing sent back on that thread since.
  const texts = await db.select({
    handle: imessages.handle, text: imessages.text, sentAt: imessages.sentAt,
    matched: imessages.matchedName, direction: imessages.direction, chat: imessages.chatGuid,
  })
    .from(imessages)
    .where(gte(imessages.sentAt, w.last.from))
    .orderBy(desc(imessages.sentAt)).limit(400);

  const lastByChat = new Map<string, { direction: string | null; who: string; text: string | null; at: Date | null }>();
  for (const t of texts) {
    const key = t.chat ?? t.handle ?? '';
    if (!key || lastByChat.has(key)) continue;          // ordered newest first
    lastByChat.set(key, { direction: t.direction, who: t.matched || t.handle || 'unknown', text: t.text, at: t.sentAt });
  }
  const unanswered = [...lastByChat.values()].filter((t) => t.direction === 'in').slice(0, 15);

  return [
    {
      heading: `Emails waiting on a reply · ${emails.length}`,
      rows: emails.map((e) => ({
        label: e.matched || e.from || e.fromEmail || 'unknown',
        value: e.receivedAt ? `${daysAgo(e.receivedAt)}d` : '',
        note: (e.subject ?? '').slice(0, 50),
      })),
      empty: 'Every lead and customer email has been dealt with.',
    },
    {
      heading: `Texts with no answer · ${unanswered.length}`,
      rows: unanswered.map((t) => ({
        label: t.who,
        value: t.at ? `${daysAgo(t.at)}d` : '',
        note: (t.text ?? '').replace(/\s+/g, ' ').slice(0, 50),
      })),
      empty: 'Nobody is waiting on a text back.',
    },
  ];
}

// ---------------------------------------------------------------- leadership

async function leadershipAgenda(mondayIso: string): Promise<MeetingAgenda> {
  const w = windows(mondayIso);
  const sections: MeetingSection[] = [];

  const [leadsLast, leadsPrior] = await Promise.all([
    countRows(leads, and(gte(leads.createdAt, w.last.from), lte(leads.createdAt, w.last.to))),
    countRows(leads, and(gte(leads.createdAt, w.prior.from), lte(leads.createdAt, w.prior.to))),
  ]);

  const signedIn = async (from: Date, to: Date) => {
    const rows = await db.select({ amount: deals.amount }).from(deals)
      .where(and(isNotNull(deals.signedAt), gte(deals.signedAt, from), lte(deals.signedAt, to)));
    return { count: rows.length, value: rows.reduce((s, r) => s + num(r.amount), 0) };
  };
  const [signedLast, signedPrior] = await Promise.all([
    signedIn(w.last.from, w.last.to), signedIn(w.prior.from, w.prior.to),
  ]);

  sections.push({
    heading: `Last week · ${w.last.iso.from} to ${w.last.iso.to}`,
    metrics: [
      { label: 'New leads', value: String(leadsLast), ...delta(leadsLast, leadsPrior) },
      { label: 'Jobs signed', value: String(signedLast.count), ...delta(signedLast.count, signedPrior.count) },
      {
        label: 'Value signed', value: money(signedLast.value),
        previous: money(signedPrior.value),
        better: signedLast.value === signedPrior.value ? null : signedLast.value > signedPrior.value,
      },
    ],
  });

  // Things that need somebody to decide, not just to know.
  const attention: Attention[] = [];

  const stalled = await db.select({ jobExternalId: productionPipeline.jobExternalId, stage: productionPipeline.stage, updatedAt: productionPipeline.updatedAt })
    .from(productionPipeline)
    .where(ne(productionPipeline.stage, 'closed_out'))
    .orderBy(productionPipeline.updatedAt).limit(200);
  const stuck = stalled.filter((r) => daysAgo(r.updatedAt) >= 14);
  if (stuck.length) {
    attention.push({ key: 'stalled_production', text: `${stuck.length} job${stuck.length === 1 ? '' : 's'} have not moved in Production for two weeks or more`, page: 'production', count: stuck.length });
  }

  // A job can be owned two ways: the JobTread "Sales Rep" field, or an in-app
  // override in rep_assignments — and ownerOf() checks the override FIRST.
  // Counting only the field reported jobs as unassigned that somebody had
  // already claimed, and would have gone on reporting them for ever.
  const [{ n: orphanJobtread }] = await db.select({ n: sql<number>`count(*)` })
    .from(leads)
    .leftJoin(repAssignments, eq(repAssignments.jobExternalId, leads.externalId))
    .where(and(
      isNull(leads.jtSalesRep), isNull(leads.closedOn), isNull(repAssignments.id),
      eq(leads.source, 'jobtread'),
    ));
  if (Number(orphanJobtread)) {
    attention.push({
      key: 'unassigned_jobs',
      text: `${orphanJobtread} live job${Number(orphanJobtread) === 1 ? ' has' : 's have'} no rep against them`,
      page: 'assignments', count: Number(orphanJobtread),
    });
  }

  // The old CRM's leads are counted apart. They are not JobTread jobs, nobody
  // is working them, and folding them into the line above buried a number
  // somebody should act on inside one nobody can.
  const [{ n: orphanRooflink }] = await db.select({ n: sql<number>`count(*)` })
    .from(leads)
    .leftJoin(repAssignments, eq(repAssignments.jobExternalId, leads.externalId))
    .where(and(
      isNull(leads.jtSalesRep), isNull(leads.closedOn), isNull(repAssignments.id),
      eq(leads.source, 'rooflink'),
    ));
  if (Number(orphanRooflink)) {
    attention.push({
      key: 'rooflink_unclaimed',
      text: `${orphanRooflink} old RoofLink leads have never been picked up — worth a decision on whether they ever will be`,
      page: 'leads', count: Number(orphanRooflink),
    });
  }

  const readyToApprove = (await db.select().from(jobCommissions).where(eq(jobCommissions.status, 'open')))
    .filter((r) => num(r.revenue) > 0 && !!r.leadSource).length;
  if (readyToApprove) {
    attention.push({
      key: 'commissions_ready',
      text: `${readyToApprove} commission record${readyToApprove === 1 ? ' is' : 's are'} ready to approve`,
      page: 'payouts', count: readyToApprove,
    });
  }

  sections.push({
    heading: 'Needs a decision',
    attention,
    empty: 'Nothing is stuck — no stalled jobs, no unassigned leads, nothing waiting on an approval.',
  });

  // The shape of the week, for the room that decides where people go.
  sections.push(...(await appointmentSections(mondayIso)));

  return { key: 'leadership', sections };
}

// -------------------------------------------------------------------- claims

async function claimsAgenda(mondayIso: string): Promise<MeetingAgenda> {
  const sections: MeetingSection[] = [];
  const open = await db.select().from(claims).where(ne(claims.stage, 'closed'));

  const byStage = CLAIM_PIPELINE_STAGES
    .map((s) => ({ label: s.label, value: String(open.filter((c) => c.stage === s.key).length) }))
    .filter((r) => r.value !== '0');
  sections.push({
    heading: `Open claims · ${open.length}`,
    rows: byStage,
    empty: 'No open claims.',
  });

  // The ones the carrier is sitting on, oldest first — the meeting's real work.
  const waiting = open
    .filter((c) => ['waiting_results', 'disputing', 'supplement', 'post_supplementing'].includes(c.stage))
    .map((c) => ({ c, age: daysAgo(c.updatedAt ?? c.createdAt) }))
    .sort((a, b) => b.age - a.age)
    .slice(0, 15);
  sections.push({
    heading: 'Waiting on the carrier',
    rows: waiting.map(({ c, age }) => ({
      label: c.customerName,
      value: `${age} day${age === 1 ? '' : 's'}`,
      note: [c.carrier, c.claimNumber].filter(Boolean).join(' · '),
    })),
    empty: 'Nothing is sitting with a carrier.',
  });

  const quiet = open
    .map((c) => ({ c, age: daysAgo(c.updatedAt ?? c.createdAt) }))
    .filter(({ age }) => age >= 10)
    .sort((a, b) => b.age - a.age)
    .slice(0, 15);
  sections.push({
    heading: 'Gone quiet · nothing recorded in 10 days or more',
    rows: quiet.map(({ c, age }) => ({ label: c.customerName, value: `${age} days`, note: c.stage })),
    empty: 'Every open claim has been touched in the last ten days.',
  });

  // What the room has to SOLVE, as opposed to read. Keyed, so each finding is
  // raised once and then carries its age rather than reappearing every Monday.
  const claimsAttention: Attention[] = [];
  if (quiet.length) {
    claimsAttention.push({
      key: 'claims_gone_quiet', page: 'claims', count: quiet.length,
      text: `${quiet.length} open claim${quiet.length === 1 ? ' has' : 's have'} had nothing recorded for ten days or more`,
    });
  }
  const stuckWithCarrier = waiting.filter(({ age }) => age >= 14);
  if (stuckWithCarrier.length) {
    claimsAttention.push({
      key: 'claims_stuck_carrier', page: 'claims', count: stuckWithCarrier.length,
      text: `${stuckWithCarrier.length} claim${stuckWithCarrier.length === 1 ? ' has' : 's have'} been with the carrier a fortnight or more`,
    });
  }
  sections.push({
    heading: 'Needs solving',
    attention: claimsAttention,
    empty: 'Nothing is stuck — every claim has been touched and none are ageing with the carrier.',
  });

  const depreciation = open.filter((c) => c.stage === 'request_depreciation');
  if (depreciation.length) {
    sections.push({
      heading: 'Depreciation requested, not yet received',
      rows: depreciation.map((c) => ({
        label: c.customerName,
        value: money(num((c.amounts as any)?.rcv) - num((c.amounts as any)?.acv)),
        note: c.carrier ?? '',
      })),
    });
  }

  return { key: 'claims', sections };
}

// --------------------------------------------------------------------- sales

async function salesAgenda(mondayIso: string): Promise<MeetingAgenda> {
  const w = windows(mondayIso);
  const sections: MeetingSection[] = [];

  const reps = await db.select({ name: teamMembers.name, repName: teamMembers.jobtreadSalesRep })
    .from(teamMembers).where(and(eq(teamMembers.active, true), eq(teamMembers.role, 'sales')));

  const weekLeads = await db.select({ rep: leads.jtSalesRep }).from(leads)
    .where(and(gte(leads.createdAt, w.last.from), lte(leads.createdAt, w.last.to)));
  const weekSigned = await db.select({ jobRef: deals.jobRef, amount: deals.amount }).from(deals)
    .where(and(isNotNull(deals.signedAt), gte(deals.signedAt, w.last.from), lte(deals.signedAt, w.last.to)));

  // A deal carries a job name, not a rep, so the rep comes via the lead.
  const jobRep = new Map<string, string>();
  for (const l of await db.select({ jobName: leads.jobName, rep: leads.jtSalesRep }).from(leads).where(isNotNull(leads.jtSalesRep))) {
    if (l.jobName) jobRep.set(l.jobName, l.rep!);
  }

  sections.push({
    heading: `Last week by rep · ${w.last.iso.from} to ${w.last.iso.to}`,
    rows: reps.map((r) => {
      const name = r.repName || r.name;
      const got = weekLeads.filter((l) => l.rep === name).length;
      const won = weekSigned.filter((d) => d.jobRef && jobRep.get(d.jobRef) === name);
      const value = won.reduce((s, d) => s + num(d.amount), 0);
      return {
        label: r.name,
        value: `${won.length} signed · ${money(value)}`,
        note: `${got} new lead${got === 1 ? '' : 's'}`,
      };
    }).sort((a, b) => a.label.localeCompare(b.label)),
    empty: 'No sales reps on the roster.',
  });

  const pipeline = await db.select({ stage: salesPipeline.stage }).from(salesPipeline);
  sections.push({
    heading: 'In the pipeline now',
    rows: SALES_PIPELINE_STAGES
      .map((s) => ({ label: s.label, value: String(pipeline.filter((p) => p.stage === s.key).length) }))
      .filter((r) => r.value !== '0'),
    empty: 'The sales pipeline is empty.',
  });

  // What ran, what is booked, and who has written to us without an answer.
  sections.splice(1, 0, ...(await appointmentSections(mondayIso)));
  const waiting = await waitingOnUsSections(mondayIso);
  sections.push(...waiting);

  // The findings this room has to solve, keyed for the issues list.
  const salesAttention: Attention[] = [];

  const [{ n: overdue }] = await db.select({ n: sql<number>`count(*)` }).from(followUps)
    // Same rule as the scorecard's measure: a ::date cast on a legacy "next
    // week" threw and took the whole agenda down, and current_date is UTC's —
    // a day ahead after 8pm Eastern, so today's follow-ups read as overdue.
    .where(and(eq(followUps.done, false), overdueFollowUpSql(sql`${followUps.dueDate}`)));
  if (Number(overdue)) {
    salesAttention.push({
      key: 'overdue_followups', page: 'followups', count: Number(overdue),
      text: `${overdue} follow-up${Number(overdue) === 1 ? ' is' : 's are'} past their due date`,
    });
  }

  // Nobody booked in front of a customer is the one that ends the week early.
  const bookedAhead = await customerAppointmentsAhead(mondayIso);
  if (bookedAhead === 0) {
    salesAttention.push({
      key: 'empty_week', page: 'schedule', count: 0,
      text: 'Nothing with a customer is booked this week — no inspections, no adjuster meetings',
    });
  }

  const unanswered = waiting.reduce((most, s) => Math.max(most, s.rows?.length ?? 0), 0);
  if (unanswered >= 5) {
    salesAttention.push({
      key: 'customers_waiting', page: 'inbox', count: unanswered,
      text: `${unanswered} customer${unanswered === 1 ? ' is' : 's are'} waiting on a reply from us`,
    });
  }

  sections.push({
    heading: 'Needs solving',
    attention: salesAttention,
    empty: 'Diaries are full, follow-ups are current, and nobody is waiting on a reply.',
  });

  return { key: 'sales', sections };
}

// ------------------------------------------------------------------- payroll

async function payrollAgenda(mondayIso: string): Promise<MeetingAgenda> {
  const sections: MeetingSection[] = [];
  const rows = await db.select().from(jobCommissions);

  // "Due" is approved and unpaid — the same definition the Payouts board uses.
  const due = rows.filter((r) => r.status === 'approved' && !r.paidAt);
  const byRep = new Map<string, { n: number; total: number }>();
  for (const r of due) {
    const k = r.repName || 'Unassigned';
    const cur = byRep.get(k) ?? { n: 0, total: 0 };
    byRep.set(k, { n: cur.n + 1, total: cur.total + num(r.commissionAmount) });
  }
  const dueTotal = due.reduce((s, r) => s + num(r.commissionAmount), 0);

  sections.push({
    heading: `Owed now · ${money(dueTotal)} across ${due.length} job${due.length === 1 ? '' : 's'}`,
    rows: [...byRep.entries()]
      .sort((a, b) => b[1].total - a[1].total)
      .map(([rep, v]) => ({ label: rep, value: money(v.total), note: `${v.n} job${v.n === 1 ? '' : 's'}` })),
    empty: 'Nothing is approved and unpaid.',
  });

  // Ready means the numbers are in: revenue filed and the rep has said where
  // the lead came from. Anything else cannot be approved yet, and is below.
  const ready = rows.filter((r) => r.status === 'open' && num(r.revenue) > 0 && !!r.leadSource);
  sections.push({
    heading: 'Ready to approve',
    rows: ready.map((r) => ({
      label: r.jobName || r.jobExternalId,
      value: money(num(r.commissionAmount)),
      note: r.repName ?? '',
    })),
    empty: 'Nothing is waiting to be approved.',
  });

  // A record with no revenue cannot be paid, and it is always somebody waiting.
  const incomplete = rows.filter((r) => r.status === 'open' && (num(r.revenue) === 0 || !r.leadSource));
  sections.push({
    heading: 'Cannot be worked out yet',
    rows: incomplete.slice(0, 20).map((r) => ({
      label: r.jobName || r.jobExternalId,
      value: num(r.revenue) === 0 ? 'no revenue filed' : 'no lead source',
      note: r.repName ?? '',
    })),
    empty: 'Every open record has what it needs.',
  });

  return { key: 'payroll', sections };
}

/** All four, assembled together. */
export async function buildAgendas(mondayIso: string): Promise<MeetingAgenda[]> {
  return Promise.all([
    leadershipAgenda(mondayIso),
    claimsAgenda(mondayIso),
    salesAgenda(mondayIso),
    payrollAgenda(mondayIso),
  ]);
}
