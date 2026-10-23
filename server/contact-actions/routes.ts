/**
 * Call / text / email a client THROUGH GoHighLevel — the business number,
 * logged in the GHL conversation — instead of the rep's personal phone.
 *
 * Texts and emails go out via GHL's Conversations API, so they work the same
 * from the desktop app and the phone app. Calls can't be placed by API (GHL
 * has no endpoint for it); the app hands the rep to the contact inside GHL —
 * the web app on a desktop, the LeadConnector app on a phone once
 * GHL_MOBILE_CONTACT_LINK is set — and then records the call as a note on
 * the contact so the GHL timeline shows it.
 *
 * Every endpoint is keyed by the lead, never by a raw GHL contact id, and
 * rep-scoped through ownsLead() — a rep can only reach their own clients.
 */
import type { Express, Request, Response } from 'express';
import { boardTz } from '../../shared/schedule-board';
import { currentProfile } from '../tenant/context';
import { currentGhlLocationId, ghlAppBase } from '../integrations/ghl/connection';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { leads } from '../../shared/schema';
import { requireAuth } from '../auth/middleware';
import { GoHighLevelClient } from '../integrations/gohighlevel';
import { ownsLead, type SessionUser } from '../access/rep-scope';
import { asyncHandler } from '../lib/async-handler';
import { rateLimit } from '../lib/rate-limit';

export type CallVia = 'ghl-web' | 'ghl-app' | 'phone';

/**
 * Where to send the rep for this contact. `appUrl` is the LeadConnector
 * deep link, built from GHL_MOBILE_CONTACT_LINK (e.g.
 * "leadconnector://contacts/{contactId}") — null until that template is set,
 * because GHL publishes no universal-link file for its web app, so
 * the web URL alone never opens the app.
 */
export function ghlContactLinks(contactId: string | null, locationId: string, template = process.env.GHL_MOBILE_CONTACT_LINK || ''): { contactId: string | null; webUrl: string | null; appUrl: string | null } {
  if (!contactId || !locationId) return { contactId, webUrl: null, appUrl: null };
  const webUrl = `${ghlAppBase()}/v2/location/${locationId}/contacts/detail/${contactId}`;
  const appUrl = template.trim()
    ? template.trim().replace(/\{contactId\}/g, contactId).replace(/\{locationId\}/g, locationId)
    : null;
  return { contactId, webUrl, appUrl };
}

