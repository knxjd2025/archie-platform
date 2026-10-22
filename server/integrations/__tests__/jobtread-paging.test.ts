import { describe, it, expect, vi } from 'vitest';
import { collectPages } from '../jobtread';

/** A fake connection of `total` nodes served 100 at a time. */
function pages(total: number, make: (i: number) => any = (i) => ({ id: `n${i}` })) {
  const all = Array.from({ length: total }, (_, i) => make(i));
  return vi.fn(async (page: string | undefined) => {
    const start = page ? Number(page) : 0;
    const nodes = all.slice(start, start + 100);
    const next = start + 100 < total ? String(start + 100) : null;
    return { nodes, nextPage: next, count: total };
  });
}

describe('collectPages', () => {
  it('reads past the first page', () => {
    // getInvoices and getJobs read one page and filtered it, so the CFO's
    // receivables and the CEO's active-job count were whatever fraction of
    // the newest 50-100 records happened to qualify.
    const fetchPage = pages(250);
    return collectPages(fetchPage, { want: 1000 }).then((r) => {
      expect(r.nodes).toHaveLength(250);
      expect(r.exhausted).toBe(true);
      expect(r.count).toBe(250);
      expect(fetchPage).toHaveBeenCalledTimes(3);
    });
  });

  it('keeps paging until enough rows pass the filter', async () => {
    const fetchPage = pages(400, (i) => ({ id: `n${i}`, balance: i % 10 === 0 ? 100 : 0 }));
    const r = await collectPages(fetchPage, { want: 1000, keep: (n) => n.balance > 0 });
    expect(r.nodes).toHaveLength(40);
    expect(r.exhausted).toBe(true);
  });

  it('stops once it has what was asked for', async () => {
    const fetchPage = pages(500);
    const r = await collectPages(fetchPage, { want: 150 });
    expect(r.nodes).toHaveLength(150);
    expect(r.exhausted).toBe(false);
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it('stops at the scan cap and says it did not see everything', async () => {
    const fetchPage = pages(10_000);
    const r = await collectPages(fetchPage, { want: 10_000, maxScan: 300, keep: () => true });
    expect(fetchPage).toHaveBeenCalledTimes(3);
    expect(r.exhausted).toBe(false);
  });

  it('stops on an empty page even if a cursor came back', async () => {
    const fetchPage = vi.fn(async () => ({ nodes: [], nextPage: 'again' }));
    const r = await collectPages(fetchPage, { want: 10 });
    expect(r.nodes).toEqual([]);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });
});
