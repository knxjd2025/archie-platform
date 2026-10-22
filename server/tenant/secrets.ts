/**
 * Encrypting a company's credentials (GHL tokens and the like) before they are
 * stored in company_integrations, with AES-256-GCM under ARCHIE_SECRETS_KEY
 * (32 random bytes, base64). A database dump alone does not reveal them.
 *
 *   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
 */
import crypto from 'node:crypto';

const VERSION = 'v1';

function key(): Buffer {
  const raw = process.env.ARCHIE_SECRETS_KEY || '';
  const k = Buffer.from(raw, 'base64');
  if (k.length !== 32) throw new Error('ARCHIE_SECRETS_KEY must be 32 bytes, base64 encoded.');
  return k;
}

/** Encrypt a JSON-serializable value to a string safe to store. */
export function sealSecret(value: unknown): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64'), tag.toString('base64'), body.toString('base64')].join(':');
}

/** Decrypt what sealSecret produced. Throws on a wrong key or a tampered value. */
export function openSecret<T = unknown>(sealed: string): T {
  const [version, iv, tag, body] = String(sealed).split(':');
  if (version !== VERSION || !iv || !tag || !body) throw new Error('Not a sealed secret.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  const out = Buffer.concat([decipher.update(Buffer.from(body, 'base64')), decipher.final()]);
  return JSON.parse(out.toString('utf8')) as T;
}
