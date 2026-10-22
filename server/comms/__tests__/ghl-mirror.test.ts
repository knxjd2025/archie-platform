import { describe, it, expect, vi } from 'vitest';
import { conversationMessages } from '../ghl-mirror';

const SINCE = Date.parse('2026-10-01T00:00:00Z');

/** GHL's messages endpoint: newest first, 100 a page, `lastMessageId` cursor. */
function thread(total: number, newest = Date.parse('2026-10-14T00:00:00Z'), stepMs = 60_000) {
  const all = Array.from({ length: total }, (_, i) => ({
    id: `m${i}`, messageType: 'TYPE_SMS', dateAdded: new Date(newest - i * stepMs).toISOString(),
  }));
  return vi.fn(async (path: string) => {
    const after = /lastMessageId=([^&]+)/.exec(path)?.[1];
    const start = after ? all.findIndex((m) => m.id === decodeURIComponent(after)) + 1 : 0;
    const messages = all.slice(start, start + 100);
    return { messages: { messages, lastMessageId: messages.at(-1)?.id, nextPage: start + 100 < total } };
  });
}

describe('conversationMessages', () => {
  it('follows the cursor past the first 100 messages', async () => {
    // Only the first page was ever read, so a busy thread lost everything
    // after its newest 100 messages from the history and the KPI counts.
    const fetchPage = thread(250);
    const list = await conversationMessages('c1', SINCE, fetchPage);
    expect(list).toHaveLength(250);
    expect(new Set(list.map((m) => m.id)).size).toBe(250);
    expect(fetchPage).toHaveBeenCalledTimes(3);
  });

  it('stops paging once a page reaches past the window', async () => {
    // Four hours apart, so the first page already reaches back before SINCE.
    const fetchPage = thread(400, Date.parse('2026-10-14T00:00:00Z'), 3_600_000 * 4);
    await conversationMessages('c1', SINCE, fetchPage);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it('reads a short thread in one request', async () => {
    const fetchPage = thread(12);
    expect(await conversationMessages('c1', SINCE, fetchPage)).toHaveLength(12);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });
});
