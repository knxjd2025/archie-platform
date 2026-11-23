/**
 * Generic fetch wrapper with exponential backoff retry logic.
 * Used by all NOAA data source fetchers for resilient API calls.
 */

export interface RetryOptions {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  timeoutMs: number;
  retryOnStatus: number[];
  /** The request-wide deadline. When it fires: no fetch starts, none is waited for, nothing is retried. */
  signal?: AbortSignal;
  onRetry?: (attempt: number, error: Error, delayMs: number) => void;
}

export interface FetchWithRetryResult {
  response: Response;
  attempts: number;
  totalTimeMs: number;
}

/** Fraction of the base delay added as random jitter to avoid thundering herds. */
const JITTER_FACTOR = 0.5;

/** Exponential-backoff base — `delay = base ^ attempt × baseDelay` (plus jitter). */
const EXP_BACKOFF_BASE = 2;

/** Log prefix for the retry warnings emitted by `fetchWithRetry`. */
const LOG_PREFIX_RETRY = '[fetch-retry]';
/** Log prefix for the fallback warnings emitted by `fetchWithDomainFallback`. */
const LOG_PREFIX_FALLBACK = '[fetch-fallback]';

/** HTTP status code constants for the retry list. Named so a future
 *  reviewer doesn't have to memorise that 429 = Too Many Requests. */
const HTTP_TOO_MANY_REQUESTS = 429;
const HTTP_INTERNAL_SERVER_ERROR = 500;
const HTTP_BAD_GATEWAY = 502;
const HTTP_SERVICE_UNAVAILABLE = 503;
const HTTP_GATEWAY_TIMEOUT = 504;

/** HTTP status codes the default config retries on (rate-limit + 5xx). */
const DEFAULT_RETRY_STATUSES: readonly number[] = [
  HTTP_TOO_MANY_REQUESTS,
  HTTP_INTERNAL_SERVER_ERROR,
  HTTP_BAD_GATEWAY,
  HTTP_SERVICE_UNAVAILABLE,
  HTTP_GATEWAY_TIMEOUT,
];

/** Default-options magic numbers, hoisted so they're discoverable and
 *  greppable individually rather than buried in an object literal. */
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BASE_DELAY_MS = 1_000;
const DEFAULT_MAX_DELAY_MS = 10_000;
const DEFAULT_TIMEOUT_MS = 15_000;

const DEFAULT_OPTIONS: RetryOptions = {
  maxRetries: DEFAULT_MAX_RETRIES,
  baseDelayMs: DEFAULT_BASE_DELAY_MS,
  maxDelayMs: DEFAULT_MAX_DELAY_MS,
  timeoutMs: DEFAULT_TIMEOUT_MS,
  retryOnStatus: [...DEFAULT_RETRY_STATUSES],
};

/** Coerce an unknown `catch`'d value into an `Error` with a useful message. */
function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

/** Retry-warning template fragments — assembled into:
 *  `'Attempt X/Y failed (REASON), retrying in Zms: URL'`. */
const MSG_ATTEMPT_PREFIX = 'Attempt ';
const MSG_ATTEMPT_SLASH = '/';
const MSG_ATTEMPT_FAILED_OPEN_PAREN = ' failed (';
const MSG_ATTEMPT_RETRY_INFIX = '), retrying in ';
const MSG_ATTEMPT_MS_SUFFIX = 'ms: ';
/** HTTP-status-prefix template fragment used for `'HTTP 503 from URL'` errors. */
const MSG_HTTP_PREFIX = 'HTTP ';
const MSG_HTTP_FROM_INFIX = ' from ';

/** Domain-fallback warning template fragments — assembled into:
 *  `'All retries failed for URL, trying next URL...'`. */
const MSG_FALLBACK_FAILED_PREFIX = 'All retries failed for ';
const MSG_FALLBACK_TRYING_SUFFIX = ', trying next URL...';
/** Final-failure error message template fragments — assembled into:
 *  `'All N attempts failed for URL'` and `'All URLs failed: u1, u2'`. */
const MSG_ALL_ATTEMPTS_FAILED_PREFIX = 'All ';
const MSG_ALL_ATTEMPTS_FAILED_INFIX = ' attempts failed for ';
const MSG_ALL_URLS_FAILED_PREFIX = 'All URLs failed: ';
const MSG_URLS_JOIN_SEPARATOR = ', ';

/** Build the standard "Attempt X/Y failed (...) retrying in Zms: URL" warning string. */
function formatRetryWarning(attempt: number, total: number, reason: string, delayMs: number, url: string): string {
  return `${MSG_ATTEMPT_PREFIX}${attempt}${MSG_ATTEMPT_SLASH}${total}${MSG_ATTEMPT_FAILED_OPEN_PAREN}${reason}${MSG_ATTEMPT_RETRY_INFIX}${Math.round(delayMs)}${MSG_ATTEMPT_MS_SUFFIX}${url}`;
}

/**
 * Run a single `fetch` with an `AbortController` timeout.
 * Always clears the timeout — even if `fetch` throws synchronously.
 */
