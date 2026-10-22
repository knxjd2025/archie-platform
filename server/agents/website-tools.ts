/**
 * The BRN Advisor reading bestroofingnow.com live — services, costs guides,
 * warranties, FAQs, neighborhood pages — so what it tells the team matches
 * what the company tells the public, even after the site changes.
 *
 * Locked to the company's own domain: the advisor passes a path or URL, and
 * anything that doesn't resolve to bestroofingnow.com is refused before a
 * request is made, and again after redirects. That keeps this from becoming a
 * way to make the server fetch arbitrary addresses.
 */
import type { Tool } from './base-agent';

export const SITE_ORIGIN = 'https://www.bestroofingnow.com';
const SITEMAP_INDEX = `${SITE_ORIGIN}/sitemap.xml`;
const ALLOWED_HOSTS = new Set(['bestroofingnow.com', 'www.bestroofingnow.com']);
const FETCH_TIMEOUT_MS = 10_000;
const MAX_BYTES = 2_000_000;
const PAGE_TEXT_LIMIT = 8_000;
const PAGE_TTL_MS = 60 * 60 * 1000;
const SITEMAP_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_SUB_SITEMAPS = 20;
// Image/video sitemaps list media, not pages worth reading.
const SKIP_SITEMAP = /\/(images|videos)(\.xml)?$/i;

/** A path or URL → an absolute URL on the company site, or null if it points anywhere else. */
export function toSiteUrl(input: unknown): string | null {
  if (typeof input !== 'string' || !input.trim()) return null;
  const raw = input.trim();
  let url: URL;
  try {
    url = /^https?:\/\//i.test(raw)
      ? new URL(raw)
      : /^(www\.)?bestroofingnow\.com(\/|$)/i.test(raw)
        ? new URL(`https://${raw}`)
        : new URL(raw.startsWith('/') ? raw : `/${raw}`, SITE_ORIGIN);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (!ALLOWED_HOSTS.has(url.hostname.toLowerCase())) return null;
  if (url.port || url.username || url.password) return null;
  return `${SITE_ORIGIN}${url.pathname}${url.search}`;
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

// Words every Charlotte page carries — matching them says nothing about the topic.
const NOISE = new Set(['charlotte', 'nc', 'sc', 'the', 'a', 'an', 'of', 'for', 'to', 'in', 'and', 'my', 'is', 'what', 'how', 'do', 'does', 'i', 'roof', 'roofing']);

/** Rank site URLs by how many query words appear in their slug; shorter slugs win ties. */
export function rankUrls(urls: readonly string[], query: string, limit = 8): string[] {
  const words = query.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1 && !NOISE.has(w));
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

async function fetchSite(url: string, accept: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { Accept: accept, 'User-Agent': 'BRN-Team-App/1.0 (+https://www.bestroofingnow.com)' },
    });
    // A redirect off the company's own domain is refused, not read.
    if (!toSiteUrl(res.url || url)) throw new Error('Redirected off bestroofingnow.com');
    if (!res.ok) throw new Error(`bestroofingnow.com returned ${res.status}`);
    const len = Number(res.headers.get('content-length') || 0);
    if (len > MAX_BYTES) throw new Error('Page too large');
    const body = await res.text();
    return body.length > MAX_BYTES ? body.slice(0, MAX_BYTES) : body;
  } finally {
    clearTimeout(timer);
  }
}

interface Cached<T> { at: number; value: T }
const pageCache = new Map<string, Cached<PageText>>();
let sitemapCache: Cached<string[]> | null = null;

/** Clear caches — tests only. */
export function resetWebsiteCache(): void {
  pageCache.clear();
  sitemapCache = null;
}

/** All page URLs on the site, from the sitemap index and its sub-sitemaps. Cached for 12 hours. */
export async function siteUrls(): Promise<string[]> {
  if (sitemapCache && Date.now() - sitemapCache.at < SITEMAP_TTL_MS) return sitemapCache.value;
  const index = parseSitemap(await fetchSite(SITEMAP_INDEX, 'application/xml,text/xml'));
  const isIndex = index.some((u) => /\/sitemaps?\//i.test(u) || /sitemap.*\.xml$/i.test(u));
  let urls = index;
  if (isIndex) {
    const subs = index.filter((u) => toSiteUrl(u) && !SKIP_SITEMAP.test(u)).slice(0, MAX_SUB_SITEMAPS);
    const settled = await Promise.allSettled(subs.map((u) => fetchSite(toSiteUrl(u)!, 'application/xml,text/xml')));
    urls = settled.flatMap((s) => (s.status === 'fulfilled' ? parseSitemap(s.value) : []));
  }
  const pages = Array.from(new Set(urls.map((u) => toSiteUrl(u)).filter((u): u is string => !!u)));
  sitemapCache = { at: Date.now(), value: pages };
  return pages;
}

export async function readSitePage(input: unknown): Promise<PageText & { url: string; truncated: boolean }> {
  const url = toSiteUrl(input);
  if (!url) throw new Error('Only pages on bestroofingnow.com can be read.');
  const hit = pageCache.get(url);
  const fresh = !!hit && Date.now() - hit.at < PAGE_TTL_MS;
  const page = fresh ? hit!.value : htmlToText(await fetchSite(url, 'text/html'));
  if (!fresh) pageCache.set(url, { at: Date.now(), value: page });
  const truncated = page.text.length > PAGE_TEXT_LIMIT;
  return { url, ...page, text: truncated ? `${page.text.slice(0, PAGE_TEXT_LIMIT)}…` : page.text, truncated };
}

const errorOf = (e: unknown) => ({ error: e instanceof Error ? e.message : 'Website lookup failed' });

export function searchWebsiteTool(): Tool {
  return {
    name: 'search_bestroofingnow',
    description:
      "Find pages on the company website, bestroofingnow.com, by topic — services, materials, cost guides, warranties, financing, FAQs, insurance-claim guides, service-area and neighborhood pages. Returns matching page URLs; then use read_bestroofingnow_page to read one. Use this whenever the question is what Best Roofing Now offers, says, or charges publicly.",
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Topic words, e.g. "metal roof cost", "warranty", "Mooresville", "insurance claim denied"' },
      },
      required: ['query'],
    },
    execute: async (p) => {
      try {
        const query = String(p.query || '').trim();
        if (!query) return { error: 'A query is required.' };
        const urls = await siteUrls();
        const matches = rankUrls(urls, query);
        return matches.length
          ? { matches, totalPages: urls.length }
          : { matches: [], totalPages: urls.length, note: 'No page slug matched. Try a broader word, or read /faq, /about, /services or /reviews.' };
      } catch (e) { return errorOf(e); }
    },
  };
}

export function readWebsiteTool(): Tool {
  return {
    name: 'read_bestroofingnow_page',
    description:
      "Read the text of one page on bestroofingnow.com (the company's own site — nothing else). Pass a path like \"/about\" or a full bestroofingnow.com URL from search_bestroofingnow. Quote the site accurately and give the link when it helps.",
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Path ("/faq") or full bestroofingnow.com URL' },
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
