import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { startNativeSignIn, openExternal } from '../native';

/**
 * A fake Capacitor shell: the Browser and App plugins as the bridge exposes
 * them, with listeners we can fire by hand and count after removal.
 */
function shell() {
  const listeners: Record<string, Array<(e: any) => void>> = {};
  const removed: string[] = [];
  const add = (name: string, fn: (e: any) => void) => {
    (listeners[name] ||= []).push(fn);
    return Promise.resolve({ remove: () => { removed.push(name); listeners[name] = listeners[name].filter((f) => f !== fn); } });
  };
  const Browser = { open: vi.fn(() => Promise.resolve()), close: vi.fn(() => Promise.resolve()), addListener: add };
  const App = { addListener: add };
  const fire = (name: string, e: any = {}) => (listeners[name] || []).forEach((f) => f(e));
  const live = (name: string) => (listeners[name] || []).length;
  return { Browser, App, fire, live, removed };
}


describe('startNativeSignIn', () => {
  let s: ReturnType<typeof shell>;
  let location: { origin: string; href: string };
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    s = shell();
    location = { origin: 'https://app.example.com', href: 'https://app.example.com/login' };
    (globalThis as any).window = {
      Capacitor: { isNativePlatform: () => true, Plugins: { Browser: s.Browser, App: s.App } },
      location,
    };
    fetchMock = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }));
    (globalThis as any).fetch = fetchMock;
  });
  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as any).window;
    delete (globalThis as any).fetch;
  });

  it("settles as 'cancelled' when the rep closes the browser without signing in", async () => {
    const p = startNativeSignIn();
    await vi.advanceTimersByTimeAsync(0);
    s.fire('browserFinished');
    await vi.advanceTimersByTimeAsync(2000);
    await expect(p).resolves.toBe('cancelled');
    expect(s.live('appUrlOpen')).toBe(0);
    expect(s.live('browserFinished')).toBe(0);
  });

  it('does not call a sign-in cancelled when the browser reports closing just before the link arrives', async () => {
    const p = startNativeSignIn();
    await vi.advanceTimersByTimeAsync(0);
    s.fire('browserFinished');
    s.fire('appUrlOpen', { url: 'archie://auth?t=tok' });
    await vi.advanceTimersByTimeAsync(2000);
    await expect(p).resolves.toBe('signed-in');
    expect(location.href).toBe('/');
  });

  it('trades the token once, even if the link is delivered twice, and removes its listeners', async () => {
    const p = startNativeSignIn();
    await vi.advanceTimersByTimeAsync(0);
    s.fire('appUrlOpen', { url: 'archie://auth?t=tok' });
    s.fire('appUrlOpen', { url: 'archie://auth?t=tok' });
    await expect(p).resolves.toBe('signed-in');
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(s.live('appUrlOpen')).toBe(0);
  });

  it("returns 'failed' without a token, so the page can offer Try again", async () => {
    const p = startNativeSignIn();
    await vi.advanceTimersByTimeAsync(0);
    s.fire('appUrlOpen', { url: 'archie://auth' });
    await expect(p).resolves.toBe('failed');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 'unavailable' outside the shell", async () => {
    (globalThis as any).window = { location };
    await expect(startNativeSignIn()).resolves.toBe('unavailable');
  });
});

describe('openExternal', () => {
  afterEach(() => { delete (globalThis as any).window; });

  it('uses the in-app browser inside the shell, never window.open', async () => {
    const s = shell();
    const open = vi.fn();
    (globalThis as any).window = { Capacitor: { isNativePlatform: () => true, Plugins: { Browser: s.Browser } }, open };
    await expect(openExternal('https://ghl.example/c/1')).resolves.toBe(true);
    expect(s.Browser.open).toHaveBeenCalledWith({ url: 'https://ghl.example/c/1' });
    expect(open).not.toHaveBeenCalled();
  });

  it('reports a blocked pop-up on the web instead of pretending it opened', async () => {
    (globalThis as any).window = { open: vi.fn(() => null) };
    await expect(openExternal('https://ghl.example/c/1')).resolves.toBe(false);
  });

  it('opens a new tab on the web', async () => {
    (globalThis as any).window = { open: vi.fn(() => ({ opener: {} })) };
    await expect(openExternal('https://ghl.example/c/1')).resolves.toBe(true);
  });
});

