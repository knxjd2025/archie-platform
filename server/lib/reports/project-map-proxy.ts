/**
 * Server-to-server proxy for a company's live project map data (its "Our
 * Work" pins), so a report page never holds a second, stale copy.
 *
 * Not fetched directly from the browser: a company website typically sends
 * X-Frame-Options: DENY and no CORS headers, which block both an iframe and a
 * cross-origin fetch. A server-to-server fetch has neither restriction, so the
 * report page calls this app's own same-origin /api/projects-map instead.
 *
 * The feed URL is per company (project-map-widget.ts projectMapFeedUrl); with
 * none, there are no pins. Cached briefly per feed: this is public marketing
 * data that changes when a job is completed and photographed.
 */

export interface ProjectMapMarker {
  id: string;
  lat: number;
  lng: number;
  city: string;
  state: string;
  product: string | null;
  productColor: string | null;
  photoCount: number;
  hasPhotos: boolean;
  completedDate: string | null;
  thumbnail?: string | null;
  /** The project's own public page, when it has one (https only). */
  url?: string;
}

const CACHE_MS = 10 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8000;

const caches = new Map<string, { markers: ProjectMapMarker[]; fetchedAt: number }>();

async function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Serves from cache when fresh; on a cold cache or upstream failure with a stale cache available, serves what it has rather than a hard error — a customer looking at a map with slightly-old pins is fine, a broken map chapter is not. No feed means no pins. */
export async function getProjectMapMarkers(feedUrl: string | null): Promise<{ markers: ProjectMapMarker[]; stale: boolean }> {
  if (!feedUrl) return { markers: [], stale: false };
  const now = Date.now();
  const cache = caches.get(feedUrl);
  if (cache && now - cache.fetchedAt < CACHE_MS) {
    return { markers: cache.markers, stale: false };
  }

  try {
    const res = await fetchWithTimeout(feedUrl, FETCH_TIMEOUT_MS);
    if (!res.ok) throw new Error(`upstream ${res.status}`);
    const data: any = await res.json();
    const allMarkers: ProjectMapMarker[] = Array.isArray(data?.markers) ? data.markers : [];
    // A pin with no photos has nothing to show a homeowner who taps it — the
    // popup would just read "No photos", which isn't worth a pin on the map.
    const markers = allMarkers.filter((m) => m.hasPhotos);
    caches.set(feedUrl, { markers, fetchedAt: now });
    return { markers, stale: false };
  } catch (e: any) {
    console.error('[project-map-proxy] upstream fetch failed:', e?.message || e);
    if (cache) return { markers: cache.markers, stale: true };
    return { markers: [], stale: true };
  }
}
