/**
 * The messages Archie sends a customer BY ITSELF, and the one switch that
 * says whether it may (docs/archie/02-roof-lee-link.md, "No messages of its
 * own").
 *
 * "By itself" means nobody pressed send on that message: it goes out because
 * a lead arrived, because an advisor (a model) decided to, or because a
 * schedule came round. A person writing a message in Archie and pressing send
 * is not one of these.
 *
 * For a company Roof Lee made, every one of these is OFF in this stage. Such a
 * message would skip Roof Lee's approval, its cap per company and its cost
 * ledger. Roof Lee is told so by the `messages.quiet` capability, and adds no
 * lead, changes none and moves no job until it has heard it.
 *
 * THE RULE FOR NEW CODE: anything that texts or emails a customer without a
 * person pressing send on that message must (1) be listed in OWN_MESSAGES and
 * (2) ask maySendOwnMessage() before it sends. `messages.quiet` is worked out
 * from the same function (isQuiet), so switching one of them on for a company
 * takes the capability away. A test (quiet.test.ts) fails when a new file
 * starts sending and nobody has said which kind it is.
 *
 * For every other company the answer is yes, as it always was.
 */
import type { Company } from '../../shared/schema';
import { getCurrentCompany } from '../tenant/companies';

/** Every feature of Archie's that texts or emails a customer by itself. */
export const OWN_MESSAGES = {
  /**
   * Speed to lead: the text a new lead is sent the moment it arrives
   * (CMOAgent.handleNewLead, reached from the KynexPro, JobTread and Twilio
   * webhooks).
   */
  new_lead_reply: 'the text sent to a new lead when it arrives',
  /**
   * A text an advisor decides to send a lead (the CMO advisor's
   * send_sms_to_lead tool: in a chat, in a task, or on the scheduled run).
   */
  advisor_text: 'a text an advisor sends a lead',
  /**
   * A payment reminder an advisor sends for an invoice (the CFO advisor's
   * send_payment_reminder tool and its overdue sweep).
   */
  payment_reminder: 'a payment reminder for an invoice',
  /**
   * Follow-ups. Nothing sends one today: a follow-up in Archie is a task for
   * a person. Listed so that whoever builds a sent one finds the switch here.
   */
  follow_up: 'a follow-up message',
  /**
   * Review requests. Nothing sends one today: the advisor only drafts the
   * words for a person to send. Listed for the same reason.
   */
  review_request: 'a review request',
} as const;

export type OwnMessage = keyof typeof OWN_MESSAGES;
export const OWN_MESSAGE_KEYS = Object.keys(OWN_MESSAGES) as OwnMessage[];

/** The tag Roof Lee puts on every KynexPro contact it makes. */
export const ROOFLI_CONTACT_TAG = 'roofli';

/**
 * THE SWITCH. May Archie send this kind of message by itself for this
 * company? Never for a company Roof Lee made, and never when the company is
 * not known (the safe answer). Yes for everyone else, as before.
 */
export function ownMessageOn(company: Pick<Company, 'roofliCompanyId'> | null | undefined, _feature: OwnMessage): boolean {
  if (!company) return false;
  return !company.roofliCompanyId;
}

/** True while every one of them is off for the company. This is `messages.quiet`. */
export function isQuiet(company: Pick<Company, 'roofliCompanyId'> | null | undefined): boolean {
  return OWN_MESSAGE_KEYS.every((feature) => !ownMessageOn(company, feature));
}

/** The question every such feature asks before it sends, about the current company. */
export async function maySendOwnMessage(feature: OwnMessage): Promise<boolean> {
  return ownMessageOn(await getCurrentCompany(), feature);
}

/** What a refused send says, in plain words. */
export const OWN_MESSAGES_OFF = 'Archie does not send customers messages by itself for this company. Its messages go out through Roof Lee.';

/**
 * Is this KynexPro contact one Roof Lee made? Roof Lee tags every contact it
 * makes; such a contact is already Roof Lee's lead and must not come back as
 * a second one. Tags arrive as a list or as one comma-separated line.
 */
export function isRoofLeeContact(data: unknown): boolean {
  const d = (data ?? {}) as { tags?: unknown; contact?: { tags?: unknown } };
  const tags = (raw: unknown): string[] =>
    Array.isArray(raw) ? raw.filter((t): t is string => typeof t === 'string')
      : typeof raw === 'string' ? raw.split(',') : [];
  return [...tags(d.tags), ...tags(d.contact?.tags)].some((t) => t.trim().toLowerCase() === ROOFLI_CONTACT_TAG);
}
