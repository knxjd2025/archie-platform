import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchWithTimeout } from '../fetch-timeout';
import { classifyUpstream } from '../upstream';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

/** A fetch that never answers until it is aborted. */
const hangingFetch = () =>
  vi.fn((_url: any, init: any) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('This operation was aborted'), { name: 'AbortError' })));
  }));

describe('fetchWithTimeout', () => {
  it('gives up on a provider that never answers', async () => {
    globalThis.fetch = hangingFetch() as any;
    const err = await fetchWithTimeout('https://services.leadconnectorhq.com/contacts', {}, 20).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toMatch(/services\.leadconnectorhq\.com timeout after 20ms/);
    // …and the route layer reads it as "couldn't reach", not a 500.
    expect(classifyUpstream(err, 'GoHighLevel').kind).toBe('upstream-down');
  });

  it('passes a normal response straight through', async () => {
    globalThis.fetch = vi.fn(async () => new Response('ok', { status: 200 })) as any;
    const r = await fetchWithTimeout('https://example.com', { method: 'POST' }, 1000);
    expect(await r.text()).toBe('ok');
    expect((globalThis.fetch as any).mock.calls[0][1]).toMatchObject({ method: 'POST', signal: expect.any(AbortSignal) });
  });

  it("still honours the caller's own abort", async () => {
    globalThis.fetch = hangingFetch() as any;
    const outer = new AbortController();
    const p = fetchWithTimeout('https://example.com', { signal: outer.signal }, 10_000).catch((e) => e);
    outer.abort();
    const err = await p;
    expect(err.name).toBe('AbortError');
  });
});
