import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseControlCommand } from '../sms-control';

describe('parseControlCommand', () => {
  it('parses DONE 42', () => {
    expect(parseControlCommand('DONE 42')).toEqual({ action: 'done', loopId: 42 });
    expect(parseControlCommand('done 42 thanks')).toEqual({ action: 'done', loopId: 42 });
  });
  it('parses SNOOZE 42 2d', () => {
    expect(parseControlCommand('snooze 42 2d')).toEqual({ action: 'snooze', loopId: 42, days: 2 });
    expect(parseControlCommand('SNOOZE 42')).toEqual({ action: 'snooze', loopId: 42, days: 1 });
  });
  it('parses reassignment', () => {
    expect(parseControlCommand('42 -> thomas')).toEqual({ action: 'reassign', loopId: 42, target: 'thomas' });
    expect(parseControlCommand('assign 42 banning')).toEqual({ action: 'reassign', loopId: 42, target: 'banning' });
  });
  it('returns null for normal texts', () => {
    expect(parseControlCommand('Hey are we still on for 10am?')).toBe(null);
  });
});

describe('isTeamControlEvent', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.JAMES_PHONE = '+17045551234';
  });

  async function load() {
    const mod = await import('../sms-control');
    return mod.isTeamControlEvent;
  }

  it('accepts an inbound GHL command text from a team phone', async () => {
    const isTeamControlEvent = await load();
    expect(isTeamControlEvent({
      source: 'ghl', direction: 'inbound',
      contact: { phone: '+17045551234' }, text: 'DONE 12',
    })).toBe(true);
  });

  it('matches on last-10-digits regardless of formatting', async () => {
    const isTeamControlEvent = await load();
    expect(isTeamControlEvent({
      source: 'ghl', direction: 'inbound',
      contact: { phone: '(704) 555-1234' }, text: 'snooze 7 2d',
    })).toBe(true);
  });

  it('rejects command-shaped texts from non-team phones', async () => {
    const isTeamControlEvent = await load();
    expect(isTeamControlEvent({
      source: 'ghl', direction: 'inbound',
      contact: { phone: '+19995550000' }, text: 'DONE 12',
    })).toBe(false);
  });

  it('rejects outbound messages and non-command texts from team phones', async () => {
    const isTeamControlEvent = await load();
    expect(isTeamControlEvent({
      source: 'ghl', direction: 'outbound',
      contact: { phone: '+17045551234' }, text: 'DONE 12',
    })).toBe(false);
    expect(isTeamControlEvent({
      source: 'ghl', direction: 'inbound',
      contact: { phone: '+17045551234' }, text: 'On my way to the site now',
    })).toBe(false);
  });

  it('rejects non-GHL sources even when everything else matches', async () => {
    const isTeamControlEvent = await load();
    expect(isTeamControlEvent({
      source: 'gmail', direction: 'inbound',
      contact: { phone: '+17045551234' }, text: 'DONE 12',
    })).toBe(false);
  });
});
