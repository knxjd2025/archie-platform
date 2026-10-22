/**
 * iMessage — a bridge running on a team member's Mac (scripts/imessage-bridge)
 * pushes that person's iMessage threads with clients into the app and sends
 * replies the app queues. Each bridge authenticates with a token the owner
 * generates on My Account; only the owner's own threads are stored and shown.
 */
import type { Express, Request, Response } from 'express';
import crypto from 'node:crypto';
import { and, desc, eq, gt, inArray, isNotNull, or, sql, type SQL } from 'drizzle-orm';
import { db } from '../db';
import { imessages, imessageOutbox, leads, settings } from '../../shared/schema';
import { requireAuth } from '../auth/middleware';
import { ownsLead, repLeadWhere, type SessionUser } from '../access/rep-scope';
import { getTeamMemberByEmail } from '../storage/team';
import { memberCanLogin } from '../auth/allowlist';
import { sendFailure } from '../lib/failure';

const TOKEN_KEY = (email: string) => `imessage.bridge.${email.toLowerCase()}`;
const ONLINE_MS = 2 * 60 * 1000;

export const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
export function phoneKey(v: string | null | undefined): string {
  const d = String(v ?? '').replace(/\D/g, '');
  return d.length === 11 && d.startsWith('1') ? d.slice(1) : d;
}
export function handleKey(h: string | null | undefined): string {
  const s = String(h ?? '').trim().toLowerCase();
  return s.includes('@') ? s : phoneKey(s);
}

interface BridgeRecord { tokenHash: string; createdAt: string; lastSeenAt?: string | null; all?: boolean }

async function bridgeFor(email: string): Promise<BridgeRecord | null> {
  const [row] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, TOKEN_KEY(email)));
  return (row?.value as BridgeRecord) ?? null;
}
async function saveBridge(email: string, rec: BridgeRecord) {
  await db.insert(settings).values({ key: TOKEN_KEY(email), value: rec, updatedAt: new Date() })
    .onConflictDoUpdate({ target: settings.key, set: { value: rec, updatedAt: new Date() } });
}

/** The account a bridge token belongs to, or null. Tokens look like brn_im.<email-b64url>.<secret>; the dot cannot occur in base64url, so the split is unambiguous. */
export async function ownerOfToken(token: string): Promise<string | null> {
  const m = /^brn_im\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(token || '');
  if (!m) return null;
  const email = Buffer.from(m[1], 'base64url').toString('utf8').toLowerCase();
  const rec = await bridgeFor(email);
  if (!rec || rec.tokenHash !== sha256(token)) return null;
  return email;
}

async function bridgeAuth(req: Request, res: Response): Promise<string | null> {
  const header = String(req.headers.authorization || '');
  const owner = header.startsWith('Bearer ') ? await ownerOfToken(header.slice(7)) : null;
  if (!owner) { res.status(401).json({ error: 'bad bridge token' }); return null; }
  return owner;
}

/**
 * The leads a bridge may see: its owner's, by the same rule the app uses for
 * them signed in. Handles and ingest matched against every lead, so a rep's
 * bridge downloaded the whole company's client phones and emails and tagged
 * their own texts onto other reps' clients. Undefined means the owner sees
 * every lead. Null means the owner is off the roster, so the token is dead.
 */
async function bridgeLeadScope(owner: string): Promise<SQL | undefined | null> {
  const member = await getTeamMemberByEmail(owner);
  if (!member || !memberCanLogin(member)) return null;
  return repLeadWhere({ email: member.email, name: member.name, role: member.role });
}

async function bridgeScopeOr401(owner: string, res: Response): Promise<{ scope: SQL | undefined } | null> {
  const scope = await bridgeLeadScope(owner);
  if (scope === null) { res.status(401).json({ error: 'bad bridge token' }); return null; }
  return { scope };
}

const withScope = (where: SQL, scope: SQL | undefined): SQL => (scope ? (and(where, scope) as SQL) : where);

