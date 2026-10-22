import { describe, it, expect, vi, afterEach } from 'vitest';
import { isNoiseConversation, conversationToEvent, getConversationContactId } from '../ghl-brain';

describe('isNoiseConversation', () => {
  it('filters bot blasts, call notifications, and robocallers', () => {
    expect(isNoiseConversation({ lastMessageBody: 'Here is our booking link just in case...' })).toBe(true);
    expect(isNoiseConversation({ lastMessageBody: 'You have a new call from :' })).toBe(true);
    expect(isNoiseConversation({ contactName: 'SMARTCARE' })).toBe(true);
    expect(isNoiseConversation({ contactName: 'TOLL FREE CALL' })).toBe(true);
    expect(isNoiseConversation({ contactName: 'Jane Homeowner', lastMessageBody: 'Is my estimate ready?' })).toBe(false);
  });
});

describe('conversationToEvent', () => {
  it('maps a GHL conversation summary to a BrainEvent', () => {
    const ev = conversationToEvent({
      id: 'conv1',
      contactName: 'Jane Homeowner',
      phone: '+17045551234',
      lastMessageBody: 'Is my estimate ready?',
      lastMessageDirection: 'inbound',
      lastMessageDate: 1784500000000,
    });
    expect(ev.source).toBe('ghl');
    expect(ev.sourceRef).toBe('conv1');
    expect(ev.direction).toBe('inbound');
    expect(ev.contact?.phone).toBe('+17045551234');
  });
});

describe('getConversationContactId', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns null when fetch rejects or response not ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));

    const result = await getConversationContactId('conv1');

    expect(result).toBe(null);
  });

  it('returns null when response is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      text: async () => 'Not found',
    }));

    const result = await getConversationContactId('conv1');

    expect(result).toBe(null);
  });
});
