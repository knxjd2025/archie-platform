/**
 * SECURITY: Server-side SSRF-safe fetch (finding H4).
 *
 * The string-only guard `isSafeFetchUrl` (./url-safety) inspects the URL text
 * but leaves two holes an attacker can drive through:
 *   1. Redirects — a public URL that 3xx-redirects to http://169.254.169.254/…
 *      (cloud metadata) or any private host. Plain `fetch` follows redirects, so
 *      the string check on the original URL is meaningless.
 *   2. DNS rebinding — a public hostname whose A/AAAA record resolves to a
 *      private/loopback/link-local IP. The hostname passes the string check.
 *
 * This module closes both by (a) resolving the hostname to its actual IP(s) and
 * rejecting any private/loopback/link-local/metadata address before connecting,
 * and (b) fetching with `redirect: 'manual'` and re-validating every hop.
 *
 * Node-only (uses `node:dns` / `node:net`). Only import from server-side code;
 * never from the Vite frontend.
 */

import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { isSafeFetchUrl } from './url-safety.js';
import { isPublicAddress } from './ip-range.js';

/** Max redirect hops we will follow before giving up. */
const MAX_REDIRECTS = 5;

/**
 * Returns true when an IP address is anything but a public unicast address:
 * private, loopback, link-local, unique-local, unspecified, multicast, a
 * translation form of one of those (NAT64, 6to4, mapped, compatible), or a
 * cloud-metadata address, or not an address at all. One rule, shared with the
 * photo downloader: see ip-range.ts.
 */
export function isPrivateIp(ip: string): boolean {
  return !isPublicAddress(ip);
}

/**
 * SECURITY: Resolve `host` to every IP the OS would connect to and reject if any
 * is private/loopback/link-local/metadata. Defends DNS rebinding by validating
 * the *resolved* address, not the hostname string.
 */
export async function assertResolvedHostIsPublic(host: string): Promise<void> {
  // A hostname wrapped in brackets is an IPv6 literal.
  let h = host;
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1);

  // If the host is already an IP literal, validate it directly (no DNS).
  if (isIP(h)) {
    if (isPrivateIp(h)) throw new Error('Unsafe URL blocked: resolves to a private address');
    return;
  }

  let addresses: { address: string; family: number }[];
  try {
    addresses = await lookup(h, { all: true });
  } catch {
    // Resolution failure → fail closed. The real fetch would fail anyway.
    throw new Error('Unsafe URL blocked: host did not resolve');
  }
  if (!addresses.length) {
    throw new Error('Unsafe URL blocked: host did not resolve');
  }
  for (const { address } of addresses) {
    if (isPrivateIp(address)) {
      throw new Error('Unsafe URL blocked: resolves to a private address');
    }
  }
}

/**
 * SECURITY: SSRF-safe replacement for `fetch` for any user-supplied /
 * attacker-influenced URL. Validates the URL string, resolves + validates the
 * host IPs, and follows redirects manually — re-validating each hop — so a 3xx
 * to a private/metadata host can't bypass the guard. Any `redirect` value in
 * `init` is ignored (always manual internally).
 */
export async function safeFetch(url: string, init: RequestInit = {}): Promise<Response> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!isSafeFetchUrl(current)) {
      throw new Error('Unsafe URL blocked');
    }
    const parsed = new URL(current);
    await assertResolvedHostIsPublic(parsed.hostname);

    const res = await fetch(current, { ...init, redirect: 'manual' });

    // 3xx with a Location → validate the next hop ourselves.
    if (res.status >= 300 && res.status < 400 && res.headers.has('location')) {
      const location = res.headers.get('location')!;
      let next: URL;
      try {
        next = new URL(location, current);
      } catch {
        throw new Error('Unsafe URL blocked: invalid redirect target');
      }
      // Drain the redirect body so the socket can be reused/closed.
      try { await res.arrayBuffer(); } catch { /* ignore */ }
      current = next.toString();
      continue;
    }

    return res;
  }
  throw new Error('Unsafe URL blocked: too many redirects');
}
