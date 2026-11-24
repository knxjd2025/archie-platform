import { describe, expect, it } from 'vitest';
import { GEOCODE_FAILED, TOO_MANY_TODAY } from '../../../../shared/roof-reports';
import { POLL_GIVE_UP_MS } from '../generate-flow';
import { runGeneration, type FlowState, type RunDeps } from '../generate-run';

const ID = '00000000-0000-4000-8000-000000000001';
const body = { reportTypes: ['inspection'], template: 'full', address: '12 Elm Street', city: 'Cedar Falls', state: 'IA', zip: '', photoIds: [], damageCounts: { windDamaged: 0, hailDamaged: 0, generalDamaged: 0 }, inspectorNotes: '' } as never;

/** A fake world: a clock that only moves when the run sleeps, and scripted answers. */
function world(script: { generate?: unknown[]; retry?: unknown[]; status?: unknown[] }) {
  let clock = 0;
  const calls: string[] = [];
  const next = (list: unknown[] | undefined, name: string, ...args: unknown[]) => {
    calls.push(`${name}${args.length ? ` ${args.join(' ')}` : ''}`);
    const item = list && list.length ? (list.length > 1 ? list.shift() : list[0]) : { id: ID, status: 'ready', problem: null };
    if (item instanceof Error) return Promise.reject(item);
    return Promise.resolve(item);
  };
  const slept: number[] = [];
  const states: FlowState[] = [];
  let stop = false;
  const deps: RunDeps = {
    generate: (_b, key) => next(script.generate, 'generate', key),
    retry: (id) => next(script.retry, 'retry', id),
    status: (id) => next(script.status, 'status', id),
    sleep: (ms) => { slept.push(ms); clock += ms; return Promise.resolve(); },
    now: () => clock,
    cancelled: () => stop,
  };
  return { deps, calls, slept, states, cancel: () => { stop = true; }, onState: (s: FlowState) => states.push(s) };
}