/** Every phone and email the owner knows a client by — what the bridge syncs threads for. */
async function knownHandles(scope: SQL | undefined): Promise<string[]> {
  const rows = await db.select({ phone: leads.phone, email: leads.email }).from(leads).where(withScope(or(isNotNull(leads.phone), isNotNull(leads.email)) as SQL, scope));
  const out = new Set<string>();
  for (const r of rows) { const p = phoneKey(r.phone); if (p.length === 10) out.add(p); const e = String(r.email || '').trim().toLowerCase(); if (e.includes('@')) out.add(e); }
  return Array.from(out);
}

async function leadForHandle(key: string, scope: SQL | undefined): Promise<{ externalId: string | null; name: string | null } | null> {
  if (!key) return null;
  const rows = key.includes('@')
    ? await db.select({ externalId: leads.externalId, firstName: leads.firstName, lastName: leads.lastName, jobName: leads.jobName }).from(leads).where(withScope(sql`lower(${leads.email}) = ${key}`, scope)).limit(1)
    : await db.select({ externalId: leads.externalId, firstName: leads.firstName, lastName: leads.lastName, jobName: leads.jobName }).from(leads).where(withScope(sql`regexp_replace(coalesce(${leads.phone}, ''), '\\D', '', 'g') LIKE ${'%' + key}`, scope)).limit(1);
  const r = rows[0];
  return r ? { externalId: r.externalId, name: [r.firstName, r.lastName].filter(Boolean).join(' ') || r.jobName || null } : null;
}

