/**
 * The company's logo, kept in the database (company_assets) and served from a
 * public, cacheable address so reports, emails and the app can all show it.
 *
 * Only PNG, JPEG and WebP are accepted, decided by the file's first bytes and
 * never by its name or the type the browser claims. SVG is refused on
 * purpose: it is a document that can carry script, not just a picture.
 */
import { createHash } from 'node:crypto';
import type { Request } from 'express';
import { and, eq } from 'drizzle-orm';
import { db } from '../db';
import { companyAssets } from '../../shared/schema';
import { isCompanyId, requireCompanyId, runAsCompany } from '../tenant/context';
import { patchCurrentCompany } from './settings';

/** The most a logo may weigh once the browser has resized it. */
export const MAX_LOGO_BYTES = 300 * 1024;

export type LogoType = 'image/png' | 'image/jpeg' | 'image/webp';
export const LOGO_TYPES: readonly LogoType[] = ['image/png', 'image/jpeg', 'image/webp'];

const startsWith = (buf: Uint8Array, bytes: number[], at = 0) =>
  buf.length >= at + bytes.length && bytes.every((b, i) => buf[at + i] === b);

/** The image type the bytes really are, or null when they are not PNG, JPEG or WebP. */
export function sniffImageType(buf: Uint8Array): LogoType | null {
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  // "RIFF" <size> "WEBP"
  if (startsWith(buf, [0x52, 0x49, 0x46, 0x46]) && startsWith(buf, [0x57, 0x45, 0x42, 0x50], 8)) return 'image/webp';
  return null;
}

/**
 * The most pixels a logo may declare on either side. The Company page sends
 * 512px at most; this leaves room for other clients while refusing a tiny
 * file that claims an enormous image (it would go into every report render).
 */
export const MAX_LOGO_SIDE = 2048;

/**
 * The width and height an image's header declares, read from the bytes
 * without decoding: PNG IHDR, JPEG SOFn, WebP VP8 / VP8L / VP8X. Null when the
 * header cannot be read.
 */
export function imageSize(buf: Buffer, type: LogoType): { width: number; height: number } | null {
  try {
    if (type === 'image/png') {
      if (buf.toString('latin1', 12, 16) !== 'IHDR') return null;
      return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    }
    if (type === 'image/jpeg') {
      let i = 2;
      while (i + 9 < buf.length) {
        if (buf[i] !== 0xff) return null;
        const marker = buf[i + 1];
        if (marker === 0xff) { i += 1; continue; } // fill byte
        if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; } // no length
        const len = buf.readUInt16BE(i + 2);
        // SOF0..SOF15, except DHT (C4), JPG (C8) and DAC (CC).
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
        }
        if (marker === 0xda || len < 2) return null; // image data before any frame header
        i += 2 + len;
      }
      return null;
    }
    const chunk = buf.toString('latin1', 12, 16);
    if (chunk === 'VP8 ') {
      // Key frame start code 9D 01 2A, then 14-bit width and height.
      if (buf[23] !== 0x9d || buf[24] !== 0x01 || buf[25] !== 0x2a) return null;
      return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
    }
    if (chunk === 'VP8L') {
      if (buf[20] !== 0x2f) return null;
      const bits = buf.readUInt32LE(21);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    if (chunk === 'VP8X') {
      return { width: buf.readUIntLE(24, 3) + 1, height: buf.readUIntLE(27, 3) + 1 };
    }
    return null;
  } catch {
    return null; // header cut short
  }
}

export type LogoCheck = { ok: true; type: LogoType } | { ok: false; status: 400 | 413; error: string };

/** Whether an uploaded file may be the logo. */
export function checkLogo(buf: unknown): LogoCheck {
  if (!Buffer.isBuffer(buf) || buf.length === 0) return { ok: false, status: 400, error: 'Choose an image file to upload.' };
  if (buf.length > MAX_LOGO_BYTES) return { ok: false, status: 413, error: 'That logo is over 300 KB. Use a smaller image.' };
  const type = sniffImageType(buf);
  if (!type) return { ok: false, status: 400, error: 'The logo must be a PNG, JPEG or WebP image.' };
  const size = imageSize(buf, type);
  if (!size || size.width < 1 || size.height < 1) return { ok: false, status: 400, error: 'That image could not be read. Try saving it again as a PNG.' };
  if (size.width > MAX_LOGO_SIDE || size.height > MAX_LOGO_SIDE) {
    return { ok: false, status: 400, error: `That image is ${size.width} by ${size.height} pixels. A logo can be at most ${MAX_LOGO_SIDE} pixels on each side.` };
  }
  return { ok: true, type };
}

/** Where links to the app should point: APP_BASE_URL, or the address this request came in on. */
export function publicBaseUrl(req: Request): string {
  const env = (process.env.APP_BASE_URL || '').trim().replace(/\/+$/, '');
  if (env) return env;
  const host = (req.headers['x-forwarded-host'] as string) || req.get('host') || '';
  const proto = ((req.headers['x-forwarded-proto'] as string) || req.protocol || 'https').split(',')[0].trim();
  return host ? `${proto}://${host}` : '';
}

/** The logo's public address. The hash in `v` changes with the image, so it can be cached for good. */
export function logoPath(companyId: string, sha256: string): string {
  return `/api/public/company/${companyId}/logo?v=${sha256.slice(0, 16)}`;
}

/**
 * Store the current company's logo and point branding.logoUrl at it, in one
 * transaction for exactly this company, so the address and the bytes always
 * agree. Returns the new address.
 */
export async function saveLogo(bytes: Buffer, type: LogoType, baseUrl: string): Promise<string> {
  const companyId = requireCompanyId();
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const logoUrl = `${baseUrl}${logoPath(companyId, sha256)}`;
  await patchCurrentCompany({ brandingSet: { logoUrl } }, async (tx, id) => {
    await tx.insert(companyAssets)
      .values({ companyId: id, kind: 'logo', contentType: type, bytes, sha256 })
      .onConflictDoUpdate({
        target: [companyAssets.companyId, companyAssets.kind],
        set: { contentType: type, bytes, sha256, updatedAt: new Date() },
      });
  });
  return logoUrl;
}

/** Remove the current company's logo, stored or linked, in one transaction. */
export async function removeLogo(): Promise<void> {
  await patchCurrentCompany({ brandingRemove: ['logoUrl'] }, async (tx, id) => {
    await tx.delete(companyAssets).where(and(eq(companyAssets.companyId, id), eq(companyAssets.kind, 'logo')));
  });
}

/**
 * One company's stored logo, for the public route. Runs as that company, so
 * row level security can only ever return its row; the query also names the
 * company and the kind, so nothing but its logo comes back.
 */
export async function readLogo(companyId: string): Promise<{ contentType: LogoType; bytes: Buffer; sha256: string } | null> {
  if (!isCompanyId(companyId)) return null;
  const rows = await runAsCompany(companyId, () =>
    db.select({ contentType: companyAssets.contentType, bytes: companyAssets.bytes, sha256: companyAssets.sha256 })
      .from(companyAssets)
      .where(and(eq(companyAssets.companyId, companyId), eq(companyAssets.kind, 'logo'))),
    // Renders nothing, so no profile: one query per request, not two.
    { loadProfile: false });
  const row = rows[0];
  if (!row || !(LOGO_TYPES as readonly string[]).includes(row.contentType)) return null;
  return { contentType: row.contentType as LogoType, bytes: row.bytes, sha256: row.sha256 };
}
