/**
 * An inbound text from Twilio, recorded once.
 *
 * Twilio retries a webhook on any slow or non-2xx answer. The route used to
 * remember MessageSids in a process-local Set, which on serverless is a
 * different, empty Set on every cold instance — so a retry that landed on a
 * fresh instance re-ran lead creation, qualification and the welcome text.
 * The text is now written to comm_messages, keyed by its MessageSid (already
 * unique there), before anything else happens; a second delivery inserts
 * nothing and the caller stops.
 */
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { commMessages, leads } from '../../shared/schema';
import { toE164 } from '../../shared/comms';
import { samePhone } from './phone-match';

export interface InboundSms {
  MessageSid?: string;
  From?: string;
  To?: string;
  Body?: string;
  NumMedia?: string;
  MediaUrl?: string;
}

/**
 * Record the text. Returns the new row's id, or null when this MessageSid was
 * already recorded — the caller must then do nothing further.
 *
 * A text with no MessageSid cannot be deduplicated; it is recorded without a
 * key and processed, which is what happened to every text before.
 */
export async function claimInboundSms(sms: InboundSms): Promise<number | null> {
  const from = toE164(sms.From) ?? String(sms.From ?? '');
  const to = toE164(sms.To) ?? String(sms.To ?? '');
  const media = Number(sms.NumMedia) > 0 && sms.MediaUrl ? [sms.MediaUrl] : null;
  const [row] = await db.insert(commMessages).values({
    provider: 'twilio',
    providerSid: sms.MessageSid || null,
    channel: media ? 'mms' : 'sms',
    direction: 'inbound',
    fromAddr: from,
    toAddr: to,
    ourNumber: toE164(sms.To),
    body: sms.Body ?? null,
    media,
    status: 'received',
    sentAt: new Date(),
  }).onConflictDoNothing({ target: commMessages.providerSid }).returning({ id: commMessages.id });
  return row?.id ?? null;
}

/** The lead this number belongs to, matched on the last ten digits. */
export async function findLeadByPhone(phone: unknown): Promise<typeof leads.$inferSelect | null> {
  const [lead] = await db.select().from(leads).where(samePhone(leads.phone, phone)).limit(1);
  return lead ?? null;
}

/** Attach a recorded text to its lead once we know which one it is. */
export async function linkInboundSms(messageId: number, lead: { id: number; externalId: string | null }): Promise<void> {
  await db.update(commMessages)
    .set({ leadId: lead.id, leadExternalId: lead.externalId })
    .where(eq(commMessages.id, messageId));
}
