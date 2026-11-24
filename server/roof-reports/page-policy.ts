/**
 * The policy a report page is served under.
 *
 * Two kinds of page, both served inside a sandbox that has no origin of its own
 * (no `allow-same-origin`), so nothing in a page can reach the app's cookies or
 * its API:
 *
 *   built  made by the escaped renderers just now. It runs the scripts those
 *          renderers wrote (the scroll engine and the page's own small script)
 *          and no others: `script-src` is the nonce of THIS response, fresh for
 *          every request, never 'unsafe-inline'. A script or handler that got
 *          into the markup some other way has no nonce and does not run.
 *   saved  a page a person saved, shown as saved. It runs nothing at all.
 *
 * For both: nothing may connect anywhere, no form may be sent, and images load
 * only from where a report's pictures come from: the app (photo links are
 * absolute addresses on it), data and blob, and the one origin the company's
 * logo is on. An injected image therefore cannot carry anything out to a host
 * of its own choosing.
 *
 * Styles and fonts are still allowed from any https address (the pages use
 * Google Fonts), and inline styles are allowed; neither can run script.
 */
import { randomBytes } from 'node:crypto';

/** A nonce for one response: 18 random bytes, written as 24 base64 characters. */
export const newNonce = (): string => randomBytes(18).toString('base64');

export interface PolicyInput {
  kind: 'built' | 'saved';
  /** Required for 'built', ignored for 'saved'. */
  nonce?: string;
  /** The origin the app is reached at, for the photo links in a page. */
  appOrigin: string;
  /** The company's logo address, as its profile holds it. Only its origin is ever used, and only when it is plain https. */
  logoUrl: string;
}

const NONCE_RE = /^[A-Za-z0-9+/]{16,256}={0,2}$/;

/** `scheme://host[:port]` and nothing else, or null: a value that could end a directive is never one. */
function plainOrigin(value: string): string | null {
  if (typeof value !== 'string' || !/^https?:\/\/[A-Za-z0-9.-]+(:\d{1,5})?(\/[^\s;,]*)?$/.test(value)) return null;
  try {
    const u = new URL(value);
    return u.origin === 'null' ? null : u.origin;
  } catch {
    return null;
  }
}

export function pagePolicy(input: PolicyInput): string {
  const app = plainOrigin(input.appOrigin);
  if (!app) throw new Error('the app origin is not a plain origin');
  const logo = /^https:\/\//.test(input.logoUrl) ? plainOrigin(input.logoUrl) : null;
  const images = ['img-src', app, ...(logo && logo !== app ? [logo] : []), 'data:', 'blob:'].join(' ');
  const common = [
    "default-src 'none'", images, "style-src 'unsafe-inline' https:", 'font-src https: data:',
    "base-uri 'none'", "form-action 'none'", "frame-ancestors 'self'",
  ];
  if (input.kind === 'saved') return ['sandbox', ...common].join('; ');
  if (typeof input.nonce !== 'string' || !NONCE_RE.test(input.nonce)) throw new Error('a page nonce must be a plain base64 token');
  return ['sandbox allow-scripts', ...common, `script-src 'nonce-${input.nonce}'`, "connect-src 'none'"].join('; ');
}
