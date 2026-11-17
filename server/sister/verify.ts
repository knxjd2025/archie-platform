/**
 * How Archie knows a request really came from Roof Lee, and how it signs what
 * it sends back.
 *
 * PASTED from Roof Lee (packages/sisters/src/sign.ts), as the written contract
 * allows (docs/sisters/contract-v2.md in the Roof Lee repository, "Proving a
 * request is genuine"). The four functions are word for word; only the ticket
 * writer, which Archie never needs, is left out. Do not change them here: fix
 * them there and paste again. server/sister/__tests__/verify.test.ts checks
 * them against the contract's worked examples.
 *
 * The two sides share one secret. The sender signs the request with it; the
 * receiver works the signature out again and compares. A request that has
 * been altered, or signed with another secret, does not match. One that is
 * more than five minutes old is refused, so a copied request soon stops
 * working.
 *
 * There are two forms.
 *
 * - `sign` / `verify` cover "timestamp.body" and nothing else. They are for
 *   the three version 1 endpoints only, whose bodies name the company.
 * - `signRequest` / `verifyRequest` also cover the method and the address.
 *   Every endpoint new in version 2, and every event going back, uses them,
 *   because there the company and the record are named only in the address.
 *   Signed the old way, the headers from any one read would open every
 *   company's data for five minutes.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

/** How far a request's timestamp may be from the receiver's clock. */
export const MAX_SIGNATURE_AGE_MS = 5 * 60_000;

/**
 * The signature for a request body, as 64 hex characters.
 * `timestamp` is milliseconds since 1970. A request with no body signs "".
 */
export function sign(body: string, timestamp: number, secret: string): string {
  if (!secret) throw new Error('a shared secret is needed to sign a request');
  if (!Number.isSafeInteger(timestamp)) throw new Error('the timestamp must be a whole number of milliseconds');
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

/** True only when the signature is right and the timestamp is within five minutes of now. */
export function verify(body: string, timestamp: number, signature: string, secret: string, nowMs: number): boolean {
  if (!secret || !Number.isSafeInteger(timestamp)) return false;
  if (Math.abs(nowMs - timestamp) > MAX_SIGNATURE_AGE_MS) return false;
  if (typeof signature !== 'string' || !/^[0-9a-f]{64}$/.test(signature)) return false;
  const expected = Buffer.from(sign(body, timestamp, secret), 'hex');
  const given = Buffer.from(signature, 'hex');
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** The method as it is signed: capital letters only. */
function signedMethod(method: string): string | null {
  const upper = typeof method === 'string' ? method.toUpperCase() : '';
  return /^[A-Z]+$/.test(upper) ? upper : null;
}

/**
 * True when `path` is an address in the form it is sent in: it starts with one
 * "/", carries its query if it has one, and holds nothing that either side
 * would rewrite before comparing. That rules out blanks and line breaks (so the
 * line feed that ends the address in the signed text cannot be forged), a "#",
 * a full address with a host, and "." or ".." parts, which the sender's HTTP
 * library folds away before the request leaves.
 */
function isSendablePath(path: string): boolean {
  if (typeof path !== 'string' || !/^\/[\x21-\x7e]*$/.test(path)) return false;
  if (path.startsWith('//') || path.includes('#') || path.includes('\\')) return false;
  const queryAt = path.indexOf('?');
  const pathname = queryAt === -1 ? path : path.slice(0, queryAt);
  return !pathname.split('/').some((part) => /^(\.|%2e){1,2}$/i.test(part));
}

/** The exact text a version 2 signature covers. */
function requestText(method: string, path: string, body: string, timestamp: number): string | null {
  const upper = signedMethod(method);
  if (!upper || !isSendablePath(path) || typeof body !== 'string') return null;
  return `${timestamp}.${upper}.${path}\n${body}`;
}

/**
 * The signature for a version 2 request, as 64 hex characters. It covers
 *
 *     timestamp + "." + METHOD + "." + path + line feed + body
 *
 * where `path` is the address exactly as sent, from the first "/" on and
 * including any query, and a request with no body signs "" after the line
 * feed. Because the method and the address are covered, a signature made for
 * one company, one record or one action is good for nothing else.
 */
export function signRequest(method: string, path: string, body: string, timestamp: number, secret: string): string {
  if (!secret) throw new Error('a pair secret is needed to sign a request');
  if (!Number.isSafeInteger(timestamp)) throw new Error('the timestamp must be a whole number of milliseconds');
  const text = requestText(method, path, body, timestamp);
  if (text === null) throw new Error('the method and address must be given exactly as they are sent');
  return createHmac('sha256', secret).update(text).digest('hex');
}

/**
 * True only when the signature is right for this method, address and body, and
 * the timestamp is within five minutes of now. `path` must be the address as
 * it arrived, before any decoding or tidying.
 */
export function verifyRequest(
  method: string,
  path: string,
  body: string,
  timestamp: number,
  signature: string,
  secret: string,
  nowMs: number,
): boolean {
  if (!secret || !Number.isSafeInteger(timestamp)) return false;
  if (Math.abs(nowMs - timestamp) > MAX_SIGNATURE_AGE_MS) return false;
  if (typeof signature !== 'string' || !/^[0-9a-f]{64}$/.test(signature)) return false;
  const text = requestText(method, path, body, timestamp);
  if (text === null) return false;
  const expected = createHmac('sha256', secret).update(text).digest();
  const given = Buffer.from(signature, 'hex');
  return expected.length === given.length && timingSafeEqual(expected, given);
}
