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

/** Max redirect hops we will follow before giving up. */
const MAX_REDIRECTS = 5;

/**
 * Returns true when a numeric IP (v4 or v6) is private, loopback, link-local,
 * unique-local, unspecified, or a cloud-metadata address — i.e. must never be
 * reached by a server-side fetch of a user-supplied URL.
 */
export function isPrivateIp(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return isPrivateIPv4(ip);
  if (family === 6) return isPrivateIPv6(ip);
  // Not a recognizable IP literal — treat as unsafe (fail closed).
  return true;
}

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true; // malformed → fail closed
  }
  const [a, b] = parts;
  if (a === 0) return true; // 0.0.0.0/8 (this-host / unspecified)
  if (a === 10) return true; // 10.0.0.0/8 private
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local (incl. 169.254.169.254 metadata)
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 private
  if (a === 192 && b === 168) return true; // 192.168.0.0/16 private
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  if (a >= 224) return true; // 224.0.0.0/4 multicast + 240.0.0.0/4 reserved
  return false;
}

function isPrivateIPv6(raw: string): boolean {
  let ip = raw.toLowerCase();
  // Strip a zone id (fe80::1%eth0) if present.
  const pct = ip.indexOf('%');
  if (pct !== -1) ip = ip.slice(0, pct);

  if (ip === '::' || ip === '::1') return true; // unspecified / loopback

  // IPv4-mapped / IPv4-compatible: validate the embedded v4 address.
  const mapped = ip.match(/^::(?:ffff:)?(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (mapped) return isPrivateIPv4(mapped[1]);
  // ::ffff:7f00:1 hex form of an IPv4-mapped address.
  const mappedHex = ip.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mappedHex) {
    const high = parseInt(mappedHex[1], 16);
    const low = parseInt(mappedHex[2], 16);
    return isPrivateIPv4(`${(high >> 8) & 0xff}.${high & 0xff}.${(low >> 8) & 0xff}.${low & 0xff}`);
  }

  if (ip.startsWith('fe80')) return true; // link-local fe80::/10
  if (ip.startsWith('fc') || ip.startsWith('fd')) return true; // unique-local fc00::/7
  if (ip.startsWith('ff')) return true; // multicast ff00::/8
  return false;
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
