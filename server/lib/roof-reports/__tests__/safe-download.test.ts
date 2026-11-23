/**
 * Photo downloads for a report must reach a public address and nowhere else.
 *
 * Nothing in this file touches the network: the name lookup and both socket
 * modules are replaced before the code under test is loaded, so a test that
 * forgot to set up an answer fails loudly instead of quietly asking real DNS.
 */
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { Readable } from 'node:stream';
import { EventEmitter } from 'node:events';

const network = vi.hoisted(() => ({ lookup: vi.fn(), request: vi.fn() }));
vi.mock('node:dns/promises', () => ({ lookup: network.lookup }));
vi.mock('node:https', () => ({ request: network.request }));
vi.mock('node:http', () => ({ request: network.request }));

import { downloadPublicMedia, downloadReportImage, isPublicAddress } from '../safe-download';

function respond(chunks: Buffer[], headers: Record<string, string> = {}, statusCode = 200): void {
  network.request.mockImplementation((_url: unknown, _options: unknown, done: (r: unknown) => void) => {
    const req = new EventEmitter() as EventEmitter & { end: () => void };
    req.end = () => {
      const response = Readable.from(chunks) as Readable & { headers: Record<string, string>; statusCode: number };
      response.headers = headers;
      response.statusCode = statusCode;
      done(response);
    };
    return req;
  });
}

beforeEach(() => {
  // Default: a public answer. A test that wants something else says so.
  network.lookup.mockReset().mockResolvedValue([{ address: '8.8.8.8', family: 4 }]);
  network.request.mockReset();
  respond([Buffer.from('image')], { 'content-type': 'image/png' });
});
afterEach(() => vi.useRealTimers());

/** Every address that must never be fetched, with what it is. */
const NEVER_PUBLIC: Array<[string, string]> = [
  ['127.0.0.1', 'loopback'],
  ['10.0.0.1', 'private'],
  ['172.16.0.9', 'private'],
  ['192.168.1.5', 'private'],
  ['169.254.169.254', 'cloud metadata'],
  ['100.64.0.1', 'carrier grade NAT'],
  ['192.0.0.1', 'IETF protocol assignments'],
  ['192.0.2.1', 'documentation'],
  ['198.18.0.1', 'benchmarking'],
  ['198.19.255.255', 'benchmarking'],
  ['0.0.0.0', 'unspecified'],
  ['255.255.255.255', 'broadcast'],
  ['224.0.0.1', 'multicast'],
  ['::', 'unspecified'],
  ['::1', 'loopback'],
  ['::ffff:127.0.0.1', 'mapped loopback'],
  ['::ffff:7f00:1', 'mapped loopback, hex'],
  ['::ffff:169.254.169.254', 'mapped metadata'],
  ['::ffff:0:7f00:1', 'translated loopback'],
  ['::7f00:1', 'deprecated IPv4-compatible loopback'],
  ['::a9fe:a9fe', 'deprecated IPv4-compatible metadata'],
  ['64:ff9b::a9fe:a9fe', 'NAT64 to the metadata address'],
  ['64:ff9b::7f00:1', 'NAT64 to loopback'],
  ['64:ff9b:1::1', 'local-use NAT64'],
  ['2002:a9fe:a9fe::1', '6to4 of the metadata address'],
  ['2002:7f00:1::1', '6to4 of loopback'],
  ['fc00::1', 'unique local'],
  ['fd12:3456::1', 'unique local'],
  ['fe80::1', 'link local'],
  ['fec0::1', 'site local'],
  ['ff02::1', 'multicast'],
  ['100::1', 'discard-only'],
  ['2001:db8::1', 'documentation'],
  ['2001::1', 'Teredo'],
  ['not an ip', 'not an address'],
  ['', 'empty'],
];

describe('isPublicAddress', () => {
  it.each(NEVER_PUBLIC)('refuses %s (%s)', (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });

  it('accepts ordinary public addresses, including a public one in mapped form', () => {
    for (const ip of ['8.8.8.8', '93.184.216.34', '2606:2800:220:1:248:1893:25c8:1946', '2001:4860:4860::8888', '::ffff:8.8.8.8']) {
      expect(isPublicAddress(ip), ip).toBe(true);
    }
  });
});

