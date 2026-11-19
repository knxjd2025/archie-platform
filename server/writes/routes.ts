import type { Express, Request, Response } from 'express';
import { boardTz } from '../../shared/schedule-board';
import { currentProfile } from '../tenant/context';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { leads, teamMembers } from '../../shared/schema';
import { requireAuth } from '../auth/middleware';
import { JobTreadClient, isValidJobStatus } from '../integrations/jobtread';
import { GoHighLevelClient } from '../integrations/gohighlevel';
import { getDelegatedCalendar } from '../integrations/google-workspace';
import { syncCalendar } from '../sync/calendar-sync';
import { logWrite } from './log';
import { ownsLead, isScoped, repClientIdentifiers, type SessionUser } from '../access/rep-scope';
import { asyncHandler } from '../lib/async-handler';
import { ensureJobCommissionFor } from '../job-commissions/service';
import { isSoldJob } from '../../shared/job-commission';
import { bookingCalendarFor, visibleCalendarsFor } from '../calendar/access';
import { canBookOn } from '../calendar/board';
import { applyAssignment } from '../access/assignment-service';
import { sendFailure } from '../lib/failure';
import { dataScope, isNarrowed } from '../../shared/rbac';
import { jobTreadWriteFailStatus } from '../integrations/jobtread-connection';
import { emitLeadCreated } from '../sister/events';
import { getCurrentCompany } from '../tenant/companies';
import { jobBackendFor } from '../production/native-jobs';
import { createNativeLead, jobOwnerByEmail, jobOwnerByName } from '../production/native-leads';
import { addNativeNote, MAX_NOTE_CHARS, NOTE_TOO_LONG, parseNativeContact, updateNativeContact } from '../production/native-job-page';


export interface AppointmentSlot { date: string; time: string; durationMins: number; type: string; notes: string }

/** The appointment fields off a request body, or null when there is no date+time. */
export function parseAppointment(b: any): AppointmentSlot | null {
  const date = String(b?.date || '').trim();        // YYYY-MM-DD
  const time = String(b?.time || '').trim();        // HH:mm (24h)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null;
  return {
    date, time,
    durationMins: Math.min(Math.max(Number(b?.durationMins) || 60, 15), 480),
    type: String(b?.type || 'Inspection').trim() || 'Inspection',
    notes: String(b?.notes || '').trim(),
  };
}

/** The Google Calendar event for a slot — pure, so it can be tested without a calendar. */
export function appointmentEvent(slot: AppointmentSlot, opts: { clientName: string; address?: string | null; bookedBy: string }) {
  const startWall = `${slot.date}T${slot.time}:00`;
  const endWall = new Date(new Date(`${startWall}Z`).getTime() + slot.durationMins * 60000).toISOString().slice(0, 19);
  return {
    summary: `${slot.type} — ${opts.clientName}`,
    location: opts.address || undefined,
    description: `${slot.notes ? slot.notes + '\n\n' : ''}Booked from the Team App by ${opts.bookedBy}.`,
    start: { dateTime: startWall, timeZone: boardTz() },
    end: { dateTime: endWall, timeZone: boardTz() },
  };
}

/**
 * Book a slot on the calendar and log it. Shared by "Schedule inspection" on a
 * client and by the quick lead + appointment flow, so both book the same way.
 */
async function bookAppointment(input: { user: { email: string; name: string }; slot: AppointmentSlot; clientName: string; address?: string | null; targetId: string | null; bookOn?: string | null }) {
  const { user, slot } = input;
  const bookOn = input.bookOn || await bookingCalendarFor(user.email);
  let ok = true; let error: string | null = null; let eventId: string | null = null;
  try {
    const cal = getDelegatedCalendar(bookOn);
    const r: any = await cal.events.insert({ calendarId: bookOn, requestBody: appointmentEvent(slot, { clientName: input.clientName, address: input.address, bookedBy: user.name }) });
    eventId = r?.data?.id || null;
  } catch (e: any) { ok = false; error = e?.message || 'Calendar insert failed'; }

  await logWrite({
    actor: user.email, system: 'google', action: 'book_appointment', targetId: input.targetId,
    summary: `${slot.type} for ${input.clientName} on ${slot.date} ${slot.time} (${bookOn})`, ok, error,
  });
  if (ok) { try { await syncCalendar(); } catch { /* the hourly sync will catch it */ } }
  return { ok, error, eventId, bookedOn: bookOn };
}

