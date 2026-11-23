/**
 * ip-range.ts: the one answer to "may this server connect to that address?".
 *
 * The rule is `ipaddr.process(address).range() === 'unicast'`: process() folds
 * an IPv4-mapped IPv6 address (::ffff:127.0.0.1) back to IPv4, and the library
 * names every special range it knows (loopback, private, link local, carrier
 * grade NAT, multicast, documentation, 6to4, NAT64 ...). Anything it cannot
 * parse is refused.
 *
 * The version in the tree (1.9.1) does not know every special range, so a few
 * are listed here by hand. Each one was checked against the library by a test
 * that fails if the library starts, or stops, agreeing:
 *   IPv4  198.18.0.0/15 (benchmarking) and three small IANA special blocks;
 *   IPv6  everything outside global unicast 2000::/3, which takes out the
 *         deprecated IPv4-compatible form (::7f00:1), site local (fec0::),
 *         discard-only (100::), local-use NAT64 (64:ff9b:1::) and the rest, plus
 *         the blocks inside 2000::/3 that are not for the public internet.
 */
import ipaddr from 'ipaddr.js';

const cidr = (text: string): [ipaddr.IPv4 | ipaddr.IPv6, number] => ipaddr.parseCIDR(text);

const V4_NOT_PUBLIC = ['198.18.0.0/15', '192.31.196.0/24', '192.52.193.0/24', '192.175.48.0/24'].map(cidr);

const V6_GLOBAL_UNICAST = cidr('2000::/3');
const V6_NOT_PUBLIC = [
  '2001::/23', // IETF protocol assignments (Teredo, benchmarking, ORCHID ...)
  '2001:db8::/32', // documentation
  '3fff::/20', // documentation
].map(cidr);

export function isPublicAddress(address: string): boolean {
  if (typeof address !== 'string' || address === '') return false;
  let parsed: ipaddr.IPv4 | ipaddr.IPv6;
  try {
    parsed = ipaddr.process(address);
  } catch {
    return false;
  }
  if (parsed.range() !== 'unicast') return false;
  if (parsed.kind() === 'ipv4') {
    return !V4_NOT_PUBLIC.some((range) => (parsed as ipaddr.IPv4).match(range as [ipaddr.IPv4, number]));
  }
  const v6 = parsed as ipaddr.IPv6;
  if (!v6.match(V6_GLOBAL_UNICAST as [ipaddr.IPv6, number])) return false;
  return !V6_NOT_PUBLIC.some((range) => v6.match(range as [ipaddr.IPv6, number]));
}
