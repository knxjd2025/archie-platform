/**
 * The morning check-in every sales rep gets: what to update today.
 *
 * One message per rep, 8 AM Eastern, Monday to Saturday, listing:
 *   - canvassed houses whose follow-up date has come
 *   - hot houses (interested / appointment / inspected) nobody has touched in days
 *   - today's appointments, and yesterday's that still need an outcome logged
 *   - their open leads that have gone quiet
 *
 * It goes by email and/or text according to the rep's own notify settings on
 * the Team page. A rep with nothing to update gets nothing — a daily message
 * that is usually empty teaches people to ignore it.
 *
 * rep_daily_reminders holds one row per rep per day: the unique key stops a
 * second send, and the rows are the record of who was reminded and of what.
 */
import { and, eq, inArray, lte, notInArray, sql } from 'drizzle-orm';
import { db } from '../db';
import {
  appointments, canvassProperties, canvassPropertyMeta, leads, repDailyReminders, teamMembers,
} from '../../shared/schema';
import { ownedLeadWhere, type SessionUser } from '../access/rep-scope';
import { ownerSql } from './access';
import { sendAsMailbox } from '../brain/gmail-delegated';
import { sendGhlSms, upsertContactByPhone } from '../brain/ghl-brain';
import { TEAM } from '../brain/types';

const ZONE = 'America/New_York';
const SEND_HOUR = 8;
const STALE_HOUSE_DAYS = 3;
const STALE_LEAD_DAYS = 3;
const LIST_CAP = 8;
const HOT_STATUSES = ['interested', 'appointment', 'inspected'] as const;
const CLOSED_STATUSES = ['sold', 'not_interested'];
const OPEN_LEAD_STATUSES = ['new', 'contacted', 'qualified', 'proposal_sent', 'negotiation'] as const;

// ---- Pure core (unit-tested) -------------------------------------------------

export interface EasternNow { dateIso: string; hour: number; weekday: number }

/** Today's date, hour and weekday (0 = Sunday) in Eastern time. */
export function easternNow(now: Date): EasternNow {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false, weekday: 'short',
    }).formatToParts(now).map((p) => [p.type, p.value]),
  );
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday);
  return { dateIso: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) % 24, weekday };
}

/**
 * Vercel crons run in UTC, so the job is scheduled at both 12:00 and 13:00 UTC
 * and only the run that lands on 8 AM Eastern sends — right on either side of
 * daylight saving. Sunday is a day off.
 */
export function isSendWindow(now: Date): boolean {
  const e = easternNow(now);
  return e.hour === SEND_HOUR && e.weekday !== 0;
}

/** UTC instant of Eastern midnight on a YYYY-MM-DD date. */
export function easternMidnight(dateIso: string): Date {
  const probe = new Date(`${dateIso}T12:00:00Z`);
  const easternHourAtNoonUtc = easternNow(probe).hour;
  const offsetHours = 12 - easternHourAtNoonUtc; // 4 in summer, 5 in winter
  return new Date(Date.UTC(
    Number(dateIso.slice(0, 4)), Number(dateIso.slice(5, 7)) - 1, Number(dateIso.slice(8, 10)), offsetHours,
  ));
}

