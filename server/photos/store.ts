/**
 * Archie's private photo store: Kynex's own Cloudflare R2 bucket, spoken to
 * through its S3-compatible interface (docs/archie/02-roof-lee-link.md,
 * "Archie's own jobs", Photos).
 *
 * PRIVATE. The bucket has no public address and this file never makes one:
 * a photo leaves the store only through Archie's own signed-in route
 * (GET /api/photos/:id/:variant, server/photos/routes.ts), which checks who
 * is asking first. Do not use server/lib/reports/r2-storage.ts for job
 * photos: that one is public by design.
 *
 * Settings, read only here and only when a store is first needed:
 *   ARCHIE_PHOTOS_ACCOUNT_ID         the Cloudflare account (the endpoint is
 *                                    https://<account>.r2.cloudflarestorage.com)
 *   ARCHIE_PHOTOS_ACCESS_KEY_ID      an R2 key limited to this bucket
 *   ARCHIE_PHOTOS_SECRET_ACCESS_KEY  its secret
 *   ARCHIE_PHOTOS_BUCKET             the bucket
 * With any of them unset the store is off (photoStoreConfigured), and adding
 * a photo answers 503 in plain words. The secrets are never logged, never put
 * in an error message and never sent anywhere but into the request signing.
 *
 * Tests never make a real client: they hand in a fake with
 * setPhotoStoreForTests, so no test talks to Cloudflare.
 */
import type { Readable } from 'node:stream';

/** What the rest of Archie may do with the store. Deliberately small. */
export interface PhotoStore {
  /** Store an object. The key must be one photoObjectKey built. */
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  /** Read an object back, or null when it is not there. */
  get(key: string): Promise<{ body: Readable; length: number | null } | null>;
  /**
   * Remove one object. Removing one that is not there is not an error. Only a
   * roof report photo that was never put in a report is ever removed. Absent on
   * a store that cannot remove, which the caller treats as "could not".
   */
  delete?(key: string): Promise<void>;
}

const SETTINGS = ['ARCHIE_PHOTOS_ACCOUNT_ID', 'ARCHIE_PHOTOS_ACCESS_KEY_ID', 'ARCHIE_PHOTOS_SECRET_ACCESS_KEY', 'ARCHIE_PHOTOS_BUCKET'] as const;

/** True only when all four settings are present. */
export function photoStoreConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return SETTINGS.every((name) => (env[name] ?? '').trim() !== '');
}

export type PhotoVariant = 'working' | 'thumb';

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const KEY_RE = new RegExp(`^c/${UUID}/p/${UUID}/(working|thumb)\\.jpg$`);
/** A roof report photo: under the company's own rr/ prefix, in the word `pending` (uploaded, not yet in a report) or a report id. */
const REPORT_KEY_RE = new RegExp(`^c/${UUID}/rr/(pending|${UUID})/${UUID}/(working|thumb)\\.jpg$`);

/**
 * Where a roof report photo's copy is kept: 'c/<company id>/rr/<scope>/<photo
 * id>/<variant>.jpg'. The scope is `pending` for a photo uploaded before its
 * report exists. Which report a photo belongs to is the database row's, never
 * its key. Built only here, from the database row, never from anything a
 * request sent. The database holds the same prefix rule
 * (roof_report_photos_keys_in_company).
 */
export function roofReportPhotoKey(companyId: string, scope: string, photoId: string, variant: PhotoVariant): string {
  const key = `c/${companyId}/rr/${scope}/${photoId}/${variant}.jpg`;
  if (!REPORT_KEY_RE.test(key)) throw new Error('photo key refused');
  return key;
}

/**
 * Where a photo's copy is kept: always under its company's own prefix
 * 'c/<company id>/p/', named by the photo's own id. Built only here, only
 * from the database row, never from anything a request sent. The database
 * holds the same rule (job_photos_keys_in_company).
 */
export function photoObjectKey(companyId: string, photoId: string, variant: PhotoVariant): string {
  const key = `c/${companyId}/p/${photoId}/${variant}.jpg`;
  if (!KEY_RE.test(key)) throw new Error('photo key refused');
  return key;
}

