/**
 * One deadline for the whole generation path.
 *
 * A request has about 300 seconds. Storm data used to be able to take about
 * 500 on its own (20 chunks, 4 at a time, 2 hosts, 3 tries, 15 s each), so a
 * slow NOAA took the whole report down with it. Now a single AbortSignal with a
 * total budget (240 s unless told otherwise) is handed to the storm fetch, the
 * photo analysis and every model call. When it fires, each returns what it has,
 * flagged partial, and none throws. Fake timers drive every case, so none waits.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDeadline, DEFAULT_BUDGET_MS, MAX_BUDGET_MS } from '../deadline';
import { fetchWithRetry, fetchWithDomainFallback } from '../fetch-with-retry';
import { fetchSWDIStormEvents } from '../swdi-api-service';
import { fetchIEMLSREvents } from '../iem-api-service';
import { generateStormReport } from '../storm-history-service';
import { comprehensiveMultiImageAnalysis } from '../enhanced-vision-analysis';
import { labelPhotosWithClaude } from '../claude-image-labeler';
import { generateNarrativeWithClaude } from '../claude-report-narrator';
import { ModelCallError, type ModelCaller } from '../model-call';

const fetchMock = vi.fn();
beforeEach(() => {
  vi.useFakeTimers();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** A fetch that never answers on its own and rejects when its signal aborts, like the real one. */
const hang = (_url: unknown, init?: RequestInit): Promise<Response> =>
  new Promise((_resolve, reject) => {
    const abort = () => reject(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }));
    if (init?.signal?.aborted) abort();
    init?.signal?.addEventListener('abort', abort);
  });

