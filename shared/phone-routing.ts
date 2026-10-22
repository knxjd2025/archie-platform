/**
 * Which of our numbers belongs to whom, and where a call to it should ring.
 *
 * Each person gets their own business number: a customer calling Bo reaches
 * Bo, a customer calling the office reaches the office, and every one of those
 * calls is logged against the client it belongs to. The number is the routing
 * key — that is the whole model.
 *
 * Pure, because the decision "this call should ring these devices, or go to
 * voicemail" is the one that must never be wrong, and it is far easier to be
 * sure of it here than by dialling a real phone to find out.
 */

export type NumberPurpose = 'direct' | 'main' | 'ai_answer' | 'outbound';

export const PURPOSE_LABEL: Record<NumberPurpose, string> = {
  direct: "A person's own line",
  main: 'The main published number',
  ai_answer: 'Answered by the AI service',
  outbound: 'Outbound calling only',
};

export function isNumberPurpose(v: unknown): v is NumberPurpose {
  return v === 'direct' || v === 'main' || v === 'ai_answer' || v === 'outbound';
}

/** Where a call to this number should actually ring. */
export type RingTo = 'browser' | 'phone' | 'both';

export const isRingTo = (v: unknown): v is RingTo =>
  v === 'browser' || v === 'phone' || v === 'both';

export interface OwnedNumber {
  e164: string;
  purpose: string;
  /** The team member this number belongs to, if any. */
  teamMemberId: number | null;
  /** An explicit override — rings here regardless of who owns the number. */
  forwardsTo: string | null;
  active: boolean;
  /** Browser, mobile, or both at once. Absent means phone, as it always was. */
  ringTo?: string | null;
  /** The browser identity to ring, when the browser is a target. */
  clientIdentity?: string | null;
}

export interface Person {
  id: number;
  name: string | null;
  /** Their actual device. Null means we have nowhere to ring them. */
  phone: string | null;
  active: boolean | null;
}

export interface RoutingDecision {
  /** Phone numbers to ring, in order. */
  ring: string[];
  /**
   * Browser identities to ring, alongside any numbers. Twilio rings every
   * target in parallel and gives the call to whoever answers first, so a
   * person at a desk who also carries a phone gets both.
   */
  ringClients: string[];
  /** Why, in words — this is what the call record and any diagnostic shows. */
  reason: string;
  /** Who the call is for, when we know. */
  forTeamMemberId: number | null;
  /** True when the call will go to voicemail because nothing could be rung. */
  voicemail: boolean;
}

/**
 * Where a call to `dialled` should go.
 *
 * Two kinds of target: phone numbers and browser identities. Twilio rings
 * every one it is given in parallel and hands the call to whoever answers
 * first, so "both" is a real answer rather than a compromise.
 *
 * Order of preference: an explicit forward on the number, then the browser
 * and/or phone of whoever owns it, then the fallback. Nothing found means
 * voicemail, and that is stated rather than implied — a number that silently
 * rings out is indistinguishable from a business that has closed.
 */
export function routeInbound(
  dialled: string,
  numbers: OwnedNumber[],
  people: Person[],
  fallback?: string | null,
): RoutingDecision {
  const none = (reason: string, forTeamMemberId: number | null): RoutingDecision => {
    const ring = [fallback].filter(Boolean) as string[];
    return { ring, ringClients: [], reason, forTeamMemberId, voicemail: !ring.length };
  };

  const num = numbers.find((n) => n.e164 === dialled);
  if (!num) return none(`${dialled} is not one of our numbers`, null);

  if (!num.active) {
    return { ring: [], ringClients: [], reason: `${dialled} is switched off`, forTeamMemberId: num.teamMemberId, voicemail: true };
  }

  // Outbound-only numbers exist for caller ID. Customers do ring them back,
  // so that goes somewhere real rather than nowhere.
  if (num.purpose === 'outbound') return none(`${dialled} is an outbound-only number`, num.teamMemberId);

  // An explicit forward is a deliberate override and beats everything.
  if (num.forwardsTo) {
    return {
      ring: [num.forwardsTo],
      ringClients: [],
      reason: 'the number has its own forwarding set',
      forTeamMemberId: num.teamMemberId,
      voicemail: false,
    };
  }

  const mode = isRingTo(num.ringTo) ? num.ringTo : 'phone';
  const owner = num.teamMemberId ? people.find((p) => p.id === num.teamMemberId) : undefined;

  if (num.teamMemberId && !owner) return none('the assigned person no longer exists', num.teamMemberId);
  if (owner && owner.active === false) return none('the assigned person is no longer active', owner.id);

  const wantsBrowser = mode === 'browser' || mode === 'both';
  const wantsPhone = mode === 'phone' || mode === 'both';

  const ringClients = wantsBrowser && num.clientIdentity ? [num.clientIdentity] : [];
  const ring = wantsPhone && owner?.phone ? [owner.phone] : [];

  if (ringClients.length || ring.length) {
    const where = [
      ringClients.length ? 'the browser' : '',
      ring.length ? "their phone" : '',
    ].filter(Boolean).join(' and ');
    return {
      ring,
      ringClients,
      reason: `${owner?.name || 'the owner'} on ${where}`,
      forTeamMemberId: num.teamMemberId,
      voicemail: false,
    };
  }

  // Nothing to ring. Say which half is missing — "set to ring a browser with
  // no identity" and "assigned to someone with no phone" are different
  // problems with different fixes, and both look configured from outside.
  if (wantsBrowser && !num.clientIdentity) {
    return none(`${dialled} is set to ring a browser but has no browser identity`, num.teamMemberId);
  }
  if (owner && wantsPhone && !owner.phone) {
    return none(`${owner.name || 'the owner'} has no phone number on file`, owner.id);
  }
  return none(num.teamMemberId ? 'the owner has nowhere to be rung' : 'nobody is assigned to this number', num.teamMemberId);
}

/** Every number that cannot currently ring anyone, and why. */
export function routingGaps(
  numbers: OwnedNumber[],
  people: Person[],
  fallback?: string | null,
): Array<{ e164: string; reason: string }> {
  return numbers
    .filter((n) => n.active && n.purpose !== 'outbound')
    .map((n) => ({ e164: n.e164, decision: routeInbound(n.e164, numbers, people, fallback) }))
    // A browser-answered number rings nobody's phone by design, so counting
    // an empty `ring` as a gap reports every office line as broken.
    .filter((x) => x.decision.voicemail || !(x.decision.ring.length + x.decision.ringClients.length))
    .map((x) => ({ e164: x.e164, reason: x.decision.reason }));
}