export function addDaysIso(dateIso: string, days: number): string {
  const d = new Date(`${dateIso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export interface ReminderHouse { address: string; status: string; daysSince?: number }
export interface ReminderAppointment { title: string; start: Date; address: string | null }
export interface ReminderLead { name: string; status: string; daysSince: number | null }

export interface ReminderInput {
  repName: string;
  followUpsDue: ReminderHouse[];
  staleHouses: ReminderHouse[];
  appointmentsToday: ReminderAppointment[];
  appointmentsToLog: ReminderAppointment[];
  staleLeads: ReminderLead[];
  /** Totals before the lists were capped. */
  totals: { followUpsDue: number; staleHouses: number; staleLeads: number };
}

export interface ReminderMessage { subject: string; html: string; sms: string; counts: Record<string, number> }

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const STATUS_WORDS: Record<string, string> = {
  not_knocked: 'not knocked', no_answer: 'no answer', not_interested: 'not interested', proposal_sent: 'proposal sent',
};
const statusWord = (s: string): string => STATUS_WORDS[s] ?? s.replace(/_/g, ' ');

const timeOf = (d: Date): string =>
  new Intl.DateTimeFormat('en-US', { timeZone: ZONE, hour: 'numeric', minute: '2-digit' }).format(d);

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** The message for one rep, or null when there is nothing for them to update. */
export function buildRepReminder(input: ReminderInput, appUrl: string): ReminderMessage | null {
  const counts = {
    followUpsDue: input.totals.followUpsDue,
    staleHouses: input.totals.staleHouses,
    appointmentsToday: input.appointmentsToday.length,
    appointmentsToLog: input.appointmentsToLog.length,
    staleLeads: input.totals.staleLeads,
  };
  if (Object.values(counts).every((n) => n === 0)) return null;

  const first = input.repName.split(/\s+/)[0] || input.repName;
  const url = appUrl.replace(/\/+$/, '');
  const more = (shown: number, total: number) => (total > shown ? `<li><i>…and ${total - shown} more in the app</i></li>` : '');

  const sections: string[] = [];
  if (input.appointmentsToday.length) {
    sections.push(`<h3>📅 Today's appointments (${input.appointmentsToday.length})</h3><ul>${input.appointmentsToday
      .map((a) => `<li><b>${timeOf(a.start)}</b> ${escapeHtml(a.title)}${a.address ? ` — ${escapeHtml(a.address)}` : ''}</li>`).join('')}</ul>`);
  }
  if (input.appointmentsToLog.length) {
    sections.push(`<h3>✍️ Log how yesterday's went (${input.appointmentsToLog.length})</h3><ul>${input.appointmentsToLog
      .map((a) => `<li>${escapeHtml(a.title)}${a.address ? ` — ${escapeHtml(a.address)}` : ''}</li>`).join('')}</ul>`);
  }
  if (input.followUpsDue.length) {
    sections.push(`<h3>🔁 Follow-ups due (${counts.followUpsDue})</h3><ul>${input.followUpsDue
      .map((h) => `<li>${escapeHtml(h.address)} <i>(${statusWord(h.status)})</i></li>`).join('')}${more(input.followUpsDue.length, counts.followUpsDue)}</ul>`);
  }
  if (input.staleHouses.length) {
    sections.push(`<h3>🔥 Hot doors going cold (${counts.staleHouses})</h3><ul>${input.staleHouses
      .map((h) => `<li>${escapeHtml(h.address)} — ${statusWord(h.status)}, ${plural(h.daysSince ?? 0, 'day')} since an update</li>`).join('')}${more(input.staleHouses.length, counts.staleHouses)}</ul>`);
  }
  if (input.staleLeads.length) {
    sections.push(`<h3>📋 Leads that need an update (${counts.staleLeads})</h3><ul>${input.staleLeads
      .map((l) => `<li>${escapeHtml(l.name)} — ${statusWord(l.status)}${l.daysSince != null ? `, ${plural(l.daysSince, 'day')} since last contact` : ', never contacted'}</li>`).join('')}${more(input.staleLeads.length, counts.staleLeads)}</ul>`);
  }

  const todo = counts.followUpsDue + counts.staleHouses + counts.appointmentsToLog + counts.staleLeads;
  const subject = `☀️ ${first}, your morning check-in — ${plural(todo + counts.appointmentsToday, 'item')}`;
  const html = `<p>Good morning ${escapeHtml(first)} — here's what needs an update today so the board stays accurate.</p>`
    + sections.join('')
    + `<p><a href="${url}/">Open the app</a> to update statuses, notes and follow-up dates.</p>`;

  const bits = [
    counts.appointmentsToday && plural(counts.appointmentsToday, 'appt') + ' today',
    counts.appointmentsToLog && plural(counts.appointmentsToLog, 'appt') + ' to log',
    counts.followUpsDue && plural(counts.followUpsDue, 'follow-up') + ' due',
    counts.staleHouses && plural(counts.staleHouses, 'hot door') + ' going cold',
    counts.staleLeads && plural(counts.staleLeads, 'lead') + ' to update',
  ].filter(Boolean);
  const sms = `BRN morning check-in, ${first}: ${bits.join(', ')}. Update them here: ${url}/`;
  return { subject, html, sms, counts };
}

