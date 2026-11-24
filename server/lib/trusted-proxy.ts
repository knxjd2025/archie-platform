/**
 * How many proxies stand in front of the app, as Express counts them.
 *
 * `req.ip` (what every rate limit counts a visitor under) is the address that
 * many hops from the RIGHT of the `X-Forwarded-For` chain; anything further left
 * is whatever the visitor chose to send and is never believed. On Vercel the
 * platform's own proxy is the one hop (it sets the header to the address it saw),
 * so the default is 1, which is what both entry points always had. Where a second
 * proxy sits in front (a CDN before the host), set ARCHIE_TRUSTED_PROXY_HOPS=2;
 * with none (the app reached directly, as in local development), 0.
 *
 * Read in the two places the app configures `trust proxy` (server/index.ts and
 * api/index.ts). Anything that is not a whole number from 0 to 5 is ignored and
 * one hop kept, so a typo can never make the counted address one the visitor chose.
 */
export function trustedProxyHops(env: Record<string, string | undefined> = process.env): number {
  const raw = (env.ARCHIE_TRUSTED_PROXY_HOPS ?? '').trim();
  return /^[0-5]$/.test(raw) ? Number(raw) : 1;
}