describe('making a report', () => {
  it('starts once with the attempt\'s key and stops at ready', async () => {
    const w = world({ generate: [{ id: ID, status: 'ready', problem: null }] });
    const end = await runGeneration(w.deps, { mode: 'start', body, key: 'rr-key-1', id: null }, w.onState);
    expect(end).toEqual({ phase: 'ready', reportId: ID, problem: null });
    expect(w.calls).toEqual(['generate rr-key-1']);
    expect(w.states[0]).toEqual({ phase: 'making', reportId: null });
  });

  it('keeps the partly missing sentence with a ready report', async () => {
    const w = world({ generate: [{ id: ID, status: 'ready', problem: 'The report ran out of time, so part of it is missing.' }] });
    expect(await runGeneration(w.deps, { mode: 'start', body, key: 'rr-key-1', id: null }, w.onState)).toMatchObject({ phase: 'ready', problem: 'The report ran out of time, so part of it is missing.' });
  });

  it('after a refresh sends the same request with the same key, is told the report is still being made, and polls with backoff until ready', async () => {
    const w = world({
      generate: [{ id: ID, status: 'generating', problem: null }],
      status: [{ id: ID, status: 'generating' }, { id: ID, status: 'generating' }, { id: ID, status: 'generating' }, { id: ID, status: 'ready', problem: null }],
    });
    const end = await runGeneration(w.deps, { mode: 'start', body, key: 'rr-key-1', id: null }, w.onState);
    expect(end.phase).toBe('ready');
    expect(w.calls).toEqual(['generate rr-key-1', `status ${ID}`, `status ${ID}`, `status ${ID}`, `status ${ID}`]);
    expect(w.slept).toEqual([2000, 3000, 5000, 8000]);
    expect(w.states.some((s) => s.phase === 'making' && s.reportId === ID)).toBe(true);
  });

  it('stops at "could not finish" with the server\'s sentence when polling finds the report failed', async () => {
    const w = world({ generate: [{ id: ID, status: 'generating' }], status: [{ id: ID, status: 'failed', problem: 'The report could not be finished. Please try again.' }] });
    const end = await runGeneration(w.deps, { mode: 'start', body, key: 'rr-key-1', id: null }, w.onState);
    expect(end).toMatchObject({ phase: 'failed', reportId: ID });
    expect((end as { view: { sentence: string; canTryAgain: boolean } }).view).toMatchObject({ sentence: 'The report could not be finished. Please try again.', canTryAgain: true });
  });

  it('does not trust an error from the first call: it asks once more with the same key, and takes the report the server already made', async () => {
    const w = world({ generate: [new Error('Request timed out — try again.'), { id: ID, status: 'ready', problem: null }] });
    const end = await runGeneration(w.deps, { mode: 'start', body, key: 'rr-key-1', id: null }, w.onState);
    expect(end.phase).toBe('ready');
    expect(w.calls).toEqual(['generate rr-key-1', 'generate rr-key-1']);
  });

  it('shows the failure, with the report\'s id so Try again can use the retry path, when the second ask finds it failed', async () => {
    const w = world({ generate: [new Error('HTTP 500'), { id: ID, status: 'failed', problem: 'The report could not be finished. Please try again.' }] });
    const end = await runGeneration(w.deps, { mode: 'start', body, key: 'rr-key-1', id: null }, w.onState);
    expect(end).toMatchObject({ phase: 'failed', reportId: ID });
  });

  it('shows the daily cap at once, with no second ask', async () => {
    const w = world({ generate: [new Error(TOO_MANY_TODAY)] });
    const end = await runGeneration(w.deps, { mode: 'start', body, key: 'rr-key-1', id: null }, w.onState);
    expect(w.calls).toEqual(['generate rr-key-1']);
    expect(end).toMatchObject({ phase: 'failed', reportId: null, view: { kind: 'capped' } });
  });

  it('shows a wrong address without trying again', async () => {
    const w = world({ generate: [new Error(GEOCODE_FAILED)] });
    const end = await runGeneration(w.deps, { mode: 'start', body, key: 'rr-key-1', id: null }, w.onState);
    expect(end).toMatchObject({ phase: 'failed', view: { kind: 'address', canChangeAddress: true } });
    expect(w.calls).toEqual(['generate rr-key-1']);
  });

  it('shows a failure after two failed asks, with the sentence for it', async () => {
    const w = world({ generate: [new Error('Failed to fetch')] });
    const end = await runGeneration(w.deps, { mode: 'start', body, key: 'rr-key-1', id: null }, w.onState);
    expect(end).toMatchObject({ phase: 'failed', reportId: null, view: { sentence: 'The report could not be finished. Please try again.', canTryAgain: true } });
    expect(w.calls).toEqual(['generate rr-key-1', 'generate rr-key-1']);
  });

  it('retries a failed report through the server\'s retry path, not a new request', async () => {
    const w = world({ retry: [{ id: ID, status: 'ready', problem: null }] });
    const end = await runGeneration(w.deps, { mode: 'retry', body, key: 'rr-key-1', id: ID }, w.onState);
    expect(end.phase).toBe('ready');
    expect(w.calls).toEqual([`retry ${ID}`]);
  });

  it('after an error from the retry, reads the report instead of guessing', async () => {
    const w = world({ retry: [new Error('HTTP 502')], status: [{ id: ID, status: 'failed', problem: 'The report could not be finished. Please try again.' }] });
    const end = await runGeneration(w.deps, { mode: 'retry', body, key: 'rr-key-1', id: ID }, w.onState);
    expect(w.calls).toEqual([`retry ${ID}`, `status ${ID}`]);
    expect(end).toMatchObject({ phase: 'failed', reportId: ID });
  });

  it('puts up with a few failed asks while polling, then says it is taking long', async () => {
    const w = world({ generate: [{ id: ID, status: 'generating' }], status: [new Error('Failed to fetch')] });
    const end = await runGeneration(w.deps, { mode: 'start', body, key: 'rr-key-1', id: null }, w.onState);
    expect(end).toEqual({ phase: 'slow', reportId: ID });
    expect(w.calls.filter((c) => c.startsWith('status')).length).toBe(3);
  });

  it('stops asking after ten minutes and says it is taking long, with the report\'s id', async () => {
    const w = world({ generate: [{ id: ID, status: 'generating' }], status: [{ id: ID, status: 'generating' }] });
    const end = await runGeneration(w.deps, { mode: 'start', body, key: 'rr-key-1', id: null }, w.onState);
    expect(end).toEqual({ phase: 'slow', reportId: ID });
    expect(w.slept.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(POLL_GIVE_UP_MS);
  });

  it('stops quietly when the screen has gone, and asks nothing more', async () => {
    const w = world({ generate: [{ id: ID, status: 'generating' }], status: [{ id: ID, status: 'generating' }] });
    w.deps.sleep = (ms) => { w.slept.push(ms); w.cancel(); return Promise.resolve(); };
    const end = await runGeneration(w.deps, { mode: 'start', body, key: 'rr-key-1', id: null }, w.onState);
    expect(end).toEqual({ phase: 'cancelled' });
    expect(w.calls.filter((c) => c.startsWith('status'))).toHaveLength(0);
  });

  it('treats a refusal sent as a success as a failure with its sentence', async () => {
    const w = world({ generate: [{ error: 'You have made a lot of reports in the last few minutes. Please wait a little and try again.' }] });
    const end = await runGeneration(w.deps, { mode: 'start', body, key: 'rr-key-1', id: null }, w.onState);
    expect(end).toMatchObject({ phase: 'failed', view: { kind: 'wait' } });
  });
});
