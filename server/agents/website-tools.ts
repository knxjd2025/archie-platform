/**
 * The team advisor reading the company's own website live — services, cost
 * guides, warranties, FAQs, service-area pages — so what it tells the team
 * matches what the company tells the public, even after the site changes.
 *
 * The site is the one in the company's profile (currentProfile().website);
 * with none entered, the tools are not offered. Locked to that site's domain:
 * the advisor passes a path or URL, and anything that doesn't resolve to the
 * company's own host is refused before a request is made. Because the address
 * is entered by the company, not fixed in code, it is also checked so it can't
 * be used to make the server fetch internal addresses: https only, a public
 * host name (no IP literals, localhost or internal names), every address it
 * resolves to must be public, and redirects are followed one hop at a time
 * with the same checks.
 */
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import type { Tool } from './base-agent';
import { currentProfile } from '../tenant/context';

const FETCH_TIMEOUT_MS = 10_000;
const MAX_BYTES = 2_000_000;
const PAGE_TEXT_LIMIT = 8_000;
const PAGE_TTL_MS = 60 * 60 * 1000;
const SITEMAP_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_SUB_SITEMAPS = 20;
const MAX_REDIRECTS = 5;
// Image/video sitemaps list media, not pages worth reading.
const SKIP_SITEMAP = /\/(images|videos)(\.xml)?$/i;

/** A company's site: its https origin and the host names that count as the same site. */
export interface CompanySite { origin: string; hosts: ReadonlySet<string> }

const INTERNAL_HOST = /(^|\.)(localhost|local|internal|intranet|lan|home|corp|localdomain|test|invalid|example)$/i;

/** True for a host name the server may fetch: a dotted public name, not an IP literal or an internal name. */
export function isPublicHostName(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, '');
  if (!h || isIP(h.replace(/^\[|\]$/g, '')) || !h.includes('.')) return false;
  if (INTERNAL_HOST.test(h)) return false;
  return /^[a-z0-9.-]+$/.test(h);
}

/**
 * The company's website, from a profile's website field, as a site the
 * advisor may read — or null when there is none or it is not a public https
 * address.
 */
export function siteFromWebsite(website: string | null | undefined): CompanySite | null {
  const raw = (website || '').trim();
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  if (url.port || url.username || url.password) return null;
  const host = url.hostname.toLowerCase();
  if (!isPublicHostName(host)) return null;
  const bare = host.replace(/^www\./, '');
  return { origin: `https://${host}`, hosts: new Set([bare, `www.${bare}`]) };
}

/** The current company's site, or null when it has none the advisor can read. */
export function companyWebsite(): CompanySite | null {
  return siteFromWebsite(currentProfile().website);
}

/** A path or URL → an absolute URL on the company site, or null if it points anywhere else. */
export function toSiteUrl(input: unknown, site: CompanySite | null = companyWebsite()): string | null {
  if (!site || typeof input !== 'string' || !input.trim()) return null;
  const raw = input.trim();
  const bareHost = /^(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)+(\/|$)/i;
  let url: URL;
  try {
    url = /^https?:\/\//i.test(raw)
      ? new URL(raw)
      : bareHost.test(raw) && site.hosts.has(raw.split('/')[0].toLowerCase())
        ? new URL(`https://${raw}`)
        : new URL(raw.startsWith('/') ? raw : `/${raw}`, site.origin);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (!site.hosts.has(url.hostname.toLowerCase())) return null;
  if (url.port || url.username || url.password) return null;
  return `${site.origin}${url.pathname}${url.search}`;
}

/** True for an IP address in a private, loopback, link-local or otherwise non-public range. */
export function isPrivateAddress(ip: string): boolean {
  const v = ip.toLowerCase();
  if (isIP(v) === 4) {
    const [a, b] = v.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  if (isIP(v) === 6) {
    const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    return v === '::' || v === '::1' || /^f[cd]/.test(v) || /^fe[89ab]/.test(v) || /^ff/.test(v);
  }
  return true;
}

/** Refuse a host that resolves to any non-public address. */
async function assertPublicHost(host: string): Promise<void> {
  const addrs = await lookup(host, { all: true, verbatim: true });
  if (!addrs.length || addrs.some((a) => isPrivateAddress(a.address))) throw new Error('The company website does not resolve to a public address.');
}

const ENTITIES: Record<string, string> = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'", '&nbsp;': ' ',
  '&mdash;': '—', '&ndash;': '–', '&rsquo;': '’', '&lsquo;': '‘', '&rdquo;': '”', '&ldquo;': '“', '&hellip;': '…', '&bull;': '•',
};

export function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&[a-z]+;/gi, (e) => ENTITIES[e.toLowerCase()] ?? e);
}

