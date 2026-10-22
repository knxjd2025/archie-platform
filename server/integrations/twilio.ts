/**
 * Twilio SMS Integration
 * Handles incoming/outgoing SMS through Twilio
 */
import { createHmac, timingSafeEqual } from 'crypto';

export interface TwilioMessage {
  MessageSid: string;
  From: string;
  To: string;
  Body: string;
  NumMedia: string;
  MediaUrl?: string;
  Status?: string;
  DateSent?: string;
}

export interface TwilioWebhookPayload {
  ToCountry: string;
  ToState: string;
  SmsMessageSid: string;
  NumMedia: string;
  ToCity: string;
  FromZip: string;
  SmsSid: string;
  FromState: string;
  SmsStatus: string;
  FromCity: string;
  Body: string;
  FromCountry: string;
  To: string;
  MessagingServiceSid: string;
  ToZip: string;
  NumSegments: string;
  ReferralNumMedia: string;
  MessageSid: string;
  AccountSid: string;
  From: string;
  ApiVersion: string;
}

export class TwilioClient {
  private accountSid: string;
  private authToken: string;
  private phoneNumber: string;
  /**
   * The registered A2P Messaging Service. Sending through it rather than from
   * a bare number is what makes the 10DLC registration true in practice: the
   * campaign's throughput applies, and the STOP / START / HELP replies the
   * carriers were shown are the ones configured on that service. A message
   * sent straight from a number gets the account's default replies instead —
   * which do not name the business, which is the thing the campaign was
   * rejected over twice.
   */
  private messagingServiceSid: string;
  private baseUrl = 'https://api.twilio.com/2010-04-01';