// ---- DB-backed ---------------------------------------------------------------

interface Rep { id: number; name: string; email: string; phone: string | null; notifyEmail: boolean; notifySms: boolean; role: SessionUser['role'] }

const daysSince = (d: Date | null, now: Date): number | null =>
  d ? Math.max(0, Math.floor((now.getTime() - new Date(d).getTime()) / 86_400_000)) : null;

/** Everything one rep should update today. */
export async function gatherReminderInput(rep: Rep, now: Date): Promise<ReminderInput> {
  const email = rep.email.toLowerCase();
  const today = easternNow(now).dateIso;
  const startYesterday = easternMidnight(addDaysIso(today, -1));
  const startToday = easternMidnight(today);
  const endToday = easternMidnight(addDaysIso(today, 1));

  const mine = sql`${ownerSql} = ${email}`;
  const houses = db.select({ address: canvassProperties.address, status: canvassProperties.status, updatedAt: canvassProperties.updatedAt })
    .from(canvassProperties)
    .leftJoin(canvassPropertyMeta, eq(canvassPropertyMeta.canvassPropertyId, canvassProperties.id));

  const followUps = await houses
    .where(and(mine, lte(canvassPropertyMeta.followUpAt, endToday), notInArray(canvassProperties.status, CLOSED_STATUSES)))
    .orderBy(canvassPropertyMeta.followUpAt);
  const staleCutoff = new Date(now.getTime() - STALE_HOUSE_DAYS * 86_400_000);
  const stale = await houses
    .where(and(
      mine,
      inArray(canvassProperties.status, [...HOT_STATUSES]),
      lte(canvassProperties.updatedAt, staleCutoff),
      // A house already listed as a follow-up is not listed twice.
      sql`(${canvassPropertyMeta.followUpAt} IS NULL OR ${canvassPropertyMeta.followUpAt} > ${endToday})`,
    ))
    .orderBy(canvassProperties.updatedAt);

  // A rep's appointments are the ones on their own calendar or that invite them.
  const onMyCalendar = sql`(lower(${appointments.calendarSource}) = ${email} OR EXISTS (
    SELECT 1 FROM jsonb_array_elements_text(coalesce(${appointments.attendees}, '[]'::jsonb)) a WHERE lower(a) = ${email}))`;
  const appts = await db.select({ title: appointments.title, start: appointments.start, address: appointments.address, kind: appointments.kind })
    .from(appointments)
    .where(and(onMyCalendar, sql`${appointments.start} >= ${startYesterday}`, sql`${appointments.start} < ${endToday}`))
    .orderBy(appointments.start);
  const customerAppts = appts.filter((a) => a.start && a.kind !== 'internal');
  const toAppt = (a: (typeof appts)[number]): ReminderAppointment => ({ title: a.title || 'Appointment', start: a.start!, address: a.address });

  const leadCutoff = new Date(now.getTime() - STALE_LEAD_DAYS * 86_400_000);
  const user: SessionUser = { email: rep.email, name: rep.name, role: rep.role };
  const quietLeads = await db.select({
    firstName: leads.firstName, lastName: leads.lastName, jobName: leads.jobName, status: leads.status,
    lastContactedAt: leads.lastContactedAt, createdAt: leads.createdAt,
  })
    .from(leads)
    .where(and(
      await ownedLeadWhere(user),
      inArray(leads.status, [...OPEN_LEAD_STATUSES]),
      sql`coalesce(${leads.lastContactedAt}, ${leads.createdAt}) <= ${leadCutoff}`,
    ))
    .orderBy(sql`coalesce(${leads.lastContactedAt}, ${leads.createdAt})`);

  return {
    repName: rep.name,
    followUpsDue: followUps.slice(0, LIST_CAP).map((h) => ({ address: h.address, status: h.status })),
    staleHouses: stale.slice(0, LIST_CAP).map((h) => ({ address: h.address, status: h.status, daysSince: daysSince(h.updatedAt, now) ?? 0 })),
    appointmentsToday: customerAppts.filter((a) => a.start! >= startToday).map(toAppt),
    appointmentsToLog: customerAppts.filter((a) => a.start! < startToday).map(toAppt),
    staleLeads: quietLeads.slice(0, LIST_CAP).map((l) => ({
      name: l.jobName || [l.firstName, l.lastName].filter(Boolean).join(' ') || 'Unnamed lead',
      status: l.status ?? 'new',
      daysSince: daysSince(l.lastContactedAt, now),
    })),
    totals: { followUpsDue: followUps.length, staleHouses: stale.length, staleLeads: quietLeads.length },
  };
}

