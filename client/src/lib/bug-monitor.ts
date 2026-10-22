/**
 * Watching for bugs while people use the app.
 *
 * Two jobs. It keeps a short trail of what just happened — pages opened,
 * requests that failed, errors logged — so a bug report says more than "it
 * broke". And it reports, by itself, the failures nobody would think to: a
 * screen that crashed, a promise nothing caught, a request that timed out.
 *
 * Server failures are recorded by the server, so a 500 is not reported again
 * from here. Reports go out with plain fetch, not the api client, so a failure
 * to report can never trigger another report.
 */

const API_BASE = import.meta.env.VITE_API_URL || '';
const MAX_TRAIL = 30;
/** A loop that throws on every render would otherwise send forever. */
const MAX_REPORTS_PER_LOAD = 20;

export interface TrailEntry { at: string; type: 'page' | 'api' | 'console' | 'error'; message: string }

let trail: TrailEntry[] = [];
let currentPage = '';
let reportsSent = 0;
let reported = new Set<string>();
let installed = false;

export function setBugPage(page: string): void {
  if (page === currentPage) return;
  currentPage = page;
  addTrail('page', page);
}

export function getBugPage(): string { return currentPage; }

export function addTrail(type: TrailEntry['type'], message: string): void {
  const entry = { at: new Date().toISOString(), type, message: message.slice(0, 300) };
  trail = [...trail.slice(-(MAX_TRAIL - 1)), entry];
}

export function getTrail(): TrailEntry[] { return trail; }

/** Test seam: the module state would otherwise leak between tests. */
export function __resetBugMonitor(): void {
  trail = []; currentPage = ''; reportsSent = 0; reported = new Set(); installed = false;
}

/**
 * Errors that are not ours, or not bugs: browser extensions, the
 * cross-origin "Script error." that carries nothing, ResizeObserver's harmless
 * warning, a request the user cancelled by leaving the page.
 */
export function isNoise(message: string, stack?: string | null): boolean {
  const text = `${message}\n${stack ?? ''}`;
  return /ResizeObserver loop/i.test(message)
    || /^Script error\.?$/i.test(message.trim())
    || /(chrome|moz|safari(-web)?)-extension:\/\//i.test(text)
    || /\bAbortError\b|The user aborted a request/i.test(text)
    || !message.trim();
}

/** `/api/leads/812?x=1` → `/api/leads/:id`, so one failing route is one bug. */
export function endpointShape(endpoint: string): string {
  return endpoint.split('?')[0]
    .split('/')
    .map((seg) => (/^\d+$/.test(seg) || /^[0-9a-f-]{16,}$/i.test(seg) || /^[A-Za-z0-9_-]{20,}$/.test(seg) ? ':id' : seg))
    .join('/');
}

/**
 * The address without its query string or fragment: a reset or sign-in link
 * carries its token there, and a bug report is stored and emailed.
 */
export function pageAddress(): string {
  return `${window.location.origin}${window.location.pathname}`;
}

export function environment(): Record<string, unknown> {
  return {
    page: currentPage,
    url: pageAddress(),
    viewport: `${window.innerWidth}×${window.innerHeight}`,
    online: navigator.onLine,
    standalone: window.matchMedia?.('(display-mode: standalone)').matches ?? false,
    build: import.meta.env.MODE,
    time: new Date().toISOString(),
  };
}

function toError(value: unknown): { message: string; stack: string | null } {
  if (value instanceof Error) return { message: value.message || value.name, stack: value.stack ?? null };
  if (typeof value === 'string') return { message: value, stack: null };
  try { return { message: JSON.stringify(value).slice(0, 500), stack: null }; } catch { return { message: String(value), stack: null }; }
}

/**
 * Send one caught error. Each distinct error is sent once per page load; the
 * server counts repeats across everyone.
 */
export function reportCaughtError(error: unknown, source: string, extra: Record<string, unknown> = {}): void {
  const { message, stack } = toError(error);
  addTrail('error', `${source}: ${message}`);
  if (isNoise(message, stack)) return;
  // Offline, every request fails and none of them is a bug.
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  const key = `${source}|${message}`;
  if (reported.has(key) || reportsSent >= MAX_REPORTS_PER_LOAD) return;
  reported = new Set([...reported, key]);
  reportsSent += 1;

  const body = JSON.stringify({
    source, message: message.slice(0, 4000), stack: stack?.slice(0, 12000) ?? null,
    page: currentPage || null, url: pageAddress().slice(0, 2000),
    context: { ...environment(), ...extra, trail: trail.slice(-15) },
  });
  fetch(`${API_BASE}/api/bugs/caught`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body, keepalive: true,
  }).catch(() => { /* nowhere left to report a failure to report */ });
}

/** Once, before the app renders. */
export function installBugMonitor(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  window.addEventListener('error', (e: ErrorEvent) => {
    reportCaughtError(e.error ?? e.message, 'window.error', { file: e.filename, line: e.lineno, column: e.colno });
  });
  window.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => {
    reportCaughtError(e.reason, 'unhandled-promise');
  });

  // console.error is how most of this app says "that failed" — keep it in the
  // trail so a report shows it, without reporting each one as a bug.
  const original = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    try {
      addTrail('console', args.map((a) => (a instanceof Error ? a.message : typeof a === 'string' ? a : safeJson(a))).join(' '));
    } catch { /* never let the trail break logging */ }
    original(...args);
  };
}

function safeJson(v: unknown): string {
  try { return JSON.stringify(v)?.slice(0, 200) ?? String(v); } catch { return String(v); }
}
