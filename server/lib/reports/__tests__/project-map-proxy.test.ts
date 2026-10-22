import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The module caches in a module-level variable, so each test gets a fresh
// module instance via vi.resetModules() — otherwise the cache from one test
// leaks into the next and the "does it actually fetch" assertions lie.
async function freshModule() {
  vi.resetModules();
  return import('../project-map-proxy');
}

describe('project-map-proxy', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches the real bestroofingnow.com endpoint and returns its markers', async () => {
    const markers = [{ id: '1', lat: 35.2, lng: -80.8, city: 'Charlotte', state: 'NC', product: null, photoCount: 3, hasPhotos: true, completedDate: null }];
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ markers }) });
    vi.stubGlobal('fetch', fetchMock);

    const { getProjectMapMarkers } = await freshModule();
    const result = await getProjectMapMarkers();

    expect(fetchMock).toHaveBeenCalledWith('https://www.bestroofingnow.com/api/projects/map', expect.any(Object));
    expect(result.stale).toBe(false);
    expect(result.markers).toEqual(markers);
  });

  it('serves from cache on a second call within the cache window instead of re-fetching', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ markers: [] }) });
    vi.stubGlobal('fetch', fetchMock);

    const { getProjectMapMarkers } = await freshModule();
    await getProjectMapMarkers();
    await getProjectMapMarkers();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('degrades to an empty list, not a thrown error, when the upstream fetch fails and there is no cache yet', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));

    const { getProjectMapMarkers } = await freshModule();
    const result = await getProjectMapMarkers();

    expect(result.stale).toBe(true);
    expect(result.markers).toEqual([]);
  });

  it('serves the last-good cache rather than an empty list when a later fetch fails', async () => {
    const markers = [{ id: '1', lat: 35.2, lng: -80.8, city: 'Charlotte', state: 'NC', product: null, photoCount: 3, hasPhotos: true, completedDate: null }];
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ markers }) })
      .mockRejectedValueOnce(new Error('network down'));
    vi.stubGlobal('fetch', fetchMock);

    const { getProjectMapMarkers } = await freshModule();
    await getProjectMapMarkers();

    vi.useFakeTimers();
    vi.advanceTimersByTime(11 * 60 * 1000); // past the 10-minute cache window
    const second = await getProjectMapMarkers();
    vi.useRealTimers();

    expect(second.stale).toBe(true);
    expect(second.markers).toEqual(markers);
  });

  it('treats a non-2xx upstream response as a failure, not a success with garbage markers', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 502, json: async () => ({}) }));

    const { getProjectMapMarkers } = await freshModule();
    const result = await getProjectMapMarkers();

    expect(result.stale).toBe(true);
    expect(result.markers).toEqual([]);
  });
});