describe('DNS-pinned report downloads', () => {
  it.each(NEVER_PUBLIC.filter(([a]) => a && a !== 'not an ip'))(
    'refuses a name that resolves to %s (%s) before connecting',
    async (address) => {
      const family = address.includes(':') ? 6 : 4;
      network.lookup.mockResolvedValue([{ address, family }]);
      await expect(downloadPublicMedia('https://uploads.example.com/photo', { maxBytes: 10 })).rejects.toThrow('Unsafe URL');
      expect(network.request).not.toHaveBeenCalled();
    },
  );

  it('refuses mixed public and private DNS answers, whichever comes first', async () => {
    for (const answers of [
      [{ address: '8.8.8.8', family: 4 }, { address: '10.0.0.1', family: 4 }],
      [{ address: '10.0.0.1', family: 4 }, { address: '8.8.8.8', family: 4 }],
      [{ address: '8.8.8.8', family: 4 }, { address: '64:ff9b::a9fe:a9fe', family: 6 }],
      [{ address: '2001:4860:4860::8888', family: 6 }, { address: 'fec0::1', family: 6 }],
    ]) {
      network.lookup.mockResolvedValue(answers);
      await expect(downloadPublicMedia('https://uploads.example.com/photo', { maxBytes: 10 })).rejects.toThrow('Unsafe URL');
    }
    expect(network.request).not.toHaveBeenCalled();
  });

  it('refuses an empty DNS answer', async () => {
    network.lookup.mockResolvedValue([]);
    await expect(downloadPublicMedia('https://uploads.example.com/photo', { maxBytes: 10 })).rejects.toThrow('Unsafe URL');
    expect(network.request).not.toHaveBeenCalled();
  });

  it.each([
    'https://127.0.0.1/a.jpg',
    'https://10.1.2.3/a.jpg',
    'https://169.254.169.254/latest/meta-data',
    'https://2130706433/a.jpg', // decimal for 127.0.0.1
    'https://0x7f000001/a.jpg', // hex
    'https://0177.0.0.1/a.jpg', // octal
    'https://0x7f.0.0.1/a.jpg',
    'https://[::1]/a.jpg',
    'https://[::ffff:7f00:1]/a.jpg',
    'https://[::7f00:1]/a.jpg',
    'https://[::ffff:0:7f00:1]/a.jpg',
    'https://[64:ff9b::a9fe:a9fe]/a.jpg',
    'https://[2002:a9fe:a9fe::1]/a.jpg',
    'https://[fec0::1]/a.jpg',
    'https://198.18.0.1/a.jpg',
    'https://192.0.0.1/a.jpg',
    'ftp://uploads.example.com/a.jpg',
    'file:///etc/passwd',
  ])('refuses the address in the link itself: %s', async (url) => {
    await expect(downloadPublicMedia(url, { maxBytes: 10 })).rejects.toThrow();
    expect(network.lookup).not.toHaveBeenCalled();
    expect(network.request).not.toHaveBeenCalled();
  });

  it('pins the connection to the vetted address while preserving the original TLS hostname', async () => {
    await expect(downloadReportImage('https://uploads.example.com/photo')).resolves.toBe('data:image/png;base64,aW1hZ2U=');
    const [url, options] = network.request.mock.calls[0];
    expect(url.hostname).toBe('uploads.example.com');
    expect(options.agent).toBe(false);
    const cb = vi.fn();
    options.lookup('uploads.example.com', {}, cb);
    expect(cb).toHaveBeenCalledWith(null, '8.8.8.8', 4);
    // a second, different answer from the system resolver can never be used
    network.lookup.mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);
    const cb2 = vi.fn();
    options.lookup('uploads.example.com', {}, cb2);
    expect(cb2).toHaveBeenCalledWith(null, '8.8.8.8', 4);
    expect(network.lookup).toHaveBeenCalledOnce();
  });

  it('pins the answer for the all-addresses form of the lookup too', async () => {
    await downloadReportImage('https://uploads.example.com/photo');
    const options = network.request.mock.calls[0][1];
    const cb = vi.fn();
    options.lookup('uploads.example.com', { all: true }, cb);
    expect(cb).toHaveBeenCalledWith(null, [{ address: '8.8.8.8', family: 4 }]);
  });

  it('rejects redirects without connecting to the redirect target', async () => {
    respond([], { location: 'http://127.0.0.1' }, 302);
    await expect(downloadPublicMedia('https://uploads.example.com/photo', { maxBytes: 10 })).rejects.toThrow('redirected');
    expect(network.request).toHaveBeenCalledOnce();
  });

  it('enforces both the advertised size and the streamed size', async () => {
    respond([Buffer.from('ok')], { 'content-length': '100' });
    await expect(downloadPublicMedia('https://uploads.example.com/photo', { maxBytes: 10 })).rejects.toThrow('size limit');
    respond([Buffer.alloc(6), Buffer.alloc(6)]);
    await expect(downloadPublicMedia('https://uploads.example.com/photo', { maxBytes: 10 })).rejects.toThrow('size limit');
  });

  it('refuses an empty response', async () => {
    respond([]);
    await expect(downloadPublicMedia('https://uploads.example.com/photo', { maxBytes: 10 })).rejects.toThrow('empty');
  });

  it('limits DNS wait time', async () => {
    vi.useFakeTimers();
    network.lookup.mockReturnValue(new Promise(() => {}));
    const result = expect(downloadPublicMedia('https://uploads.example.com/photo', { maxBytes: 10, timeoutMs: 50 })).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(51);
    await result;
    expect(network.request).not.toHaveBeenCalled();
  });

  it('rejects active image formats and accepts only the four plain ones', async () => {
    respond([Buffer.from('<svg/>')], { 'content-type': 'image/svg+xml' });
    await expect(downloadReportImage('https://uploads.example.com/photo')).rejects.toThrow('Unsupported');
    respond([Buffer.from('x')], { 'content-type': 'text/html' });
    await expect(downloadReportImage('https://uploads.example.com/photo')).rejects.toThrow('Unsupported');
    for (const type of ['image/jpeg', 'image/png', 'image/webp', 'image/gif']) {
      respond([Buffer.from('x')], { 'content-type': type });
      await expect(downloadReportImage('https://uploads.example.com/photo')).resolves.toContain(`data:${type};base64,`);
    }
  });

  it('never uses the real network: every test above ran against the mocks', () => {
    expect(vi.isMockFunction(network.lookup)).toBe(true);
    expect(vi.isMockFunction(network.request)).toBe(true);
  });
});
