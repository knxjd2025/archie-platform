/**
 * Preliminary URL/IP-literal guard for server-side fetches (SSRF mitigation).
 * This does not resolve DNS. Callers must also enforce public destinations at
 * connection time and reject or revalidate redirects.
 *
 * Framework-agnostic: uses only the web-standard `URL` (no Node-only APIs),
 * so it is safe to import from both the Vite frontend and the Node/Express
 * server. Call {@link isSafeFetchUrl} (or {@link assertSafeFetchUrl}) before
 * fetching any user-supplied or attacker-influenced URL on the server.
 *
 * Blocks: non-http(s) protocols; localhost / 0.0.0.0; loopback (127.0.0.0/8,
 * ::1); link-local (169.254.0.0/16, fe80::); private ranges (10.0.0.0/8,
 * 192.168.0.0/16, 172.16.0.0/12); cloud metadata (metadata.google.internal,
 * any *.internal); IPv4-mapped IPv6 of those; and alternate IP encodings
 * (decimal, hex, octal, bracketed ::ffff: forms).
 */

/** Matches a bare decimal integer host (e.g. `2130706433` → 127.0.0.1). */
const DECIMAL_HOST_RE = /^\d+$/;

/** Matches a hex-encoded host (e.g. `0x7f000001`). */
const HEX_HOST_RE = /^0x/i;

/** IPv4 loopback 127.0.0.0/8. */
const IPV4_LOOPBACK_RE = /^127\./;

/** IPv4 link-local 169.254.0.0/16. */
const IPV4_LINK_LOCAL_RE = /^169\.254\./;

/** IPv4 private 10.0.0.0/8. */
const IPV4_PRIVATE_10_RE = /^10\./;

/** IPv4 private 192.168.0.0/16. */
const IPV4_PRIVATE_192_RE = /^192\.168\./;

/** IPv4 private 172.16.0.0/12. */
const IPV4_PRIVATE_172_RE = /^172\.(1[6-9]|2\d|3[0-1])\./;

/** IPv6 loopback. */
const IPV6_LOOPBACK = '::1';

/** IPv6 link-local prefix. */
const IPV6_LINK_LOCAL_RE = /^fe[89ab][0-9a-f]:/;

/** IPv6 unique-local prefixes (fc00::/7 → fc.., fd..). */
const IPV6_ULA_RE = /^f[cd]/;

/** Matches an octet that uses a leading-zero (octal) encoding, e.g. `0177`. */
const OCTAL_OCTET_RE = /(^|\.)0\d/;

/** Error thrown by {@link assertSafeFetchUrl} for blocked URLs. */
const UNSAFE_URL_ERROR = 'Unsafe URL blocked';

/**
 * Resolves an IPv4-mapped IPv6 host to its dotted-quad IPv4 string, so the
 * IPv4 range checks below catch it. The WHATWG `URL` parser normalizes
 * `::ffff:127.0.0.1` to the hex form `::ffff:7f00:1`, so both the dotted and
 * hex tails must be handled. Returns the input unchanged when it is not a
 * mapped address.
 */
function unwrapMappedIPv4(host: string): string {
  if (!host.startsWith('::ffff:')) return host;
  const tail = host.slice('::ffff:'.length);

  // Already dotted IPv4 (e.g. ::ffff:127.0.0.1 — not normalized by all parsers).
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(tail)) return tail;

  // Hex form: two 16-bit groups, e.g. 7f00:1 → 127.0.0.1.
  const hexMatch = tail.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hexMatch) {
    const high = parseInt(hexMatch[1], 16);
    const low = parseInt(hexMatch[2], 16);
    if (Number.isFinite(high) && Number.isFinite(low)) {
      return `${(high >> 8) & 0xff}.${high & 0xff}.${(low >> 8) & 0xff}.${low & 0xff}`;
    }
  }

  return host;
}

/**
 * Returns true only when `raw` is a public http(s) URL that is safe to fetch
 * server-side. Rejects internal/loopback/link-local/private hosts, cloud
 * metadata endpoints, and alternate IP encodings used to bypass naive checks.
 */
export function isSafeFetchUrl(raw: string): boolean {
  if (typeof raw !== 'string' || raw.length === 0) return false;

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }

  if (parsed.username || parsed.password) return false;

  // Protocol allowlist.
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;

  // Normalize hostname: lowercase + strip IPv6 brackets.
  let host = parsed.hostname.toLowerCase().replace(/\.+$/, '');
  if (host.startsWith('[') && host.endsWith(']')) {
    host = host.slice(1, host.length - 1);
  }
  if (host.length === 0) return false;

  // Obvious internal names.
  if (host === 'localhost' || host.endsWith('.localhost') || host === '0.0.0.0') return false;
  if (host === 'metadata.google.internal') return false;
  if (host.endsWith('.internal') || host.endsWith('.local')) return false;

  // Reject alternate IPv4 encodings outright — a bare decimal/hex/octal host
  // is never a legitimate public hostname and is a classic SSRF bypass.
  if (HEX_HOST_RE.test(host)) return false;
  if (DECIMAL_HOST_RE.test(host)) return false;
  if (OCTAL_OCTET_RE.test(host)) return false;

  // Resolve any IPv4-mapped IPv6 address (dotted or hex tail) to dotted IPv4
  // so the IPv4 range regexes below catch the embedded address.
  const mappedV4 = unwrapMappedIPv4(host);

  // Unspecified, carrier-grade NAT, multicast and reserved addresses are not public targets.
  if (/^0\./.test(mappedV4) || /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(mappedV4)) return false;
  if (/^(22[4-9]|23\d|24\d|25[0-5])\./.test(mappedV4)) return false;
  if (host === '::' || /^ff/i.test(host)) return false;

  // IPv4 loopback / link-local / private ranges.
  if (IPV4_LOOPBACK_RE.test(mappedV4)) return false;
  if (IPV4_LINK_LOCAL_RE.test(mappedV4)) return false;
  if (IPV4_PRIVATE_10_RE.test(mappedV4)) return false;
  if (IPV4_PRIVATE_192_RE.test(mappedV4)) return false;
  if (IPV4_PRIVATE_172_RE.test(mappedV4)) return false;

  // IPv6 loopback / link-local / unique-local.
  if (host === IPV6_LOOPBACK) return false;
  if (IPV6_LINK_LOCAL_RE.test(host)) return false;
  if (IPV6_ULA_RE.test(host)) return false;

  return true;
}

/**
 * Throws {@link Error}('Unsafe URL blocked') when `raw` fails
 * {@link isSafeFetchUrl}. Use to fail fast before a server-side fetch.
 */
export function assertSafeFetchUrl(raw: string): void {
  if (!isSafeFetchUrl(raw)) {
    throw new Error(UNSAFE_URL_ERROR);
  }
}
