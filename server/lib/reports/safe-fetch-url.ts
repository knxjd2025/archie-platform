/**
 * Guards a handful of spots that fetch an arbitrary, caller-supplied URL
 * server-side (vision-test's ?url=, a rep's pasted "extra photo URLs", and
 * the Groq vision fallback's image-to-base64 fetch) against SSRF: a request
 * for http://169.254.169.254/... or http://localhost:5432/... would otherwise
 * be fetched from inside our own network by the server, not the caller's
 * browser. Resolves the hostname and rejects loopback/private/link-local
 * targets rather than allowlisting domains — reps legitimately paste photo
 * URLs from all kinds of hosts (Dropbox, insurance portals, JobTread's CDN),
 * so a domain allowlist would just break real usage.
 */
import { lookup } from 'dns/promises';
import { isIP } from 'net';

function isPrivateOrLoopback(ip: string): boolean {
  if (ip === '127.0.0.1' || ip === '::1' || ip === '0.0.0.0') return true;
  if (ip.startsWith('169.254.') || ip.startsWith('fe80:')) return true; // link-local incl. cloud metadata
  if (ip.startsWith('10.') || ip.startsWith('192.168.')) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return true;
  if (ip.startsWith('fc') || ip.startsWith('fd')) return true; // unique local IPv6
  return false;
}

export async function assertSafeExternalUrl(rawUrl: string): Promise<void> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('Not a valid URL.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only http(s) URLs are allowed.');
  }
  const hostname = url.hostname;
  if (hostname === 'localhost') throw new Error('That host is not allowed.');
  if (isIP(hostname)) {
    if (isPrivateOrLoopback(hostname)) throw new Error('That host is not allowed.');
    return;
  }
  const results = await lookup(hostname, { all: true });
  if (results.some((r) => isPrivateOrLoopback(r.address))) {
    throw new Error('That host is not allowed.');
  }
}
