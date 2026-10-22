/**
 * Server-to-server proxy for bestroofingnow.com's real, live project map data
 * (src/app/api/projects/map/route.ts in the marketing-site codebase) — the
 * exact same data James's team keeps current through that site's own admin
 * backend, so this never drifts into a second, stale copy of "our work."
 *
 * Not fetched directly from the browser: that site sends
 * X-Frame-Options: DENY (blocks an iframe) and has no CORS headers on this
 * endpoint (blocks a cross-origin fetch too). A server-to-server fetch has
 * neither restriction, so the report page instead calls this app's own
 * same-origin /api/projects-map, which fetches upstream here and returns it.
 *
 * Cached briefly in memory: this is public marketing data that changes when
 * a job is completed and photographed, not every minute, and every report a
 * customer opens would otherwise re-hit the marketing site's DB for the same
 * unchanged pins.
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
  slug?: string;
}

const UPSTREAM_URL = 'https://www.bestroofingnow.com/api/projects/map';
const CACHE_MS = 10 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8000;

let cache: { markers: ProjectMapMarker[]; fetchedAt: number } | null = null;

async function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Serves from cache when fresh; on a cold cache or upstream failure with a stale cache available, serves what it has rather than a hard error — a customer looking at a map with slightly-old pins is fine, a broken map chapter is not. */
export async function getProjectMapMarkers(): Promise<{ markers: ProjectMapMarker[]; stale: boolean }> {
  const now = Date.now();
  if (cache && now - cache.fetchedAt < CACHE_MS) {
    return { markers: cache.markers, stale: false };
  }

  try {
    const res = await fetchWithTimeout(UPSTREAM_URL, FETCH_TIMEOUT_MS);
    if (!res.ok) throw new Error(`upstream ${res.status}`);
    const data: any = await res.json();
    const allMarkers: ProjectMapMarker[] = Array.isArray(data?.markers) ? data.markers : [];
    // A pin with no photos has nothing to show a homeowner who taps it — the
    // popup would just read "No photos", which isn't worth a pin on the map.
    const markers = allMarkers.filter((m) => m.hasPhotos);
    cache = { markers, fetchedAt: now };
    return { markers, stale: false };
  } catch (e: any) {
    console.error('[project-map-proxy] upstream fetch failed:', e?.message || e);
    if (cache) return { markers: cache.markers, stale: true };
    return { markers: [], stale: true };
  }
}