/** The note GHL's timeline shows for a call started from the app. */
export function callLogNote(via: CallVia, actor: string, when = new Date()): string {
  const how = via === 'ghl-app' ? 'LeadConnector app' : via === 'ghl-web' ? 'GHL web dialer' : "rep's own phone";
  const stamp = when.toLocaleString('en-US', { timeZone: boardTz(), month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
  return `📞 Call started from the Team App via ${how} by ${actor} — ${stamp}`;
}

export function normalizeVia(v: unknown): CallVia | null {
  return v === 'ghl-web' || v === 'ghl-app' || v === 'phone' ? v : null;
}

const digits = (s: string | null | undefined) => String(s || '').replace(/\D/g, '');
/** The last ten digits: GHL stores "+17045551234", the lead "(704) 555-1234". */
const phoneKey = (s: string | null | undefined) => digits(s).slice(-10);

/**
 * The GHL contact that is this client, or null. GHL's query is a fuzzy search
 * — a number shares digits with plenty of other people's — and this used to
 * fall back to the first result when nothing matched exactly, so a text went
 * to a stranger and logged on their timeline. Only an exact phone (or email)
 * match counts; anything else means the client isn't in GHL yet.
 */
export function exactContactMatch<T extends { id?: string; phone?: string | null; email?: string | null }>(
  contacts: readonly T[] | null | undefined,
  lead: { phone: string | null; email: string | null },
): T | null {
  const list = contacts || [];
  const want = phoneKey(lead.phone);
  const byPhone = want.length === 10 ? list.find((c) => c.id && phoneKey(c.phone) === want) : undefined;
  if (byPhone) return byPhone;
  const email = String(lead.email || '').trim().toLowerCase();
  return (email && list.find((c) => c.id && String(c.email || '').trim().toLowerCase() === email)) || null;
}

/**
 * The lead's GHL contact, created from the lead when GHL doesn't have them
 * yet — GHL is the CRM of record, and a call or text that can't be logged
 * against a contact is a call or text that never happened as far as the
 * timeline is concerned.
 */
/**
 * "No contact for this client" and "GoHighLevel is not answering" are different
 * answers and the caller has to be able to tell them apart. The client throws
 * on any non-2xx — an expired token, a 500 at their end — and that used to
 * escape as an unhandled 500 carrying GHL's own error text to the browser.
 */
type ContactLookup =
  | { ok: true; contactId: string | null }
  | { ok: false; error: string };

/**
 * How many of GHL's fuzzy matches to look through for the exact one. It was
 * five: a common exchange fills five results with neighbours sharing digits,
 * the real contact came sixth, and the create that followed was refused as a
 * duplicate — so the rep could neither text nor log a call.
 */
const CONTACT_SEARCH_LIMIT = 20;

/**
 * The contact GHL already has, read off its refusal to create a duplicate.
 *
 * With duplicates turned off, POST /contacts answers 400 with
 * `{"message":"This location does not allow duplicated contacts.","meta":{"contactId":"..."}}`,
 * and the client surfaces that as `GHL API Error (400): <body>`. That refusal
 * names exactly the contact we were looking for, so it is an answer, not a failure.
 */
export function existingContactIdFrom(error: unknown): string | null {
  const text = error instanceof Error ? error.message : String(error ?? '');
  const start = text.indexOf('{');
  if (start < 0) return null;
  try {
    const body = JSON.parse(text.slice(start)) as { meta?: { contactId?: unknown }; contactId?: unknown };
    const id = body?.meta?.contactId ?? body?.contactId;
    return typeof id === 'string' && id ? id : null;
  } catch {
    return null;
  }
}

export async function findOrCreateContact(ghl: GoHighLevelClient, lead: { phone: string | null; email: string | null; firstName?: string | null; lastName?: string | null }): Promise<ContactLookup> {
  if (!lead.phone) return { ok: true, contactId: null };
  try {
    const found: any = await ghl.getContacts({ query: lead.phone, limit: CONTACT_SEARCH_LIMIT });
    const hit = exactContactMatch<any>(found?.contacts, lead);
    if (hit?.id) return { ok: true, contactId: hit.id };
    try {
      const created: any = await ghl.createContact({
        phone: lead.phone,
        ...(lead.email ? { email: lead.email } : {}),
        ...(lead.firstName ? { firstName: lead.firstName } : {}),
        ...(lead.lastName ? { lastName: lead.lastName } : {}),
      });
      return { ok: true, contactId: created?.contact?.id ?? null };
    } catch (e) {
      const existing = existingContactIdFrom(e);
      if (existing) return { ok: true, contactId: existing };
      throw e;
    }
  } catch (e: any) {
    // The upstream text can carry tokens and internal detail; it belongs in the
    // log, not in a toast on a rep's phone.
    console.error('[contact-actions] GoHighLevel lookup failed:', e?.message || e);
    return { ok: false, error: 'GoHighLevel is not responding right now.' };
  }
}

const messageLimiter = rateLimit(30, 10 * 60 * 1000);

export function registerContactActionRoutes(app: Express) {
  const loadLead = async (req: Request, res: Response) => {
    const user = req.session.user! as SessionUser;
    const [lead] = await db.select().from(leads).where(eq(leads.externalId, req.params.externalId));
    if (!lead || !(await ownsLead(user, lead.externalId))) { res.status(404).json({ error: 'not found' }); return null; }
    return lead;
  };

  // Where "Call" should take the rep for this client.
  app.get('/api/clients/:externalId/ghl-contact', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const lead = await loadLead(req, res);
    if (!lead) return;
    if (!lead.phone) return res.json({ contactId: null, webUrl: null, appUrl: null });
    const found = await findOrCreateContact(new GoHighLevelClient(), lead);
    // Degrade rather than fail: the screen still renders, the GHL-specific
    // buttons just explain why they are unavailable.
    if (!found.ok) return res.json({ contactId: null, webUrl: null, appUrl: null, unavailable: true, reason: found.error });
    res.json(ghlContactLinks(found.contactId, (await currentGhlLocationId()) ?? ''));
  }));

  // A text or email from the business number / business mailbox, logged in GHL.
  app.post('/api/clients/:externalId/message', requireAuth, messageLimiter, asyncHandler(async (req: Request, res: Response) => {
    const lead = await loadLead(req, res);
    if (!lead) return;
    const channel = req.body?.channel === 'email' ? 'email' : req.body?.channel === 'sms' ? 'sms' : null;
    const message = String(req.body?.message || '').trim().slice(0, 4000);
    const subject = String(req.body?.subject || '').trim().slice(0, 200);
    if (!channel) return res.status(400).json({ error: 'channel must be "sms" or "email"' });
    if (!message) return res.status(400).json({ error: 'message is required' });
    if (channel === 'sms' && !lead.phone) return res.status(400).json({ error: 'This client has no phone number on file.' });
    if (channel === 'email' && !lead.email) return res.status(400).json({ error: 'This client has no email on file.' });

    const ghl = new GoHighLevelClient();
    const found = await findOrCreateContact(ghl, lead);
    if (!found.ok) return res.status(502).json({ error: `Couldn't send it — ${found.error}` });
    if (!found.contactId) return res.status(502).json({ error: 'GoHighLevel has no contact for this client and one could not be created.' });
    const result = channel === 'sms'
      ? await ghl.sendSms(lead.phone!, message, found.contactId)
      : await ghl.sendEmail(found.contactId, subject || currentProfile().displayName, message);
    if (!result.success) return res.status(502).json({ error: result.error || 'GoHighLevel did not accept the message.' });
    res.json({ ok: true, contactId: found.contactId, messageId: result.messageId ?? null });
  }));

  // The rep just started a call from the app — put it on the GHL timeline.
  app.post('/api/clients/:externalId/call-log', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const lead = await loadLead(req, res);
    if (!lead) return;
    const via = normalizeVia(req.body?.via);
    if (!via) return res.status(400).json({ error: 'via must be ghl-web, ghl-app or phone' });
    const ghl = new GoHighLevelClient();
    const found = await findOrCreateContact(ghl, lead);
    if (!found.ok) return res.status(502).json({ error: `Couldn't log the call — ${found.error}` });
    if (!found.contactId) return res.status(502).json({ error: 'GoHighLevel has no contact for this client.' });
    try {
      await ghl.addContactNote(found.contactId, callLogNote(via, (req.session.user as SessionUser).email));
    } catch (e: any) {
      console.error('[contact-actions] GoHighLevel note failed:', e?.message || e);
      return res.status(502).json({ error: "The call was placed, but GoHighLevel wouldn't take the note." });
    }
    res.json({ ok: true, contactId: found.contactId });
  }));
}