/**
 * Whose calendar a booking goes on when the booker asked for someone else's
 * (the cold caller booking for a rep from the availability board). Only a
 * calendar the booker can see on the board is allowed; an unknown or hidden
 * one is refused rather than silently landing on the booker's own calendar.
 */
async function resolveBookOn(user: SessionUser, forEmail: unknown): Promise<{ bookOn: string | null; error?: string }> {
  const target = String(forEmail || '').trim().toLowerCase();
  if (!target) return { bookOn: null };
  const [member] = await db.select({ email: teamMembers.email, active: teamMembers.active }).from(teamMembers).where(eq(teamMembers.email, target));
  if (!member?.active) return { bookOn: null, error: 'That person is not on the active roster.' };
  const visible = await visibleCalendarsFor(user);
  if (!canBookOn(user, target, visible)) return { bookOn: null, error: "You can't book on that calendar." };
  return { bookOn: await bookingCalendarFor(target) };
}

/** Normalize a requested reply channel, or null if unsupported. */
export function normalizeReplyChannel(channel: unknown): 'sms' | 'email' | null {
  const c = String(channel || '').toLowerCase();
  return c === 'sms' || c === 'email' ? c : null;
}

// Loose on purpose (this app sees US numbers in every shape a rep might type
// them) — just enough to catch garbage before it's written across JobTread,
// GHL, and the local leads table in one fan-out.
const PHONE_RE = /^[\d\s()+.-]{7,20}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Said when someone tries to book in a company that keeps its own jobs: from the lead form, or for one of its jobs. */
export const NATIVE_BOOKING_UNAVAILABLE = 'Booking is not available for your company yet.';

/** Said when the job page's stage control is used on a job Archie keeps: the Production board moves it, with its checks. */
export const NATIVE_STAGE_ON_BOARD = 'Move this job on the Production board.';

/** Which system keeps this job (server/production/native-jobs.ts, the one seam), for the current company. */
async function backendOf(externalId: string) {
  return jobBackendFor({ externalId }, await getCurrentCompany());
}

/**
 * The lead form for a company that keeps its own jobs (server/production/native-leads.ts).
 * No JobTread, no KynexPro (Roof Lee owns it for this company) and no calendar.
 *
 * Who owns it from the start, so the right people can see it:
 *   - the salesperson a sales leader picked on the form (the dropdown sends
 *     the person's name: such a company has no JobTread rep names);
 *   - else the person who typed it in, when they would otherwise not see it
 *     (a rep, or a sales leader who sees only their own team). Never a crew
 *     member: owning a job opens its money;
 *   - else nobody yet. Office staff and admins see every lead already, and a
 *     lead nobody owns waits on the Assignments page for a manager.
 */
async function createLeadInArchie(
  b: any,
  typed: { firstName: string; lastName: string; phone: string; email: string; address: string },
  user: SessionUser,
) {
  const { firstName, lastName, phone, email, address } = typed;
  const actor = user.email;
  const picked = dataScope(user.role) !== 'self' ? await jobOwnerByName(b.salesRep) : null;
  const owner = picked ?? (isNarrowed(user.role) ? await jobOwnerByEmail(actor) : null);
  const clientName = `${firstName} ${lastName}`.trim() || phone || email;
  const { row } = await createNativeLead({
    values: {
      firstName: firstName || null, lastName: lastName || null,
      email: email || null, phone: phone || null,
      address: address || null, city: String(b.city || '').trim() || null,
      state: String(b.state || '').trim() || null, zip: String(b.zip || '').trim() || null,
      serviceType: String(b.serviceType || '').trim() || null, status: 'new' as any,
      // The whole name, as a lead Roof Lee adds has it: the page shows the customer's
      // whole name, and a job name that differs from it is printed under it.
      jobName: `${firstName} ${lastName}`.trim() || null,
      enteredBy: actor, enteredByName: user.name || null,
      ...(String(b.notes || '').trim() ? { notes: String(b.notes).trim().slice(0, 2000) } : {}),
    },
    actor, action: 'create_lead', summary: clientName,
    ownerId: owner?.id ?? null, ownerSource: 'created',
    ownerEvidence: picked ? `picked on the lead form by ${user.name || actor}` : `entered by ${user.name || actor}`,
  });
  return {
    ok: true, id: row.id, jobId: row.externalId, backend: 'archie' as const,
    jobtread: 'not used', ghl: 'not used',
    // Booking needs the company's own calendar, which comes later.
    appointment: parseAppointment(b.appointment) ? { ok: false, error: NATIVE_BOOKING_UNAVAILABLE } : null,
  };
}

