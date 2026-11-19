/**
 * Archie's own jobs, as Roof Lee's assistant moves them: a lead Roof Lee's
 * company holds has an Archie-made job identity from the moment it is made,
 * and sits on the production board with no JobTread behind it. Against the real test database, through
 * the real request path.
 *
 * What must hold (docs/sisters/contract-v2.md in the Roof Lee repository,
 * "Archie"): the company comes from the address; a job that belongs to
 * another company is not found; Archie applies its own role rules and its own
 * board rules to the move; a move sent twice is made once; and nothing leaves
 * Archie for any outside system.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { companyBody, dropSecret, localDb, member, sisterSend, startSisterApp, useSecret, type TestMember } from './helpers';

vi.mock('../../seed', () => ({ seedCompany: async () => {}, seedAll: async () => {}, SEED_JOB: 'seed-company', seedVersion: () => 'test' }));
vi.mock('@vercel/functions', () => ({ waitUntil: () => {} }));

describe.skipIf(!localDb)('Archie\'s own jobs', async () => {
  const { db } = await import('../../db');
  const schema = await import('../../../shared/schema');
  const { eq, desc } = await import('drizzle-orm');
  const { runAsCompany } = await import('../../tenant/context');
  const { createCompany } = await import('../../tenant/companies');
  const { ensureJobIdentity, isNativeJobId, recordPhotoConsent } = await import('../../production/native-jobs');
  const { moveStage, completeTrade } = await import('../../production/pipeline');

  const tag = `sis-job-${process.pid}-${Date.now()}`;
  const companies = '/api/sister/v1/companies';
  let server: Server;
  let base = '';
  let outside: string[] = [];

  beforeAll(async () => { ({ server, base } = await startSisterApp()); });
  afterAll(() => { server?.close(); });
  beforeEach(() => {
    useSecret();
    // Nothing may leave the building: watch every outgoing request.
    const real = globalThis.fetch;
    outside = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation((input: any, init?: any) => {
      const url = String(typeof input === 'string' || input instanceof URL ? input : input.url);
      if (!url.startsWith(base)) outside.push(url);
      return real(input, init);
    });
  });
  afterEach(() => { dropSecret(); vi.restoreAllMocks(); });

  interface Made { id: string; roofliId: string; owner: TestMember; office: TestMember; crew: TestMember }
  async function make(): Promise<Made> {
    const owner = member(tag, 'owner', 'Dana Whitfield');
    const office = member(tag, 'office', 'Riley Marsh');
    const crew = member(tag, 'crew', 'Sam Ortiz');
    const body = companyBody(tag, { members: [owner, office, crew] });
    const r = await sisterSend(base, { method: 'POST', path: companies, json: body, version: 1 });
    expect(r.status).toBe(201);
    return { id: r.body.companyId, roofliId: body.roofliCompanyId as string, owner, office, crew };
  }
  const as = (m: TestMember) => ({ authUserId: m.authUserId, role: m.role });
  const who = (m: TestMember) => `actingUserId=${m.authUserId}&actingRole=${m.role}`;
  const read = (c: Made, path: string, m?: TestMember) =>
    sisterSend(base, { path: `${companies}/${c.roofliId}${path}${m ? `?${who(m)}` : ''}`, version: 2 });
  const write = (c: Made, method: string, path: string, json: Record<string, unknown>, key: string | null = randomUUID()) =>
    sisterSend(base, { method, path: `${companies}/${c.roofliId}${path}`, json, version: 2, headers: key ? { 'idempotency-key': key } : {} });
  async function newLead(c: Made, name = 'Pat Hollis'): Promise<string> {
    const r = await write(c, 'POST', '/leads', { name, town: 'Cedar Falls', jobType: 'replacement', acting: as(c.office) });
    expect(r.status).toBe(201);
    return r.body.leadId as string;
  }
  const move = (c: Made, id: string, stage: unknown, m: TestMember, key?: string | null) =>
    write(c, 'POST', `/jobs/${id}/stage`, { stage, acting: as(m) }, key);
  const leadRow = async (c: Made, id: string) =>
    (await runAsCompany(c.id, () => db.select().from(schema.leads).where(eq(schema.leads.id, Number(id)))))[0];
  const boardRows = (c: Made) => runAsCompany(c.id, () => db.select().from(schema.productionPipeline));
  const logRows = (c: Made) => runAsCompany(c.id, () => db.select().from(schema.writeLog).orderBy(desc(schema.writeLog.id)));

  it('says it can keep this company\'s jobs on its own board', async () => {
    const c = await make();
    const r = await read(c, '/capabilities');
    expect(r.status).toBe(200);
    expect(r.body.capabilities).toContain('jobs.native');
  });

  it('keeps what Roof Lee said the job is, on the job', async () => {
    const c = await make();
    const id = await newLead(c);
    expect(await leadRow(c, id)).toMatchObject({ jobType: 'replacement', serviceType: 'replacement', photoConsent: false, lat: null, lng: null, leadSource: null, postRef: null });
    const one = await read(c, `/jobs/${id}`, c.office);
    expect(one.body.job).toMatchObject({ id, kind: 'lead', jobType: 'replacement' });
  });

  it('gives a new lead an identity Archie made at once, in New Lead, so office staff can open it', async () => {
    const c = await make();
    const id = await newLead(c);
    const lead = await leadRow(c, id);
    expect(lead.externalId).toMatch(/^archie-[0-9a-f]{32}$/);
    expect(isNativeJobId(lead.externalId)).toBe(true);
    expect(lead).toMatchObject({ source: 'roofli', stage: 'New Lead' });
    // A lead, not yet a job: nothing is on the board until it is moved there.
    expect(await boardRows(c)).toEqual([]);
    expect((await read(c, `/jobs/${id}`, c.office)).body.job).toMatchObject({ id, kind: 'lead', stage: 'New Lead' });
    // Each lead its own.
    const other = await leadRow(c, await newLead(c, 'Jo Burst'));
    expect(isNativeJobId(other.externalId)).toBe(true);
    expect(other.externalId).not.toBe(lead.externalId);
  });

  it('puts a lead on the board under the identity it already has, and calls nobody outside', async () => {
    const c = await make();
    const id = await newLead(c);
    const made = (await leadRow(c, id)).externalId;

    const r = await move(c, id, 'approved', c.office);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true, stage: 'approved' });
    const lead = await leadRow(c, id);
    expect(lead.externalId).toBe(made);
    // The status the rest of Archie reads says where it is now, not New Lead.
    expect(lead.stage).toBe('Buyer Approved');
    const board = await boardRows(c);
    expect(board).toHaveLength(1);
    expect(board[0]).toMatchObject({ jobExternalId: lead.externalId, stage: 'approved', companyId: c.id });

    // Roof Lee now sees a job, at its stage on the board, under the same id as before.
    const one = await read(c, `/jobs/${id}`, c.office);
    expect(one.body.job).toMatchObject({ id, kind: 'job', stage: 'approved' });
    const list = await read(c, '/jobs', c.owner);
    expect(list.body.jobs).toEqual([expect.objectContaining({ id, kind: 'job', stage: 'approved' })]);

    // Onward, and the status the rest of Archie reads follows without JobTread.
    expect((await move(c, id, 'pre_production', c.owner)).body).toEqual({ ok: true, stage: 'pre_production' });
    expect((await leadRow(c, id)).stage).toBe('Pre-Construction');
    expect((await leadRow(c, id)).externalId).toBe(lead.externalId);

    expect(outside).toEqual([]);
    const log = await logRows(c);
    expect(log.filter((l) => l.system === 'jobtread')).toEqual([]);
    expect(log.find((l) => l.action === 'move_job')).toMatchObject({ actor: c.owner.email, system: 'roofli', targetId: id, ok: true });
  });

  it('keeps the board\'s own rules: a move the board would refuse a person is refused Roof Lee too', async () => {
    const c = await make();
    const id = await newLead(c);
    const made = (await leadRow(c, id)).externalId;
    // Turned down before it was ever on the board: it is not put there, and keeps the identity it has.
    const early = await move(c, id, 'closed_out', c.office);
    expect(early.status).toBe(409);
    expect((await leadRow(c, id)).externalId).toBe(made);
    expect((await leadRow(c, id)).stage).toBe('New Lead');
    expect(await boardRows(c)).toEqual([]);
    expect((await move(c, id, 'pre_production', c.office)).status).toBe(200);
    // Scheduling waits for the pre-construction checklist, whoever asks.
    const key = randomUUID();
    const refused = await move(c, id, 'schedule', c.office, key);
    expect(refused.status).toBe(409);
    expect(refused.body.error).toMatch(/pre-construction checklist/i);
    expect((await boardRows(c))[0].stage).toBe('pre_production');
    // A refusal is not kept: the same request goes through once the checklist is in.
    const lead = await leadRow(c, id);
    await runAsCompany(c.id, () => db.insert(schema.preConstructionChecklists).values({ jobExternalId: lead.externalId!, status: 'submitted', createdBy: c.office.email }));
    expect((await move(c, id, 'schedule', c.office, key)).status).toBe(200);
    expect((await boardRows(c))[0].stage).toBe('schedule');
    // A stage Archie does not have.
    expect((await move(c, id, 'constructor', c.office)).status).toBe(400);
    expect((await move(c, id, 'done', c.office)).status).toBe(400);
    expect((await move(c, id, undefined, c.office)).status).toBe(400);
    expect((await boardRows(c))[0].stage).toBe('schedule');
  });

  it('makes one move for one key, and one identity however many arrive together', async () => {
    const c = await make();
    const id = await newLead(c);
    const key = randomUUID();
    const first = await move(c, id, 'waiting_dp', c.office, key);
    const again = await move(c, id, 'waiting_dp', c.office, key);
    expect(first.status).toBe(200);
    expect(again.body).toEqual(first.body);
    expect((await logRows(c)).filter((l) => l.action === 'move_job')).toHaveLength(1);

    const other = await newLead(c, 'Jo Burst');
    const burst = await Promise.all([1, 2, 3, 4].map(() => move(c, other, 'approved', c.office)));
    for (const r of burst) expect(r.status).toBe(200);
    const board = await boardRows(c);
    expect(board).toHaveLength(2);
    expect(new Set(board.map((b) => b.jobExternalId)).size).toBe(2);
    expect(board.map((b) => b.jobExternalId)).toContain((await leadRow(c, other)).externalId);
  });

  it('applies Archie\'s own role rules, and finds nothing in another company', async () => {
    const c = await make();
    const d = await make();
    const id = await newLead(c);
    expect((await move(c, id, 'approved', c.crew)).status).toBe(403);
    // Another company's lead, asked for under this company's address.
    expect((await move(d, id, 'approved', d.owner)).status).toBe(404);
    expect((await move(c, '999999999', 'approved', c.owner)).status).toBe(404);
    expect((await move(c, 'archie-1', 'approved', c.owner)).status).toBe(404);
    // Who it is for, and a key, are both required.
    expect((await write(c, 'POST', `/jobs/${id}/stage`, { stage: 'approved' })).status).toBe(400);
    expect((await move(c, id, 'approved', c.owner, null)).status).toBe(400);
    expect(isNativeJobId((await leadRow(c, id)).externalId)).toBe(true);
    expect((await leadRow(c, id)).stage).toBe('New Lead');
    expect(await boardRows(c)).toEqual([]);
    expect(await boardRows(d)).toEqual([]);
    // The older signature opens nothing here.
    const v1 = await sisterSend(base, { method: 'POST', path: `${companies}/${c.roofliId}/jobs/${id}/stage`, json: { stage: 'approved', acting: as(c.owner) }, version: 1, headers: { 'idempotency-key': randomUUID() } });
    expect(v1.status).toBe(401);
  });

  it('leaves a job that another system keeps where it is', async () => {
    const c = await make();
    const [row] = await runAsCompany(c.id, () => db.insert(schema.leads).values({ source: 'manual', externalId: `${tag}-elsewhere`, firstName: 'Pat', status: 'won' } as any).returning());
    const r = await move(c, String(row.id), 'approved', c.owner);
    expect(r.status).toBe(409);
    expect(await boardRows(c)).toEqual([]);
    expect(outside).toEqual([]);
  });

  it('gives an identity only in a company that keeps its own jobs', async () => {
    const c = await make();
    const id = await newLead(c);
    // A lead made now already has one, and keeps it.
    const made = (await leadRow(c, id)).externalId;
    expect(await runAsCompany(c.id, () => ensureJobIdentity(Number(id)))).toBe(made);
    // An older lead with none is given one, once.
    const [older] = await runAsCompany(c.id, () => db.insert(schema.leads).values({ source: 'roofli', firstName: 'Old', status: 'new' } as any).returning());
    const first = await runAsCompany(c.id, () => ensureJobIdentity(older.id));
    expect(isNativeJobId(first)).toBe(true);
    expect(await runAsCompany(c.id, () => ensureJobIdentity(older.id))).toBe(first);
    expect(await runAsCompany(c.id, () => ensureJobIdentity(987654321))).toBeNull();

    // A company Roof Lee did not make keeps its jobs where it always has.
    const own = await createCompany({ slug: `${tag}-own-${randomUUID().slice(0, 8)}`, name: 'Summit Ridge Roofing' });
    const [lead] = await runAsCompany(own.id, () => db.insert(schema.leads).values({ source: 'manual', firstName: 'Pat', status: 'new' } as any).returning());
    expect(await runAsCompany(own.id, () => ensureJobIdentity(lead.id))).toBeNull();
    expect((await runAsCompany(own.id, () => db.select().from(schema.leads).where(eq(schema.leads.id, lead.id))))[0].externalId).toBeNull();
  });

  it('still puts an older lead with no identity on the board, giving it one, and refuses first what the board would refuse', async () => {
    const c = await make();
    const older = async (name: string) => String((await runAsCompany(c.id, () => db.insert(schema.leads).values({ source: 'roofli', firstName: name, jobName: name, status: 'new' } as any).returning()))[0].id);
    const id = await older('Old Hollis');
    // Turned down on its very first move: not put on the board, and given no identity.
    expect((await move(c, id, 'closed_out', c.office)).status).toBe(409);
    expect((await leadRow(c, id)).externalId).toBeNull();
    expect(await boardRows(c)).toEqual([]);
    // Moved: given one, and on the board under it.
    expect((await move(c, id, 'approved', c.office)).status).toBe(200);
    const lead = await leadRow(c, id);
    expect(isNativeJobId(lead.externalId)).toBe(true);
    expect(lead.stage).toBe('Buyer Approved');
    expect((await boardRows(c)).map((b) => b.jobExternalId)).toEqual([lead.externalId]);
    expect(outside).toEqual([]);
  });

  it('runs the rest of the board for such a job without JobTread', async () => {
    const c = await make();
    const id = await newLead(c);
    await move(c, id, 'approved', c.owner);
    const key = (await leadRow(c, id)).externalId!;
    // The crew and the automation move it from inside Archie.
    const moved = await runAsCompany(c.id, () => moveStage(key, 'install', 'system', { system: true, reason: 'test' }));
    expect(moved).toMatchObject({ ok: true, moved: true, jobtread: { ok: true } });
    expect((await leadRow(c, id)).stage).toBe('Roof Construction');
    const done = await runAsCompany(c.id, () => completeTrade(key, 'roofing', c.crew.email));
    expect(done).toMatchObject({ ok: true, completed: true, jobtread: { ok: true } });
    expect(outside).toEqual([]);
    expect((await logRows(c)).filter((l) => l.system === 'jobtread')).toEqual([]);
  });

  it('says a customer agreed to their photos being used only once a person recorded it, and hands over no photo it does not hold', async () => {
    const c = await make();
    const id = await newLead(c);
    await move(c, id, 'approved', c.owner);
    const key = (await leadRow(c, id)).externalId!;
    expect((await read(c, `/jobs/${id}`)).body.job).toMatchObject({ photoConsent: false, photos: [] });

    expect(await runAsCompany(c.id, () => recordPhotoConsent(key, true, c.office.email))).toBe(true);
    expect((await read(c, `/jobs/${id}`)).body.job).toMatchObject({ photoConsent: true, photos: [] });
    expect((await logRows(c))[0]).toMatchObject({ actor: c.office.email, action: 'photo_consent', targetId: key, ok: true });
    // Archie holds no uploaded photo of its own for a job, so there is none to hand over.
    expect((await read(c, `/jobs/${id}/photos/abc123`)).status).toBe(404);
    expect((await read(c, `/jobs/${id}/photos/..%2F..%2Fetc`)).status).toBe(404);

    expect(await runAsCompany(c.id, () => recordPhotoConsent(key, false, c.office.email))).toBe(true);
    expect((await read(c, `/jobs/${id}`)).body.job.photoConsent).toBe(false);
    expect(await runAsCompany(c.id, () => recordPhotoConsent('archie-nothing', true, c.office.email))).toBe(false);
  });
});
