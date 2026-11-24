import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SendDialog, type SendDialogProps } from '../SendDialog';
import { initialSend, sendReducer, type SendState } from '../send-model';
import { SEND_FAILED } from '../../../../shared/roof-reports';

const BANNED = new RegExp(`${String.fromCharCode(0x2014)}|✨|🪄|Sparkles`, 'u');
const noop = () => {};
const opened = (): SendState => sendReducer(initialSend(), { type: 'open', email: 'dana@example.com', name: 'Dana Whitfield', key: 'send-aaaaaaaa' });
const view = (state: SendState, over: Partial<SendDialogProps> = {}) => renderToStaticMarkup(createElement(SendDialog, { state, onEdit: noop, onSend: noop, onClose: noop, ...over }));

describe('the send dialog as drawn', () => {
  it('draws nothing while it is closed', () => {
    expect(view(initialSend())).toBe('');
  });

  it('is a labelled dialog with a label on every box, and says nothing is attached', () => {
    const h = view(opened());
    expect(h).toMatch(/role="dialog"[^>]*aria-modal="true"/);
    expect(h).toMatch(/aria-labelledby="rr-send-title"/);
    for (const label of ['Customer email', 'Customer name (optional)', 'A note to add (optional)']) expect(h).toContain(label);
    expect(h).not.toMatch(/<(input|select|textarea)(?![^>]*\bid=)[^>]*>/);
    expect(h).toMatch(/<label[^>]*for="rr-send-email"/);
    expect(h).toContain('value="dana@example.com"');
    expect(h).toContain('The report is not attached');
    expect(h).toContain('Send email');
    expect(h).toContain('Cancel');
  });

  it('caps the note at the length the server takes and counts it', () => {
    expect(view(opened())).toMatch(/<textarea[^>]*maxLength="1000"/);
    expect(view(sendReducer(opened(), { type: 'edit', field: 'message', text: 'Hello.' }))).toContain('6 of 1,000');
  });

  it('answers the click at once: Sending, the button off and busy, nothing else to press', () => {
    const h = view(sendReducer(opened(), { type: 'sending' }));
    expect(h).toContain('Sending...');
    expect(h).toMatch(/<button[^>]*disabled=""[^>]*aria-busy="true"|<button[^>]*aria-busy="true"[^>]*disabled=""/);
    expect(h).toMatch(/<input[^>]*disabled=""/);
  });

  it('says plainly that it was sent', () => {
    const h = view(sendReducer(sendReducer(opened(), { type: 'sending' }), { type: 'sent' }));
    expect(h).toContain('Sent. Your customer will get an email with a link to the report.');
    expect(h).toContain('role="status"');
    expect(h).not.toContain('Send email');
    expect(h).toContain('Close');
  });

  it('says plainly when it could not be sent, and lets them try again', () => {
    const h = view(sendReducer(sendReducer(opened(), { type: 'sending' }), { type: 'failed', error: SEND_FAILED }));
    expect(h).toContain(`role="alert"`);
    expect(h).toContain(SEND_FAILED);
    expect(h).toContain('Try again');
  });

  it('holds no em dash, sparkle or wand, and no code', () => {
    for (const s of [opened(), sendReducer(opened(), { type: 'sending' }), sendReducer(opened(), { type: 'failed', error: SEND_FAILED })]) {
      const h = view(s);
      expect(h).not.toMatch(BANNED);
      expect(h).not.toMatch(/undefined|\[object|NaN/);
    }
  });
});
