/**
 * The pure parts of placing and recording a call.
 *
 * Twilio drives a call by fetching TwiML from us and posting status back, so
 * almost all of the logic is "turn this request into that XML" and "turn that
 * callback into a row". Both are pure, so both are tested here rather than
 * against a live provider — the alternative is discovering a malformed verb
 * when a rep is stood in a driveway.
 */

/** Twilio's own words for how a call ended. */
export type TwilioCallStatus =
  | 'queued' | 'initiated' | 'ringing' | 'in-progress'
  | 'completed' | 'busy' | 'no-answer' | 'canceled' | 'failed';

export const isFinalStatus = (s: string): boolean =>
  ['completed', 'busy', 'no-answer', 'canceled', 'failed'].includes(s);

/**
 * XML-escape. Customer names reach TwiML through <Say>, and an ampersand in
 * "Jones & Sons" would otherwise produce XML Twilio rejects — the call simply
 * fails to connect, with nothing to indicate why.
 */
export function xmlEscape(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export interface BridgeOptions {
  /** The rep's own phone — answered first, then bridged to the customer. */
  repNumber: string;
  /** Who we are calling. */
  customerNumber: string;
  /** The number the customer sees. Must be one of ours. */
  callerId: string;
  /** Where Twilio posts the recording when it is ready. */
  recordingStatusCallback?: string;
  /** Spoken to the rep before the customer is dialled. Skipped when absent. */
  whisper?: string;
  /** Both sides are told, because one-party consent is not every state. */
  announceRecording?: boolean;
  timeLimitSeconds?: number;
}

/**
 * The TwiML for a rep-to-customer bridge.
 *
 * The rep's phone rings first; when they pick up, Twilio dials the customer
 * and joins them. That ordering matters — dialling the customer first means
 * they hear silence while the rep's phone rings, which is how a business gets
 * mistaken for a robocall.
 */
export function bridgeTwiml(o: BridgeOptions): string {
  const parts: string[] = ['<?xml version="1.0" encoding="UTF-8"?>', '<Response>'];

  if (o.whisper) {
    parts.push(`<Say voice="alice">${xmlEscape(o.whisper)}</Say>`);
  }
  if (o.announceRecording) {
    parts.push('<Say voice="alice">This call is recorded for quality and training.</Say>');
  }

  const dialAttrs = [
    `callerId="${xmlEscape(o.callerId)}"`,
    'record="record-from-answer-dual"',
    'recordingTrack="both"',
    o.timeLimitSeconds ? `timeLimit="${Math.max(60, Math.floor(o.timeLimitSeconds))}"` : '',
    o.recordingStatusCallback
      ? `recordingStatusCallback="${xmlEscape(o.recordingStatusCallback)}" recordingStatusCallbackEvent="completed"`
      : '',
  ].filter(Boolean).join(' ');

  parts.push(`<Dial ${dialAttrs}><Number>${xmlEscape(o.customerNumber)}</Number></Dial>`);
  parts.push('</Response>');
  return parts.join('');
}

export interface InboundOptions {
  /** Rung in order until one answers. */
  forwardTo: string[];
  /**
   * Browser identities to ring alongside the numbers. Twilio rings every noun
   * inside one <Dial> in parallel and gives the call to whoever answers first.
   */
  ringClients?: string[];
  greeting?: string;
  recordingStatusCallback?: string;
  announceRecording?: boolean;
  /**
   * Where Twilio goes when nobody answered. This is how the AI gets the call
   * on the third ring instead of a caller hearing a beep.
   */
  noAnswerAction?: string;
  ringSeconds?: number;
}

/** A US ring cycle is about six seconds, so three rings is roughly this. */
export const RINGS_TO_SECONDS = (rings: number): number =>
  Math.min(Math.max(Math.round(rings * 6), 5), 60);

/**
 * The TwiML for a call coming in to one of our numbers: greet, ring the people
 * who should take it, fall through to voicemail.
 *
 * With nobody to forward to it still answers and takes a message, because a
 * misconfigured forward list should not mean the phone rings out — that is
 * indistinguishable from being out of business.
 */
export function inboundTwiml(o: InboundOptions): string {
  const parts: string[] = ['<?xml version="1.0" encoding="UTF-8"?>', '<Response>'];

  if (o.greeting) parts.push(`<Say voice="alice">${xmlEscape(o.greeting)}</Say>`);
  if (o.announceRecording) parts.push('<Say voice="alice">This call may be recorded.</Say>');

  const targets = (o.forwardTo || []).filter(Boolean);
  const clients = (o.ringClients || []).filter(Boolean);
  if (targets.length || clients.length) {
    const attrs = [
      `timeout="${Math.min(Math.max(o.ringSeconds ?? 20, 5), 60)}"`,
      'record="record-from-answer-dual"',
      o.recordingStatusCallback
        ? `recordingStatusCallback="${xmlEscape(o.recordingStatusCallback)}" recordingStatusCallbackEvent="completed"`
        : '',
      // Twilio continues to the verbs after <Dial> when a call is answered and
      // then ends, which would send a finished caller to the AI. An `action`
      // takes the decision instead, so the handler can tell "nobody picked up"
      // from "they spoke for ten minutes and hung up".
      o.noAnswerAction ? `action="${xmlEscape(o.noAnswerAction)}"` : '',
    ].filter(Boolean).join(' ');
    const nouns = [
      ...targets.map((t) => `<Number>${xmlEscape(t)}</Number>`),
      ...clients.map((c) => `<Client>${xmlEscape(c)}</Client>`),
    ].join('');
    parts.push(`<Dial ${attrs}>${nouns}</Dial>`);
    if (!o.noAnswerAction) {
      parts.push('<Say voice="alice">Sorry, we could not reach anyone. Please leave a message after the tone.</Say>');
      parts.push('<Record maxLength="120" playBeep="true" />');
    }
  } else if (o.noAnswerAction) {
    // Nobody to ring at all: hand straight over rather than making the caller
    // sit through a ring that was never going to be answered.
    parts.push(`<Redirect method="POST">${xmlEscape(o.noAnswerAction)}</Redirect>`);
  } else {
    parts.push('<Say voice="alice">Sorry, nobody is available to take your call. Please leave a message after the tone.</Say>');
    parts.push('<Record maxLength="120" playBeep="true" />');
  }

  parts.push('</Response>');
  return parts.join('');
}

/** What Twilio posts to a status callback. Only the fields we use. */
export interface TwilioStatusCallback {
  CallSid?: string;
  From?: string;
  To?: string;
  CallStatus?: string;
  Direction?: string;
  CallDuration?: string;
  Timestamp?: string;
  AnsweredBy?: string;
  RecordingUrl?: string;
  RecordingSid?: string;
  RecordingDuration?: string;
}

export interface CallUpdate {
  providerSid: string;
  status: string | null;
  durationSeconds: number | null;
  answeredBy: 'human' | 'machine' | null;
  recordingUrl: string | null;
  recordingSid: string | null;
  recordingSeconds: number | null;
  endedAt: Date | null;
}

const int = (v: unknown): number | null => {
  // `Number('')` is 0, not NaN — so an absent duration would otherwise be
  // recorded as a zero-second call. "We were not told" and "it lasted no time"
  // are different facts, and only one of them belongs in a connect rate.
  if (v === null || v === undefined || String(v).trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
};

/**
 * A status callback into the fields we store. Returns null without a CallSid:
 * there is nothing to attach it to, and inventing a row is worse than
 * dropping a malformed callback.
 */
export function statusToUpdate(cb: TwilioStatusCallback): CallUpdate | null {
  if (!cb.CallSid) return null;
  const status = cb.CallStatus ?? null;
  const answered = String(cb.AnsweredBy ?? '').toLowerCase();
  return {
    providerSid: cb.CallSid,
    status,
    durationSeconds: int(cb.CallDuration),
    // Twilio's machine detection reports several flavours of "a machine
    // picked up"; they all mean the same thing to us.
    answeredBy: answered.startsWith('machine') ? 'machine' : answered === 'human' ? 'human' : null,
    recordingUrl: cb.RecordingUrl ?? null,
    recordingSid: cb.RecordingSid ?? null,
    recordingSeconds: int(cb.RecordingDuration),
    endedAt: status && isFinalStatus(status) ? new Date() : null,
  };
}

/**
 * Twilio hands back a recording URL with no extension; the audio is at the
 * same URL with one. Kept here so nothing has to remember that.
 */
export const recordingMediaUrl = (url: string, ext: 'mp3' | 'wav' = 'mp3'): string =>
  /\.(mp3|wav)$/i.test(url) ? url : `${url}.${ext}`;

/**
 * Hand an unanswered call to whoever answers it next — today the AI service
 * still running in GoHighLevel, later our own.
 *
 * A plain <Dial> rather than anything clever: the caller is already on the
 * line, and every second of hold music is a second they might hang up.
 */
export function handoffTwiml(toNumber: string, callerId?: string): string {
  const attrs = [callerId ? `callerId="${xmlEscape(callerId)}"` : '', 'timeout="30"'].filter(Boolean).join(' ');
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Response>',
    `<Dial ${attrs}><Number>${xmlEscape(toNumber)}</Number></Dial>`,
    '</Response>',
  ].join('');
}

/** What <Dial action> posts back. `no-answer`, `busy` and `failed` mean nobody took it. */
export function nobodyAnswered(dialCallStatus: string | undefined): boolean {
  return ['no-answer', 'busy', 'failed', 'canceled'].includes(String(dialCallStatus ?? '').toLowerCase());
}

export interface BrowserDialOptions {
  /** The number the browser asked to call. */
  to: string;
  /** The business number the customer should see. */
  callerId: string;
  recordingStatusCallback?: string;
  announceRecording?: boolean;
  timeLimitSeconds?: number;
}

/**
 * TwiML for a call placed from a browser.
 *
 * Twilio has already connected the browser to itself by the time this is
 * fetched; all that remains is dialling the far end and joining them. The
 * recording announcement is on the customer's leg, which is the leg that
 * legally needs it.
 */
export function browserDialTwiml(o: BrowserDialOptions): string {
  const attrs = [
    `callerId="${xmlEscape(o.callerId)}"`,
    'record="record-from-answer-dual"',
    'answerOnBridge="true"',
    o.timeLimitSeconds ? `timeLimit="${Math.max(60, Math.floor(o.timeLimitSeconds))}"` : '',
    o.recordingStatusCallback
      ? `recordingStatusCallback="${xmlEscape(o.recordingStatusCallback)}" recordingStatusCallbackEvent="completed"`
      : '',
  ].filter(Boolean).join(' ');

  const parts = ['<?xml version="1.0" encoding="UTF-8"?>', '<Response>'];
  if (o.announceRecording) parts.push('<Say voice="alice">This call is recorded for quality and training.</Say>');
  parts.push(`<Dial ${attrs}><Number>${xmlEscape(o.to)}</Number></Dial>`);
  parts.push('</Response>');
  return parts.join('');
}
