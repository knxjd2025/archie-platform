/**
 * Read and write for Lee, Roof Lee's assistant: leads, jobs, notes and what
 * Archie can do for a company. Against the real test database, through the
 * real request path.
 *
 * What must hold (docs/sisters/contract-v2.md in the Roof Lee repository,
 * "Rules for every version 2 endpoint" and "Archie"): the company comes from
 * the address and nothing else; a record that belongs to another company is
 * not found; Archie applies its own role rules to the person named; a write
 * sent twice under one key is done once; and a lead Roof Lee adds stays inside
 * Archie, with no call to any outside system.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { companyBody, dropSecret, localDb, member, sisterSend, startSisterApp, useSecret, type TestMember } from './helpers';
import { signRequest } from '../verify';

vi.mock('../../seed', () => ({ seedCompany: async () => {}, seedAll: async () => {}, SEED_JOB: 'seed-company', seedVersion: () => 'test' }));
vi.mock('@vercel/functions', () => ({ waitUntil: () => {} }));

describe.skipIf(!localDb)('read and write for Lee', async () => {
  const { db } = await import('../../db');
  const schema = await import('../../../shared/schema');
  const { eq, desc } = await import('drizzle-orm');
  const { runAsCompany } = await import('../../tenant/context');
  const { createCompany } = await import('../../tenant/companies');

  const tag = `sis-lee-${process.pid}-${Date.now()}`;
  const companies = '/api/sister/v1/companies';
  let server: Server;
  let base = '';

  beforeAll(async () => { ({ server, base } = await startSisterApp()); });
  afterAll(() => { server?.close(); });
  beforeEach(() => { useSecret(); });
  afterEach(() => { dropSecret(); vi.restoreAllMocks(); });

  interface Made { id: string; roofliId: string; owner: TestMember; office: TestMember; crew: TestMember; body: Record<string, unknown> }
  async function make(): Promise<Made> {
    const owner = member(tag, 'owner', 'Dana Whitfield');
    const office = member(tag, 'office', 'Riley Marsh');
    const crew = member(tag, 'crew', 'Sam Ortiz');
    const body = companyBody(tag, { members: [owner, office, crew] });
    const r = await sisterSend(base, { method: 'POST', path: companies, json: body, version: 1 });
    expect(r.status).toBe(201);
    return { id: r.body.companyId, roofliId: body.roofliCompanyId as string, owner, office, crew, body };
  }
  const as = (m: TestMember) => ({ authUserId: m.authUserId, role: m.role });
  const who = (m: TestMember) => `actingUserId=${m.authUserId}&actingRole=${m.role}`;
  const read = (c: Made, path: string, m?: TestMember, more = '') =>
    sisterSend(base, { path: `${companies}/${c.roofliId}${path}${m || more ? '?' : ''}${m ? who(m) : ''}${m && more ? '&' : ''}${more}`, version: 2 });
  const write = (c: Made, method: string, path: string, json: Record<string, unknown>, key: string | null = randomUUID()) =>
    sisterSend(base, { method, path: `${companies}/${c.roofliId}${path}`, json, version: 2, headers: key ? { 'idempotency-key': key } : {} });
  const newLead = (c: Made, m: TestMember, over: Record<string, unknown> = {}, key?: string | null) =>
    write(c, 'POST', '/leads', { name: 'Pat Hollis', phone: '(319) 555-0142', email: 'Pat@Example.test', address: '12 Birch Lane', town: 'Cedar Falls', jobType: 'replacement', message: 'Hail damage on the north slope.', acting: as(m), ...over }, key);
  const leadRows = (id: string) => runAsCompany(id, () => db.select().from(schema.leads).orderBy(schema.leads.id));
  const logRows = (id: string) => runAsCompany(id, () => db.select().from(schema.writeLog).orderBy(desc(schema.writeLog.id)));
  const noteRows = (id: string) => runAsCompany(id, () => db.select().from(schema.leadNotes).orderBy(schema.leadNotes.id));

  it('says what Archie can do for a company', async () => {
    const c = await make();
    const r = await read(c, '/capabilities');
    expect(r.status).toBe(200);
    // Worked out per company, from the switches the features themselves read
    // (jobs.test.ts and quiet.test.ts say when each may be claimed).
    expect(r.body).toEqual({ capabilities: ['messages.quiet', 'jobs.native'] });
    expect((await sisterSend(base, { path: `${companies}/${randomUUID()}/capabilities`, version: 2 })).status).toBe(404);
    // The older signature, which does not cover the address, opens nothing here.
    expect((await sisterSend(base, { path: `${companies}/${c.roofliId}/capabilities`, version: 1 })).status).toBe(401);
  });

  it('adds a lead that stays inside Archie, under the name of the person it was for', async () => {
    const c = await make();
    // Nothing may leave the building: watch every outgoing request.
    const real = globalThis.fetch;
    const outside: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation((input: any, init?: any) => {
      const url = String(typeof input === 'string' || input instanceof URL ? input : input.url);
      if (!url.startsWith(base)) outside.push(url);
      return real(input, init);
    });
    const r = await newLead(c, c.office);
    expect(r.status).toBe(201);
    expect(outside).toEqual([]);
    const rows = await leadRows(c.id);
    expect(rows).toHaveLength(1);
    expect(r.body).toEqual({ leadId: String(rows[0].id) });
    expect(rows[0]).toMatchObject({
      source: 'roofli', externalId: null, firstName: 'Pat', lastName: 'Hollis', jobName: 'Pat Hollis',
      phone: '(319) 555-0142', email: 'pat@example.test', address: '12 Birch Lane', city: 'Cedar Falls',
      serviceType: 'replacement', notes: 'Hail damage on the north slope.', status: 'new',
      enteredBy: c.office.email, enteredByName: 'Riley Marsh', companyId: c.id,
    });
    const [log] = await logRows(c.id);
    expect(log).toMatchObject({ actor: c.office.email, system: 'roofli', action: 'create_lead', targetId: String(rows[0].id), ok: true });
  });

  it('makes one lead for one key, however many times it arrives', async () => {
    const c = await make();
    const key = randomUUID();
    const first = await newLead(c, c.owner, {}, key);
    const again = await newLead(c, c.owner, {}, key);
    expect(first.status).toBe(201);
    expect(again.status).toBe(201);
    expect(again.body).toEqual(first.body);
    expect(await leadRows(c.id)).toHaveLength(1);
    // Copies arriving together: one does the work, the others wait or are told to come back.
    const key2 = randomUUID();
    const burst = await Promise.all([1, 2, 3, 4].map(() => newLead(c, c.owner, { name: 'Jo Burst' }, key2)));
    for (const r of burst) expect([201, 409]).toContain(r.status);
    expect(burst.some((r) => r.status === 201)).toBe(true);
    expect((await leadRows(c.id)).filter((l) => l.jobName === 'Jo Burst')).toHaveLength(1);
    // The same key in another company is that company's own key.
    const d = await make();
    const other = await newLead(d, d.owner, {}, key);
    expect(other.status).toBe(201);
    expect(await leadRows(d.id)).toHaveLength(1);
  });

  it('applies Archie\'s own role rules: crew can neither add nor see leads', async () => {
    const c = await make();
    const made = await newLead(c, c.office);
    const key = randomUUID();
    const refused = await newLead(c, c.crew, { name: 'Crew Made' }, key);
    expect(refused.status).toBe(403);
    expect(await leadRows(c.id)).toHaveLength(1);
    expect((await read(c, '/jobs', c.crew)).body).toEqual({ jobs: [] });
    expect((await read(c, `/jobs/${made.body.leadId}`, c.crew)).status).toBe(404);
    expect((await write(c, 'PATCH', `/leads/${made.body.leadId}`, { status: 'lost', acting: as(c.crew) })).status).toBe(403);
    expect((await write(c, 'POST', `/leads/${made.body.leadId}/notes`, { text: 'hi', acting: as(c.crew) })).status).toBe(403);
    // A refusal is not remembered: once Roof Lee makes Sam office staff, the very same request goes through.
    const promoted = { ...c.crew, role: 'office' };
    await sisterSend(base, { method: 'PUT', path: `${companies}/${c.roofliId}/members`, json: { roofliCompanyId: c.roofliId, members: [c.owner, c.office, promoted] }, version: 1 });
    expect((await newLead(c, promoted, { name: 'Crew Made' }, key)).status).toBe(201);
  });

  it('goes by the person Archie holds, and by the lower role when Roof Lee states another', async () => {
    const c = await make();
    // Someone Roof Lee names who is not on this company's team.
    expect((await newLead(c, member(tag, 'owner'))).status).toBe(403);
    // Sam is crew in Archie. Roof Lee calling Sam an owner changes nothing.
    expect((await newLead(c, { ...c.crew, role: 'owner' })).status).toBe(403);
    // Dana is an admin in Archie. If Roof Lee now says crew, the lower one counts.
    expect((await newLead(c, { ...c.owner, role: 'crew' })).status).toBe(403);
    expect((await read(c, '/jobs', { ...c.owner, role: 'crew' })).body).toEqual({ jobs: [] });
    // A person from another company's team is nobody here.
    const d = await make();
    expect((await newLead(c, d.owner)).status).toBe(403);
    expect((await read(c, '/jobs', d.owner)).status).toBe(403);
    expect(await leadRows(c.id)).toHaveLength(0);
  });

  it('answers 404 for a lead that belongs to another company, and changes nothing there', async () => {
    const a = await make();
    const b = await make();
    const theirs = (await newLead(b, b.owner, { name: 'Belongs To B' })).body.leadId as string;
    // Asked under A's address, by A's own owner, B's lead does not exist.
    expect((await read(a, `/jobs/${theirs}`, a.owner)).status).toBe(404);
    expect((await read(a, `/jobs/${theirs}`)).status).toBe(404);
    expect((await write(a, 'PATCH', `/leads/${theirs}`, { status: 'lost', name: 'Taken Over', acting: as(a.owner) })).status).toBe(404);
    expect((await write(a, 'POST', `/leads/${theirs}/notes`, { text: 'planted', acting: as(a.owner) })).status).toBe(404);
    expect((await read(a, '/jobs', a.owner)).body.jobs).toEqual([]);
    const [still] = await leadRows(b.id);
    expect(still).toMatchObject({ jobName: 'Belongs To B', status: 'new' });
    expect(await noteRows(b.id)).toEqual([]);
    expect(await noteRows(a.id)).toEqual([]);
    // And a signature made for A's address does not open B's.
    const at = Date.now();
    const pathA = `${companies}/${a.roofliId}/jobs?${who(a.owner)}`;
    const pathB = `${companies}/${b.roofliId}/jobs?${who(a.owner)}`;
    const moved = await fetch(`${base}${pathB}`, { headers: { 'x-roofli-timestamp': String(at), 'x-roofli-signature': signRequest('GET', pathA, '', at, 'sister-test-pair-secret') } });
    expect(moved.status).toBe(401);
  });

  it('finds a company by Roof Lee\'s id only, never by Archie\'s own', async () => {
    const c = await make();
    const plain = await createCompany({ slug: `${tag}-plain-${randomUUID().slice(0, 8)}`, name: 'Not From Roof Lee', status: 'active' });
    for (const id of [c.id, plain.id]) {
      expect((await sisterSend(base, { path: `${companies}/${id}/jobs?${who(c.owner)}`, version: 2 })).status).toBe(404);
      expect((await sisterSend(base, { method: 'POST', path: `${companies}/${id}/leads`, json: { name: 'X', acting: as(c.owner) }, version: 2, headers: { 'idempotency-key': randomUUID() } })).status).toBe(404);
    }
    expect(await runAsCompany(plain.id, () => db.select().from(schema.leads))).toEqual([]);
  });

  it('lists leads for the person named, and looks for words when asked', async () => {
    const c = await make();
    const pat = (await newLead(c, c.office)).body.leadId as string;
    await newLead(c, c.office, { name: 'Morgan 100% Reyes', phone: undefined, email: undefined, address: '4 Elm Court', town: 'Waterloo', jobType: 'repair', message: undefined });
    const all = await read(c, '/jobs', c.office);
    expect(all.status).toBe(200);
    expect(all.body.jobs).toHaveLength(2);
    const listed = all.body.jobs.find((j: any) => j.id === pat);
    expect(listed).toMatchObject({ id: pat, kind: 'lead', name: 'Pat Hollis', stage: 'new', jobType: 'replacement', town: 'Cedar Falls', phone: '(319) 555-0142', email: 'pat@example.test' });
    expect(Number.isNaN(Date.parse(listed.updatedAt))).toBe(false);
    // No money and nothing internal rides along.
    expect(Object.keys(listed).sort()).toEqual(['email', 'id', 'jobType', 'kind', 'name', 'phone', 'stage', 'town', 'updatedAt']);
    expect((await read(c, '/jobs', c.office, 'text=waterloo')).body.jobs.map((j: any) => j.name)).toEqual(['Morgan 100% Reyes']);
    expect((await read(c, '/jobs', c.office, 'text=birch')).body.jobs.map((j: any) => j.id)).toEqual([pat]);
    // A percent sign is a percent sign, not "anything".
    expect((await read(c, '/jobs', c.office, `text=${encodeURIComponent('100%')}`)).body.jobs).toHaveLength(1);
    expect((await read(c, '/jobs', c.office, `text=${encodeURIComponent('%')}`)).body.jobs).toHaveLength(1);
    expect((await read(c, '/jobs', c.office, 'text=nobody-by-this-name')).body.jobs).toEqual([]);
    // A list is always for someone.
    expect((await read(c, '/jobs')).status).toBe(400);
    expect((await sisterSend(base, { path: `${companies}/${c.roofliId}/jobs?actingUserId=${c.office.authUserId}`, version: 2 })).status).toBe(400);
    expect((await sisterSend(base, { path: `${companies}/${c.roofliId}/jobs?actingUserId=nope&actingRole=office`, version: 2 })).status).toBe(400);
  });

  it('shows one lead in full, with its notes, and claims no consent to use photos that nobody recorded', async () => {
    const c = await make();
    const id = (await newLead(c, c.office)).body.leadId as string;
    const key = randomUUID();
    expect((await write(c, 'POST', `/leads/${id}/notes`, { text: 'Called, left a voicemail.', acting: as(c.office) }, key)).status).toBe(201);
    // The same note sent again under the same key is one note.
    expect((await write(c, 'POST', `/leads/${id}/notes`, { text: 'Called, left a voicemail.', acting: as(c.office) }, key)).status).toBe(201);
    expect((await write(c, 'POST', `/leads/${id}/notes`, { text: 'Booked the inspection for Tuesday.', acting: as(c.owner) })).status).toBe(201);
    const stored = await noteRows(c.id);
    expect(stored.map((n) => [n.text, n.author, n.system])).toEqual([
      ['Called, left a voicemail.', c.office.email, 'roofli'],
      ['Booked the inspection for Tuesday.', c.owner.email, 'roofli'],
    ]);
    const r = await read(c, `/jobs/${id}`, c.office);
    expect(r.status).toBe(200);
    expect(r.body.job).toMatchObject({
      id, kind: 'lead', name: 'Pat Hollis', stage: 'new', address: '12 Birch Lane', message: 'Hail damage on the north slope.',
      photoConsent: false, photos: [],
    });
    expect(r.body.job.notes.map((n: any) => n.text).sort()).toEqual(['Booked the inspection for Tuesday.', 'Called, left a voicemail.']);
    for (const n of r.body.job.notes) expect(Number.isNaN(Date.parse(n.at))).toBe(false);
    // The scheduled run names nobody and still gets the company's own record.
    expect((await read(c, `/jobs/${id}`)).body.job.id).toBe(id);
    for (const junk of ['0', 'abc', '1e3', '-1', '99999999', `${id}x`, '1234567890123']) {
      expect((await read(c, `/jobs/${junk}`, c.office)).status, junk).toBe(404);
    }
    const [log] = await logRows(c.id);
    expect(log).toMatchObject({ actor: c.owner.email, system: 'roofli', action: 'add_note', targetId: id });
    expect((await write(c, 'POST', `/leads/${id}/notes`, { text: '   ', acting: as(c.office) })).status).toBe(400);
    expect((await write(c, 'POST', `/leads/${id}/notes`, { text: 'x'.repeat(2001), acting: as(c.office) })).status).toBe(400);
  });

  it('changes a lead\'s status and contact details, and says who did', async () => {
    const c = await make();
    const id = (await newLead(c, c.office)).body.leadId as string;
    const r = await write(c, 'PATCH', `/leads/${id}`, { status: 'contacted', name: 'Patricia Hollis-Grant', phone: '319-555-0199', email: 'PHG@example.test', notes: 'Prefers a call after 5.', acting: as(c.owner), somethingNew: true });
    expect(r.status).toBe(200);
    const [row] = await leadRows(c.id);
    expect(row).toMatchObject({ status: 'contacted', firstName: 'Patricia', lastName: 'Hollis-Grant', jobName: 'Patricia Hollis-Grant', phone: '319-555-0199', email: 'phg@example.test', notes: 'Prefers a call after 5.', source: 'roofli' });
    const [log] = await logRows(c.id);
    expect(log).toMatchObject({ actor: c.owner.email, system: 'roofli', action: 'update_lead', targetId: id });
    // Only what was sent is changed.
    expect((await write(c, 'PATCH', `/leads/${id}`, { status: 'qualified', acting: as(c.office) })).status).toBe(200);
    expect((await leadRows(c.id))[0]).toMatchObject({ status: 'qualified', phone: '319-555-0199', notes: 'Prefers a call after 5.' });
    expect((await write(c, 'PATCH', `/leads/${id}`, { status: 'sold!', acting: as(c.owner) })).status).toBe(400);
    expect((await write(c, 'PATCH', `/leads/${id}`, { acting: as(c.owner) })).status).toBe(400);
    expect((await write(c, 'PATCH', `/leads/${id}`, { email: 'not-an-email', acting: as(c.owner) })).status).toBe(400);
    expect((await write(c, 'PATCH', '/leads/987654', { status: 'lost', acting: as(c.owner) })).status).toBe(404);
    expect((await leadRows(c.id))[0].status).toBe('qualified');
  });

  it('refuses a write that does not say who it is for, has no key, or names another company', async () => {
    const c = await make();
    const d = await make();
    expect((await write(c, 'POST', '/leads', { name: 'No One Named' })).status).toBe(400);
    expect((await write(c, 'POST', '/leads', { name: 'Half Named', acting: { authUserId: c.owner.authUserId } })).status).toBe(400);
    expect((await newLead(c, c.owner, {}, null)).status).toBe(400);
    expect((await newLead(c, c.owner, { roofliCompanyId: d.roofliId })).status).toBe(400);
    expect((await newLead(c, c.owner, { name: '' })).status).toBe(400);
    expect((await newLead(c, c.owner, { name: 'x'.repeat(201) })).status).toBe(400);
    expect((await newLead(c, c.owner, { phone: 'call me' })).status).toBe(400);
    expect(await leadRows(c.id)).toEqual([]);
    expect(await leadRows(d.id)).toEqual([]);
    // A body that repeats the right company is fine.
    expect((await newLead(c, c.owner, { roofliCompanyId: c.roofliId })).status).toBe(201);
  });

  it('does nothing for a company that is paused', async () => {
    const c = await make();
    const id = (await newLead(c, c.owner)).body.leadId as string;
    const paused = await sisterSend(base, { method: 'DELETE', path: `${companies}/${c.roofliId}`, json: { roofliCompanyId: c.roofliId, mode: 'pause' }, version: 2, headers: { 'idempotency-key': randomUUID() } });
    expect(paused.status).toBe(200);
    expect((await read(c, '/capabilities')).status).toBe(409);
    expect((await read(c, '/jobs', c.owner)).status).toBe(409);
    expect((await read(c, `/jobs/${id}`, c.owner)).status).toBe(409);
    expect((await newLead(c, c.owner, { name: 'While Paused' })).status).toBe(409);
    expect((await write(c, 'PATCH', `/leads/${id}`, { status: 'lost', acting: as(c.owner) })).status).toBe(409);
    expect(await leadRows(c.id)).toHaveLength(1);
    expect((await leadRows(c.id))[0].status).toBe('new');
  });

  it('is shut, bare, while the pair secret is unset', async () => {
    const c = await make();
    dropSecret();
    for (const r of [await read(c, '/capabilities'), await read(c, '/jobs', c.owner), await newLead(c, c.owner)]) {
      expect(r.status).toBe(401);
      expect(r.text).toBe('');
    }
    useSecret();
    expect(await leadRows(c.id)).toEqual([]);
  });
});
