/**
 * The one door Roof Lee's requests come through (docs/archie/02-roof-lee-link.md).
 *
 * Every request under /api/sister is signed with the secret Archie and Roof
 * Lee share (SISTERS_ARCHIE_SECRET). Nothing behind this door runs until the
 * signature has been checked over the bytes as they arrived. With the secret
 * unset the door is shut: every request is refused, so deploying this code
 * changes nothing until the owner sets the secret.
 *
 * Both entry files (server/index.ts and api/index.ts) must mount
 * sisterRawBody() on SISTER_PREFIX BEFORE express.json. The signature covers
 * the raw body; once express.json has parsed it the bytes are gone and no
 * request verifies. server/sister/__tests__/door.test.ts boots api/index.ts to
 * prove it, because forgetting it there passes locally and fails live.
 */
import express, { type Request, type RequestHandler, type Response } from 'express';
import { verify, verifyRequest } from './verify';

export const SISTER_PREFIX = '/api/sister';
/** The secret this pair shares. Archie holds no other product's secret. */
export const SISTER_SECRET_ENV = 'SISTERS_ARCHIE_SECRET';
export const TIMESTAMP_HEADER = 'x-roofli-timestamp';
export const SIGNATURE_HEADER = 'x-roofli-signature';
export const IDEMPOTENCY_HEADER = 'idempotency-key';

/**
 * A company with its team and confirmed facts is a few kilobytes. This leaves
 * plenty of room and still stops a signed-looking flood being buffered.
 */
const RAW_BODY_LIMIT = '1mb';

/** What a handler behind the door is given: the body as sent, and parsed. */
export interface SisterRequest {
  /** The raw body exactly as it arrived ('' when there was none). */
  raw: string;
  /** The parsed body: always a JSON object, or undefined when there was no body. */
  body: Record<string, unknown> | undefined;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Set by requireSister once the signature has been checked. */
      sister?: SisterRequest;
    }
  }
}

/** Keeps a sister request's body as raw bytes. Mount on SISTER_PREFIX before express.json. */
export function sisterRawBody(): RequestHandler {
  return express.raw({ type: 'application/json', limit: RAW_BODY_LIMIT });
}

/** The pair secret, or '' when it is not set (which shuts the door). */
function pairSecret(): string {
  return (process.env[SISTER_SECRET_ENV] ?? '').trim();
}

/** True when the Roof Lee link has been switched on for this deployment. */
export function sisterDoorOpen(): boolean {
  return pairSecret() !== '';
}

/**
 * Every failure looks the same: one status, no body, nothing to tell a wrong
 * secret from an old timestamp or an unset secret.
 */
export function refuse(res: Response): void {
  res.status(401).end();
}

/**
 * Checks the signature, then hands the request on.
 *
 * `version` 1 is the older form (timestamp and body), accepted only on the
 * three endpoints the first contract defined. `version` 2 also covers the
 * method and the address as they arrived, and is what everything else takes.
 * Neither form is ever accepted in place of the other, and the old
 * SISTERS_SHARED_SECRET is never read at all.
 */
export function requireSister(version: 1 | 2): RequestHandler {
  return (req, res, next) => {
    const secret = pairSecret();
    if (!secret) return refuse(res);

    // Whole milliseconds, as plain digits. Anything else is not a genuine sender.
    const stamp = req.get(TIMESTAMP_HEADER) ?? '';
    if (!/^[1-9]\d{0,15}$/.test(stamp)) return refuse(res);
    const timestamp = Number(stamp);
    const signature = req.get(SIGNATURE_HEADER) ?? '';

    // express.raw leaves a Buffer for a JSON body and {} when there was none.
    // A body that arrived as anything else was never kept as bytes, so it
    // cannot be checked and is treated as absent: the signature then fails.
    const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';

    // originalUrl is the address as it arrived: not decoded, not tidied, with its query.
    const genuine = version === 2
      ? verifyRequest(req.method, req.originalUrl, raw, timestamp, signature, secret, Date.now())
      : verify(raw, timestamp, signature, secret, Date.now());
    if (!genuine) return refuse(res);

    let body: Record<string, unknown> | undefined;
    if (raw !== '') {
      let parsed: unknown;
      try { parsed = JSON.parse(raw); } catch { parsed = undefined; }
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        res.status(400).json({ error: 'The request body must be a JSON object.' });
        return;
      }
      body = parsed as Record<string, unknown>;
    }
    req.sister = { raw, body };
    next();
  };
}

/**
 * Anything under /api/sister that no route answered. A signed request is told
 * plainly that there is nothing here; an unsigned one learns nothing, not even
 * which addresses exist.
 */
export function sisterNotFound(): RequestHandler {
  const signed = requireSister(2);
  return (req: Request, res: Response, next) => signed(req, res, (err?: unknown) => {
    if (err) return next(err);
    res.status(404).end();
  });
}
