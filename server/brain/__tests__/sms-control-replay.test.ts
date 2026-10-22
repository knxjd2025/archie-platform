import { describe, it, expect, vi, beforeEach } from 'vitest';

// A sweep killed after processControlEvents but before the GHL cursor was
// saved used to apply the same "SNOOZE 12 2d" again next hour and re-send the
// confirmation. Handled commands are now marked per conversation.
const { marks, updates, sms } = vi.hoisted(() => {
  process.env.JAMES_PHONE = '+17045551234';
  return { marks: new Map<string, string>(), updates: [] as unknown[], sms: [] as string[] };
});

vi.mock('../../db', () => ({
  db: {
    update: () => ({ set: (v: unknown) => ({ where: () => ({ returning: async () => { updates.push(v); return [{ id: 12 }]; } }) }) }),
  },
}));
vi.mock('../cursor-store', () => ({
  getCursor: async (s: string, c: string) => marks.get(`${s}|${c}`) ?? null,
  setCursor: async (s: string, c: string, v: string) => { marks.set(`${s}|${c}`, v); },
}));
vi.mock('../ghl-brain', () => ({
  getConversationContactId: async () => 'contact-1',
  sendGhlSms: async (_c: string, body: string) => { sms.push(body); return { messageId: 'm' }; },
}));

import { processControlEvents } from '../sms-control';

const command = (text: string, iso: string) => ({
  source: 'ghl' as const, sourceRef: 'conv-james', direction: 'inbound' as const,
  contact: { phone: '+17045551234' }, occurredAt: iso, text,
});

describe('processControlEvents does not replay a handled command', () => {
  beforeEach(() => { marks.clear(); updates.length = 0; sms.length = 0; });

  it('applies a command once even when the same event is read again', async () => {
    const ev = command('SNOOZE 12 2d', '2026-10-15T12:00:00Z');
    const first = await processControlEvents([ev]);
    const again = await processControlEvents([ev]);
    expect(first).toMatchObject({ handled: 1, replayed: 0, remaining: [] });
    expect(again).toMatchObject({ handled: 0, replayed: 1, remaining: [] });
    expect(updates).toHaveLength(1);
    expect(sms).toEqual(['Loop 12 snoozed 2d.']);
  });

  it('a newer command on the same conversation still applies', async () => {
    await processControlEvents([command('SNOOZE 12 2d', '2026-10-15T12:00:00Z')]);
    const next = await processControlEvents([command('DONE 12', '2026-10-15T13:00:00Z')]);
    expect(next.handled).toBe(1);
    expect(updates).toHaveLength(2);
  });

  it('ordinary messages still go to triage', async () => {
    const ev = { ...command('Can you come Tuesday?', '2026-10-15T12:00:00Z'), contact: { phone: '+19805550000' } };
    expect((await processControlEvents([ev])).remaining).toEqual([ev]);
  });
});
