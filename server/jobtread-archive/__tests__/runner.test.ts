import { describe, it, expect, vi } from 'vitest';

vi.mock('../../db', () => ({ db: {} }));
vi.mock('../../integrations/jobtread', () => ({ JobTreadClient: class {} }));

import { allPages, DeadlineReached } from '../runner';

const read = (r: any) => ({ rows: r.rows, nextPage: r.next });
const row = (id: string) => ({ entityType: 'comment', jtId: id, jobId: 'j1', data: {} });

describe('allPages checks the run deadline before every page', () => {
  it('walks every page while there is time', async () => {
    const pages = [{ rows: [row('a')], next: 'p2' }, { rows: [row('b')], next: null }];
    let i = 0;
    const rows = await allPages(async () => pages[i++], () => ({}), read, Date.now() + 60_000);
    expect(rows.map((r) => r.jtId)).toEqual(['a', 'b']);
  });

  it('stops mid-connection once the deadline passes, so the record is redone whole next run', async () => {
    let calls = 0;
    let clock = 1_000;
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => clock);
    const pave = async () => { calls++; clock = 5_000; return { rows: [row(`r${calls}`)], next: 'more' }; };
    await expect(allPages(pave, () => ({}), read, 2_000)).rejects.toBeInstanceOf(DeadlineReached);
    nowSpy.mockRestore();
    expect(calls).toBe(1);
  });
});
