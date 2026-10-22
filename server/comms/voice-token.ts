/**
 * The credential a browser needs to be a phone.
 *
 * Twilio's Voice SDK authenticates with a short-lived JWT rather than the
 * account credentials — which is the whole reason the browser can be trusted
 * with it. The token says who this browser is (`identity`), that it may
 * receive calls, and which TwiML App handles the calls it places. It is signed
 * with an API Key, never the Auth Token, so it can be revoked on its own.
 *
 * Built by hand rather than with the Twilio helper library: the shape is a
 * documented JWT, the library is a large dependency for one function, and the
 * pieces that actually matter — the `cty` header, the grants, the expiry — are
 * far easier to assert on when they are written out.
 */
import jwt from 'jsonwebtoken';

export interface VoiceTokenInput {
  accountSid: string;
  apiKeySid: string;
  apiKeySecret: string;
  /** Who this browser is. Rung as <Client>identity</Client>. */
  identity: string;
  /** The TwiML App that handles calls this browser places. */
  outgoingApplicationSid?: string;
  /** Seconds. Twilio caps these at 24 hours; an hour is plenty. */
  ttlSeconds?: number;
}

/**
 * An identity travels in a URL and in TwiML, so it is restricted to characters
 * that are safe in both. Twilio allows more, but a space or a slash in an
 * identity produces failures that are miserable to trace back here.
 */
export function safeIdentity(raw: string): string {
  return String(raw ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 121);
}

export function buildVoiceToken(i: VoiceTokenInput): { token: string; identity: string; expiresAt: string } {
  const identity = safeIdentity(i.identity);
  if (!identity) throw new Error('A browser needs an identity before it can take calls.');
  if (!i.accountSid || !i.apiKeySid || !i.apiKeySecret) {
    throw new Error('Twilio API key is not configured.');
  }

  const ttl = Math.min(Math.max(i.ttlSeconds ?? 3600, 60), 86400);
  const now = Math.floor(Date.now() / 1000);

  const grants: Record<string, unknown> = {
    identity,
    voice: {
      // Without this the browser can place calls but never ring.
      incoming: { allow: true },
      ...(i.outgoingApplicationSid
        ? { outgoing: { application_sid: i.outgoingApplicationSid } }
        : {}),
    },
  };

  const token = jwt.sign(
    { jti: `${i.apiKeySid}-${now}`, grants, iat: now, exp: now + ttl, iss: i.apiKeySid, sub: i.accountSid },
    i.apiKeySecret,
    {
      algorithm: 'HS256',
      // Twilio rejects a token without this header, and the failure it returns
      // says nothing about why.
      header: { cty: 'twilio-fpa;v=1', typ: 'JWT', alg: 'HS256' },
    },
  );

  return { token, identity, expiresAt: new Date((now + ttl) * 1000).toISOString() };
}