export function registerImessageRoutes(app: Express) {
  // ---- owner-facing ------------------------------------------------------
  app.get('/api/imessage/status', requireAuth, async (req: Request, res: Response) => {
    try {
      const user = req.session.user! as SessionUser;
      const rec = await bridgeFor(user.email);
      const lastSeen = rec?.lastSeenAt ? new Date(rec.lastSeenAt) : null;
      const [cnt] = await db.select({ n: sql<number>`count(*)` }).from(imessages).where(eq(imessages.owner, user.email.toLowerCase()));
      res.json({ configured: !!rec, online: !!lastSeen && Date.now() - lastSeen.getTime() < ONLINE_MS, lastSeenAt: rec?.lastSeenAt ?? null, createdAt: rec?.createdAt ?? null, messages: Number(cnt?.n || 0), all: !!rec?.all });
    } catch (e: any) { return sendFailure(res, e, 'GET /api/imessage/status', 500); }
  });

  // Make (or replace) my bridge token. Shown once.
  app.post('/api/imessage/bridge/token', requireAuth, async (req: Request, res: Response) => {
    try {
      const user = req.session.user! as SessionUser;
      const email = user.email.toLowerCase();
      const token = `brn_im.${Buffer.from(email).toString('base64url')}.${crypto.randomBytes(24).toString('base64url')}`;
      await saveBridge(email, { tokenHash: sha256(token), createdAt: new Date().toISOString(), lastSeenAt: null });
      res.json({ ok: true, token, command: `BRN_APP_URL=${process.env.APP_BASE_URL || 'https://app.bestroofingnow.com'} BRN_BRIDGE_TOKEN=${token} node scripts/imessage-bridge/bridge.mjs` });
    } catch (e: any) { return sendFailure(res, e, 'POST /api/imessage/bridge/token', 500); }
  });

  app.delete('/api/imessage/bridge/token', requireAuth, async (req: Request, res: Response) => {
    try {
      const user = req.session.user! as SessionUser;
      await db.delete(settings).where(eq(settings.key, TOKEN_KEY(user.email)));
      res.json({ ok: true });
    } catch (e: any) { return sendFailure(res, e, 'DELETE /api/imessage/bridge/token', 500); }
  });

  // The thread with one client (owner's messages only — a rep never sees another person's iMessages).
  app.get('/api/clients/:externalId/imessages', requireAuth, async (req: Request, res: Response) => {
    try {
      const user = req.session.user! as SessionUser;
      const [lead] = await db.select({ externalId: leads.externalId, phone: leads.phone, email: leads.email }).from(leads).where(eq(leads.externalId, req.params.externalId));
      if (!lead) return res.status(404).json({ error: 'not found' });
      if (!(await ownsLead(user, lead.externalId))) return res.status(404).json({ error: 'not found' });
      const keys = [phoneKey(lead.phone), String(lead.email || '').toLowerCase()].filter((k) => k && (k.includes('@') || k.length === 10));
      const owner = user.email.toLowerCase();
      const rows = keys.length
        ? await db.select().from(imessages).where(and(eq(imessages.owner, owner), or(eq(imessages.matchedExternalId, lead.externalId!), inArray(imessages.handleKey, keys)))).orderBy(desc(imessages.sentAt)).limit(100)
        : await db.select().from(imessages).where(and(eq(imessages.owner, owner), eq(imessages.matchedExternalId, lead.externalId!))).orderBy(desc(imessages.sentAt)).limit(100);
      const rec = await bridgeFor(owner);
      const online = !!rec?.lastSeenAt && Date.now() - new Date(rec.lastSeenAt).getTime() < ONLINE_MS;
      const pending = await db.select().from(imessageOutbox).where(and(eq(imessageOutbox.owner, owner), eq(imessageOutbox.status, 'queued'))).limit(20);
      res.json({ messages: rows, bridge: { configured: !!rec, online }, handle: keys.find((k) => !k.includes('@')) ? lead.phone : lead.email, pending: pending.filter((p) => keys.includes(handleKey(p.toHandle))) });
    } catch (e: any) { return sendFailure(res, e, 'GET /api/clients/:externalId/imessages', 500); }
  });

  // Queue an iMessage for my bridge to send.
  app.post('/api/imessage/send', requireAuth, async (req: Request, res: Response) => {
    try {
      const user = req.session.user! as SessionUser;
      const owner = user.email.toLowerCase();
      const rec = await bridgeFor(owner);
      if (!rec) return res.status(400).json({ error: 'Set up the iMessage bridge on My Account first.' });
      const to = String(req.body?.to || '').trim();
      const body = String(req.body?.body || '').trim().slice(0, 2000);
      const externalId = String(req.body?.externalId || '').trim() || null;
      if (!to || !body) return res.status(400).json({ error: 'to and body are required' });
      if (externalId && !(await ownsLead(user, externalId))) return res.status(404).json({ error: 'not found' });
      const [row] = await db.insert(imessageOutbox).values({ owner, toHandle: to, body, externalId, createdBy: user.email, status: 'queued' }).returning();
      res.json({ ok: true, queued: row, bridgeOnline: !!rec.lastSeenAt && Date.now() - new Date(rec.lastSeenAt).getTime() < ONLINE_MS });
    } catch (e: any) { return sendFailure(res, e, 'POST /api/imessage/send', 500); }
  });

  // ---- bridge-facing (token auth) -----------------------------------------
  app.get('/api/imessage/bridge/handles', async (req: Request, res: Response) => {
    const owner = await bridgeAuth(req, res); if (!owner) return;
    try {
      const access = await bridgeScopeOr401(owner, res); if (!access) return;
      res.json({ handles: await knownHandles(access.scope) });
    } catch (e: any) { return sendFailure(res, e, 'GET /api/imessage/bridge/handles', 500); }
  });

  app.post('/api/imessage/ingest', async (req: Request, res: Response) => {
    const owner = await bridgeAuth(req, res); if (!owner) return;
    try {
      const access = await bridgeScopeOr401(owner, res); if (!access) return;
      const list: any[] = Array.isArray(req.body?.messages) ? req.body.messages.slice(0, 500) : [];
      let accepted = 0;
      for (const m of list) {
        const guid = String(m?.guid || '').trim();
        const sentAt = m?.sentAt ? new Date(m.sentAt) : null;
        if (!guid || !sentAt || Number.isNaN(sentAt.getTime())) continue;
        const key = handleKey(m.handle);
        const match = await leadForHandle(key, access.scope);
        const r = await db.insert(imessages).values({
          owner, guid, chatGuid: m.chatGuid ? String(m.chatGuid) : null, handle: m.handle ? String(m.handle) : null, handleKey: key || null,
          direction: m.isFromMe ? 'outbound' : 'inbound', service: m.service ? String(m.service) : null,
          text: m.text ? String(m.text).slice(0, 4000) : null, hasAttachment: !!m.hasAttachment, isGroup: !!m.isGroup,
          sentAt, matchedExternalId: match?.externalId ?? null, matchedName: match?.name ?? null,
        }).onConflictDoNothing({ target: imessages.guid }).returning({ id: imessages.id });
        if (r.length) accepted++;
      }
      const rec = (await bridgeFor(owner)) || { tokenHash: '', createdAt: new Date().toISOString() };
      await saveBridge(owner, { ...rec, lastSeenAt: new Date().toISOString(), all: !!req.body?.all });
      const outbox = await db.select({ id: imessageOutbox.id, toHandle: imessageOutbox.toHandle, body: imessageOutbox.body })
        .from(imessageOutbox).where(and(eq(imessageOutbox.owner, owner), eq(imessageOutbox.status, 'queued'))).orderBy(imessageOutbox.id).limit(10);
      if (outbox.length) await db.update(imessageOutbox).set({ status: 'sending', updatedAt: new Date() }).where(inArray(imessageOutbox.id, outbox.map((o) => o.id)));
      res.json({ ok: true, accepted, outbox });
    } catch (e: any) { return sendFailure(res, e, 'POST /api/imessage/ingest', 500); }
  });

  app.post('/api/imessage/outbox/:id/result', async (req: Request, res: Response) => {
    const owner = await bridgeAuth(req, res); if (!owner) return;
    try {
      const ok = req.body?.ok === true;
      const [row] = await db.update(imessageOutbox)
        .set({ status: ok ? 'sent' : 'failed', error: ok ? null : String(req.body?.error || 'send failed').slice(0, 300), sentAt: ok ? new Date() : null, updatedAt: new Date() })
        .where(and(eq(imessageOutbox.id, Number(req.params.id)), eq(imessageOutbox.owner, owner))).returning();
      if (!row) return res.status(404).json({ error: 'not found' });
      if (ok) {
        // Mirror the sent text into the thread right away; the bridge will also see it in chat.db and skip the duplicate guid.
        await db.insert(imessages).values({ owner, guid: `app-outbox-${row.id}`, handle: row.toHandle, handleKey: handleKey(row.toHandle), direction: 'outbound', service: 'iMessage', text: row.body, sentAt: new Date(), matchedExternalId: row.externalId, hasAttachment: false, isGroup: false }).onConflictDoNothing();
      }
      res.json({ ok: true });
    } catch (e: any) { return sendFailure(res, e, 'POST /api/imessage/outbox/:id/result', 500); }
  });
}

/** Latest inbound/outbound per handle for the owner — merged into the Conversations feed. */
export async function imessageConversations(owner: string, since: Date): Promise<Array<{ id: string; source: string; channel: string; contact: string; contactId: string; lastMessage: string; direction: string; date: number; unread: number }>> {
  const rows = await db.select().from(imessages).where(and(eq(imessages.owner, owner.toLowerCase()), gt(imessages.sentAt, since))).orderBy(desc(imessages.sentAt)).limit(400);
  const seen = new Map<string, typeof rows[number]>();
  for (const r of rows) { const k = r.handleKey || r.handle || r.guid; if (!seen.has(k)) seen.set(k, r); }
  return Array.from(seen.values()).map((r) => ({
    id: `imessage:${r.handleKey || r.guid}`, source: 'imessage', channel: 'sms',
    contact: r.matchedName || r.handle || 'Unknown', contactId: r.matchedExternalId || '',
    lastMessage: r.text || (r.hasAttachment ? '📎 attachment' : ''), direction: r.direction, date: r.sentAt ? r.sentAt.getTime() : 0, unread: 0,
  }));
}