/** True for a key photoObjectKey could have built. The store refuses any other. */
export const isPhotoObjectKey = (key: string): boolean => KEY_RE.test(key) || REPORT_KEY_RE.test(key);

let forTests: PhotoStore | null = null;
let real: { signature: string; store: PhotoStore } | null = null;

/** Tests only: use this store instead of the real one (null goes back to the settings). */
export function setPhotoStoreForTests(store: PhotoStore | null): void {
  forTests = store;
}

/**
 * The store, or null when it is not switched on. The real client is made the
 * first time it is needed and kept while the settings stay the same.
 */
export function photoStore(): PhotoStore | null {
  if (forTests) return forTests;
  if (!photoStoreConfigured()) return null;
  const env = process.env;
  const signature = SETTINGS.map((n) => env[n]).join('\n');
  if (!real || real.signature !== signature) {
    real = {
      signature,
      store: r2PhotoStore({
        accountId: env.ARCHIE_PHOTOS_ACCOUNT_ID!.trim(),
        accessKeyId: env.ARCHIE_PHOTOS_ACCESS_KEY_ID!.trim(),
        secretAccessKey: env.ARCHIE_PHOTOS_SECRET_ACCESS_KEY!.trim(),
        bucket: env.ARCHIE_PHOTOS_BUCKET!.trim(),
      }),
    };
  }
  return real.store;
}

interface R2Settings { accountId: string; accessKeyId: string; secretAccessKey: string; bucket: string }

/**
 * The real store over R2. The S3 library is loaded on first use, so a cold
 * start that never touches a photo never loads it.
 */
function r2PhotoStore(s: R2Settings): PhotoStore {
  let client: Promise<{ send: (command: unknown) => Promise<any>; lib: typeof import('@aws-sdk/client-s3') }> | null = null;
  const connect = () => {
    client ??= import('@aws-sdk/client-s3').then((lib) => {
      const s3 = new lib.S3Client({
        region: 'auto',
        endpoint: `https://${s.accountId}.r2.cloudflarestorage.com`,
        credentials: { accessKeyId: s.accessKeyId, secretAccessKey: s.secretAccessKey },
      });
      return { send: (command: unknown) => s3.send(command as any), lib };
    });
    return client;
  };

  return {
    async put(key, body, contentType) {
      if (!isPhotoObjectKey(key)) throw new Error('photo key refused');
      const { send, lib } = await connect();
      await send(new lib.PutObjectCommand({
        Bucket: s.bucket, Key: key, Body: body, ContentType: contentType, ContentLength: body.length,
        CacheControl: 'private, max-age=300',
      }));
    },
    async get(key) {
      if (!isPhotoObjectKey(key)) throw new Error('photo key refused');
      const { send, lib } = await connect();
      try {
        const r = await send(new lib.GetObjectCommand({ Bucket: s.bucket, Key: key }));
        if (!r?.Body) return null;
        return { body: r.Body as Readable, length: typeof r.ContentLength === 'number' ? r.ContentLength : null };
      } catch (e: any) {
        if (e?.name === 'NoSuchKey' || e?.$metadata?.httpStatusCode === 404) return null;
        throw e;
      }
    },
    async delete(key) {
      // Only a roof report photo's own key may be removed, never a job photo's.
      if (!REPORT_KEY_RE.test(key)) throw new Error('photo key refused');
      const { send, lib } = await connect();
      await send(new lib.DeleteObjectCommand({ Bucket: s.bucket, Key: key }));
    },
  };
}

/**
 * A few plain words about a store failure, for the log: the error's name and
 * status only. Never its message, which can carry the request it was making.
 */
export function describeStoreError(e: unknown): string {
  const any = (e ?? {}) as { name?: unknown; $metadata?: { httpStatusCode?: unknown } };
  const name = typeof any.name === 'string' ? any.name : 'Error';
  const status = typeof any.$metadata?.httpStatusCode === 'number' ? ` ${any.$metadata.httpStatusCode}` : '';
  return `${name}${status}`.slice(0, 80);
}
