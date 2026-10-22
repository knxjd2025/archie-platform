/**
 * Cloudflare R2 storage for finished reports.
 *
 * NOT WIRED UP. Every function here has zero callers, and the R2_REPORTS_*
 * keys are deliberately unset — the roof colour renders that were to use it
 * were declined on 2026-09-19 (see roof-color-renders.ts), and reports are
 * served from /r/:token rather than an R2 link. `@aws-sdk/client-s3` is not a
 * dependency, and installing it changes nothing while nothing calls this.
 *
 * Kept because the intent may come back: reports on a public R2 link. If it
 * does, install the SDK then — not before. The S3 client is loaded dynamically so
 * importing this never breaks boot/build when R2 isn't configured, and every
 * call degrades to `null` so the caller can fall back to Vercel Blob / a local
 * link.
 *
 * Env: R2_REPORTS_ACCOUNT_ID, R2_REPORTS_ACCESS_KEY_ID,
 *      R2_REPORTS_SECRET_ACCESS_KEY, R2_REPORTS_BUCKET_NAME, R2_REPORTS_PUBLIC_URL
 */

export interface StoredR2Object {
  url: string;
  key: string;
}

interface R2Config {
  account: string;
  access: string;
  secret: string;
  bucket: string;
  publicBase: string;
}

function readConfig(): R2Config | null {
  const account = process.env.R2_REPORTS_ACCOUNT_ID;
  const access = process.env.R2_REPORTS_ACCESS_KEY_ID;
  const secret = process.env.R2_REPORTS_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_REPORTS_BUCKET_NAME;
  let publicBase = (process.env.R2_REPORTS_PUBLIC_URL || '').replace(/\/$/, '');
  if (!account || !access || !secret || !bucket || !publicBase) return null;
  if (!/^https?:\/\//.test(publicBase)) publicBase = 'https://' + publicBase;
  return { account, access, secret, bucket, publicBase };
}

export function isR2Configured(): boolean {
  return readConfig() !== null;
}

// Cache the client across calls within a process.
let cachedClient: any = null;
let cachedFor: string | null = null;

async function getClient(cfg: R2Config): Promise<any | null> {
  if (cachedClient && cachedFor === cfg.account) return cachedClient;
  try {
    const mod: any = await import('@aws-sdk/client-s3');
    cachedClient = new mod.S3Client({
      region: 'auto',
      endpoint: `https://${cfg.account}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: cfg.access, secretAccessKey: cfg.secret },
    });
    cachedFor = cfg.account;
    return cachedClient;
  } catch (err: any) {
    console.warn('[r2-storage] @aws-sdk/client-s3 unavailable:', err?.message);
    return null;
  }
}

async function put(key: string, body: Buffer | string, contentType: string): Promise<StoredR2Object | null> {
  const cfg = readConfig();
  if (!cfg) return null;
  const client = await getClient(cfg);
  if (!client) return null;
  try {
    const { PutObjectCommand }: any = await import('@aws-sdk/client-s3');
    await client.send(new PutObjectCommand({
      Bucket: cfg.bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      CacheControl: 'public, max-age=300',
    }));
    return { url: `${cfg.publicBase}/${key}`, key };
  } catch (err: any) {
    console.error('[r2-storage] put failed:', err?.message);
    return null;
  }
}

const slugify = (s: string) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'report';

/** Store report HTML. Key: <slug>/<kind>-roof-report.html. Returns public URL or null. */
export function putReportHtml(slug: string, html: string, kind = 'roof'): Promise<StoredR2Object | null> {
  return put(`${slugify(slug)}/${kind}-roof-report.html`, html, 'text/html; charset=utf-8');
}

/** Store report PDF. Returns public URL or null. */
export function putReportPdf(slug: string, pdf: Buffer, kind = 'roof'): Promise<StoredR2Object | null> {
  return put(`${slugify(slug)}/${kind}-roof-report.pdf`, pdf, 'application/pdf');
}

/** Store a property image (e.g. a JobTread/upload photo) under the report slug. */
export function putReportImage(slug: string, filename: string, content: Buffer, contentType = 'image/jpeg'): Promise<StoredR2Object | null> {
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80);
  return put(`${slugify(slug)}/photos/${safe}`, content, contentType);
}
