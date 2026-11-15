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

export type LogoCheck = { ok: true; type: LogoType } | { ok: false; status: 400 | 413; error: string };

/** Whether an uploaded file may be the logo. */
export function checkLogo(buf: unknown): LogoCheck {
  if (!Buffer.isBuffer(buf) || buf.length === 0) return { ok: false, status: 400, error: 'Choose an image file to upload.' };
  if (buf.length > MAX_LOGO_BYTES) return { ok: false, status: 413, error: 'That logo is over 300 KB. Use a smaller image.' };
  const type = sniffImageType(buf);
  if (!type) return { ok: false, status: 400, error: 'The logo must be a PNG, JPEG or WebP image.' };
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

/** Store the current company's logo and point branding.logoUrl at it. Returns the new address. */
export async function saveLogo(bytes: Buffer, type: LogoType, baseUrl: string): Promise<string> {
  const companyId = requireCompanyId();
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  // As the company: row level security stamps and checks its own company_id.
  await db.insert(companyAssets)
    .values({ kind: 'logo', contentType: type, bytes, sha256 })
    .onConflictDoUpdate({
      target: [companyAssets.companyId, companyAssets.kind],
      set: { contentType: type, bytes, sha256, updatedAt: new Date() },
    });
  const logoUrl = `${baseUrl}${logoPath(companyId, sha256)}`;
  await patchCurrentCompany({ brandingSet: { logoUrl } });
  return logoUrl;
}

/** Remove the current company's logo, stored or linked. */
export async function removeLogo(): Promise<void> {
  const companyId = requireCompanyId();
  await db.delete(companyAssets).where(and(eq(companyAssets.companyId, companyId), eq(companyAssets.kind, 'logo')));
  await patchCurrentCompany({ brandingRemove: ['logoUrl'] });
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
      .where(and(eq(companyAssets.companyId, companyId), eq(companyAssets.kind, 'logo'))));
  const row = rows[0];
  if (!row || !(LOGO_TYPES as readonly string[]).includes(row.contentType)) return null;
  return { contentType: row.contentType as LogoType, bytes: row.bytes, sha256: row.sha256 };
}