/** REP_REMINDERS=off stops them; =dry_run records what would go without sending. Default: on. */
function reminderMode(): 'on' | 'off' | 'dry_run' {
  const v = String(process.env.REP_REMINDERS || 'on').toLowerCase();
  return v === 'off' || v === 'dry_run' ? v : 'on';
}

export interface ReminderRunResult { date: string; reps: number; sent: number; nothingToDo: number; alreadySent: number; failed: number; retried: number }

/** A claimed row with no outcome after this long belongs to a run that was killed mid-send. */
export const ABANDONED_CLAIM_MS = 10 * 60_000;

/**
 * Whether today's row for a rep should be sent again. The row is claimed
 * before sending (so two runs never both send), which meant a send that
 * failed — or a run killed between the claim and the send — left a row that
 * made every later run that day skip the rep: no reminder, and no retry.
 */
export function reminderNeedsRetry(
  row: { emailStatus: string | null; smsStatus: string | null; sentAt: Date | null },
  now: Date,
): boolean {
  if (row.emailStatus === 'failed' || row.smsStatus === 'failed') return true;
  if (row.emailStatus === null && row.smsStatus === null) {
    return !row.sentAt || now.getTime() - new Date(row.sentAt).getTime() > ABANDONED_CLAIM_MS;
  }
  return false;
}

/**
 * Take back today's row for a retry — atomically, so two runs cannot both
 * resend. Mirrors reminderNeedsRetry. A channel that already went out stays
 * 'sent' and is not sent twice; a failed one is cleared for the new attempt.
 */
async function reclaimForRetry(teamMemberId: number, date: string) {
  const [row] = await db.update(repDailyReminders)
    .set({
      emailStatus: sql`CASE WHEN ${repDailyReminders.emailStatus} = 'sent' THEN 'sent' ELSE NULL END`,
      smsStatus: sql`CASE WHEN ${repDailyReminders.smsStatus} = 'sent' THEN 'sent' ELSE NULL END`,
      error: null,
      sentAt: new Date(),
    })
    .where(and(
      eq(repDailyReminders.teamMemberId, teamMemberId),
      eq(repDailyReminders.reminderDate, date),
      sql`(${repDailyReminders.emailStatus} = 'failed' OR ${repDailyReminders.smsStatus} = 'failed'
        OR (${repDailyReminders.emailStatus} IS NULL AND ${repDailyReminders.smsStatus} IS NULL
          AND (${repDailyReminders.sentAt} IS NULL OR ${repDailyReminders.sentAt} < ${new Date(Date.now() - ABANDONED_CLAIM_MS).toISOString()}::timestamp)))`,
    ))
    .returning({ id: repDailyReminders.id, emailStatus: repDailyReminders.emailStatus, smsStatus: repDailyReminders.smsStatus });
  return row ?? null;
}