export function registerWriteRoutes(app: Express) {
  // Move a job's pipeline stage (writes the JobTread "Status" field).
  app.post('/api/production/:externalId/stage', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const { externalId } = req.params;
    const stage = String(req.body?.stage || '');
    const actor = req.session.user!.email;
    if (!externalId || !stage) return res.status(400).json({ error: 'externalId and stage are required' });
    if (!(await ownsLead(req.session.user! as SessionUser, externalId))) return res.status(404).json({ error: 'not found' });
    // A job Archie keeps has no JobTread status to write: it moves on the
    // Production board, where the board's own checks apply.
    if (await backendOf(externalId) === 'archie') return res.status(409).json({ error: NATIVE_STAGE_ON_BOARD });
    if (!isValidJobStatus(stage)) return res.status(400).json({ error: `Invalid stage "${stage}"` });

    // Current stage (for the log summary + so we can revert client-side on failure).
    const [before] = await db.select({ stage: leads.stage }).from(leads).where(eq(leads.externalId, externalId));
    const jt = new JobTreadClient();
    const result = await jt.setJobStage(externalId, stage);

    await logWrite({
      actor, system: 'jobtread', action: 'set_stage', targetId: externalId,
      summary: `${before?.stage || '?'} → ${stage}`, ok: result.ok, error: result.error || null,
    });

    if (!result.ok) return res.status(jobTreadWriteFailStatus(result.error)).json({ error: result.error || 'Current CRM write failed' });

    // Optimistic local update so the board reflects immediately (sync reconciles).
    await db.update(leads).set({ stage }).where(eq(leads.externalId, externalId));

    // Moving past the sale is the sale — open the job's commission record so
    // the rep and admin checklist can start. Best-effort: a failure here
    // must not undo a stage change JobTread has already accepted.
    if (isSoldJob({ stage })) {
      ensureJobCommissionFor(externalId, `system:stage:${actor}`)
        .catch((e: any) => console.error('[job-commissions] auto-create on stage change failed:', e?.message || e));
    }
    res.json({ ok: true, stage });
  }));

  // Add an internal note/comment to a job (JobTread's comments, or Archie's
  // own notes for a job Archie keeps).
  app.post('/api/jobs/:externalId/note', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const { externalId } = req.params;
    const message = String(req.body?.message || '').trim();
    const actor = req.session.user!.email;
    if (!externalId || !message) return res.status(400).json({ error: 'externalId and message are required' });
    if (!(await ownsLead(req.session.user! as SessionUser, externalId))) return res.status(404).json({ error: 'not found' });

    // A job Archie keeps: the note is kept here (lead_notes), where Roof Lee reads it too.
    if (await backendOf(externalId) === 'archie') {
      if (message.length > MAX_NOTE_CHARS) return res.status(400).json({ error: NOTE_TOO_LONG });
      if (!(await addNativeNote(externalId, message, req.session.user!))) return res.status(404).json({ error: 'not found' });
      return res.json({ ok: true });
    }

    const jt = new JobTreadClient();
    const result = await jt.addJobComment(externalId, message, `Note from ${req.session.user!.name}`);

    await logWrite({
      actor, system: 'jobtread', action: 'add_note', targetId: externalId,
      summary: message.slice(0, 120), ok: result.ok, error: result.error || null,
    });

    if (!result.ok) return res.status(502).json({ error: result.error || 'Current CRM note failed' });
    res.json({ ok: true });
  }));

  // Reply to a customer through GoHighLevel (SMS or email).
  app.post('/api/conversations/:contactId/reply', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const { contactId } = req.params;
    const channel = normalizeReplyChannel(req.body?.channel);
    const message = String(req.body?.message || '').trim();
    const subject = String(req.body?.subject || '').trim();
    const html = typeof req.body?.html === 'string' && req.body.html.length <= 200_000 ? req.body.html : undefined;
    const actor = req.session.user!.email;
    if (!contactId || !message) return res.status(400).json({ error: 'contactId and message are required' });
    if (!channel) return res.status(400).json({ error: 'channel must be "sms" or "email"' });

    const ghl = new GoHighLevelClient();

    // GHL has no owner column to check by id directly, so for a scoped (sales)
    // user we resolve the contact and confirm its phone matches one of their
    // own clients before letting them send through the company's GHL account —
    // otherwise any signed-in rep could message any contact by id alone.
    if (isScoped(req.session.user! as SessionUser)) {
      const mine = await repClientIdentifiers(req.session.user! as SessionUser);
      const minePhoneDigits = new Set((mine?.phones || []).map((p) => p.replace(/\D/g, '')).filter(Boolean));
      let contactPhoneDigits = '';
      try {
        const { contact } = await ghl.getContact(contactId);
        contactPhoneDigits = String(contact?.phone || '').replace(/\D/g, '');
      } catch { /* treat as unresolvable below */ }
      if (!contactPhoneDigits || !minePhoneDigits.has(contactPhoneDigits)) {
        return res.status(404).json({ error: 'not found' });
      }
    }

    const result =
      channel === 'sms'
        ? await ghl.sendSms('', message, contactId)
        : await ghl.sendEmail(contactId, subject || `Message from ${currentProfile().displayName}`, message, html);

    await logWrite({
      actor, system: 'ghl', action: channel === 'sms' ? 'reply_sms' : 'reply_email', targetId: contactId,
      summary: message.slice(0, 120), ok: result.success, error: result.error || null,
    });

    if (!result.success) return res.status(502).json({ error: result.error || 'KynexPro send failed' });
    res.json({ ok: true });
  }));

  // Edit a customer's email/phone → JobTread (source of truth) + local mirror.
  // A job Archie keeps is corrected on the lead alone.
  app.patch('/api/leads/:externalId/contact', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const { externalId } = req.params;
    const email = req.body?.email !== undefined ? String(req.body.email).trim() : undefined;
    const phone = req.body?.phone !== undefined ? String(req.body.phone).trim() : undefined;
    const actor = req.session.user!.email;
    if (!externalId || (email === undefined && phone === undefined)) {
      return res.status(400).json({ error: 'externalId and at least one of email/phone are required' });
    }
    // Rewriting a client's contact details on someone else's job is a
    // lead-theft primitive, not just an integrity problem.
    if (!(await ownsLead(req.session.user! as SessionUser, externalId))) return res.status(404).json({ error: 'not found' });

    // A job Archie keeps: the lead itself is the record. No JobTread, and no
    // KynexPro (Roof Lee owns it for this company).
    if (await backendOf(externalId) === 'archie') {
      const parsed = parseNativeContact({ email, phone });
      if (!parsed.ok) return res.status(400).json({ error: parsed.error });
      if (!(await updateNativeContact(externalId, parsed.change, actor))) return res.status(404).json({ error: 'not found' });
      return res.json({ ok: true });
    }

    const jt = new JobTreadClient();
    const result = await jt.updateJobContact(externalId, { email, phone });

    await logWrite({
      actor, system: 'jobtread', action: 'update_contact', targetId: externalId,
      summary: [email !== undefined ? `email=${email}` : null, phone !== undefined ? `phone=${phone}` : null].filter(Boolean).join(' '),
      ok: result.ok, error: result.error || null,
    });

    if (!result.ok) return res.status(jobTreadWriteFailStatus(result.error)).json({ error: result.error || 'Current CRM contact update failed' });

    // Mirror locally so the app reflects immediately (sync reconciles).
    const patch: Record<string, string> = {};
    if (email !== undefined) patch.email = email;
    if (phone !== undefined) patch.phone = phone;
    await db.update(leads).set(patch).where(eq(leads.externalId, externalId));
    res.json({ ok: true });
  }));

  // Tag a lead's GoHighLevel contact (e.g. "Hot", "Follow-up") — can trigger the
  // team's GHL automations. Resolves the GHL contact by the lead's phone.
  app.post('/api/leads/:externalId/tag', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const { externalId } = req.params;
    const tag = String(req.body?.tag || '').trim();
    const actor = req.session.user!.email;
    if (!externalId || !tag) return res.status(400).json({ error: 'externalId and tag are required' });
    if (!(await ownsLead(req.session.user! as SessionUser, externalId))) return res.status(404).json({ error: 'not found' });

    const [lead] = await db.select({ phone: leads.phone }).from(leads).where(eq(leads.externalId, externalId));
    if (!lead?.phone) return res.status(400).json({ error: 'This lead has no phone to match a KynexPro contact.' });

    const ghl = new GoHighLevelClient();
    let contactId: string | null = null;
    try {
      const cs: any = await ghl.getContacts({ query: lead.phone, limit: 1 });
      contactId = cs?.contacts?.[0]?.id || null;
    } catch { /* fall through to 404 below */ }
    if (!contactId) return res.status(404).json({ error: 'No matching KynexPro contact for this lead.' });

    let ok = true; let error: string | null = null;
    try {
      await ghl.addTagToContact(contactId, [tag]);
    } catch (e: any) { ok = false; error = e?.message || 'KynexPro tag failed'; }

    await logWrite({ actor, system: 'ghl', action: 'add_tag', targetId: contactId, summary: tag, ok, error });
    if (!ok) return sendFailure(res, error, 'POST /api/leads/:externalId/tag', 502, 'KynexPro tag failed');
    res.json({ ok: true, tag });
  }));

  // Book an inspection/appointment on Google Calendar (the source the Schedule
  // syncs from), so it shows up in the app. Written to the rep's own calendar when
  // it's synced, else the office (admin) calendar.
  app.post('/api/clients/:externalId/appointment', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const { externalId } = req.params;
    const user = req.session.user!;
    const slot = parseAppointment(req.body);
    if (!externalId || !slot) return res.status(400).json({ error: 'date and time are required' });
    if (!(await ownsLead(user as SessionUser, externalId))) return res.status(404).json({ error: 'not found' });
    // A job Archie keeps: its company has no calendar in Archie yet (the same answer as the lead form's).
    if (await backendOf(externalId) === 'archie') return res.status(409).json({ error: NATIVE_BOOKING_UNAVAILABLE });

    const target = await resolveBookOn(user as SessionUser, req.body?.forEmail);
    if (target.error) return res.status(403).json({ error: target.error });
    const [lead] = await db.select({ jobName: leads.jobName, address: leads.address }).from(leads).where(eq(leads.externalId, externalId));
    const booked = await bookAppointment({ user, slot, clientName: lead?.jobName || 'Client', address: lead?.address, targetId: externalId, bookOn: target.bookOn });
    if (!booked.ok) return res.status(502).json({ error: booked.error || 'Booking failed' });
    res.json({ ok: true, eventId: booked.eventId, bookedOn: booked.bookedOn });
  }));

  // Create a new lead across all systems: JobTread (account→contact→location→job,
  // Status="New Lead" + Sales Rep) + GoHighLevel contact + a local lead row.
  // A company that keeps its own jobs keeps the lead in Archie only (createLeadInArchie).
  app.post('/api/leads/create', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const b = req.body || {};
    const firstName = String(b.firstName || '').trim();
    const lastName = String(b.lastName || '').trim();
    const phone = String(b.phone || '').trim();
    const email = String(b.email || '').trim();
    const address = String(b.address || '').trim();
    const user = req.session.user!;
    const actor = user.email;
    if (!firstName && !phone && !email) return res.status(400).json({ error: 'Provide at least a name, phone, or email' });
    if (phone && !PHONE_RE.test(phone)) return res.status(400).json({ error: 'That phone number doesn\'t look right.' });
    if (email && !EMAIL_RE.test(email)) return res.status(400).json({ error: 'That email address doesn\'t look right.' });

    // A company that keeps its own jobs (a company Roof Lee made): the lead is
    // kept in Archie and nowhere else. Every other company carries on below,
    // exactly as before.
    if (jobBackendFor({ externalId: null }, await getCurrentCompany()) === 'archie') {
      return res.json(await createLeadInArchie(b, { firstName, lastName, phone, email, address }, user as SessionUser));
    }

    // Booking for someone else (the availability board): their calendar, and
    // — unless a rep was chosen explicitly — their JobTread rep name on the lead.
    const target = await resolveBookOn(user as SessionUser, b.appointment?.forEmail);
    if (target.error) return res.status(403).json({ error: target.error });

    // Sales Rep: explicit choice, else the person the appointment is for, else the creator's own JobTread rep name.
    // The explicit choice is a sales leader's dropdown. A rep (own-records
    // scope) never sees it, but the server took body.salesRep from anyone, so
    // a rep could file a lead under another rep's name and into their book.
    // Booking on someone else's calendar still hands it to them below —
    // resolveBookOn has already checked they may book there.
    const picksRep = dataScope(user.role) !== 'self';
    let salesRep = (picksRep ? String(b.salesRep || '').trim() : '') || undefined;
    if (!salesRep && target.bookOn) {
      const [them] = await db.select({ rep: teamMembers.jobtreadSalesRep }).from(teamMembers).where(eq(teamMembers.email, String(b.appointment.forEmail).toLowerCase()));
      salesRep = them?.rep || undefined;
    }
    if (!salesRep) {
      const [me] = await db.select({ rep: teamMembers.jobtreadSalesRep }).from(teamMembers).where(eq(teamMembers.email, actor));
      salesRep = me?.rep || undefined;
    }

    // 1) JobTread lead (source of truth).
    const jt = await new JobTreadClient().createLead({ firstName, lastName, phone, email, address, salesRep });

    // 2) GoHighLevel contact (reachable by text/email).
    let ghlOk = true; let ghlErr: string | null = null;
    try {
      const ghl = new GoHighLevelClient();
      await ghl.createContact({ firstName, lastName, email: email || undefined, phone: phone || undefined } as any);
    } catch (e: any) { ghlOk = false; ghlErr = e?.message || 'KynexPro createContact failed'; }

    // 3) Local lead row — linked to the JobTread job when created (sync reconciles),
    //    else a standalone manual row so the lead is never lost. The rep's name
    //    goes on it either way: a sales login only sees leads carrying its rep
    //    name, so a lead JobTread refused would otherwise vanish from the rep
    //    who just took the call.
    const clientName = `${firstName} ${lastName}`.trim() || phone || email;
    const [row] = await db.insert(leads).values({
      source: jt.ok ? 'jobtread' : 'manual',
      externalId: jt.jobId || null,
      firstName: firstName || null, lastName: lastName || null,
      email: email || null, phone: phone || null,
      address: address || null, city: String(b.city || '').trim() || null,
      state: String(b.state || '').trim() || null, zip: String(b.zip || '').trim() || null,
      serviceType: String(b.serviceType || '').trim() || null, status: 'new' as any,
      jtSalesRep: salesRep || null,
      jobName: firstName || lastName || null,
      // Credit for taking the call, separate from the rep who will sell it.
      enteredBy: actor, enteredByName: user.name || null,
      ...(jt.ok ? { stage: 'New Lead' } : {}),
      ...(String(b.notes || '').trim() ? { notes: String(b.notes).trim().slice(0, 2000) } : {}),
    }).returning();

    await logWrite({
      actor, system: 'jobtread', action: 'create_lead', targetId: jt.jobId || (row?.id ? String(row.id) : null),
      summary: clientName, ok: jt.ok, error: jt.error || ghlErr,
    });
    // News for Roof Lee, for a company it made. Does nothing for anyone else.
    if (row) await emitLeadCreated(row);

    // 4) Optional: the appointment the rep just agreed to on the phone, booked
    //    in the same breath so nothing has to be typed twice.
    const slot = parseAppointment(b.appointment);
    let appointment: { ok: boolean; eventId?: string | null; bookedOn?: string; error?: string | null } | null = null;
    if (slot) {
      const booked = await bookAppointment({ user, slot, clientName, address, targetId: jt.jobId || null, bookOn: target.bookOn });
      appointment = { ok: booked.ok, eventId: booked.eventId, bookedOn: booked.bookedOn, error: booked.error };
    }

    // Booked for another rep: that rep owns the job, and the person who set
    // the appointment keeps it in their list as a shared rep — otherwise the
    // cold caller loses sight of every lead the moment they hand it over.
    const forEmail = String(b.appointment?.forEmail || '').trim().toLowerCase();
    if (jt.jobId && target.bookOn && forEmail && forEmail !== actor.toLowerCase()) {
      try {
        const people = await db.select({ id: teamMembers.id, email: teamMembers.email }).from(teamMembers);
        const owner = people.find((p) => p.email.toLowerCase() === forEmail);
        const setter = people.find((p) => p.email.toLowerCase() === actor.toLowerCase());
        if (owner) {
          await applyAssignment({
            jobExternalId: jt.jobId, primaryTeamMemberId: owner.id, secondaryTeamMemberIds: setter ? [setter.id] : [],
            source: 'calendar', confidence: 'high', evidence: `appointment set by ${user.name} for ${forEmail}`, assignedBy: actor,
          });
        }
      } catch (e: any) {
        console.error('[leads/create] shared assignment failed:', e?.message || e);
      }
    }

    res.json({
      ok: true, id: row?.id, jobId: jt.jobId,
      jobtread: jt.ok ? 'created' : `skipped (${jt.error})`,
      ghl: ghlOk ? 'created' : `skipped (${ghlErr})`,
      appointment,
    });
  }));
}
