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
  onRetry?: (attempt: number, error: Error, delayMs: number) => void;
}

export interface FetchWithRetryResult {
  response: any;
  attempts: number;
  totalTimeMs: number;
}

const DEFAULT_OPTIONS: RetryOptions = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 10000,
  timeoutMs: 15000,
  retryOnStatus: [429, 500, 502, 503, 504],
};

/** Sleep for a given number of milliseconds */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Calculate delay with exponential backoff and jitter */
function calculateDelay(attempt: number, baseDelayMs: number, maxDelayMs: number): number {
  const exponentialDelay = baseDelayMs * Math.pow(2, attempt);
  const jitter = Math.random() * baseDelayMs * 0.5;
  return Math.min(exponentialDelay + jitter, maxDelayMs);
}

/** Check if an error is a retryable network error */
function isRetryableNetworkError(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    return (
      msg.includes('econnrefused') ||
      msg.includes('econnreset') ||
      msg.includes('etimedout') ||
      msg.includes('enotfound') ||
      msg.includes('fetch failed') ||
      msg.includes('network') ||
      msg.includes('abort') ||
      msg.includes('timeout')
    );
  }
  return false;
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

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), opts.timeoutMs);

      const response: any = await fetch(url, {
        ...fetchOptions,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // Check if we should retry based on status code
      if (!response.ok && opts.retryOnStatus.includes(response.status) && attempt < opts.maxRetries) {
        const delay = calculateDelay(attempt, opts.baseDelayMs, opts.maxDelayMs);
        const retryError = new Error(`HTTP ${response.status} from ${url}`);
        opts.onRetry?.(attempt + 1, retryError, delay);
        console.warn(`[fetch-retry] Attempt ${attempt + 1}/${opts.maxRetries + 1} failed (HTTP ${response.status}), retrying in ${Math.round(delay)}ms: ${url}`);
        await sleep(delay);
        continue;
      }

      return {
        response,
        attempts: attempt + 1,
        totalTimeMs: Date.now() - startTime,
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (isRetryableNetworkError(error) && attempt < opts.maxRetries) {
        const delay = calculateDelay(attempt, opts.baseDelayMs, opts.maxDelayMs);
        opts.onRetry?.(attempt + 1, lastError, delay);
        console.warn(`[fetch-retry] Attempt ${attempt + 1}/${opts.maxRetries + 1} failed (${lastError.message}), retrying in ${Math.round(delay)}ms: ${url}`);
        await sleep(delay);
        continue;
      }

      // Non-retryable error or exhausted retries
      throw lastError;
    }
  }

  // Should not reach here, but just in case
  throw lastError || new Error(`All ${opts.maxRetries + 1} attempts failed for ${url}`);
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
      lastError = error instanceof Error ? error : new Error(String(error));
      console.warn(`[fetch-fallback] All retries failed for ${url}, trying next URL...`);
    }
  }

  throw lastError || new Error(`All URLs failed: ${urls.join(', ')}`);
}
