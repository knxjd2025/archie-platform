/**
 * deadline.ts: one total time budget for a whole report request.
 *
 * A request has about 300 seconds. Each step inside it (the storm fetch, every
 * photo, every model call) has its own time limit, but the limits add up: the
 * storm data alone could take about 500 seconds in the worst case. So the
 * request makes ONE signal here and hands it to every step. When it fires each
 * step stops starting work, returns what it already has flagged partial, and
 * never throws because of it.
 */
import { boundedNumber } from './html-safety.js';

/** The budget a report gets unless told otherwise: leaves a minute of the 300 for saving and replying. */
export const DEFAULT_BUDGET_MS = 240_000;
/** No budget may be longer than this, so a request can never be promised more time than it has. */
export const MAX_BUDGET_MS = 280_000;

/**
 * A signal that aborts after `totalMs` (240 seconds by default, never more than
 * 280), or when `parent` aborts, whichever comes first.
 */
export function createDeadline(totalMs: number = DEFAULT_BUDGET_MS, parent?: AbortSignal): AbortSignal {
  const ms = boundedNumber(totalMs, 1, MAX_BUDGET_MS, DEFAULT_BUDGET_MS);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('The report ran out of time.')), ms);
  // A finished request must not be kept alive by its own deadline.
  if (typeof timer === 'object' && timer !== null && 'unref' in timer) (timer as { unref: () => void }).unref();
  const stop = (): void => {
    clearTimeout(timer);
    controller.abort();
  };
  if (parent) {
    if (parent.aborted) stop();
    else parent.addEventListener('abort', stop, { once: true });
  }
  return controller.signal;
}

/** True once the deadline has passed. A missing deadline never passes. */
export function deadlinePassed(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}