  constructor() {
    this.accountSid = process.env.TWILIO_ACCOUNT_SID || '';
    this.authToken = process.env.TWILIO_AUTH_TOKEN || '';
    this.phoneNumber = process.env.TWILIO_PHONE_NUMBER || '';
    this.messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID || '';

    if (!this.accountSid || !this.authToken) {
      console.warn('Twilio credentials not set - SMS integration disabled');
    }
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    // Fail before the network, not after. With no account SID the URL becomes
    // `/Accounts//Messages.json`, which Twilio answers with a 404 — but it
    // took 10.5 seconds to do it in the route sweep, so an unconfigured
    // integration was costing a user ten seconds to be told nothing useful.
    // `sendSms` already refused up front; every other method now does too.
    if (!this.accountSid || !this.authToken) {
      throw new Error('Twilio not configured');
    }

    const url = `${this.baseUrl}/Accounts/${this.accountSid}${endpoint}`;
    
    const auth = Buffer.from(`${this.accountSid}:${this.authToken}`).toString('base64');

    // No timeout here would let a hung Twilio call block the synchronous
    // inbound-webhook handler indefinitely, risking a Twilio-side timeout +
    // retry that double-processes the same inbound message.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    let response: globalThis.Response;
    try {
      response = await fetch(url, {
        ...options,
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          ...options.headers,
        },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Twilio API Error (${response.status}): ${error}`);
    }

    return response.json();
  }

  /**
   * Send SMS message
   */
  async sendSms(to: string, body: string, mediaUrl?: string): Promise<{ sid: string; status: string }> {
    if (!this.accountSid || !this.authToken) {
      throw new Error('Twilio not configured');
    }
    // Neither sender configured would post From="" and get back a Twilio
    // error nobody reads. Say which variable is missing instead.
    if (!this.messagingServiceSid && !this.phoneNumber) {
      throw new Error('Twilio has no sender: set TWILIO_MESSAGING_SERVICE_SID or TWILIO_PHONE_NUMBER');
    }

    // Prefer the registered Messaging Service; fall back to the single number
    // so an account that has not been moved over yet keeps working.
    const params = new URLSearchParams(
      this.messagingServiceSid
        ? { To: to, MessagingServiceSid: this.messagingServiceSid, Body: body }
        : { To: to, From: this.phoneNumber, Body: body },
    );

    if (mediaUrl) {
      params.append('MediaUrl', mediaUrl);
    }

    const result = await this.request<any>(`/Messages.json`, {
      method: 'POST',
      body: params.toString(),
    });

    return {
      sid: result.sid,
      status: result.status,
    };
  }

  /**
   * Get message details
   */
  async getMessage(messageSid: string): Promise<any> {
    return this.request(`/Messages/${messageSid}.json`);
  }

  /**
   * List recent messages
   */
  async listMessages(limit: number = 20): Promise<any[]> {
    const result = await this.request<{ messages: any[] }>(`/Messages.json?PageSize=${limit}`);
    return result.messages || [];
  }

  /**
   * Parse incoming webhook payload
   */
  parseWebhookPayload(payload: Record<string, any>): TwilioMessage {
    return {
      MessageSid: payload.MessageSid || payload.SmsMessageSid,
      From: payload.From,
      To: payload.To,
      Body: payload.Body,
      NumMedia: payload.NumMedia,
      MediaUrl: payload.MediaUrl0,
      Status: payload.SmsStatus,
      DateSent: payload.DateSent,
    };
  }

  /**
   * Validate webhook signature (security)
   */
  /**
   * Twilio's request-validation algorithm (documented at
   * twilio.com/docs/usage/security#validating-requests): HMAC-SHA1 over the
   * full webhook URL followed by each POST param's key+value, sorted by key,
   * concatenated with no delimiter, keyed by the account's auth token.
   *
   * Without this, anyone who finds the webhook URL can forge `From`/`Body`
   * and get treated as a real inbound text — including the ops-brain control
   * commands in sms-control.ts (DONE/SNOOZE/reassign), which trust `From` to
   * identify a team member with zero other authentication.
   */
  validateWebhookSignature(url: string, params: Record<string, any>, signature: string): boolean {
    if (!this.authToken || !signature) return false;
    const data = Object.keys(params)
      .sort()
      .reduce((acc, key) => acc + key + String(params[key] ?? ''), url);
    const expected = createHmac('sha1', this.authToken).update(data, 'utf-8').digest('base64');
    const a = Buffer.from(expected);
    const b = Buffer.from(signature);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  /**
   * Generate TwiML response for auto-reply
   */
  generateTwiML(message: string): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>${this.escapeXml(message)}</Message>
</Response>`;
  }

  private escapeXml(unsafe: string): string {
    return unsafe.replace(/[<>&'"]/g, (c) => {
      switch (c) {
        case '<': return '&lt;';
        case '>': return '&gt;';
        case '&': return '&amp;';
        case '"': return '&quot;';
        case "'": return '&apos;';
        default: return c;
      }
    });
  }

  /**
   * Health check
   */
  /**
   * Ring `to`, and when it answers fetch `twimlUrl` for what to do next.
   *
   * Used for rep-to-customer bridging: `to` is the rep's own phone, and the
   * TwiML then dials the customer showing the business number. Machine
   * detection is on so a voicemail pickup is recorded as one rather than
   * counting as a conversation.
   */
  async placeBridgedCall(p: {
    to: string; from: string; twimlUrl: string; statusCallback?: string;
  }): Promise<{ sid: string; status: string }> {
    const body = new URLSearchParams({
      To: p.to,
      From: p.from,
      Url: p.twimlUrl,
      Method: 'POST',
      MachineDetection: 'Enable',
      ...(p.statusCallback
        ? {
            StatusCallback: p.statusCallback,
            StatusCallbackMethod: 'POST',
          }
        : {}),
    });
    // Twilio wants each callback event as its own repeated field.
    if (p.statusCallback) {
      for (const e of ['initiated', 'ringing', 'answered', 'completed']) body.append('StatusCallbackEvent', e);
    }

    const r = await this.request<any>('/Calls.json', { method: 'POST', body: body.toString() });
    return { sid: r.sid, status: r.status };
  }

  /**
   * The TwiML App that handles calls placed *from* a browser.
   *
   * Twilio will not let a browser dial without one: the access token names an
   * application, and Twilio asks that application's Voice URL what to do. This
   * finds ours by name and creates it only if it is missing, so running it
   * twice is safe and nobody ends up with a drawer full of near-identical
   * applications.
   */
  async ensureTwimlApp(p: { friendlyName: string; voiceUrl: string; statusCallback?: string }): Promise<{ sid: string; created: boolean; voiceUrl: string }> {
    const existing = await this.request<any>('/Applications.json?PageSize=50');
    const match = (existing.applications || []).find((a: any) => a.friendly_name === p.friendlyName);

    const body = new URLSearchParams({
      FriendlyName: p.friendlyName,
      VoiceUrl: p.voiceUrl,
      VoiceMethod: 'POST',
      ...(p.statusCallback ? { StatusCallback: p.statusCallback, StatusCallbackMethod: 'POST' } : {}),
    });

    if (match) {
      // Keep the URL current — the app moves between deploys and domains, and
      // a stale Voice URL means outbound calls simply fail to connect.
      const updated = await this.request<any>(`/Applications/${match.sid}.json`, { method: 'POST', body: body.toString() });
      return { sid: updated.sid, created: false, voiceUrl: updated.voice_url };
    }

    const made = await this.request<any>('/Applications.json', { method: 'POST', body: body.toString() });
    return { sid: made.sid, created: true, voiceUrl: made.voice_url };
  }

  /** Find one of our numbers by its E.164 value, so callers need not know SIDs. */
  async findIncomingNumber(e164: string): Promise<{ sid: string; phoneNumber: string; voiceUrl: string | null } | null> {
    const r = await this.request<any>(`/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(e164)}&PageSize=5`);
    const n = (r.incoming_phone_numbers || [])[0];
    return n ? { sid: n.sid, phoneNumber: n.phone_number, voiceUrl: n.voice_url || null } : null;
  }

  /**
   * Point a number at this app: calls to it fetch TwiML from `voiceUrl` and
   * progress is posted to `statusCallback`.
   *
   * Written as an explicit, named operation rather than something that happens
   * as a side effect of anything else — it changes where a real phone line
   * rings, and that deserves to be a decision someone made on purpose.
   */
  async configureIncomingNumber(sid: string, p: {
    voiceUrl: string; statusCallback?: string; friendlyName?: string;
  }): Promise<{ sid: string; voiceUrl: string; friendlyName: string }> {
    const body = new URLSearchParams({
      VoiceUrl: p.voiceUrl,
      VoiceMethod: 'POST',
      ...(p.statusCallback ? { StatusCallback: p.statusCallback, StatusCallbackMethod: 'POST' } : {}),
      ...(p.friendlyName ? { FriendlyName: p.friendlyName } : {}),
    });
    const r = await this.request<any>(`/IncomingPhoneNumbers/${sid}.json`, { method: 'POST', body: body.toString() });
    return { sid: r.sid, voiceUrl: r.voice_url, friendlyName: r.friendly_name };
  }

  /**
   * The audio for a recording. Twilio's media URLs need the account
   * credentials, so this is fetched server-side and proxied — a recording URL
   * handed to a browser either leaks the credentials or simply 401s.
   */
  async fetchRecording(recordingUrl: string): Promise<ArrayBuffer> {
    if (!this.accountSid || !this.authToken) throw new Error('Twilio not configured');
    const url = /\.(mp3|wav)$/i.test(recordingUrl) ? recordingUrl : `${recordingUrl}.mp3`;
    const auth = Buffer.from(`${this.accountSid}:${this.authToken}`).toString('base64');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
      const r = await fetch(url, { headers: { Authorization: `Basic ${auth}` }, signal: controller.signal });
      if (!r.ok) throw new Error(`Twilio API Error (${r.status}): could not fetch the recording`);
      return await r.arrayBuffer();
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * The shape of the configured credentials, without revealing them.
   *
   * A wrong Auth Token and a Auth Token with a trailing newline produce the
   * identical 401, and Vercel's UI shows both as a row of dots — so "check it
   * is right" is advice nobody can act on. Length, prefix and whitespace are
   * enough to tell a paste error from a genuine mismatch, and none of it is
   * secret: an Account SID is 34 characters starting `AC`, an Auth Token is
   * 32 hex characters, and saying so reveals nothing an attacker could use.
   */
  credentialShape(): {
    sidLength: number; sidPrefix: string; sidLooksRight: boolean;
    tokenLength: number; tokenLooksRight: boolean;
    whitespace: string[]; problems: string[];
  } {
    const rawSid = process.env.TWILIO_ACCOUNT_SID ?? '';
    const rawTok = process.env.TWILIO_AUTH_TOKEN ?? '';
    const whitespace: string[] = [];
    if (rawSid !== rawSid.trim()) whitespace.push('TWILIO_ACCOUNT_SID has leading or trailing whitespace');
    if (rawTok !== rawTok.trim()) whitespace.push('TWILIO_AUTH_TOKEN has leading or trailing whitespace');

    const sid = rawSid.trim();
    const tok = rawTok.trim();
    const sidLooksRight = /^AC[0-9a-f]{32}$/i.test(sid);
    const tokenLooksRight = /^[0-9a-f]{32}$/i.test(tok);

    const problems: string[] = [];
    if (!sid) problems.push('TWILIO_ACCOUNT_SID is empty');
    else if (!sidLooksRight) {
      problems.push(sid.startsWith('SK')
        ? 'That is an API Key SID (starts SK), not an Account SID. The Account SID starts with AC and is on the Console home page.'
        : `TWILIO_ACCOUNT_SID is ${sid.length} characters starting "${sid.slice(0, 2)}" — an Account SID is 34 characters starting "AC".`);
    }
    if (!tok) problems.push('TWILIO_AUTH_TOKEN is empty');
    else if (!tokenLooksRight) {
      problems.push(tok.length === 34 && /^AC/i.test(tok)
        ? 'TWILIO_AUTH_TOKEN looks like an Account SID — the two values may have been swapped.'
        : `TWILIO_AUTH_TOKEN is ${tok.length} characters — an Auth Token is 32 hex characters. ${tok.length > 32 ? 'Something extra was copied with it.' : 'It looks truncated.'}`);
    }
    return {
      sidLength: sid.length,
      sidPrefix: sid.slice(0, 6),
      sidLooksRight,
      tokenLength: tok.length,
      tokenLooksRight,
      whitespace,
      problems,
    };
  }

  /**
   * What this Twilio account actually holds: the numbers, and how far along
   * the A2P 10DLC registration is.
   *
   * Exists so nobody has to read it off the console. Carrier registration is
   * the long pole in moving off GoHighLevel — one to three weeks — and the
   * difference between "not started" and "already approved" decides whether
   * the rest of the migration waits on it. An account that predates this
   * project may already be registered, which is worth knowing before anyone
   * waits three weeks for something already done.
   *
   * Read-only: it lists, it never registers or buys anything. Each call is
   * time-boxed and failures are reported per section, so one endpoint being
   * unavailable does not hide the others.
   */
  async inventory(): Promise<{
    account: { sid: string; friendlyName?: string; status?: string } | null;
    subaccounts: Array<{ sid: string; friendlyName?: string; status?: string; numbers: number }>;
    numbers: Array<{ number: string; friendlyName?: string; sms: boolean; voice: boolean; mms: boolean; onSubaccount?: string }>;
    a2p: { brands: Array<{ status?: string; brandType?: string; failureReason?: string }>; campaigns: Array<{ service: string; status?: string; useCase?: string }> };
    notes: string[];
  }> {
    if (!this.accountSid || !this.authToken) throw new Error('Twilio not configured');
    const auth = Buffer.from(`${this.accountSid}:${this.authToken}`).toString('base64');
    const notes: string[] = [];

    const get = async (url: string): Promise<any | null> => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 12_000);
      try {
        const r = await fetch(url, { headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' }, signal: controller.signal });
        if (!r.ok) {
          notes.push(`${new URL(url).pathname} → HTTP ${r.status}`);
          return null;
        }
        return await r.json();
      } catch (e) {
        notes.push(`${new URL(url).pathname} → ${e instanceof Error ? e.message : 'failed'}`);
        return null;
      } finally {
        clearTimeout(timer);
      }
    };

    const [acct, nums, brands, services, subs] = await Promise.all([
      get(`https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}.json`),
      get(`https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}/IncomingPhoneNumbers.json?PageSize=50`),
      get('https://messaging.twilio.com/v1/a2p/BrandRegistrations?PageSize=20'),
      get('https://messaging.twilio.com/v1/Services?PageSize=20'),
      // Numbers frequently live on a subaccount rather than the parent —
      // GoHighLevel provisions exactly that way, one subaccount per location.
      // Looking only at the parent then reports "no numbers" for an account
      // that plainly has some, which is a confusing thing to tell someone.
      get(`https://api.twilio.com/2010-04-01/Accounts.json?PageSize=20`),
    ]);

    // A campaign hangs off a messaging service, so each service is asked in
    // turn. Capped at five: this is a diagnostic, not a crawler.
    const campaigns: Array<{ service: string; status?: string; useCase?: string }> = [];
    for (const svc of (services?.services || []).slice(0, 5)) {
      const c = await get(`https://messaging.twilio.com/v1/Services/${svc.sid}/Compliance/Usa2p`);
      if (c) campaigns.push({ service: svc.friendly_name || svc.sid, status: c.campaign_status || c.status, useCase: c.us_app_to_person_usecase });
    }

    // Walk any subaccounts for numbers too, so "none" means none anywhere.
    const shapeNumbers = (list: any[], owner?: string) => (list || []).map((n: any) => ({
      number: n.phone_number,
      friendlyName: n.friendly_name,
      sms: !!n.capabilities?.sms,
      voice: !!n.capabilities?.voice,
      mms: !!n.capabilities?.mms,
      ...(owner ? { onSubaccount: owner } : {}),
    }));

    const allNumbers = shapeNumbers(nums?.incoming_phone_numbers);
    const subaccounts: Array<{ sid: string; friendlyName?: string; status?: string; numbers: number }> = [];
    for (const sub of (subs?.accounts || []).filter((a: any) => a.sid && a.sid !== this.accountSid).slice(0, 10)) {
      const subNums = await get(`https://api.twilio.com/2010-04-01/Accounts/${sub.sid}/IncomingPhoneNumbers.json?PageSize=50`);
      const shaped = shapeNumbers(subNums?.incoming_phone_numbers, sub.friendly_name || sub.sid);
      subaccounts.push({ sid: sub.sid, friendlyName: sub.friendly_name, status: sub.status, numbers: shaped.length });
      allNumbers.push(...shaped);
    }

    return {
      account: acct ? { sid: acct.sid, friendlyName: acct.friendly_name, status: acct.status } : null,
      subaccounts,
      numbers: allNumbers,
      a2p: {
        brands: (brands?.data || brands?.brand_registrations || []).map((b: any) => ({
          status: b.status, brandType: b.brand_type, failureReason: b.failure_reason,
        })),
        campaigns,
      },
      notes,
    };
  }

  async healthCheck(): Promise<{ ok: boolean; error?: string; phoneNumber?: string; messagingServiceSid?: string; sendsVia?: string }> {
    if (!this.accountSid || !this.authToken) {
      return {
        ok: false,
        error: 'Twilio credentials not configured (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)',
      };
    }

    // Either sender will do. Saying "no phone number" while a messaging
    // service is configured sent the last reader looking for the wrong thing.
    if (!this.messagingServiceSid && !this.phoneNumber) {
      return {
        ok: false,
        error: 'Twilio has no sender configured (set TWILIO_MESSAGING_SERVICE_SID, or TWILIO_PHONE_NUMBER)',
      };
    }

    try {
      // Test by fetching account info
      const account = await this.request<any>('');
      return {
        ok: true,
        phoneNumber: this.phoneNumber || undefined,
        messagingServiceSid: this.messagingServiceSid || undefined,
        // Which of the two a text will actually go out through, so the answer
        // to "is SMS set up?" is one line rather than an inference.
        sendsVia: this.messagingServiceSid ? 'messaging-service' : 'phone-number',
      };
    } catch (error: any) {
      return {
        ok: false,
        error: error.message,
      };
    }
  }
}

// Singleton instance
let twilioClient: TwilioClient | null = null;

export function getTwilioClient(): TwilioClient {
  if (!twilioClient) {
    twilioClient = new TwilioClient();
  }
  return twilioClient;
}