async function fetchWithAbort(
  url: string,
  fetchOptions: RequestInit | undefined,
  timeoutMs: number,
  deadline?: AbortSignal,
): Promise<Response> {
  if (deadline?.aborted) throw abortError();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const signal = deadline ? AbortSignal.any([controller.signal, deadline]) : controller.signal;
    return await fetch(url, { ...fetchOptions, signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Substrings (case-insensitive) we treat as transient/retryable network errors.
 * Centralised so adding a new fetch failure pattern is a one-line edit.
 */
const RETRYABLE_ERROR_PATTERNS: readonly string[] = [
  'econnrefused',
  'econnreset',
  'etimedout',
  'enotfound',
  'fetch failed',
  'network',
  'abort',
  'timeout',
];

/** The error a deadline produces. It is never retried. */
function abortError(): Error {
  return Object.assign(new Error('The request ran out of time.'), { name: 'AbortError' });
}

/** Sleep for a given number of milliseconds, or less if the deadline fires (then it rejects). */
function sleep(ms: number, deadline?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (deadline?.aborted) return reject(abortError());
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(abortError());
    };
    const timer = setTimeout(() => {
      deadline?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    deadline?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Calculate delay with exponential backoff and jitter */
function calculateDelay(attempt: number, baseDelayMs: number, maxDelayMs: number): number {
  const exponentialDelay = baseDelayMs * EXP_BACKOFF_BASE ** attempt;
  const jitter = Math.random() * baseDelayMs * JITTER_FACTOR;
  return Math.min(exponentialDelay + jitter, maxDelayMs);
}

/** Check if an error is a retryable network error */
function isRetryableNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const msg = error.message.toLowerCase();
  return RETRYABLE_ERROR_PATTERNS.some((p) => msg.includes(p));
}

/**
 * Fetch with automatic retry on failure.
 * Retries on network errors and configurable HTTP status codes (default: 429, 5xx).
 * Does NOT retry on 4xx client errors (except 429).
 */
export async function fetchWithRetry(
  url: string,
  fetchOptions?: RequestInit,
  retryOptions?: Partial<RetryOptions>
): Promise<FetchWithRetryResult> {
  const opts = { ...DEFAULT_OPTIONS, ...retryOptions };
  const startTime = Date.now();
  let lastError: Error | null = null;

  const totalAttempts = opts.maxRetries + 1;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      const response = await fetchWithAbort(url, fetchOptions, opts.timeoutMs, opts.signal);

      // Check if we should retry based on status code
      if (!response.ok && opts.retryOnStatus.includes(response.status) && attempt < opts.maxRetries) {
        const delay = calculateDelay(attempt, opts.baseDelayMs, opts.maxDelayMs);
        const retryError = new Error(`${MSG_HTTP_PREFIX}${response.status}${MSG_HTTP_FROM_INFIX}${url}`);
        opts.onRetry?.(attempt + 1, retryError, delay);
        console.warn(`${LOG_PREFIX_RETRY} ${formatRetryWarning(attempt + 1, totalAttempts, `${MSG_HTTP_PREFIX}${response.status}`, delay, url)}`);
        await sleep(delay, opts.signal);
        continue;
      }

      return {
        response,
        attempts: attempt + 1,
        totalTimeMs: Date.now() - startTime,
      };
    } catch (error) {
      lastError = toError(error);

      // The deadline is final: never retry past it.
      if (opts.signal?.aborted) throw lastError;

      if (isRetryableNetworkError(error) && attempt < opts.maxRetries) {
        const delay = calculateDelay(attempt, opts.baseDelayMs, opts.maxDelayMs);
        opts.onRetry?.(attempt + 1, lastError, delay);
        console.warn(`${LOG_PREFIX_RETRY} ${formatRetryWarning(attempt + 1, totalAttempts, lastError.message, delay, url)}`);
        await sleep(delay, opts.signal);
        continue;
      }

      // Non-retryable error or exhausted retries
      throw lastError;
    }
  }

  // Should not reach here, but just in case
  throw lastError || new Error(`${MSG_ALL_ATTEMPTS_FAILED_PREFIX}${opts.maxRetries + 1}${MSG_ALL_ATTEMPTS_FAILED_INFIX}${url}`);
}

/**
 * Try fetching from multiple URLs in order (domain fallback).
 * Returns the first successful response. If all fail, throws the last error.
 */
export async function fetchWithDomainFallback(
  urls: string[],
  fetchOptions?: RequestInit,
  retryOptions?: Partial<RetryOptions>
): Promise<FetchWithRetryResult & { usedUrl: string }> {
  let lastError: Error | null = null;

  for (const url of urls) {
    try {
      const result = await fetchWithRetry(url, fetchOptions, retryOptions);
      return { ...result, usedUrl: url };
    } catch (error) {
      lastError = toError(error);
      // Past the deadline there is no next host to try.
      if (retryOptions?.signal?.aborted) throw lastError;
      console.warn(`${LOG_PREFIX_FALLBACK} ${MSG_FALLBACK_FAILED_PREFIX}${url}${MSG_FALLBACK_TRYING_SUFFIX}`);
    }
  }

  throw lastError || new Error(`${MSG_ALL_URLS_FAILED_PREFIX}${urls.join(MSG_URLS_JOIN_SEPARATOR)}`);
}
