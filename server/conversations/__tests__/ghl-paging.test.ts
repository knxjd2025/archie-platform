import { describe, it, expect, vi } from 'vitest';
import { fetchGhlConversations, GHL_REP_PAGES } from '../routes';

/** GHL conversations search: newest first, `startAfterDate` cursor. */
function search(total: number) {
  const all = Array.from({ length: total }, (_, i) => ({ id: `c${i}`, lastMessageDate: 2_000_000 - i }));
  return vi.fn(async ({ limit, startAfterDate }: { limit: number; startAfterDate?: number }) => {
    const start = startAfterDate ? all.findIndex((c) => c.lastMessageDate === startAfterDate) + 1 : 0;
    return { conversations: all.slice(start, start + limit) };
  });
}

describe('fetchGhlConversations', () => {
  it('asks for full pages rather than GHL\'s default 20', async () => {
    // With no limit GHL returned 20 conversations for the whole company, and
    // a rep saw those 20 filtered to their own clients — usually none.
    const getPage = search(50);
    await fetchGhlConversations(getPage, 1);
    expect(getPage).toHaveBeenCalledWith({ limit: 100, startAfterDate: undefined });
  });

  it('reads several pages deep for a rep', async () => {
    const getPage = search(1000);
    const list = await fetchGhlConversations(getPage, GHL_REP_PAGES);
    expect(getPage).toHaveBeenCalledTimes(GHL_REP_PAGES);
    expect(list).toHaveLength(GHL_REP_PAGES * 100);
    expect(new Set(list.map((c) => c.id)).size).toBe(list.length);
  });

  it('stops at the last page', async () => {
    const getPage = search(130);
    const list = await fetchGhlConversations(getPage, GHL_REP_PAGES);
    expect(list).toHaveLength(130);
    expect(getPage).toHaveBeenCalledTimes(2);
  });

  it('drops a conversation repeated across a page boundary', async () => {
    const page = Array.from({ length: 100 }, (_, i) => ({ id: `c${i}`, lastMessageDate: 1000 - i }));
    const getPage = vi.fn()
      .mockResolvedValueOnce({ conversations: page })
      .mockResolvedValueOnce({ conversations: [page[99], { id: 'c100', lastMessageDate: 1 }] });
    const list = await fetchGhlConversations(getPage, 3);
    expect(list.map((c) => c.id)).toHaveLength(101);
  });
});
