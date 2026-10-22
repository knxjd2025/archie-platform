import { describe, it, expect, vi } from 'vitest';
import { createSeedOnce } from '../seed';

const deferred = () => {
  let resolve!: () => void; let reject!: (e: unknown) => void;
  const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

describe('createSeedOnce', () => {
  it('shares one in-flight run between concurrent callers', async () => {
    const d = deferred();
    const run = vi.fn(() => d.promise);
    const ensure = createSeedOnce(run);
    const a = ensure(); const b = ensure(); const c = ensure();
    expect(run).toHaveBeenCalledTimes(1);
    d.resolve();
    await Promise.all([a, b, c]);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('never runs again after a success', async () => {
    const run = vi.fn(async () => {});
    const ensure = createSeedOnce(run);
    await ensure(); await ensure(); await ensure();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('swallows a failure, then retries only after the back-off', async () => {
    let t = 1_000;
    const onError = vi.fn();
    const run = vi.fn().mockRejectedValueOnce(new Error('db down')).mockResolvedValue(undefined);
    const ensure = createSeedOnce(run, { retryAfterMs: 60_000, now: () => t, onError });

    await expect(ensure()).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalledTimes(1);

    t += 30_000;
    await ensure();
    expect(run).toHaveBeenCalledTimes(1); // still backing off

    t += 31_000;
    await ensure();
    expect(run).toHaveBeenCalledTimes(2);
    await ensure();
    expect(run).toHaveBeenCalledTimes(2); // succeeded, done
  });
});
