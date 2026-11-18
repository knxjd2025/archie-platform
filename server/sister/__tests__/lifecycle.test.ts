/**
 * The rest of a Roof Lee company's life in Archie: its team replaced, the
 * readiness question, the health check, and being paused or closed. Against
 * the real test database, through the real request path.
 *
 * What must hold (docs/sisters/contract-v2.md in the Roof Lee repository): a
 * person left out of the team list is refused on their very next request; a
 * company is found by Roof Lee's id and nothing else; pausing and closing
 * delete nothing; and a write sent twice under one key is done once.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import http, { type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { companyBody, dropSecret, localDb, member, sisterSend, startSisterApp, useSecret } from './helpers';

vi.mock('../../seed', () => ({ seedCompany: async () => {}, seedAll: async () => {}, createSeedOnce: () => async () => {} }));
vi.mock('@vercel/functions', () => ({ waitUntil: () => {} }));

describe.skipIf(!localDb)('a Roof Lee company\'s life in Archie', async () => {
  const { db, pool } = await import('../../db');
  const schema = await import('../../../shared/schema');
  const { eq, inArray } = await import('drizzle-orm');
  const { runAsCompany, runAsSystem } = await import('../../tenant/context');
  const { createCompany } = await import('../../tenant/companies');
  const { tenantFromSession } = await import('../../tenant/middleware');
  const { registerTeamRoutes } = await import('../../auth/team-routes');
  const { clearSessionRevalidationCache } = await import('../../auth/middleware');

  const tag = `sis-life-${process.pid}-${Date.now()}`;
  let sister: Server;
  let base = '';
  // The ordinary signed-in app, to ask "may this person still get in?"
  let appServer: Server;
  let appBase = '';
  let sessionUser: Record<string, unknown> | undefined;
  const made: string[] = [];

  const companies = '/api/sister/v1/companies';
  const post = (json: unknown) => sisterSend(base, { method: 'POST', path: companies, json, version: 1 });
  const putMembers = (roofliId: string, json: unknown) => sisterSend(base, { method: 'PUT', path: `${companies}/${roofliId}/members`, json, version: 1 });
  const getCompany = (roofliId: string) => sisterSend(base, { path: `${companies}/${roofliId}`, version: 2 });
  const del = (roofliId: string, json: unknown, key: string | null = randomUUID()) =>
    sisterSend(base, { method: 'DELETE', path: `${companies}/${roofliId}`, json, version: 2, headers: key ? { 'idempotency-key': key } : {} });
  const companyRow = async (id: string) => (await runAsSystem('test', () => db.select().from(schema.companies).where(eq(schema.companies.id, id))))[0];
  const team = (id: string) => runAsCompany(id, () => db.select().from(schema.teamMembers).orderBy(schema.teamMembers.id));

  async function make(over: Record<string, unknown> = {}) {
    const body = companyBody(tag, over);
    const r = await post(body);
    expect(r.status).toBe(201);
    made.push(r.body.companyId);
    return { body, id: r.body.companyId as string, roofliId: body.roofliCompanyId };
  }

  /** A stored session for this person, as the session store keeps it. */
  async function storeSession(companyId: string, email: string): Promise<string> {
    const sid = `${tag}-${randomUUID()}`;
    await pool.query('insert into "session" (sid, sess, expire) values ($1, $2, now() + interval \'1 day\')',
      [sid, JSON.stringify({ cookie: {}, user: { email, name: 'x', role: 'admin', companyId } })]);
    return sid;
  }
  const sessionExists = async (sid: string) => (await pool.query('select 1 from "session" where sid = $1', [sid])).rowCount === 1;
  /** What the app answers this person right now. */
  async function knock(companyId: string, email: string): Promise<number> {
    sessionUser = { email, name: 'x', role: 'admin', companyId };
    return (await fetch(`${appBase}/api/team`)).status;
  }

  beforeAll(async () => {
    ({ server: sister, base } = await startSisterApp());
    const app = express();
    app.use(express.json());
    app.use((req: any, _res, next) => {
      req.session = { user: sessionUser, destroy: (cb: () => void) => { req.session.user = undefined; cb(); } };
      next();
    });
    app.use(tenantFromSession);
    registerTeamRoutes(app);
    appServer = http.createServer(app);
    await new Promise<void>((resolve) => appServer.listen(0, '127.0.0.1', resolve));
    appBase = `http://127.0.0.1:${(appServer.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    sister?.close();
    appServer?.close();
    await pool.query('delete from "session" where sid like $1', [`${tag}-%`]);
    await runAsSystem('test cleanup', async () => {
      if (made.length) await db.delete(schema.teamMembers).where(inArray(schema.teamMembers.companyId, made));
    });
  });
  beforeEach(() => { useSecret(); clearSessionRevalidationCache(); });
  afterEach(() => { dropSecret(); delete process.env.SISTERS_ARCHIE_READY; });

  // ---------------------------------------------------------------- team

  describe('PUT .../members', () => {
    it('makes the team exactly the list, and refuses a removed person\'s very next request', async () => {
      const owner = member(tag, 'owner');
      const leaving = member(tag, 'admin', 'Lee Marsh');
      const { id, roofliId } = await make({ members: [owner, leaving] });
      const sid = await storeSession(id, leaving.email);
      const kept = await storeSession(id, owner.email);
      // Both are in, and the roster has just been read for both (so it is cached).
      expect(await knock(id, leaving.email)).toBe(200);
      expect(await knock(id, owner.email)).toBe(200);

      const joining = member(tag, 'crew', 'Kit Moss');
      const r = await putMembers(roofliId, { roofliCompanyId: roofliId, members: [owner, joining] });
      expect(r.status).toBe(200);

      expect((await team(id)).map((m) => [m.email, m.active, m.canLogin, m.role])).toEqual([
        [owner.email, true, true, 'admin'],
        [leaving.email, false, false, 'admin'],
        [joining.email, true, true, 'production'],
      ]);
      // No waiting for a cache to run out: refused at once, and their stored session is gone.
      expect(await knock(id, leaving.email)).toBe(401);
      expect(await sessionExists(sid)).toBe(false);
      // Everyone still on the team carries on.
      expect(await knock(id, owner.email)).toBe(200);
      expect(await sessionExists(kept)).toBe(true);
    });

    it('takes a changed role at once', async () => {
      const owner = member(tag, 'owner');
      const person = member(tag, 'admin', 'Lee Marsh');
      const { id, roofliId } = await make({ members: [owner, person] });
      // /api/team is for admins only.
      expect(await knock(id, person.email)).toBe(200);
      await putMembers(roofliId, { roofliCompanyId: roofliId, members: [owner, { ...person, role: 'crew' }] });
      expect((await team(id)).find((m) => m.email === person.email)?.role).toBe('production');
      expect(await knock(id, person.email)).toBe(403);
    });

    it('names anyone it could not add', async () => {
      const owner = member(tag, 'owner');
      const { roofliId } = await make({ members: [owner] });
      const bad = { ...member(tag, 'office'), role: 'janitor' };
      const r = await putMembers(roofliId, { roofliCompanyId: roofliId, members: [owner, bad] });
      expect(r.status).toBe(200);
      expect(r.body.skipped).toEqual([{ authUserId: bad.authUserId, reason: expect.any(String) }]);
    });

    it('refuses a body that names another company, or none: the signature covers only the body', async () => {
      const a = await make({ members: [member(tag, 'owner')] });
      const b = await make({ members: [member(tag, 'owner'), member(tag, 'office')] });
      const before = await team(b.id);
      // Signed for A, sent to B's address.
      const moved = await putMembers(b.roofliId, { roofliCompanyId: a.roofliId, members: [] });
      expect(moved.status).toBe(400);
      const unnamed = await putMembers(b.roofliId, { members: [] });
      expect(unnamed.status).toBe(400);
      expect(await team(b.id)).toEqual(before);
    });

    it('answers 404 for a company Roof Lee never made, and 400 for a team it cannot read', async () => {
      const unknown = randomUUID();
      expect((await putMembers(unknown, { roofliCompanyId: unknown, members: [] })).status).toBe(404);
      const { id, roofliId } = await make();
      const before = await team(id);
      expect((await putMembers(roofliId, { roofliCompanyId: roofliId })).status).toBe(400);
      expect((await putMembers(roofliId, { roofliCompanyId: roofliId, members: [{ email: 'a@example.test', role: 'owner' }] })).status).toBe(400);
      expect(await team(id)).toEqual(before);
    });

    it('cannot be aimed at a company by Archie\'s own id', async () => {
      const { id, roofliId } = await make();
      const before = await team(id);
      const r = await putMembers(id, { roofliCompanyId: id, members: [] });
      expect(r.status).toBe(404);
      expect(await team(id)).toEqual(before);
      // The version 2 signature is not taken here.
      const v2 = await sisterSend(base, { method: 'PUT', path: `${companies}/${roofliId}/members`, json: { roofliCompanyId: roofliId, members: [] }, version: 2 });
      expect(v2.status).toBe(401);
      expect(await team(id)).toEqual(before);
    });

    it('an empty list leaves nobody with access', async () => {
      const owner = member(tag, 'owner');
      const { id, roofliId } = await make({ members: [owner] });
      expect((await putMembers(roofliId, { roofliCompanyId: roofliId, members: [] })).status).toBe(200);
      expect((await team(id)).map((m) => [m.active, m.canLogin])).toEqual([[false, false]]);
      expect(await knock(id, owner.email)).toBe(401);
    });
  });

  // --------------------------------------------------------------- ready

  describe('GET /api/sister/v1/ready', () => {
    const ready = (o: { secret?: string; version?: 1 | 2 } = {}) => sisterSend(base, { path: '/api/sister/v1/ready', version: o.version ?? 1, secret: o.secret });

    it('says no until the owner switches it on', async () => {
      expect((await ready()).body).toEqual({ ready: false });
      for (const off of ['', 'false', '0', 'no', 'soon']) {
        process.env.SISTERS_ARCHIE_READY = off;
        expect((await ready()).body, off).toEqual({ ready: false });
      }
      for (const on of ['true', 'TRUE', '1', 'yes']) {
        process.env.SISTERS_ARCHIE_READY = on;
        const r = await ready();
        expect(r.status).toBe(200);
        expect(r.body, on).toEqual({ ready: true });
      }
    });

    it('answers only a request signed the version 1 way with the pair secret', async () => {
      process.env.SISTERS_ARCHIE_READY = 'true';
      expect((await fetch(`${base}/api/sister/v1/ready`)).status).toBe(401);
      expect((await ready({ secret: 'another-secret' })).status).toBe(401);
      expect((await ready({ version: 2 })).status).toBe(401);
      dropSecret();
      expect((await ready()).status).toBe(401);
    });
  });

  // -------------------------------------------------------------- health

  describe('GET .../companies/{roofliCompanyId}', () => {
    it('says where the company stands, in the contract\'s three words', async () => {
      const { id, roofliId } = await make({ plan: { keys: ['base'], active: true, trial: true } });
      for (const [status, word] of [['trial', 'active'], ['active', 'active'], ['paused', 'paused'], ['cancelled', 'closed']] as const) {
        await runAsSystem('test: set status', () => db.update(schema.companies).set({ status }).where(eq(schema.companies.id, id)));
        const r = await getCompany(roofliId);
        expect(r.status).toBe(200);
        expect(r.body).toEqual({ companyId: id, status: word });
      }
    });

    it('answers 404 for anything Roof Lee did not make, found by Roof Lee\'s id and nothing else', async () => {
      expect((await getCompany(randomUUID())).status).toBe(404);
      expect((await getCompany('not-an-id')).status).toBe(404);
      // A company made in Archie itself is not found, by its own id or any other.
      const plain = await createCompany({ slug: `${tag}-plain`, name: 'Plain Roofing', status: 'active' });
      expect((await getCompany(plain.id)).status).toBe(404);
      // Nor is a Roof Lee company by Archie's id for it.
      const { id } = await make();
      expect((await getCompany(id)).status).toBe(404);
    });

    it('takes only the version 2 signature, made for this very address', async () => {
      const a = await make();
      const b = await make();
      expect((await sisterSend(base, { path: `${companies}/${a.roofliId}`, version: 1 })).status).toBe(401);
      // Headers from A's health check do not open B's.
      const { signRequest } = await import('../verify');
      const at = Date.now();
      const stolen = await fetch(`${base}${companies}/${b.roofliId}`, {
        headers: { 'x-roofli-timestamp': String(at), 'x-roofli-signature': signRequest('GET', `${companies}/${a.roofliId}`, '', at, process.env.SISTERS_ARCHIE_SECRET!) },
      });
      expect(stolen.status).toBe(401);
    });
  });

  // ------------------------------------------------------ pause and close

  describe('DELETE .../companies/{roofliCompanyId}', () => {
    it('pauses: nobody gets in, and nothing is deleted', async () => {
      const owner = member(tag, 'owner');
      const { id, roofliId } = await make({ members: [owner, member(tag, 'crew')] });
      await runAsCompany(id, () => db.insert(schema.leads).values({ firstName: `${tag} lead`, source: 'test' }));
      const before = { team: await team(id), leads: await runAsCompany(id, () => db.select().from(schema.leads)) };
      const sid = await storeSession(id, owner.email);
      expect(await knock(id, owner.email)).toBe(200);

      const r = await del(roofliId, { roofliCompanyId: roofliId, mode: 'pause', acting: { authUserId: owner.authUserId, role: 'owner' } });
      expect(r.status).toBe(200);
      expect(r.body).toEqual({ companyId: id, status: 'paused' });
      expect((await companyRow(id)).status).toBe('paused');
      expect((await getCompany(roofliId)).body.status).toBe('paused');

      expect(await knock(id, owner.email)).toBe(401);
      expect(await sessionExists(sid)).toBe(false);
      // Every person and every record is still there.
      expect({ team: await team(id), leads: await runAsCompany(id, () => db.select().from(schema.leads)) }).toEqual(before);
      // And who asked is written down.
      const log = await runAsCompany(id, () => db.select().from(schema.writeLog));
      expect(log.map((l) => [l.system, l.action, l.actor, l.ok])).toEqual([['roofli', 'pause_company', `roofli:${owner.authUserId}`, true]]);
    });

    it('a paused company comes back when Roof Lee says it is paying again', async () => {
      const owner = member(tag, 'owner');
      const { body, id, roofliId } = await make({ members: [owner], plan: { keys: ['base'], active: true, trial: false } });
      // The subscription ended: no person asked, so nobody is named.
      expect((await del(roofliId, { roofliCompanyId: roofliId, mode: 'pause' })).status).toBe(200);
      expect(await knock(id, owner.email)).toBe(401);
      await post(body);
      expect((await companyRow(id)).status).toBe('active');
      expect(await knock(id, owner.email)).toBe(200);
    });

    it('closes for good, deletes nothing, and a later pause or payment does not reopen it', async () => {
      const owner = member(tag, 'owner');
      const { body, id, roofliId } = await make({ members: [owner], plan: { keys: ['base'], active: true, trial: false } });
      const before = await team(id);
      const r = await del(roofliId, { roofliCompanyId: roofliId, mode: 'close', acting: { authUserId: owner.authUserId, role: 'owner' } });
      expect(r.body).toEqual({ companyId: id, status: 'closed' });
      expect((await companyRow(id)).status).toBe('cancelled');
      expect(await team(id)).toEqual(before);
      expect(await knock(id, owner.email)).toBe(401);

      expect((await del(roofliId, { roofliCompanyId: roofliId, mode: 'pause' })).body).toEqual({ companyId: id, status: 'closed' });
      await post(body);
      expect((await companyRow(id)).status).toBe('cancelled');
      expect((await getCompany(roofliId)).body).toEqual({ companyId: id, status: 'closed' });
    });

    it('is safe to receive twice, and does the work once under one key', async () => {
      const { body, id, roofliId } = await make({ plan: { keys: ['base'], active: true, trial: false } });
      const key = randomUUID();
      const pause = { roofliCompanyId: roofliId, mode: 'pause' };
      const first = await del(roofliId, pause, key);
      // The company starts paying again...
      await post(body);
      expect((await companyRow(id)).status).toBe('active');
      // ...and the same pause arrives a second time. It is answered as before and does nothing.
      const repeat = await del(roofliId, pause, key);
      expect(repeat.status).toBe(first.status);
      expect(repeat.body).toEqual(first.body);
      expect((await companyRow(id)).status).toBe('active');
      // A new pause, under a new key, is new work.
      await del(roofliId, pause, randomUUID());
      expect((await companyRow(id)).status).toBe('paused');
      // With no key at all it is still safe to repeat.
      expect((await del(roofliId, pause, null)).status).toBe(200);
      expect((await del(roofliId, pause, null)).status).toBe(200);
      const log = await runAsCompany(id, () => db.select().from(schema.writeLog));
      expect(log.filter((l) => l.action === 'pause_company').length).toBe(4);
    });

    it('keeps one company\'s key from answering for another', async () => {
      const a = await make({ plan: { keys: ['base'], active: true, trial: false } });
      const b = await make({ plan: { keys: ['base'], active: true, trial: false } });
      const key = randomUUID();
      await del(a.roofliId, { roofliCompanyId: a.roofliId, mode: 'pause' }, key);
      expect((await companyRow(b.id)).status).toBe('active');
      const r = await del(b.roofliId, { roofliCompanyId: b.roofliId, mode: 'close' }, key);
      expect(r.body).toEqual({ companyId: b.id, status: 'closed' });
      expect((await companyRow(a.id)).status).toBe('paused');
    });

    it('refuses what it cannot read, and changes nothing', async () => {
      const { id, roofliId } = await make();
      const other = await make();
      const bad: unknown[] = [
        { roofliCompanyId: other.roofliId, mode: 'pause' },
        { mode: 'pause' },
        { roofliCompanyId: roofliId },
        { roofliCompanyId: roofliId, mode: 'delete' },
        { roofliCompanyId: roofliId, mode: 'pause', acting: { authUserId: 'nobody', role: 'owner' } },
        { roofliCompanyId: roofliId, mode: 'pause', acting: { authUserId: randomUUID(), role: 'emperor' } },
      ];
      for (const body of bad) expect((await del(roofliId, body)).status, JSON.stringify(body)).toBe(400);
      expect((await del(roofliId, { roofliCompanyId: roofliId, mode: 'pause' }, 'x'.repeat(300))).status).toBe(400);
      expect((await companyRow(id)).status).toBe('trial');
      expect((await companyRow(other.id)).status).toBe('trial');
    });

    // Contract rule 4: Archie applies its own role rules to the person a
    // write is for. Roof Lee's word on their role is not enough by itself.
    describe('who may pause or close', () => {
      const live = { plan: { keys: ['base'], active: true, trial: false } };
      const refused = async (id: string, r: { status: number; body: any }) => {
        expect(r.status).toBe(403);
        expect(Object.keys(r.body)).toEqual(['error']);
        expect((await companyRow(id)).status).toBe('active');
        expect(await runAsCompany(id, () => db.select().from(schema.writeLog))).toEqual([]);
      };

      it('refuses crew and office, for pause and for close, and ends nobody\'s session', async () => {
        const owner = member(tag, 'owner');
        const crew = member(tag, 'crew');
        const office = member(tag, 'office');
        const { id, roofliId } = await make({ members: [owner, crew, office], ...live });
        const sid = await storeSession(id, owner.email);
        for (const who of [crew, office]) {
          for (const mode of ['pause', 'close']) {
            await refused(id, await del(roofliId, { roofliCompanyId: roofliId, mode, acting: { authUserId: who.authUserId, role: who.role } }));
          }
        }
        expect(await sessionExists(sid)).toBe(true);
        expect(await knock(id, owner.email)).toBe(200);
      });

      it('goes by the role Archie holds, not the role the request states', async () => {
        const crew = member(tag, 'crew');
        const { id, roofliId } = await make({ members: [member(tag, 'owner'), crew], ...live });
        await refused(id, await del(roofliId, { roofliCompanyId: roofliId, mode: 'close', acting: { authUserId: crew.authUserId, role: 'owner' } }));
      });

      it('refuses an admin in Archie whom Roof Lee now calls crew', async () => {
        const owner = member(tag, 'owner');
        const { id, roofliId } = await make({ members: [owner], ...live });
        await refused(id, await del(roofliId, { roofliCompanyId: roofliId, mode: 'close', acting: { authUserId: owner.authUserId, role: 'crew' } }));
      });

      it('refuses someone who is not on this company\'s team', async () => {
        const { id, roofliId } = await make({ ...live });
        await refused(id, await del(roofliId, { roofliCompanyId: roofliId, mode: 'close', acting: { authUserId: randomUUID(), role: 'owner' } }));
      });

      it('refuses the owner of a different company', async () => {
        const elsewhere = member(tag, 'owner');
        await make({ members: [elsewhere], ...live });
        const { id, roofliId } = await make({ ...live });
        await refused(id, await del(roofliId, { roofliCompanyId: roofliId, mode: 'pause', acting: { authUserId: elsewhere.authUserId, role: 'owner' } }));
      });

      it('refuses an owner who has since left the team', async () => {
        const gone = member(tag, 'owner');
        const stays = member(tag, 'owner');
        const { id, roofliId } = await make({ members: [gone, stays], ...live });
        expect((await putMembers(roofliId, { roofliCompanyId: roofliId, members: [stays] })).status).toBe(200);
        await refused(id, await del(roofliId, { roofliCompanyId: roofliId, mode: 'close', acting: { authUserId: gone.authUserId, role: 'owner' } }));
      });

      it('lets an admin pause, as well as an owner', async () => {
        const admin = member(tag, 'admin');
        const { id, roofliId } = await make({ members: [member(tag, 'owner'), admin], ...live });
        const r = await del(roofliId, { roofliCompanyId: roofliId, mode: 'pause', acting: { authUserId: admin.authUserId, role: 'admin' } });
        expect(r.status).toBe(200);
        expect((await companyRow(id)).status).toBe('paused');
      });

      it('does not remember a refusal: the same key works once the person may', async () => {
        const owner = member(tag, 'owner');
        const riser = member(tag, 'crew');
        const { id, roofliId } = await make({ members: [owner, riser], ...live });
        const key = randomUUID();
        const body = { roofliCompanyId: roofliId, mode: 'pause', acting: { authUserId: riser.authUserId, role: 'admin' } };
        await refused(id, await del(roofliId, body, key));
        // Roof Lee's team list, saying this person is now an admin, arrives late.
        expect((await putMembers(roofliId, { roofliCompanyId: roofliId, members: [owner, { ...riser, role: 'admin' }] })).status).toBe(200);
        const r = await del(roofliId, body, key);
        expect(r.status).toBe(200);
        expect((await companyRow(id)).status).toBe('paused');
      });

      it('answers a repeat as it did the first time, even after that person has left', async () => {
        const asker = member(tag, 'owner');
        const stays = member(tag, 'owner');
        const { body: made, id, roofliId } = await make({ members: [asker, stays], ...live });
        const key = randomUUID();
        const pause = { roofliCompanyId: roofliId, mode: 'pause', acting: { authUserId: asker.authUserId, role: 'owner' } };
        const first = await del(roofliId, pause, key);
        expect(first.status).toBe(200);
        await post({ ...made, members: [stays], ...live });
        const repeat = await del(roofliId, pause, key);
        expect([repeat.status, repeat.body]).toEqual([first.status, first.body]);
        expect((await companyRow(id)).status).toBe('active');
      });

      it('still answers 404, not 403, for a company Roof Lee never made', async () => {
        const unknown = randomUUID();
        const r = await del(unknown, { roofliCompanyId: unknown, mode: 'close', acting: { authUserId: randomUUID(), role: 'crew' } });
        expect(r.status).toBe(404);
      });
    });

    it('answers 404 for a company Roof Lee never made, and never reaches one by Archie\'s id', async () => {
      const unknown = randomUUID();
      expect((await del(unknown, { roofliCompanyId: unknown, mode: 'close' })).status).toBe(404);
      const plain = await createCompany({ slug: `${tag}-plain-close`, name: 'Plain Roofing', status: 'active' });
      expect((await del(plain.id, { roofliCompanyId: plain.id, mode: 'close' })).status).toBe(404);
      expect((await companyRow(plain.id)).status).toBe('active');
      const { id } = await make();
      expect((await del(id, { roofliCompanyId: id, mode: 'close' })).status).toBe(404);
      expect((await companyRow(id)).status).toBe('trial');
    });

    it('takes only the version 2 signature', async () => {
      const { id, roofliId } = await make();
      const r = await sisterSend(base, { method: 'DELETE', path: `${companies}/${roofliId}`, json: { roofliCompanyId: roofliId, mode: 'close' }, version: 1 });
      expect(r.status).toBe(401);
      expect((await companyRow(id)).status).toBe('trial');
    });
  });
});
