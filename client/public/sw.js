// Minimal, deploy-safe service worker for installability + offline shell.
// - API calls and customer links (/r/*) are NEVER cached.
// - Navigations are network-first (always fresh HTML; cached shell only offline).
// - Hashed static assets under /assets/ are cache-first (Vite filenames are
//   immutable per build). Everything else is network-first, cache only offline.
//
// The cache used to be a constant 'brn-v1' with cache-first for every non-API
// GET, so files without a hash in their name (/sales-journey/*, /logo.jpg, the
// manifest) were frozen at whatever the first visit saw, across every deploy.
// BUILD_ID is stamped in by vite.config.ts at build time, so each deploy gets a
// fresh cache and the old ones are dropped on activate.
const BUILD_ID = '__BUILD_ID__';
const CACHE_PREFIX = 'brn-';
const CACHE = CACHE_PREFIX + BUILD_ID;

// Never answered from, or written to, the cache. /r/* is customer data —
// reports, signing pages, frozen contracts — and must not sit in Cache Storage
// on whatever device opened it.
const NEVER_CACHE_PREFIXES = ['/api/', '/r/'];
// Standalone static pages served next to the app. They are not the app shell,
// so they must never be stored as '/', but they may be kept under their own URL.
const STATIC_PAGE_PREFIXES = ['/sales-journey/', '/commercial-training/', '/roof-systems/'];

function hasPrefix(pathname, prefixes) {
  return prefixes.some((p) => pathname === p.slice(0, -1) || pathname.startsWith(p));
}

/** Requests the worker must leave entirely to the network. */
function isNeverCached(pathname) {
  return hasPrefix(pathname, NEVER_CACHE_PREFIXES);
}

function isStaticPage(pathname) {
  return hasPrefix(pathname, STATIC_PAGE_PREFIXES);
}

function isHashedAsset(pathname) {
  return pathname.startsWith('/assets/');
}

/**
 * May this navigation response be stored as the app shell ('/')?
 *
 * Every navigation used to overwrite '/', so a signing page, a frozen contract,
 * a training page, or a 404/500 page became "the app" the next time the device
 * was offline — and customer data sat in Cache Storage. Only a successful HTML
 * answer for an app route, in a top-level window, qualifies.
 */
function isShellResponse(request, response) {
  if (!response || !response.ok) return false;
  if (request.destination === 'iframe') return false;
  const type = (response.headers && response.headers.get('content-type')) || '';
  if (!type.includes('text/html')) return false;
  const paths = [new URL(request.url).pathname];
  // A redirect may have landed somewhere other than where the request was going.
  if (response.url) paths.push(new URL(response.url).pathname);
  return paths.every((p) => !isNeverCached(p) && !isStaticPage(p));
}

/** May this non-shell response be kept under its own URL for offline use? */
function isCacheableResponse(response) {
  return !!response && response.ok && response.type === 'basic';
}

// The pre-versioning cache. Its '/' may be a signing page or a contract (see
// isShellResponse), so it is never kept as "the previous build".
const LEGACY_CACHES = ['brn-v1'];

/**
 * Every cache except this build's and the newest one before it. `keys` is in
 * creation order, as CacheStorage.keys() returns it.
 */
function cachesToDelete(keys) {
  const previous = keys.filter((k) => k.startsWith(CACHE_PREFIX) && k !== CACHE && !LEGACY_CACHES.includes(k));
  const keepPrevious = previous[previous.length - 1];
  return keys.filter((k) => k !== CACHE && k !== keepPrevious);
}

/** The current build's copy first, then the previous build's. */
async function matchNewest(key) {
  const current = await caches.open(CACHE);
  return (await current.match(key)) || (await caches.match(key));
}

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Keep the current cache and the one build before it. A tab opened before
      // this deploy still lazy-loads its own hashed chunks, which the new
      // deployment no longer serves; one generation back covers it without the
      // cache growing every deploy. keys() lists caches in creation order.
      const keys = await caches.keys();
      await Promise.all(cachesToDelete(keys).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

async function networkFirst(req, cacheKey, shouldStore) {
  try {
    const net = await fetch(req);
    if (shouldStore(net)) {
      const cache = await caches.open(CACHE);
      await cache.put(cacheKey, net.clone());
    }
    return net;
  } catch (err) {
    const hit = await matchNewest(cacheKey);
    if (hit) return hit;
    throw err;
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (isNeverCached(url.pathname)) return;

  if (req.mode === 'navigate') {
    // A framed page (the report preview) is not the app; leave it to the network.
    if (req.destination === 'iframe') return;
    if (isStaticPage(url.pathname)) {
      event.respondWith(networkFirst(req, req, isCacheableResponse));
      return;
    }
    event.respondWith(
      networkFirst(req, '/', (net) => isShellResponse(req, net)).catch(() => Response.error()),
    );
    return;
  }

  if (isHashedAsset(url.pathname)) {
    event.respondWith(
      (async () => {
        const hit = await caches.match(req);
        if (hit) return hit;
        const net = await fetch(req);
        if (isCacheableResponse(net)) {
          const cache = await caches.open(CACHE);
          await cache.put(req, net.clone());
        }
        return net;
      })(),
    );
    return;
  }

  event.respondWith(networkFirst(req, req, isCacheableResponse));
});