async function deliver(rep: Rep, msg: ReminderMessage, mode: 'on' | 'dry_run', alreadySent = { email: false, sms: false }) {
  let emailStatus = 'skipped', smsStatus = 'skipped';
  const errors: string[] = [];
  if (rep.notifyEmail && alreadySent.email) emailStatus = 'sent';
  else if (rep.notifyEmail) {
    if (mode === 'dry_run') emailStatus = 'dry_run';
    else {
      try { await sendAsMailbox(TEAM.james.email, rep.email, msg.subject, msg.html); emailStatus = 'sent'; }
      catch (e: any) { emailStatus = 'failed'; errors.push(`email: ${String(e?.message || e).slice(0, 200)}`); }
    }
  }
  if (rep.notifySms && rep.phone && alreadySent.sms) smsStatus = 'sent';
  else if (rep.notifySms && rep.phone) {
    if (mode === 'dry_run') smsStatus = 'dry_run';
    else {
      try {
        const contactId = await upsertContactByPhone(`${rep.name} (BRN team)`, rep.phone);
        if (!contactId) throw new Error('no GoHighLevel contact for that number');
        await sendGhlSms(contactId, msg.sms);
        smsStatus = 'sent';
      } catch (e: any) { smsStatus = 'failed'; errors.push(`sms: ${String(e?.message || e).slice(0, 200)}`); }
    }
  }
  return { emailStatus, smsStatus, error: errors.join(' | ') || null };
}

/** Send today's check-in to every active sales rep who has something to update. */
export async function runRepReminders(now: Date, appUrl: string): Promise<ReminderRunResult> {
  const mode = reminderMode();
  const date = easternNow(now).dateIso;
  const result: ReminderRunResult = { date, reps: 0, sent: 0, nothingToDo: 0, alreadySent: 0, failed: 0, retried: 0 };
  if (mode === 'off') return result;

  const reps = (await db.select({
    id: teamMembers.id, name: teamMembers.name, email: teamMembers.email, phone: teamMembers.phone,
    notifyEmail: teamMembers.notifyEmail, notifySms: teamMembers.notifySms, role: teamMembers.role, active: teamMembers.active,
  }).from(teamMembers)).filter((m) => m.active && m.role === 'sales') as Array<Rep & { active: boolean }>;
  result.reps = reps.length;

  for (const rep of reps) {
    try {
      const msg = buildRepReminder(await gatherReminderInput(rep, now), appUrl);
      if (!msg) { result.nothingToDo++; continue; }
      // Claim today's row first: a second cron run finds it and stops — unless
      // the earlier attempt failed (or was killed mid-send), which it retries.
      const [fresh] = await db.insert(repDailyReminders)
        .values({ teamMemberId: rep.id, reminderDate: date, counts: msg.counts })
        .onConflictDoNothing()
        .returning({ id: repDailyReminders.id });
      const retry = fresh ? null : await reclaimForRetry(rep.id, date);
      const claimedId = fresh?.id ?? retry?.id;
      if (!claimedId) { result.alreadySent++; continue; }
      if (retry) result.retried++;
      const outcome = await deliver(rep, msg, mode, { email: retry?.emailStatus === 'sent', sms: retry?.smsStatus === 'sent' });
      await db.update(repDailyReminders).set(outcome).where(eq(repDailyReminders.id, claimedId));
      if ([outcome.emailStatus, outcome.smsStatus].includes('failed')) result.failed++;
      else result.sent++;
    } catch (e: any) {
      result.failed++;
      console.error(`[rep-reminders] ${rep.email}:`, e?.message || e);
    }
  }
  return result;
}
