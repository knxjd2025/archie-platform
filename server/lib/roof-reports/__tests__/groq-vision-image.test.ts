/**
 * The photo a vision model looks at is fetched with the same pinned, size
 * capped, timed download as report images: one DNS answer, vetted and then
 * connected to, never looked up a second time by a general-purpose fetch.
 * Nothing here reaches the network: DNS, both socket modules and fetch are
 * replaced before the code under test loads.
 */
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { Readable } from 'node:stream';
import { EventEmitter } from 'node:events';

const network = vi.hoisted(() => ({ lookup: vi.fn(), request: vi.fn(), fetch: vi.fn() }));
vi.mock('node:dns/promises', () => ({ lookup: network.lookup }));
vi.mock('node:https', () => ({ request: network.request }));
vi.mock('node:http', () => ({ request: network.request }));

import { analyzeRoofImage } from '../groq-vision';

function serve(chunks: Buffer[], headers: Record<string, string> = { 'content-type': 'image/png' }, statusCode = 200): void {
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

const MODEL_REPLY = {
  choices: [{ message: { content: JSON.stringify({ image_quality: 'good', damages: [], overall_condition: 'good', severity_score: 5, summary: 'fine' }) } }],
};

beforeEach(() => {
  network.lookup.mockReset().mockResolvedValue([{ address: '8.8.8.8', family: 4 }]);
  network.request.mockReset();
  network.fetch.mockReset().mockImplementation(async () => new Response(JSON.stringify(MODEL_REPLY), { status: 200 }));
  vi.stubGlobal('fetch', network.fetch);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  serve([Buffer.from('png-bytes')]);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const modelHosts = (): string[] => network.fetch.mock.calls.map((c) => new URL(String(c[0])).host);

describe('analyzeRoofImage fetches the photo through the pinned download', () => {
  it('looks the name up once, connects to that answer, and never uses fetch for the photo', async () => {
    const result = await analyzeRoofImage('https://uploads.example.com/roof.png', 'groq-test-key');
    expect(result.success).toBe(true);
    expect(network.lookup).toHaveBeenCalledOnce();
    expect(network.request).toHaveBeenCalledOnce();
    const options = network.request.mock.calls[0][1];
    const cb = vi.fn();
    options.lookup('uploads.example.com', {}, cb);
    expect(cb).toHaveBeenCalledWith(null, '8.8.8.8', 4);
    expect(modelHosts()).toEqual(['api.groq.com']); // fetch went to the model and nowhere else
  });

  it('sends the photo to the model as an inline image the download produced', async () => {
    await analyzeRoofImage('https://uploads.example.com/roof.png', 'groq-test-key');
    const body = JSON.parse(String(network.fetch.mock.calls[0][1].body));
    const url = body.messages[1].content[1].image_url.url as string;
    expect(url).toBe(`data:image/png;base64,${Buffer.from('png-bytes').toString('base64')}`);
  });

  it('refuses a name that resolves to a private address, and asks the model nothing', async () => {
    network.lookup.mockResolvedValue([{ address: '169.254.169.254', family: 4 }]);
    const result = await analyzeRoofImage('https://uploads.example.com/roof.png', 'groq-test-key');
    expect(result.success).toBe(false);
    expect(network.request).not.toHaveBeenCalled();
    expect(network.fetch).not.toHaveBeenCalled();
  });

  it('refuses a photo larger than the cap, advertised or streamed, and asks the model nothing', async () => {
    serve([Buffer.from('x')], { 'content-type': 'image/png', 'content-length': String(25 * 1024 * 1024) });
    expect((await analyzeRoofImage('https://uploads.example.com/roof.png', 'k')).success).toBe(false);
    serve([Buffer.alloc(11 * 1024 * 1024), Buffer.alloc(11 * 1024 * 1024)]);
    expect((await analyzeRoofImage('https://uploads.example.com/roof.png', 'k')).success).toBe(false);
    expect(network.fetch).not.toHaveBeenCalled();
  });

  it('refuses a redirect and a photo type that is not a plain image', async () => {
    serve([], { location: 'http://127.0.0.1/' }, 302);
    expect((await analyzeRoofImage('https://uploads.example.com/roof.png', 'k')).success).toBe(false);
    serve([Buffer.from('<svg/>')], { 'content-type': 'image/svg+xml' });
    expect((await analyzeRoofImage('https://uploads.example.com/roof.png', 'k')).success).toBe(false);
    expect(network.fetch).not.toHaveBeenCalled();
  });

  it('times out a photo that never answers', async () => {
    vi.useFakeTimers();
    network.lookup.mockReturnValue(new Promise(() => {}));
    const run = analyzeRoofImage('https://uploads.example.com/roof.png', 'k');
    await vi.advanceTimersByTimeAsync(31_000);
    expect((await run).success).toBe(false);
    expect(network.fetch).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