export interface PageText { title: string; description: string; text: string }

/** Readable text from a page: title, meta description, and body with structure kept as line breaks. */
export function htmlToText(html: string): PageText {
  const title = decodeEntities((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').replace(/\s+/g, ' ').trim());
  const description = decodeEntities(
    (html.match(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i)?.[1]
      || html.match(/<meta[^>]+content=["']([^"']*)["'][^>]*name=["']description["']/i)?.[1]
      || '').trim(),
  );
  const body = (html.match(/<body[^>]*>([\s\S]*)<\/body>/i)?.[1] ?? html)
    .replace(/<(script|style|noscript|svg|iframe|template)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(nav|footer|header)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<(br|\/p|\/div|\/h[1-6]|\/li|\/tr|\/section|\/article)[^>]*>/gi, '\n')
    .replace(/<h[1-6][^>]*>/gi, '\n\n')
    .replace(/<[^>]+>/g, ' ');
  const text = decodeEntities(body)
    .split('\n')
    .map((l) => l.replace(/[ \t\f\v\r]+/g, ' ').trim())
    .filter((l, i, all) => l && l !== '-' && l !== all[i - 1])
    .join('\n');
  return { title, description, text };
}

/** Every <loc> in a sitemap document. */
export function parseSitemap(xml: string): string[] {
  return Array.from(xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi), (m) => decodeEntities(m[1]));
}

const slugWords = (url: string): string[] => {
  try {
    return new URL(url).pathname.toLowerCase().split(/[\/\-_.]+/).filter(Boolean);
  } catch {
    return [];
  }
};

// Words nearly every page on a contractor's site carries — matching them says nothing about the topic.
const NOISE = new Set(['the', 'a', 'an', 'of', 'for', 'to', 'in', 'and', 'my', 'is', 'what', 'how', 'do', 'does', 'i', 'roof', 'roofing']);

/** Rank site URLs by how many query words appear in their slug; shorter slugs win ties. `extraNoise` words are ignored. */
export function rankUrls(urls: readonly string[], query: string, limit = 8, extraNoise: readonly string[] = []): string[] {
  const noise = new Set([...NOISE, ...extraNoise.map((w) => w.toLowerCase())]);
  const words = query.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1 && !noise.has(w));
  const loose = query.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w === 'roof' || w === 'roofing');
  if (!words.length && !loose.length) return [];
  return Array.from(new Set(urls))
    .map((u) => {
      const slug = slugWords(u);
      const hits = words.filter((w) => slug.some((s) => s === w || (w.length > 3 && s.startsWith(w.slice(0, -1))))).length;
      return { u, hits, len: slug.length };
    })
    .filter((x) => x.hits > 0)
    .sort((a, b) => b.hits - a.hits || a.len - b.len)
    .slice(0, limit)
    .map((x) => x.u);
}

async function fetchSite(site: CompanySite, url: string, accept: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    let current = url;
    for (let hop = 0; ; hop++) {
      const target = toSiteUrl(current, site);
      // A redirect off the company's own site is refused, not read.
      if (!target) throw new Error(`Redirected off ${site.origin.replace(/^https:\/\//, '')}`);
      await assertPublicHost(new URL(target).hostname);
      const res = await fetch(target, {
        signal: controller.signal,
        redirect: 'manual',
        headers: { Accept: accept, 'User-Agent': 'Archie-Advisor/1.0' },
      });
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        if (hop >= MAX_REDIRECTS) throw new Error('Too many redirects');
        current = new URL(res.headers.get('location')!, target).toString();
        continue;
      }
      if (!res.ok) throw new Error(`${site.origin.replace(/^https:\/\//, '')} returned ${res.status}`);
      const len = Number(res.headers.get('content-length') || 0);
      if (len > MAX_BYTES) throw new Error('Page too large');
      const body = await res.text();
      return body.length > MAX_BYTES ? body.slice(0, MAX_BYTES) : body;
    }
  } finally {
    clearTimeout(timer);
  }
}

