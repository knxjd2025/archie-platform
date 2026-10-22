import { describe, it, expect, vi, afterEach } from 'vitest';
import { RoofLinkClient } from '../rooflink';

const page = (results: any[], next_page: number | null, count: number): any => ({
  ok: true, status: 200,
  headers: new Headers(),
  json: async () => ({ count, next: next_page ? 'x' : null, previous: null, next_page, results }),
  text: async () => '',
});

afterEach(() => vi.unstubAllGlobals());

describe('RoofLinkClient', () => {
  it('sends the key in X-API-KEY and walks every page, in order, a few pages at a time', async () => {
    const calls: number[] = [];
    let inFlight = 0, peak = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: URL, init: any) => {
      expect(init.headers['X-API-KEY']).toBe('k');
      const p = Number(url.searchParams.get('page'));
      calls.push(p);
      inFlight++; peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      // 5 pages of 2 → count 10
      return page([{ id: p * 2 - 1 }, { id: p * 2 }], p < 5 ? p + 1 : null, 10);
    }));
    const r = await new RoofLinkClient('k').listAllJobs({ concurrency: 3 });
    expect(r.jobs.map((j) => j.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]); // page order kept
    expect(r.total).toBe(10);
    expect(r.truncated).toBe(false);
    expect(calls.sort()).toEqual([1, 2, 3, 4, 5]); // each page exactly once
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(3);
  });
  it('reports truncation when the page cap is hit', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: URL) => { const p = Number(url.searchParams.get('page')); return page([{ id: p }], p + 1, 999); }));
    const r = await new RoofLinkClient('k').listAllJobs({ maxPages: 2 });
    expect(r.jobs.map((j) => j.id)).toEqual([1, 2]);
    expect(r.truncated).toBe(true);
  });
  it('retries once after a 429 and surfaces other errors with the status', async () => {
    let n = 0;
    vi.stubGlobal('fetch', vi.fn(async (): Promise<any> => (++n === 1
      ? { ok: false, status: 429, headers: new Headers({ 'retry-after': '0' }), text: async () => 'slow down' }
      : page([], null, 0))));
    expect((await new RoofLinkClient('k').listJobs()).count).toBe(0);
    expect(n).toBe(2);

    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401, headers: new Headers(), text: async () => 'bad key' })));
    await expect(new RoofLinkClient('k').listJobs()).rejects.toThrow('RoofLink 401');
    expect(await new RoofLinkClient('k').healthCheck()).toMatchObject({ ok: false });
    expect(await new RoofLinkClient('').healthCheck()).toEqual({ ok: false, error: 'ROOFLINK_API_KEY is not set' });
  });
});