describe('createDeadline', () => {
  it('defaults to 240 seconds, which fits inside a 300 second request', async () => {
    expect(DEFAULT_BUDGET_MS).toBe(240_000);
    expect(MAX_BUDGET_MS).toBeLessThan(300_000);
    const signal = createDeadline();
    await vi.advanceTimersByTimeAsync(239_999);
    expect(signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    expect(signal.aborted).toBe(true);
  });

  it('never gives a budget longer than the request can hold, nor a nonsense one', async () => {
    const long = createDeadline(10 * 60_000);
    await vi.advanceTimersByTimeAsync(MAX_BUDGET_MS + 1);
    expect(long.aborted).toBe(true);
    const nonsense = createDeadline(Number.NaN);
    await vi.advanceTimersByTimeAsync(DEFAULT_BUDGET_MS + 1);
    expect(nonsense.aborted).toBe(true);
  });

  it('also ends when the request it belongs to ends', () => {
    const request = new AbortController();
    const signal = createDeadline(240_000, request.signal);
    request.abort();
    expect(signal.aborted).toBe(true);
  });
});

describe('fetchWithRetry and domain fallback honour the deadline', () => {
  it('does not start a fetch once the deadline has passed', async () => {
    await expect(fetchWithRetry('https://a.example/x', {}, { signal: AbortSignal.abort() })).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('stops waiting between tries the moment the deadline fires, and does not try again', async () => {
    fetchMock.mockResolvedValue(new Response('no', { status: 503 }));
    const deadline = new AbortController();
    const run = fetchWithRetry('https://a.example/x', {}, { signal: deadline.signal, baseDelayMs: 60_000, maxDelayMs: 60_000, maxRetries: 3 }).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(100); // first try answered 503, now sleeping 60 s
    expect(fetchMock).toHaveBeenCalledTimes(1);
    deadline.abort();
    await vi.advanceTimersByTimeAsync(1);
    expect(await run).toBeInstanceOf(Error);
    await vi.advanceTimersByTimeAsync(300_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('an in-flight request is cut off by the deadline, not by its own 15 s timer', async () => {
    fetchMock.mockImplementation(hang);
    const deadline = new AbortController();
    const run = fetchWithRetry('https://a.example/x', {}, { signal: deadline.signal, timeoutMs: 15_000, maxRetries: 3 }).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(2_000);
    deadline.abort();
    await vi.advanceTimersByTimeAsync(1);
    expect(await run).toBeInstanceOf(Error);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not move on to the next host after the deadline', async () => {
    fetchMock.mockImplementation(hang);
    const deadline = new AbortController();
    const run = fetchWithDomainFallback(['https://a.example/x', 'https://b.example/x'], {}, { signal: deadline.signal }).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(10);
    deadline.abort();
    await vi.advanceTimersByTimeAsync(10);
    await run;
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('the storm sources return what they have, flagged partial', () => {
  const START = new Date('2025-01-01T00:00:00Z');
  const END = new Date('2026-01-01T00:00:00Z');

  it('SWDI: chunks that finished are kept, the rest are not started, nothing throws', async () => {
    const csv = 'LAT,LON,ZTIME,MAXSIZE,SEVPROB\n42.5,-92.4,2025-06-02T22:00:00Z,1.5,80\n';
    let answered = 0;
    fetchMock.mockImplementation((url: unknown, init?: RequestInit) => {
      // the first four chunk requests answer; every later one hangs
      if (answered < 4) { answered++; return Promise.resolve(new Response(csv, { status: 200 })); }
      return hang(url, init);
    });
    const deadline = new AbortController();
    const run = fetchSWDIStormEvents(42.5, -92.4, START, END, 10, deadline.signal);
    await vi.advanceTimersByTimeAsync(5_000);
    deadline.abort();
    const result = await run;
    expect(result.events.length).toBeGreaterThan(0);
    expect(result.sourceDetail.partial).toBe(true);
    expect(result.sourceDetail.status).toBe('success');
    const startedAtAbort = fetchMock.mock.calls.length;
    await vi.advanceTimersByTimeAsync(600_000);
    expect(fetchMock.mock.calls.length).toBe(startedAtAbort); // nothing new began after the deadline
  });

  it('SWDI with nothing finished is a timeout, still not an exception', async () => {
    fetchMock.mockImplementation(hang);
    const deadline = new AbortController();
    const run = fetchSWDIStormEvents(42.5, -92.4, START, END, 10, deadline.signal);
    await vi.advanceTimersByTimeAsync(1_000);
    deadline.abort();
    const result = await run;
    expect(result.events).toEqual([]);
    expect(result.sourceDetail).toMatchObject({ status: 'timeout', partial: true });
  });

  it('IEM: a deadline mid-request is a timeout flagged partial, not an exception', async () => {
    fetchMock.mockImplementation(hang);
    const deadline = new AbortController();
    const run = fetchIEMLSREvents(42.5, -92.4, START, END, 10, deadline.signal);
    await vi.advanceTimersByTimeAsync(1_000);
    deadline.abort();
    const result = await run;
    expect(result.events).toEqual([]);
    expect(result.sourceDetail).toMatchObject({ status: 'timeout', partial: true });
  });
});

describe('generateStormReport inside the budget', () => {
  const GEOCODE_OK = new Response(JSON.stringify([{ lat: '42.5', lon: '-92.4', display_name: '12 Elm Street' }]), { status: 200 });

  /** Geocoding answers at once; every NOAA request hangs, which is the worst case. */
  const noaaHangs = (url: unknown, init?: RequestInit): Promise<Response> => {
    if (String(url).includes('nominatim')) return Promise.resolve(GEOCODE_OK.clone());
    return hang(url, init);
  };

  it('a 10 year report whose sources never answer ends at the deadline with a partial report, not 500 seconds later and not with an exception', async () => {
    fetchMock.mockImplementation(noaaHangs);
    const t0 = Date.now();
    const run = generateStormReport('12 Elm Street', 'Cedar Falls', 'IA', '50613', { yearsBack: 10, signal: createDeadline(240_000) });
    await vi.advanceTimersByTimeAsync(240_001);
    const report = await run;
    expect(Date.now() - t0).toBeLessThanOrEqual(241_000);
    expect(report.partial).toBe(true);
    expect(['partial', 'degraded']).toContain(report.data_quality);
    expect(report.events).toEqual([]);
    const started = fetchMock.mock.calls.length;
    await vi.advanceTimersByTimeAsync(600_000);
    expect(fetchMock.mock.calls.length).toBe(started);
  });

  it('with no deadline given it still applies the default one', async () => {
    fetchMock.mockImplementation(noaaHangs);
    const run = generateStormReport('12 Elm Street', 'Cedar Falls', 'IA', '50613', { yearsBack: 10 });
    await vi.advanceTimersByTimeAsync(241_000);
    const report = await run;
    expect(report.partial).toBe(true);
  });

  it('a report that finishes inside the budget is not flagged partial', async () => {
    fetchMock.mockImplementation((url: unknown) => {
      if (String(url).includes('nominatim')) return Promise.resolve(GEOCODE_OK.clone());
      return Promise.resolve(new Response('LAT,LON,ZTIME,MAXSIZE,SEVPROB\n', { status: 200 }));
    });
    const run = generateStormReport('12 Elm Street', 'Cedar Falls', 'IA', '50613', { yearsBack: 1, signal: createDeadline(240_000) });
    await vi.advanceTimersByTimeAsync(5_000);
    const report = await run;
    expect(report.partial).toBeFalsy();
  });

  it('a deadline that has already passed before geocoding is an empty partial report, never an exception', async () => {
    fetchMock.mockImplementation(hang);
    const report = await generateStormReport('12 Elm Street', 'Cedar Falls', 'IA', '50613', { signal: AbortSignal.abort() });
    expect(report.partial).toBe(true);
    expect(report.data_quality).toBe('degraded');
    expect(report.events).toEqual([]);
  });
});

describe('photo analysis inside the budget', () => {
  const IMG = 'data:image/png;base64,QUJD';
  const JSON_REPLY = JSON.stringify({ image_quality: 'good', damages: [], overall_condition: 'good', severity_score: 5, summary: 'fine' });

  it('stops starting photos when the deadline fires and returns the ones it finished, flagged partial', async () => {
    const deadline = new AbortController();
    let photos = 0;
    const call: ModelCaller = async (request) => {
      if (request.role === 'visionAlternative') {
        photos++;
        if (photos === 2) deadline.abort(); // the deadline fires during the second photo
      }
      if (request.signal?.aborted) throw new ModelCallError(0, true);
      return { text: JSON_REPLY };
    };
    const result = await comprehensiveMultiImageAnalysis([IMG, IMG, IMG, IMG], '', undefined, { call, signal: deadline.signal });
    expect(result.partial).toBe(true);
    expect(result.individual_analyses.length).toBeLessThan(4);
    expect(photos).toBeLessThanOrEqual(2); // no photo was begun after the deadline
  });

  it('a run that finishes in time is not partial', async () => {
    const call: ModelCaller = async () => ({ text: JSON_REPLY });
    const result = await comprehensiveMultiImageAnalysis([IMG, IMG], '', undefined, { call });
    expect(result.partial).toBeFalsy();
    expect(result.individual_analyses).toHaveLength(2);
  });
});

describe('narrative and labels inside the budget', () => {
  const BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2]);
  const inputs = ['p1', 'p2', 'p3', 'p4'].map((photoId) => ({
    photoId,
    image: { bytes: BYTES, mediaType: 'image/jpeg' as const },
    existingDamages: [{ id: `${photoId}-d`, type: 'hail_impact', label: 'Hail impact', severity: 'high' as const, confidence: 90, description: 'd', location: 'center' }],
  }));

  it('labels: once the deadline fires no photo is sent, and every photo still gets labels from what was already found', async () => {
    const deadline = new AbortController();
    const call: ModelCaller = vi.fn(async (request) => {
      deadline.abort();
      if (request.signal?.aborted) throw new ModelCallError(0, true);
      return { text: '{"labels":[]}' };
    });
    const run = labelPhotosWithClaude(inputs, { call, signal: deadline.signal, batchSize: 1 });
    await vi.advanceTimersByTimeAsync(30_000);
    const out = await run;
    // not one photo was labelled by the model, so the overlays are skipped altogether: null, not an exception
    expect(out).toBeNull();
    expect(call).toHaveBeenCalledTimes(1); // the second, third and fourth photo were never begun
  });

  it('labels: photos the model did label before the deadline are kept, the rest fall back, no exception', async () => {
    const deadline = new AbortController();
    let n = 0;
    const call: ModelCaller = vi.fn(async (request) => {
      n++;
      if (n === 2) deadline.abort();
      if (request.signal?.aborted) throw new ModelCallError(0, true);
      return { text: '{"labels":[{"text":"Hail strike","position":"center","severity":"high"}]}' };
    });
    const run = labelPhotosWithClaude(inputs, { call, signal: deadline.signal, batchSize: 1 });
    await vi.advanceTimersByTimeAsync(30_000);
    const out = await run;
    expect(out).not.toBeNull();
    expect(Object.keys(out!).sort()).toEqual(['p1', 'p2', 'p3', 'p4']);
    expect(out!.p1[0].text).toBe('Hail strike');
    expect(out!.p4[0].text).toBe('Hail impact'); // built from its existing detection
    expect(call).toHaveBeenCalledTimes(2);
  });

  it('narrative: a passed deadline is a null result (the report goes out without it), not an exception', async () => {
    const call: ModelCaller = vi.fn(async (request) => {
      if (request.signal?.aborted) throw new ModelCallError(0, true);
      return { text: '{}' };
    });
    const result = await generateNarrativeWithClaude({} as never, { call, signal: AbortSignal.abort() });
    expect(result).toBeNull();
  });
});
