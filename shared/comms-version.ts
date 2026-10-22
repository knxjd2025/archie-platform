/**
 * V1 / V2 — which stack the app's phone and texting runs on.
 *
 * V1 is GoHighLevel, which is how everything works today. V2 is the same
 * capabilities on our own Twilio wiring. The switch exists so James can run V2
 * against the real world for a day, find what breaks, and put it back in one
 * click — GHL stays connected and untouched the whole time, so flipping back
 * loses nothing.
 *
 * It is deliberately temporary. When V2 has run clean for long enough, the
 * flag and the V1 branches come out together.
 */

export type CommsVersion = 'v1' | 'v2';

export const COMMS_VERSION_LABEL: Record<CommsVersion, string> = {
  v1: 'V1 — GoHighLevel',
  v2: 'V2 — our own tools',
};

export const COMMS_VERSION_BLURB: Record<CommsVersion, string> = {
  v1: 'Texts, calls and the AI answer service all run through GoHighLevel, exactly as they do today.',
  v2: 'Texts and calls go out on our own Twilio numbers and land in our own call history. GoHighLevel stays connected and keeps receiving — nothing there is switched off.',
};

export function isCommsVersion(v: unknown): v is CommsVersion {
  return v === 'v1' || v === 'v2';
}

/** One thing V2 needs before it can do its job. */
export interface Requirement {
  key: string;
  label: string;
  ready: boolean;
  /** What to do about it, when it isn't ready. */
  fix: string;
}

export interface Readiness {
  ready: boolean;
  requirements: Requirement[];
  /** The ones still outstanding, for a one-line summary. */
  missing: string[];
}

/**
 * Can V2 actually work right now?
 *
 * Checked rather than assumed, because the failure this prevents is the worst
 * one available here: flipping to V2 on a Tuesday morning, and every text a rep
 * sends silently going nowhere. If something is missing, the toggle says so and
 * refuses rather than letting it happen.
 */
export function evaluateReadiness(env: {
  twilioAccountSid?: string | null;
  twilioAuthToken?: string | null;
  numbersConfigured?: number;
  callsTableReady?: boolean;
  a2pRegistered?: boolean;
  voiceAgentConfigured?: boolean;
}): Readiness {
  const requirements: Requirement[] = [
    {
      key: 'twilio_credentials',
      label: 'Twilio account connected',
      ready: !!(env.twilioAccountSid && env.twilioAuthToken),
      fix: 'Add TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN in Vercel.',
    },
    {
      key: 'numbers',
      label: 'At least one number of our own',
      ready: (env.numbersConfigured ?? 0) > 0,
      fix: 'Buy or port a number in Twilio, then add it on this page.',
    },
    {
      key: 'call_history',
      label: 'Somewhere to put the calls',
      ready: !!env.callsTableReady,
      fix: 'Apply migration 0029 (calls, comm_messages, phone_numbers).',
    },
    {
      key: 'a2p',
      label: 'Business texting registered (A2P 10DLC)',
      ready: !!env.a2pRegistered,
      fix: 'Finish the A2P brand and campaign registration in Twilio. Carriers take 1–3 weeks, so start it first.',
    },
    {
      key: 'voice_agent',
      label: 'AI answer service rebuilt',
      ready: !!env.voiceAgentConfigured,
      fix: 'Port the Dakota script and its 13 actions onto the new stack.',
    },
  ];

  const missing = requirements.filter((r) => !r.ready);
  return {
    // Texting and calling are what a rep touches hourly; the AI answer service
    // is inbound-only and can lag behind without anyone being stranded. So V2
    // is usable without it, and the toggle says as much rather than blocking.
    ready: missing.every((r) => r.key === 'voice_agent'),
    requirements,
    missing: missing.map((r) => r.label),
  };
}

/** What the toggle should say when V2 can't be turned on yet. */
export function blockedReason(r: Readiness): string | null {
  if (r.ready) return null;
  const blocking = r.requirements.filter((x) => !x.ready && x.key !== 'voice_agent');
  if (!blocking.length) return null;
  return blocking.length === 1
    ? `V2 needs one more thing first: ${blocking[0].label.toLowerCase()}.`
    : `V2 needs ${blocking.length} more things first: ${blocking.map((b) => b.label.toLowerCase()).join(', ')}.`;
}
