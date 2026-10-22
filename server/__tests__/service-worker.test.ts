import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import vm from 'node:vm';

/**
 * client/public/sw.js, run as the browser runs it: a classic script in a
 * worker global, with fake Cache Storage and fetch. It lives here rather than
 * under client/ so it runs with the server suites.
 *
 * What it pins: every navigation used to overwrite the cached app shell, so a
 * signing page, a contract, a training page or a 500 page became "the app"
 * offline and customer data sat in Cache Storage; and a constant cache name with
 * cache-first for everything froze unhashed files across deploys.
 */
const SOURCE = readFileSync(join(__dirname, '../../client/public/sw.js'), 'utf8');
const ORIGIN = 'https://app.bestroofingnow.com';

type FakeResponse = { ok: boolean; status: number; type: string; url: string; headers: Headers; body: string; clone(): FakeResponse };

function response(body: string, init: { status?: number; type?: string; contentType?: string; url?: string } = {}): FakeResponse {
  const status = init.status ?? 200;
  const r: FakeResponse = {
    ok: status >= 200 && status < 300,
    status,
    type: init.type ?? 'basic',
    url: init.url ?? '',
    headers: new Headers({ 'content-type': init.contentType ?? 'text/html; charset=utf-8' }),
    body,
    clone: () => r,
  };
  return r;
}

const keyOf = (k: string | { url: string }) => new URL(typeof k === 'string' ? k : k.url, ORIGIN).href;

function makeWorker(buildId = 'build-2') {
  const stores = new Map<string, Map<string, FakeResponse>>();
  const open = async (name: string) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const m = stores.get(name)!;
    return {
      match: async (k: any) => m.get(keyOf(k)),
      put: async (k: any, v: FakeResponse) => { m.set(keyOf(k), v); },
    };
  };
  const caches = {
    open,
    keys: async () => [...stores.keys()],
    delete: async (name: string) => stores.delete(name),
    match: async (k: any) => {
      for (const m of stores.values()) { const hit = m.get(keyOf(k)); if (hit) return hit; }
      return undefined;
    },
  };
  let network: (req: any) => Promise<FakeResponse> = async () => { throw new TypeError('offline'); };
  const listeners: Record<string, (e: any) => void> = {};
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, fn: (e: any) => void) => { listeners[type] = fn; },
    skipWaiting: () => {},
    clients: { claim: async () => {} },
  };
  const context = vm.createContext({
    self, caches, URL, Headers, Promise,
    fetch: (req: any) => network(req),
    Response: { error: () => ({ type: 'error' }) },
  });
  vm.runInContext(SOURCE.replace(/__BUILD_ID__/g, buildId), context);

  /** Dispatch a fetch; resolves to what the worker answered, or 'passthrough' when it left it alone. */
  async function request(path: string, opts: { mode?: string; destination?: string } = {}): Promise<any> {
    let answer: Promise<any> | null = null;
    const req = { method: 'GET', url: ORIGIN + path, mode: opts.mode ?? 'no-cors', destination: opts.destination ?? '' };
    listeners.fetch({ request: req, respondWith: (p: Promise<any>) => { answer = p; } });
    return answer ? await answer : 'passthrough';
  }
  const navigate = (path: string, destination = 'document') => request(path, { mode: 'navigate', destination });
  const activate = async () => {
    let done: Promise<unknown> = Promise.resolve();
    listeners.activate({ waitUntil: (p: Promise<unknown>) => { done = p; } });
    await done;
  };

  return {
    context: context as any, stores, request, navigate, activate,
    online: (fn: (req: any) => Promise<FakeResponse>) => { network = fn; },
    offline: () => { network = async () => { throw new TypeError('offline'); }; },
    cacheName: `brn-${buildId}`,
  };
}

let sw: ReturnType<typeof makeWorker>;
beforeEach(() => { sw = makeWorker(); });

describe('isShellResponse', () => {
  const nav = (path: string, destination = 'document') => ({ url: ORIGIN + path, destination });
  it('accepts a successful HTML answer for an app route', () => {
    expect(sw.context.isShellResponse(nav('/'), response('<app>'))).toBe(true);
    expect(sw.context.isShellResponse(nav('/login'), response('<app>'))).toBe(true);
  });
  it('refuses errors, non-HTML, iframes, customer links and static pages', () => {
    expect(sw.context.isShellResponse(nav('/'), response('oops', { status: 500 }))).toBe(false);
    expect(sw.context.isShellResponse(nav('/nope'), response('404', { status: 404 }))).toBe(false);
    expect(sw.context.isShellResponse(nav('/'), response('{}', { contentType: 'application/json' }))).toBe(false);
    expect(sw.context.isShellResponse(nav('/', 'iframe'), response('<app>'))).toBe(false);
    for (const p of ['/r/abc', '/r/s/tok', '/r/sign/tok', '/sales-journey/', '/commercial-training/', '/roof-systems/gaf/', '/api/x']) {
      expect(sw.context.isShellResponse(nav(p), response('<page>'))).toBe(false);
    }
  });
  it('refuses a redirect that landed on a customer link', () => {
    expect(sw.context.isShellResponse(nav('/'), response('<doc>', { url: `${ORIGIN}/r/s/tok` }))).toBe(false);
  });
});

