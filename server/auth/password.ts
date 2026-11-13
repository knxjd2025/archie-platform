/**
 * Password hashing with node:crypto scrypt (no extra dependency).
 *
 * Stored as `scrypt$N$r$p$<salt b64>$<hash b64>` so the cost can be raised
 * later without invalidating existing hashes: verify reads the parameters back
 * out of the stored string.
 */
import crypto from 'node:crypto';

const N = 16384;
const R = 8;
const P = 1;
const SALT_BYTES = 16;
const KEY_BYTES = 64;
const MIN_LENGTH = 10;
const MAX_LENGTH = 200;

const scrypt = (plain: string, salt: Buffer, n: number, r: number, p: number, keyLen: number) =>
  new Promise<Buffer>((resolve, reject) =>
    crypto.scrypt(plain, salt, keyLen, { N: n, r, p }, (err, key) => (err ? reject(err) : resolve(key))));

export async function hashPassword(plain: string): Promise<string> {
  const salt = crypto.randomBytes(SALT_BYTES);
  const key = await scrypt(plain, salt, N, R, P, KEY_BYTES);
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`;
}

// Verified against when no password is stored, so "no such password" costs the same time as "wrong password".
const DUMMY_SALT = Buffer.alloc(SALT_BYTES, 7);
const DUMMY_HASH = `scrypt$${N}$${R}$${P}$${DUMMY_SALT.toString('base64')}$${Buffer.alloc(KEY_BYTES, 9).toString('base64')}`;

export async function verifyPassword(plain: string, stored: string | null | undefined): Promise<boolean> {
  if (typeof stored !== 'string' || stored === '') {
    await verifyAgainst(plain, DUMMY_HASH);
    return false;
  }
  return verifyAgainst(plain, stored);
}

async function verifyAgainst(plain: string, stored: string): Promise<boolean> {
  try {
    const parts = stored.split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
    const [n, r, p] = [parts[1], parts[2], parts[3]].map(Number);
    if (![n, r, p].every((v) => Number.isInteger(v) && v > 0)) return false;
    const salt = Buffer.from(parts[4], 'base64');
    const expected = Buffer.from(parts[5], 'base64');
    if (salt.length === 0 || expected.length === 0) return false;
    const actual = await scrypt(plain, salt, n, r, p, expected.length);
    return crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/** A user-facing reason the password is unacceptable, or null when it is fine. */
export function passwordProblem(plain: unknown): string | null {
  if (typeof plain !== 'string' || plain.length < MIN_LENGTH) return `Use at least ${MIN_LENGTH} characters.`;
  if (plain.length > MAX_LENGTH) return 'That password is too long.';
  return null;
}
