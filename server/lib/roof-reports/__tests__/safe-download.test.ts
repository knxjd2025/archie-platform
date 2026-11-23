import { describe, it, expect, vi, afterEach } from 'vitest';
import { downloadPublicMedia, isPublicAddress } from '../safe-download';

afterEach(() => vi.unstubAllGlobals());

describe('safe-download', () => {
  it('treats private, loopback and metadata addresses as not public, and a public one as public', () => {
    for (const ip of ['10.0.0.1', '127.0.0.1', '169.254.169.254', '192.168.1.5', '172.16.0.9', '::1', 'fe80::1', 'not an ip']) {
      expect(isPublicAddress(ip), ip).toBe(false);
    }
    expect(isPublicAddress('93.184.216.34')).toBe(true);
  });

  it('refuses an address that is private or not https before any connection is made', async () => {
    vi.stubGlobal('fetch', vi.fn(() => { throw new Error('no network in tests'); }));
    await expect(downloadPublicMedia('https://127.0.0.1/a.jpg', { maxBytes: 1000 })).rejects.toThrow();
    await expect(downloadPublicMedia('http://example.com/a.jpg', { maxBytes: 1000 })).rejects.toThrow();
    await expect(downloadPublicMedia('https://10.1.2.3/a.jpg', { maxBytes: 1000 })).rejects.toThrow();
  });
});