describe('navigations', () => {
  it('stores the app shell from a successful app navigation and serves it offline', async () => {
    sw.online(async () => response('<app v2>'));
    expect((await sw.navigate('/')).body).toBe('<app v2>');
    sw.offline();
    expect((await sw.navigate('/login')).body).toBe('<app v2>');
  });

  it('never lets a 500 page replace the shell', async () => {
    sw.online(async () => response('<app>'));
    await sw.navigate('/');
    sw.online(async () => response('<h1>500</h1>', { status: 500 }));
    await sw.navigate('/');
    sw.offline();
    expect((await sw.navigate('/')).body).toBe('<app>');
  });

  it('leaves customer links entirely to the network — nothing cached, nothing answered', async () => {
    sw.online(async () => response('<contract for Dana>'));
    for (const p of ['/r/0123456789abcdef0123456789abcdef', '/r/s/tok', '/r/sign/tok']) {
      expect(await sw.navigate(p)).toBe('passthrough');
    }
    const everything = [...sw.stores.values()].flatMap((m) => [...m.values()]).map((r) => r.body);
    expect(everything).not.toContain('<contract for Dana>');
  });

  it('leaves framed pages (the report preview) alone', async () => {
    expect(await sw.navigate('/', 'iframe')).toBe('passthrough');
  });

  it('keeps a training page under its own URL, never as the shell', async () => {
    sw.online(async (req) => response(req.url.includes('sales-journey') ? '<journey>' : '<app>'));
    await sw.navigate('/');
    await sw.navigate('/sales-journey/');
    sw.offline();
    expect((await sw.navigate('/')).body).toBe('<app>');
    expect((await sw.navigate('/sales-journey/')).body).toBe('<journey>');
  });
});

describe('static files', () => {
  it('serves an unhashed file fresh from the network, the cache only offline', async () => {
    sw.online(async () => response('logo-v1', { contentType: 'image/jpeg' }));
    await sw.request('/logo.jpg');
    sw.online(async () => response('logo-v2', { contentType: 'image/jpeg' }));
    expect((await sw.request('/logo.jpg')).body).toBe('logo-v2');
    sw.offline();
    expect((await sw.request('/logo.jpg')).body).toBe('logo-v2');
  });

  it('serves hashed /assets/ from the cache once fetched', async () => {
    let hits = 0;
    sw.online(async () => { hits++; return response('chunk', { contentType: 'text/javascript' }); });
    await sw.request('/assets/index-abc123.js');
    await sw.request('/assets/index-abc123.js');
    expect(hits).toBe(1);
  });

  it('never caches the API', async () => {
    expect(await sw.request('/api/leads')).toBe('passthrough');
  });
});

describe('deploys', () => {
  it('names its cache after the build', () => {
    expect(SOURCE).toContain("'__BUILD_ID__'");
    // `const` is not a property of the worker global, so ask the script for it.
    expect(vm.runInContext('CACHE', sw.context)).toBe(sw.cacheName);
  });

  it('keeps this build and the one before it, drops the rest and the old brn-v1', () => {
    const keys = ['brn-v1', 'brn-build-0', 'brn-build-1', sw.cacheName, 'something-else'];
    expect(sw.context.cachesToDelete(keys)).toEqual(['brn-v1', 'brn-build-0', 'something-else']);
  });

  it('on activate, a stale cache is deleted and the previous build still answers its chunks', async () => {
    // What an earlier worker left behind in Cache Storage.
    const v1 = sw.stores;
    v1.set('brn-v1', new Map([[`${ORIGIN}/`, response('<signing page>')]]));
    v1.set('brn-build-0', new Map());
    v1.set('brn-build-1', new Map([[`${ORIGIN}/assets/old-1.js`, response('old chunk', { contentType: 'text/javascript' })]]));
    await sw.activate();
    expect([...v1.keys()].sort()).toEqual(['brn-build-1']);
    sw.offline();
    expect((await sw.request('/assets/old-1.js')).body).toBe('old chunk');
  });
});
