import { describe, expect, it } from 'vitest';
import { findRoof } from '../satellite-model';
import { SATELLITE_NOT_FOUND } from '../../../../shared/roof-reports';
import type { RoofDraft } from '../draft';

const roof = (over: Partial<RoofDraft> = {}): RoofDraft => ({ squares: '', pitch: '', stories: '', material: '', ...over });
const where = { address: '12 Elm Street', city: 'Cedar Falls', state: 'IA', zip: '50613', job: null };
const ok = { estimate: { squares: 43.7, pitch: '6/12' }, confidence: 'high' };

async function run(start: RoofDraft, detect: (b: unknown, k: string) => Promise<unknown>) {
  let current = start;
  const keys: string[] = [];
  const out = await findRoof({ where, getRoof: () => current, setRoof: (r) => { current = r; }, detect: (b, k) => { keys.push(k); return detect(b, k); }, key: () => 'sat-test-key-1' });
  return { out, current, keys };
}

describe('pressing "Find it from the satellite"', () => {
  it('fills an empty roof and asks nothing', async () => {
    const r = await run(roof(), async () => ok);
    expect(r.current).toMatchObject({ squares: '43.7', pitch: '6/12' });
    expect(r.out).toEqual({ state: { phase: 'idle' }, confidence: 'high' });
    expect(r.keys).toEqual(['sat-test-key-1']);
  });

  it('keeps typed numbers and hands back the question, in the same answer', async () => {
    const r = await run(roof({ squares: '30', pitch: '8/12' }), async () => ok);
    expect(r.current).toMatchObject({ squares: '30', pitch: '8/12' });
    expect(r.out.state).toEqual({ phase: 'choose', pending: { squares: '43.7', pitch: '6/12' } });
  });

  it('says the plain sentence for an answer it cannot use, and changes nothing', async () => {
    const r = await run(roof({ squares: '30' }), async () => ({ estimate: { squares: 0, pitch: null } }));
    expect(r.out.state).toEqual({ phase: 'failed', message: SATELLITE_NOT_FOUND });
    expect(r.current.squares).toBe('30');
  });

  it('says a plain sentence when the request fails, never the error text', async () => {
    const r = await run(roof(), async () => { throw new Error('HTTP 500'); });
    expect(r.out.state.phase).toBe('failed');
    expect(JSON.stringify(r.out)).not.toMatch(/HTTP|500/);
  });
});