interface Cached<T> { at: number; value: T }
const pageCache = new Map<string, Cached<PageText>>();
/** Per site origin: every company has its own sitemap. */
const sitemapCache = new Map<string, Cached<string[]>>();

/** Clear caches — tests only. */
export function resetWebsiteCache(): void {
  pageCache.clear();
  sitemapCache.clear();
}

/** All page URLs on the site, from the sitemap index and its sub-sitemaps. Cached for 12 hours. */
export async function siteUrls(site: CompanySite): Promise<string[]> {
  const hit = sitemapCache.get(site.origin);
  if (hit && Date.now() - hit.at < SITEMAP_TTL_MS) return hit.value;
  const index = parseSitemap(await fetchSite(site, `${site.origin}/sitemap.xml`, 'application/xml,text/xml'));
  const isIndex = index.some((u) => /\/sitemaps?\//i.test(u) || /sitemap.*\.xml$/i.test(u));
  let urls = index;
  if (isIndex) {
    const subs = index.filter((u) => toSiteUrl(u, site) && !SKIP_SITEMAP.test(u)).slice(0, MAX_SUB_SITEMAPS);
    const settled = await Promise.allSettled(subs.map((u) => fetchSite(site, toSiteUrl(u, site)!, 'application/xml,text/xml')));
    urls = settled.flatMap((s) => (s.status === 'fulfilled' ? parseSitemap(s.value) : []));
  }
  const pages = Array.from(new Set(urls.map((u) => toSiteUrl(u, site)).filter((u): u is string => !!u)));
  sitemapCache.set(site.origin, { at: Date.now(), value: pages });
  return pages;
}

export async function readSitePage(input: unknown, site: CompanySite | null = companyWebsite()): Promise<PageText & { url: string; truncated: boolean }> {
  if (!site) throw new Error('No company website is set in the company profile.');
  const url = toSiteUrl(input, site);
  if (!url) throw new Error(`Only pages on ${site.origin.replace(/^https:\/\//, '')} can be read.`);
  const hit = pageCache.get(url);
  const fresh = !!hit && Date.now() - hit.at < PAGE_TTL_MS;
  const page = fresh ? hit!.value : htmlToText(await fetchSite(site, url, 'text/html'));
  if (!fresh) pageCache.set(url, { at: Date.now(), value: page });
  const truncated = page.text.length > PAGE_TEXT_LIMIT;
  return { url, ...page, text: truncated ? `${page.text.slice(0, PAGE_TEXT_LIMIT)}…` : page.text, truncated };
}

const errorOf = (e: unknown) => ({ error: e instanceof Error ? e.message : 'Website lookup failed' });

export function searchWebsiteTool(): Tool {
  return {
    name: 'search_company_website',
    description:
      "Find pages on the company's own website by topic — services, materials, cost guides, warranties, financing, FAQs, insurance-claim guides, service-area pages. Returns matching page URLs; then use read_company_website_page to read one. Use this whenever the question is what the company offers, says, or charges publicly.",
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Topic words, e.g. "metal roof cost", "warranty", a town name, "insurance claim denied"' },
      },
      required: ['query'],
    },
    execute: async (p) => {
      try {
        const site = companyWebsite();
        if (!site) return { error: 'No company website is set in the company profile.' };
        const query = String(p.query || '').trim();
        if (!query) return { error: 'A query is required.' };
        const urls = await siteUrls(site);
        // The company's own town and state are on most of its pages too.
        const { city, state } = currentProfile();
        const matches = rankUrls(urls, query, 8, [...city.split(/[^a-z0-9]+/i), state].filter((w) => w.length > 1));
        return matches.length
          ? { matches, totalPages: urls.length }
          : { matches: [], totalPages: urls.length, note: 'No page slug matched. Try a broader word, or read /faq, /about, /services or /reviews.' };
      } catch (e) { return errorOf(e); }
    },
  };
}

export function readWebsiteTool(): Tool {
  return {
    name: 'read_company_website_page',
    description:
      "Read the text of one page on the company's own website (nothing else). Pass a path like \"/about\" or a full URL from search_company_website. Quote the site accurately and give the link when it helps.",
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Path ("/faq") or full URL on the company website' },
      },
      required: ['url'],
    },
    execute: async (p) => {
      try {
        return await readSitePage(p.url);
      } catch (e) { return errorOf(e); }
    },
  };
}
