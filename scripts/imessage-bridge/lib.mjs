// Pure helpers for the iMessage bridge (no I/O), tested by vitest.

/** Apple stores dates as nanoseconds since 2001-01-01 (older rows: seconds). */
export function appleDateToIso(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  const secs = n > 1e12 ? n / 1e9 : n;
  return new Date((secs + 978307200) * 1000).toISOString();
}

/**
 * Modern macOS leaves `text` NULL and keeps the body in `attributedBody`, an
 * NSAttributedString typedstream. The string sits right after "NSString" as
 * `+` <length> <utf8 bytes>; a length of 0x81 means a 2-byte little-endian
 * length follows. Everything else in the blob is styling we do not need.
 */
export function textFromAttributedBody(buf) {
  if (!buf || !buf.length) return null;
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  const marker = b.indexOf('NSString');
  if (marker < 0) return null;
  let i = marker + 'NSString'.length;
  // skip the class-info bytes up to the '+' (0x2b) that introduces the string
  const plus = b.indexOf(0x2b, i);
  if (plus < 0 || plus - i > 16) return null;
  i = plus + 1;
  let len = b[i]; i += 1;
  if (len === 0x81) { len = b.readUInt16LE(i); i += 2; }
  else if (len === 0x82) { len = b.readUInt32LE(i); i += 4; }
  if (!Number.isFinite(len) || len <= 0 || i + len > b.length) return null;
  const s = b.subarray(i, i + len).toString('utf8').replace(/￼/g, '').trim();
  return s || null;
}

/** Digits of a US number, with the leading 1 dropped, so +1 (704) 555-0100 and 7045550100 match. */
export function phoneKey(v) {
  const d = String(v ?? '').replace(/\D/g, '');
  return d.length === 11 && d.startsWith('1') ? d.slice(1) : d;
}

/** A handle is a phone number or an email (Apple ID). */
export function handleKey(handle) {
  const h = String(handle ?? '').trim().toLowerCase();
  if (!h) return '';
  return h.includes('@') ? h : phoneKey(h);
}

/** Group chats have a `chat` prefix in their guid; 1:1 threads read `any;-;<handle>`. */
export function isGroupChat(chatGuid) {
  return /^[^;]*;\+;/.test(String(chatGuid ?? '')) || /^chat\d/.test(String(chatGuid ?? '').split(';').pop() || '');
}

/** Turn a chat.db row into what the app ingests. */
export function rowToMessage(r) {
  const text = r.text && String(r.text).trim() ? String(r.text).trim() : textFromAttributedBody(r.attributedBody);
  return {
    guid: r.guid,
    rowid: Number(r.ROWID),
    chatGuid: r.chat_guid || null,
    handle: r.handle || null,
    handleKey: handleKey(r.handle),
    isFromMe: Number(r.is_from_me) === 1,
    service: r.service || null,
    text: text || null,
    sentAt: appleDateToIso(r.date),
    isGroup: isGroupChat(r.chat_guid),
    hasAttachment: Number(r.cache_has_attachments) === 1,
  };
}

/** Which rows leave the Mac: only threads with people the app knows, unless --all. */
export function shouldSync(msg, knownKeys, all) {
  if (!msg.guid || !msg.sentAt) return false;
  if (!msg.text && !msg.hasAttachment) return false;
  if (all) return true;
  if (msg.isGroup) return false;
  return !!msg.handleKey && knownKeys.has(msg.handleKey);
}

/** AppleScript that sends one iMessage (or falls back to SMS) to a handle. */
export function sendScript(handle, body) {
  const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return [
    'tell application "Messages"',
    `  set targetService to 1st account whose service type = iMessage`,
    `  set targetBuddy to participant "${esc(handle)}" of targetService`,
    `  send "${esc(body)}" to targetBuddy`,
    'end tell',
  ].join('\n');
}
