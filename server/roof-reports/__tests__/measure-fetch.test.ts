/**
 * The real way the satellite picture is fetched: only for the one map address, only through the pinned
 * safe download (which resolves once, refuses private addresses, follows no redirect and bounds the size).
 * The safe download itself is replaced by a recorder here, so nothing reaches a network.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const KEY = 'AIzaSy-ZZ-MAP-KEY-DO-NOT-LEAK-123456';
const { download } = vi.hoisted(() => ({ download: vi.fn(async (..._args: unknown[]) => ({ bytes: Buffer.from('ZZ-PICTURE'), contentType: 'image/jpeg' })) }));
vi.mock('../../lib/roof-reports/safe-download.js', () => ({ downloadPublicMedia: download }));

import { defaultFetchImage } from '../measure';
import { staticMapUrl } from '../satellite-answer';

describe('the real picture fetch', () => {
  beforeEach(() => { download.mockClear(); });

  it('goes through the pinned safe download, once, with a size limit and the time that is left', async () => {
    const url = staticMapUrl(42.5349, -92.4453, KEY);
    const got = await defaultFetchImage(url, { timeoutMs: 4321 });
    expect(got).toEqual({ bytes: Buffer.from('ZZ-PICTURE'), contentType: 'image/jpeg' });
    expect(download).toHaveBeenCalledTimes(1);
    expect(download).toHaveBeenCalledWith(url, { maxBytes: 5 * 1024 * 1024, timeoutMs: 4321 });
  });

  it('refuses any other host before it reaches the download, and its refusal never carries the address or the key', async () => {
    for (const bad of [`https://evil.example/maps/api/staticmap?key=${KEY}`, `http://maps.googleapis.com/maps/api/staticmap?key=${KEY}`, `https://maps.googleapis.com.evil.example/maps/api/staticmap?key=${KEY}`, `https://maps.googleapis.com/maps/api/geocode/json?key=${KEY}`, `https://127.0.0.1/maps/api/staticmap?key=${KEY}`]) {
      const failure = await defaultFetchImage(bad, { timeoutMs: 1000 }).then(() => null, (e: Error) => e);
      expect(failure, bad).not.toBeNull();
      expect(`${failure!.name} ${failure!.message}`, bad).not.toMatch(/AIza|evil|127\.0|key=/);
    }
    expect(download).not.toHaveBeenCalled();
  });
});
