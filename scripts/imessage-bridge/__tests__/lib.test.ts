import { describe, it, expect } from 'vitest';
import { appleDateToIso, textFromAttributedBody, phoneKey, handleKey, isGroupChat, rowToMessage, shouldSync, sendScript } from '../lib.mjs';

/** Build a typedstream-ish blob the way Messages does: ...NSString...'+' <len> <utf8>. */
function body(text: string, long = false) {
  const utf = Buffer.from(text, 'utf8');
  const len = long ? Buffer.from([0x81, utf.length & 0xff, (utf.length >> 8) & 0xff]) : Buffer.from([utf.length]);
  return Buffer.concat([Buffer.from('streamtyped\x81\xe8\x03\x84\x01@\x84\x84\x84\x12NSAttributedString\x00\x84\x84\x08NSObject\x00\x85\x92\x84\x84\x84\x08NSString\x01\x94\x84\x01', 'latin1'), Buffer.from('+'), len, utf, Buffer.from('\x86\x84\x02iI\x01', 'latin1')]);
}

describe('reading chat.db rows', () => {
  it('converts Apple nanosecond dates', () => {
    expect(appleDateToIso(0)).toBeNull();
    expect(appleDateToIso(779_000_000 * 1e9)).toBe(new Date((779_000_000 + 978307200) * 1000).toISOString());
    expect(appleDateToIso(779_000_000)).toBe(new Date((779_000_000 + 978307200) * 1000).toISOString()); // legacy seconds
  });
  it('pulls the text out of attributedBody, short and long', () => {
    expect(textFromAttributedBody(body('Ok cool'))).toBe('Ok cool');
    const long = 'x'.repeat(300) + ' end';
    expect(textFromAttributedBody(body(long, true))).toBe(long);
    expect(textFromAttributedBody(body('Sorry — it’s taking longer than expected'))).toBe('Sorry — it’s taking longer than expected');
    expect(textFromAttributedBody(Buffer.from('nothing here'))).toBeNull();
    expect(textFromAttributedBody(null)).toBeNull();
  });
  it('normalises handles so +1 (704) 555-0100, 7045550100 and an Apple ID email all key the same way', () => {
    expect(phoneKey('+1 (704) 555-0100')).toBe('7045550100');
    expect(phoneKey('7045550100')).toBe('7045550100');
    expect(handleKey('Pat@Example.com ')).toBe('pat@example.com');
    expect(handleKey('+17045550100')).toBe('7045550100');
  });
  it('tells group chats from 1:1 threads', () => {
    expect(isGroupChat('any;-;+17045550100')).toBe(false);
    expect(isGroupChat('any;+;chat123456789')).toBe(true);
    expect(isGroupChat(null)).toBe(false);
  });
  it('maps a row, preferring the plain text column when it is there', () => {
    const m = rowToMessage({ ROWID: 5, guid: 'G', text: ' hi ', attributedBody: body('ignored'), is_from_me: 1, service: 'iMessage', date: 779_000_000 * 1e9, cache_has_attachments: 0, handle: '+17045550100', chat_guid: 'any;-;+17045550100' });
    expect(m).toMatchObject({ rowid: 5, guid: 'G', text: 'hi', isFromMe: true, handleKey: '7045550100', isGroup: false, hasAttachment: false });
    expect(rowToMessage({ ROWID: 6, guid: 'H', text: null, attributedBody: body('from blob'), is_from_me: 0, date: 779_000_000 * 1e9, handle: 'a@b.com', chat_guid: 'any;-;a@b.com' }).text).toBe('from blob');
  });
});

describe('what leaves the Mac', () => {
  const known = new Set(['7045550100', 'pat@example.com']);
  const base = { guid: 'G', sentAt: '2026-09-15T10:00:00.000Z', text: 'hi', hasAttachment: false, isGroup: false, handleKey: '7045550100' };
  it('only threads with people the app knows, never group chats, unless --all', () => {
    expect(shouldSync(base, known, false)).toBe(true);
    expect(shouldSync({ ...base, handleKey: '9195551212' }, known, false)).toBe(false);
    expect(shouldSync({ ...base, handleKey: '9195551212' }, known, true)).toBe(true);
    expect(shouldSync({ ...base, isGroup: true }, known, false)).toBe(false);
    expect(shouldSync({ ...base, text: null }, known, false)).toBe(false);
    expect(shouldSync({ ...base, text: null, hasAttachment: true }, known, false)).toBe(true);
    expect(shouldSync({ ...base, sentAt: null }, known, true)).toBe(false);
  });
  it('escapes the AppleScript it sends with', () => {
    const s = sendScript('+17045550100', 'Say "hi" \\ now');
    expect(s).toContain('participant "+17045550100"');
    expect(s).toContain('send "Say \\"hi\\" \\\\ now"');
  });
});
