import { describe, it, expect, vi, afterEach } from 'vitest';

// The module caches in a module-level map, so each test gets a fresh module
// instance via vi.resetModules() — otherwise the cache from one test leaks
// into the next and the "does it actually fetch" assertions lie.
async function freshModule() {
  vi.resetModules();
  return import('../project-map-proxy');
}

const FEED = 'https://acme.test/api/projects/map';
const marker = { id: '1', lat: 39.8, lng: -89.6, city: 'Springfield', state: 'IL', product: null, productColor: null, photoCount: 3, hasPhotos: true, completedDate: null };

describe('project-map-proxy', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches the company's own feed and returns its markers", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ markers: [marker] }) });
    vi.stubGlobal('fetch', fetchMock);

    const { getProjectMapMarkers } = await freshModule();
    const result = await getProjectMapMarkers(FEED);

    expect(fetchMock).toHaveBeenCalledWith(FEED, expect.any(Object));
    expect(result.stale).toBe(false);
    expect(result.markers).toEqual([marker]);
  });

  it('has no pins, and fetches nothing, for a company with no feed', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const { getProjectMapMarkers } = await freshModule();
    expect(await getProjectMapMarkers(null)).toEqual({ markers: [], stale: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('serves from cache on a second call within the cache window instead of re-fetching', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ markers: [] }) });
    vi.stubGlobal('fetch', fetchMock);

    const { getProjectMapMarkers } = await freshModule();
    await getProjectMapMarkers(FEED);
    await getProjectMapMarkers(FEED);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps each feed in its own cache', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ markers: [] }) });
    vi.stubGlobal('fetch', fetchMock);

    const { getProjectMapMarkers } = await freshModule();
    await getProjectMapMarkers(FEED);
    await getProjectMapMarkers('https://other.test/map');

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('degrades to an empty list, not a thrown error, when the upstream fetch fails and there is no cache yet', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));

    const { getProjectMapMarkers } = await freshModule();
    const result = await getProjectMapMarkers(FEED);

    expect(result.stale).toBe(true);
    expect(result.markers).toEqual([]);
  });

  it('serves the last-good cache rather than an empty list when a later fetch fails', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ markers: [marker] }) })
      .mockRejectedValueOnce(new Error('network down'));
    vi.stubGlobal('fetch', fetchMock);

    const { getProjectMapMarkers } = await freshModule();
    await getProjectMapMarkers(FEED);

    vi.useFakeTimers();
    vi.advanceTimersByTime(11 * 60 * 1000); // past the 10-minute cache window
    const second = await getProjectMapMarkers(FEED);
    vi.useRealTimers();

    expect(second.stale).toBe(true);
    expect(second.markers).toEqual([marker]);
  });

  it('treats a non-2xx upstream response as a failure, not a success with garbage markers', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 502, json: async () => ({}) }));

    const { getProjectMapMarkers } = await freshModule();
    const result = await getProjectMapMarkers(FEED);

    expect(result.stale).toBe(true);
    expect(result.markers).toEqual([]);
  });
});
