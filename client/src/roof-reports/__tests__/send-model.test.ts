import { describe, expect, it } from 'vitest';
import { SEND_FAILED, SEND_REPORT_CAPPED } from '../../../../shared/roof-reports';
import { canSubmit, initialSend, makeSendKey, sendBodyOf, sendPrefill, sendReducer, sendsAllowed, sentLine, submitSend, type SendState } from '../send-model';
import { emptyValues } from '../editor-model';
import { RR } from '../words';

const open = (over: Partial<Parameters<typeof sendReducer>[1] & { type: 'open' }> = {}) =>
  sendReducer(initialSend(), { type: 'open', email: 'dana@example.com', name: 'Dana Whitfield', key: 'send-aaaaaaaa', ...over } as never);

describe('the send dialog: what is drawn after each step', () => {
  it('starts closed', () => {
    expect(initialSend()).toMatchObject({ phase: 'closed', email: '', customerName: '', message: '', error: null });
  });

  it('opens with the customer\'s address and name from the report, and one request key for this try', () => {
    expect(open()).toEqual({ phase: 'form', email: 'dana@example.com', customerName: 'Dana Whitfield', message: '', key: 'send-aaaaaaaa', error: null });
  });

  it('keeps what is typed, one field at a time', () => {
    const s = sendReducer(sendReducer(open(), { type: 'edit', field: 'email', text: 'jo@example.com' }), { type: 'edit', field: 'message', text: 'Hello.' });
    expect(s).toMatchObject({ email: 'jo@example.com', message: 'Hello.', customerName: 'Dana Whitfield' });
  });

  it('shows the work in the frame of the click: Sending', () => {
    expect(sendReducer(open(), { type: 'sending' })).toMatchObject({ phase: 'sending', error: null });
  });

  it('says it was sent, and clears an old failure', () => {
    const failed = sendReducer(sendReducer(open(), { type: 'sending' }), { type: 'failed', error: SEND_FAILED });
    expect(failed).toMatchObject({ phase: 'failed', error: SEND_FAILED });
    expect(sendReducer(sendReducer(failed, { type: 'sending' }), { type: 'sent' })).toMatchObject({ phase: 'sent', error: null });
  });

  it('keeps what was typed, and the same key, when a try failed, so Try again is the same request', () => {
    const typed = sendReducer(open(), { type: 'edit', field: 'message', text: 'Hello.' });
    const failed = sendReducer(sendReducer(typed, { type: 'sending' }), { type: 'failed', error: SEND_REPORT_CAPPED });
    expect(failed).toMatchObject({ phase: 'failed', message: 'Hello.', key: 'send-aaaaaaaa', error: SEND_REPORT_CAPPED });
  });

  it('closes, and forgets', () => {
    expect(sendReducer(open(), { type: 'close' })).toEqual(initialSend());
  });

  it('ignores a second press while it is sending', () => {
    const sending = sendReducer(open(), { type: 'sending' });
    expect(canSubmit(sending)).toBe(false);
    expect(canSubmit(open())).toBe(true);
  });
});

describe('what is sent', () => {
  it('is the address, the name and the note, trimmed, with the note and name left out when empty', () => {
    expect(sendBodyOf({ ...open(), email: ' dana@example.com ', message: '  ' } as SendState)).toEqual({ email: 'dana@example.com', customerName: 'Dana Whitfield' });
    expect(sendBodyOf({ ...open(), message: ' Hi. ', customerName: '' } as SendState)).toEqual({ email: 'dana@example.com', message: 'Hi.' });
  });

  it('cannot be sent without something that looks like an address', () => {
    for (const email of ['', 'dana', 'dana@', 'a b@example.com', 'dana@example']) expect(canSubmit({ ...open(), email } as SendState), email).toBe(false);
    expect(canSubmit({ ...open(), email: 'dana@example.com' } as SendState)).toBe(true);
  });

  it('makes a fresh request key for each try, in the form the server takes', () => {
    const keys = new Set(Array.from({ length: 20 }, () => makeSendKey()));
    expect(keys.size).toBe(20);
    for (const k of keys) expect(k).toMatch(/^[A-Za-z0-9_.:-]{8,200}$/);
  });
});

describe('pressing Send', () => {
  const state = (): SendState => sendReducer(open(), { type: 'sending' });

  it('answers sent when the server says it went, and sends the key as the request\'s key', async () => {
    const calls: Array<[unknown, string]> = [];
    const action = await submitSend({ send: async (body, key) => { calls.push([body, key]); return { status: 'sent' }; } }, state());
    expect(action).toEqual({ type: 'sent' });
    expect(calls).toEqual([[{ email: 'dana@example.com', customerName: 'Dana Whitfield' }, 'send-aaaaaaaa']]);
  });

  it('also counts "on its way" (a double click that met the first request) as sent', async () => {
    expect(await submitSend({ send: async () => ({ status: 'sending' }) }, state())).toEqual({ type: 'sent' });
  });

  it('gives the server\'s plain sentence when it refuses, and the standard one for anything that is not plain', async () => {
    expect(await submitSend({ send: async () => { throw new Error(SEND_REPORT_CAPPED); } }, state())).toEqual({ type: 'failed', error: SEND_REPORT_CAPPED });
    for (const message of ['HTTP 500', 'TypeError: Failed to fetch', '{"error":"x"}', 'undefined', '']) {
      expect(await submitSend({ send: async () => { throw new Error(message); } }, state()), message).toEqual({ type: 'failed', error: RR.send.failed });
    }
  });

  it('does not take an answer that is not a send as a send', async () => {
    expect(await submitSend({ send: async () => ({ status: 'maybe' }) }, state())).toEqual({ type: 'failed', error: RR.send.failed });
    expect(await submitSend({ send: async () => null }, state())).toEqual({ type: 'failed', error: RR.send.failed });
  });
});

describe('who sees the button, and the line about earlier emails', () => {
  it('shows the button only to a role that may send', () => {
    expect(sendsAllowed('admin')).toBe(true);
    expect(sendsAllowed('sales')).toBe(true);
    expect(sendsAllowed('production')).toBe(false);
  });

  it('says how many times it was emailed and when it was last, or nothing', () => {
    expect(sentLine(0, null)).toBeNull();
    expect(sentLine(1, '2026-11-24T15:00:00.000Z')).toBe('Emailed once. Last sent Nov 24, 2026.');
    expect(sentLine(3, '2026-11-24T15:00:00.000Z')).toBe('Emailed 3 times. Last sent Nov 24, 2026.');
    expect(sentLine(2, null)).toBe('Emailed 2 times.');
    expect(sentLine(2, 'not a date')).toBe('Emailed 2 times.');
  });
});

describe('what the dialog starts with', () => {
  it('is the customer\'s address and name as they stand in the editor now, typed and saved or not, never what the report was first opened with', () => {
    const values = { ...emptyValues(), customerEmail: 'new.address@example.com', customerName: 'Dana Whitfield' };
    expect(sendPrefill(values)).toEqual({ email: 'new.address@example.com', name: 'Dana Whitfield' });
    expect(sendPrefill(emptyValues())).toEqual({ email: '', name: '' });
  });
});
