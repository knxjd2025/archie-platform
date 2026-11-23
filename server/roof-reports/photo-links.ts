/**
 * Short-lived signed links for report photos.
 *
 * A report page shows its photos from links like these, never from a public
 * address (the store has none). A link is made only AFTER the access rules
 * passed for the person asking (the html route), names the company, the
 * report, the photo and the copy, and runs out after ten minutes. It is
 * signed with a key derived from the session secret, so it cannot be made up
 * or changed, and it grants one photo copy and nothing else.
 *
 * Why not just the signed-in route: the page is shown in a sandboxed frame
 * that carries no cookie, so its images need to prove themselves.
 *
 * The token is a credential while it lasts: it is never logged.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { sessionSecret } from '../security-config';

export type LinkVariant = 'working' | 'thumb';

/** How long a link works. Ten minutes: long enough to open and read a page, short enough to be useless when passed on. */
export const LINK_TTL_SECONDS = 600;

export interface PhotoLink { companyId: string; reportId: string; photoId: string; variant: LinkVariant }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_TOKEN_LENGTH = 600;

/** The signing key: derived from the session secret for this one purpose, so it is never the session key itself. */
function key(secret: string): Buffer {
  return createHmac('sha256', secret).update('roof-report-photo-link-v1').digest();
}
const mac = (payload: string, secret: string): string => createHmac('sha256', key(secret)).update(payload).digest('base64url');

/** A token for one photo copy, good for ten minutes from `now`. */
export function signPhotoLink(link: PhotoLink, now: number = Date.now(), secret: string = sessionSecret()): string {
  if (!UUID_RE.test(link.companyId) || !UUID_RE.test(link.reportId) || !UUID_RE.test(link.photoId)) throw new Error('photo link refused');
  if (link.variant !== 'working' && link.variant !== 'thumb') throw new Error('photo link refused');
  const payload = Buffer.from(JSON.stringify({
    c: link.companyId, r: link.reportId, p: link.photoId, v: link.variant,
    e: Math.floor(now / 1000) + LINK_TTL_SECONDS,
  })).toString('base64url');
  return `${payload}.${mac(payload, secret)}`;
}

/** What a token names, or null: for one that is changed, signed with another key, out of date or not a token at all. */
export function verifyPhotoLink(token: unknown, now: number = Date.now(), secret: string = sessionSecret()): PhotoLink | null {
  if (typeof token !== 'string' || token.length === 0 || token.length > MAX_TOKEN_LENGTH) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  const expected = Buffer.from(mac(payload, secret));
  const given = Buffer.from(sig);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  let data: { c?: unknown; r?: unknown; p?: unknown; v?: unknown; e?: unknown };
  try {
    data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (typeof data.e !== 'number' || !Number.isFinite(data.e) || now >= data.e * 1000) return null;
  if (typeof data.c !== 'string' || typeof data.r !== 'string' || typeof data.p !== 'string') return null;
  if (!UUID_RE.test(data.c) || !UUID_RE.test(data.r) || !UUID_RE.test(data.p)) return null;
  if (data.v !== 'working' && data.v !== 'thumb') return null;
  return { companyId: data.c, reportId: data.r, photoId: data.p, variant: data.v };
}

/** The address a token is read at, relative to the app. */
export const photoLinkPath = (token: string): string => `/api/roof-reports/linked-photo/${token}`;
