/**
 * The paid Google geocoding call tells its caller that it was made, so the
 * caller can record its cost. The library does not know about the cost table:
 * it only reports each attempt through a hook. Nothing reaches the network.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { geocodeAddress } from '../storm-history-service.js';

const GOOGLE_OK = { results: [{ geometry: { location: { lat: 42.5349, lng: -92.4453 } }, formatted_address: '12 Elm Street, Cedar Falls, IA 50613', address_components: [] }] };
const NOMINATIM_OK = [{ lat: '42.5349', lon: '-92.4453', display_name: '12 Elm Street, Cedar Falls' }];

const respond = (body: unknown, ok = true) => ({ ok, json: async () => body }) as Response;
const hostOf = (input: unknown) => new URL(String(typeof input === 'string' || input instanceof URL ? input : (input as Request).url)).host;

describe('the paid geocoding call is reported when it is made', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('reports one attempt when Google answers', async () => {
    vi.stubGlobal('fetch', vi.fn(async (u: unknown) => (hostOf(u) === 'maps.googleapis.com' ? respond(GOOGLE_OK) : (() => { throw new Error('unexpected host'); })())));
    const calls: number[] = [];
    const found = await geocodeAddress('12 Elm Street', 'Cedar Falls', 'IA', '50613', 'key-123', undefined, () => { calls.push(1); });
    expect(found?.latitude).toBeCloseTo(42.5349);
    expect(calls).toHaveLength(1);
  });

  it('reports the attempt even when Google did not answer well, and the free fallback then places the address', async () => {
    vi.stubGlobal('fetch', vi.fn(async (u: unknown) => (hostOf(u) === 'maps.googleapis.com' ? respond({ status: 'OVER_QUERY_LIMIT' }, false) : respond(NOMINATIM_OK))));
    const calls: number[] = [];
    const found = await geocodeAddress('12 Elm Street', 'Cedar Falls', 'IA', '50613', 'key-123', undefined, () => { calls.push(1); });
    expect(found?.latitude).toBeCloseTo(42.5349);
    expect(calls).toHaveLength(1);
  });

  it('reports the attempt when the request itself failed', async () => {
    vi.stubGlobal('fetch', vi.fn(async (u: unknown) => { if (hostOf(u) === 'maps.googleapis.com') throw new Error('socket hang up'); return respond(NOMINATIM_OK); }));
    const calls: number[] = [];
    await geocodeAddress('12 Elm Street', 'Cedar Falls', 'IA', '50613', 'key-123', undefined, () => { calls.push(1); });
    expect(calls).toHaveLength(1);
  });

  it('reports nothing when there is no Google key, because nothing paid was called', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respond(NOMINATIM_OK)));
    const calls: number[] = [];
    await geocodeAddress('12 Elm Street', 'Cedar Falls', 'IA', '50613', undefined, undefined, () => { calls.push(1); });
    expect(calls).toHaveLength(0);
  });

  it('is not made to fail by a hook that throws', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respond(GOOGLE_OK)));
    const found = await geocodeAddress('12 Elm Street', 'Cedar Falls', 'IA', '50613', 'key-123', undefined, () => { throw new Error('cost table down'); });
    expect(found?.latitude).toBeCloseTo(42.5349);
  });
});
