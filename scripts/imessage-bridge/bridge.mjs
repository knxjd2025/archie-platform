#!/usr/bin/env node
/**
 * iMessage bridge — runs on the Mac that is signed into Messages.
 *
 * Every few seconds it reads new rows from ~/Library/Messages/chat.db (read
 * only, via the sqlite3 CLI — no native modules), keeps the threads with
 * people the app knows (clients and leads; everything else stays on the Mac),
 * and posts them to the Team App under the account whose bridge token this
 * is. It also sends any replies the app has queued, through Messages.app.
 *
 * Setup: System Settings → Privacy & Security → Full Disk Access → add the
 * terminal (or node) that runs this. Then:
 *   BRN_APP_URL=https://app.bestroofingnow.com BRN_BRIDGE_TOKEN=... node scripts/imessage-bridge/bridge.mjs
 * or install.sh to run it at login.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { rowToMessage, shouldSync, sendScript, handleKey } from './lib.mjs';

const run = promisify(execFile);
const APP = (process.env.BRN_APP_URL || 'https://app.bestroofingnow.com').replace(/\/+$/, '');
const TOKEN = process.env.BRN_BRIDGE_TOKEN || '';
const ALL = process.argv.includes('--all') || process.env.BRN_IMESSAGE_ALL === '1';
const DB = path.join(os.homedir(), 'Library/Messages/chat.db');
const STATE = path.join(os.homedir(), '.brn-imessage-bridge.json');
const POLL_MS = Number(process.env.BRN_POLL_MS || 5000);
const BACKFILL_DAYS = Number(process.env.BRN_BACKFILL_DAYS || 30);

if (!TOKEN) { console.error('BRN_BRIDGE_TOKEN is required (My Account → iMessage bridge).'); process.exit(1); }

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const loadState = () => { try { return JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch { return {}; } };
const saveState = (s) => fs.writeFileSync(STATE, JSON.stringify(s));

async function api(method, p, body) {
  const r = await fetch(APP + p, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
  if (!r.ok) throw new Error(`${method} ${p} → ${r.status} ${json?.error || text.slice(0, 120)}`);
  return json;
}

async function sql(query) {
  const { stdout } = await run('sqlite3', ['-readonly', '-json', DB, query], { maxBuffer: 64 * 1024 * 1024 });
  return stdout.trim() ? JSON.parse(stdout) : [];
}

async function newRows(afterRowid) {
  return sql(`
    SELECT m.ROWID, m.guid, m.text, hex(m.attributedBody) AS attributedBody, m.is_from_me, m.service, m.date, m.cache_has_attachments,
           h.id AS handle, c.guid AS chat_guid
    FROM message m
    LEFT JOIN handle h ON h.ROWID = m.handle_id
    LEFT JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
    LEFT JOIN chat c ON c.ROWID = cmj.chat_id
    WHERE m.ROWID > ${Number(afterRowid) || 0}
    ORDER BY m.ROWID ASC
    LIMIT 500`);
}

async function startingRowid() {
  const cutoff = Math.floor((Date.now() / 1000 - BACKFILL_DAYS * 86400 - 978307200)) * 1e9;
  const [r] = await sql(`SELECT COALESCE(MIN(ROWID), 0) - 1 AS start FROM message WHERE date >= ${cutoff}`);
  return Number(r?.start ?? 0);
}

let known = new Set();
let knownAt = 0;
async function refreshKnown() {
  if (Date.now() - knownAt < 5 * 60 * 1000) return;
  const r = await api('GET', '/api/imessage/bridge/handles');
  known = new Set((r.handles || []).map(handleKey).filter(Boolean));
  knownAt = Date.now();
}

async function sendQueued(outbox) {
  for (const o of outbox || []) {
    try {
      await run('osascript', ['-e', sendScript(o.toHandle, o.body)]);
      await api('POST', `/api/imessage/outbox/${o.id}/result`, { ok: true });
      log('sent to', o.toHandle);
    } catch (e) {
      await api('POST', `/api/imessage/outbox/${o.id}/result`, { ok: false, error: String(e?.message || e).slice(0, 300) }).catch(() => {});
      log('send failed', o.toHandle, e?.message || e);
    }
  }
}

async function tick(state) {
  await refreshKnown();
  const rows = await newRows(state.lastRowid);
  const msgs = rows.map((r) => rowToMessage({ ...r, attributedBody: r.attributedBody ? Buffer.from(r.attributedBody, 'hex') : null }));
  const keep = msgs.filter((m) => shouldSync(m, known, ALL));
  const r = await api('POST', '/api/imessage/ingest', { messages: keep.map(({ rowid, handleKey: _k, ...m }) => m), scannedThrough: rows.length ? rows[rows.length - 1].ROWID : state.lastRowid, all: ALL });
  if (rows.length) { state.lastRowid = rows[rows.length - 1].ROWID; saveState(state); }
  if (keep.length) log(`sent ${keep.length} of ${rows.length} new messages (${r.accepted ?? '?'} accepted)`);
  await sendQueued(r.outbox);
}

(async () => {
  if (!fs.existsSync(DB)) { console.error(`No Messages database at ${DB}`); process.exit(1); }
  try { await sql('SELECT 1'); } catch (e) { console.error('Cannot read chat.db — give this terminal Full Disk Access (System Settings → Privacy & Security).', e?.message || e); process.exit(1); }
  const state = loadState();
  if (!state.lastRowid) { state.lastRowid = await startingRowid(); saveState(state); log(`first run: syncing the last ${BACKFILL_DAYS} days`); }
  log(`bridge up → ${APP} (${ALL ? 'all threads' : 'client threads only'})`);
  for (;;) {
    try { await tick(state); } catch (e) { log('tick failed:', e?.message || e); }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
})();
