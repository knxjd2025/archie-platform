import { describe, it, expect, vi, afterEach } from 'vitest';
import { offlineRetry, OFFLINE_RETRY_MS } from '../auth';

/**
 * The session re-check while the server isn't answering. A 5xx during a
 * deploy left the offline banner up until a reload, because the only thing
 * that re-checked was the browser's 'online' event, which a server error
 * never fires.
 */
afterEach(() => { vi.useRealTimers(); });

describe('offlineRetry', () => {
  it('asks again after the wait, about every fifteen seconds', () => {
    vi.useFakeTimers();
    const run = vi.fn();
    const retry = offlineRetry(run);
    expect(OFFLINE_RETRY_MS).toBe(15_000);
    retry.schedule();
    vi.advanceTimersByTime(OFFLINE_RETRY_MS - 1);
    expect(run).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(run).toHaveBeenCalledTimes(1);
    // Still offline after that check: it schedules again, and asks again.
    retry.schedule();
    vi.advanceTimersByTime(OFFLINE_RETRY_MS);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('keeps one timer however many times it is scheduled', () => {
    vi.useFakeTimers();
    const run = vi.fn();
    const retry = offlineRetry(run, 1000);
    retry.schedule(); retry.schedule(); retry.schedule();
    vi.advanceTimersByTime(5000);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('stops once the server answers, or the app unmounts', () => {
    vi.useFakeTimers();
    const run = vi.fn();
    const retry = offlineRetry(run, 1000);
    retry.schedule();
    retry.cancel();
    vi.advanceTimersByTime(5000);
    expect(run).not.toHaveBeenCalled();
  });
});
