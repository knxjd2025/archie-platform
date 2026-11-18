/**
 * POST /api/sister/v1/companies: Roof Lee asks Archie to make a company, or
 * bring one up to date. Against the real test database, through the real
 * request path (signed door, routes, row level security).
 *
 * What must hold (docs/sisters/contract-v2.md in the Roof Lee repository):
 * the same Roof Lee id always means the same company; nothing that already
 * existed is ever attached, whatever name, slug or email matches; a request
 * for one company changes nothing in another; and a company Roof Lee made
 * never uses credentials held in Archie's own settings.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { companyBody, dropSecret, localDb, member, sisterSend, startSisterApp, useSecret } from './helpers';

const seeded: string[] = [];
const background: Array<Promise<unknown>> = [];
vi.mock('../../seed', async () => {
  const { currentCompanyId } = await import('../../tenant/context');
  return {
    seedCompany: vi.fn(async () => { seeded.push(String(currentCompanyId())); }),
    seedAll: async () => {},
    SEED_JOB: 'seed-company',
    seedVersion: () => 'test',
  };
});
vi.mock('@vercel/functions', () => ({ waitUntil: (p: Promise<unknown>) => { background.push(p); } }));

describe.skipIf(!localDb)('Roof Lee makes a company in Archie', async () => {
  const { db } = await import('../../db');
  const schema = await import('../../../shared/schema');
  const { eq, inArray } = await import('drizzle-orm');
  const { runAsCompany, runAsSystem } = await import('../../tenant/context');
  const { createCompany } = await import('../../tenant/companies');
  const { findSignInMember } = await import('../../storage/team');

  const tag = `sis-co-${process.pid}-${Date.now()}`;
  let server: Server;
  let base = '';
  const made: string[] = [];

  const post = (json: unknown) => sisterSend(base, { method: 'POST', path: '/api/sister/v1/companies', json, version: 1 });
  const companyRow = async (id: string) => (await runAsSystem('test', () => db.select().from(schema.companies).where(eq(schema.companies.id, id))))[0];
  const byRoofli = (roofliId: string) => runAsSystem('test', () => db.select().from(schema.companies).where(eq(schema.companies.roofliCompanyId, roofliId)));
  const team = (id: string) => runAsCompany(id, () => db.select().from(schema.teamMembers).orderBy(schema.teamMembers.id));
  /** Makes a company the way Roof Lee would, and remembers it for cleanup. */
  async function make(over: Record<string, unknown> = {}) {
    const body = companyBody(tag, over);
    const r = await post(body);
    if (r.body?.companyId) made.push(r.body.companyId);
    return { body, r, id: r.body?.companyId as string };
  }

  beforeAll(async () => { ({ server, base } = await startSisterApp()); });
  afterAll(async () => {
    server?.close();
    await Promise.allSettled(background);
    await runAsSystem('test cleanup', async () => {
      if (made.length) await db.delete(schema.teamMembers).where(inArray(schema.teamMembers.companyId, made));
    });
  });
  beforeEach(() => { useSecret(); });
  afterEach(() => {
    dropSecret();
    delete process.env.ARCHIE_ENV_CREDENTIALS_COMPANY_ID;
    delete process.env.JOBTREAD_API_KEY;
    delete process.env.LOGIN_BLOCKLIST;
    vi.unstubAllGlobals();
  });

  it('makes the company, its team and its place from what Roof Lee sent', async () => {
    const owner = member(tag, 'owner', 'Dana Whitfield');
    const admin = member(tag, 'admin', 'Lee Marsh');
    const office = member(tag, 'office', 'Sam Ortiz');
    const crew = { ...member(tag, 'crew'), fullName: null };
    const { body, r, id } = await make({ members: [owner, admin, office, crew], timezone: 'America/Chicago', plan: { keys: ['base'], active: true, trial: true } });

    expect(r.status).toBe(201);
    expect(r.body).toEqual({ companyId: id });
    const row = await companyRow(id);
    expect(row).toMatchObject({ roofliCompanyId: body.roofliCompanyId, name: 'Summit Ridge Roofing', slug: body.slug, status: 'trial', trade: 'roofing', ghlLocationId: null });
    expect(row.branding).toMatchObject({ city: 'Cedar Falls', state: 'IA' });
    expect(row.settings.timeZone).toBe('America/Chicago');

    const rows = await team(id);
    expect(rows.map((m) => [m.email, m.role, m.name])).toEqual([
      [owner.email, 'admin', 'Dana Whitfield'],
      [admin.email, 'admin', 'Lee Marsh'],
      [office.email, 'customer_service', 'Sam Ortiz'],
      // No name was sent: the part of the email before the @ stands in.
      [crew.email, 'production', crew.email.split('@')[0]],
    ]);
    for (const m of rows) {
      expect(m).toMatchObject({ active: true, canLogin: true, source: 'roofli', passwordHash: null, companyId: id });
    }
    expect(rows.map((m) => m.authUserId)).toEqual([owner, admin, office, crew].map((m) => m.authUserId));
  });

  it('answers first and finishes setting the company up afterwards, as that company', async () => {
    seeded.length = 0;
    const { id } = await make();
    await Promise.allSettled(background);
    expect(seeded).toEqual([id]);
  });

  it('sets a company up once: it is recorded the way the seed cron records it, and a repeat seeds nothing', async () => {
    seeded.length = 0;
    const { body, id } = await make();
    await Promise.allSettled(background);
    // What /api/cron/seed-companies reads to know this company is done for this version.
    const runs = await runAsCompany(id, () => db.select().from(schema.companyJobRuns));
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ companyId: id, job: 'seed-company', donePeriod: 'test', lastError: null, leaseToken: null });
    expect(runs[0].doneAt).not.toBeNull();
    // The same request again (Roof Lee repeats itself freely) seeds nothing more.
    expect((await post(body)).status).toBe(200);
    await Promise.allSettled(background);
    expect(seeded).toEqual([id]);
  });

  it('leaves a company that is not live to be set up later, when it is', async () => {
    seeded.length = 0;
    const { body, id } = await make({ plan: { keys: ['base'], active: false, trial: false } });
    await Promise.allSettled(background);
    expect((await companyRow(id)).status).toBe('paused');
    expect(seeded).toEqual([]);
    // Paying again: live, and set up after that answer.
    expect((await post({ ...body, plan: { keys: ['base'], active: true, trial: false } })).status).toBe(200);
    await Promise.allSettled(background);
    expect(seeded).toEqual([id]);
  });

  it('never makes a second company for the same Roof Lee id', async () => {
    const { body, id } = await make();
    const again = await post({ ...body, name: 'Summit Ridge Roofing & Gutters', slug: `${tag}-a-different-slug` });
    expect(again.status).toBe(200);
    expect(again.body).toEqual({ companyId: id });
    const rows = await byRoofli(body.roofliCompanyId);
    expect(rows.map((c) => c.id)).toEqual([id]);
    // Brought up to date, and still under the slug it was made with.
    expect(rows[0]).toMatchObject({ name: 'Summit Ridge Roofing & Gutters', slug: body.slug });
    expect((await team(id)).length).toBe(1);
  });

  it('makes one company when the same request arrives twice at once', async () => {
    const body = companyBody(tag);
    const answers = await Promise.all([post(body), post(body), post(body)]);
    const ids = new Set(answers.map((a) => a.body?.companyId));
    made.push(...[...ids].filter(Boolean) as string[]);
    expect(answers.map((a) => a.status).every((s) => s === 200 || s === 201)).toBe(true);
    expect(ids.size).toBe(1);
    expect((await byRoofli(body.roofliCompanyId)).length).toBe(1);
    expect((await team([...ids][0] as string)).length).toBe(1);
  });

  it('never attaches to a company that already existed, whatever name, slug or email matches', async () => {
    // A company made in Archie itself, with the same name, the same slug and the owner's own email.
    const slug = `${tag}-existing-roofing`;
    const email = `${tag}-shared-owner@example.test`;
    const old = await createCompany({ slug, name: 'Summit Ridge Roofing', status: 'active' });
    await runAsCompany(old.id, () => db.insert(schema.teamMembers).values({ name: 'Dana Whitfield', email, role: 'admin', canLogin: true }));
    const before = { row: await companyRow(old.id), team: await team(old.id) };

    const owner = { ...member(tag, 'owner'), email };
    const second = member(tag, 'admin', 'Lee Marsh');
    const { r, id, body } = await make({ slug, members: [owner, second] });

    expect(r.status).toBe(201);
    expect(id).not.toBe(old.id);
    const row = await companyRow(id);
    // Its own slug, with something added because the plain one was taken.
    expect(row.slug).not.toBe(slug);
    expect(row.slug.startsWith(`${slug}-`)).toBe(true);
    expect(row.roofliCompanyId).toBe(body.roofliCompanyId);
    // The person whose email belongs to the other company is left out and named, never moved.
    expect(r.body.skipped).toEqual([{ authUserId: owner.authUserId, reason: expect.any(String) }]);
    expect(r.body.skipped[0].reason).not.toMatch(/[{}[\]_]|\b\d{3}\b/);
    expect((await team(id)).map((m) => m.email)).toEqual([second.email]);
    // And the company that already existed is exactly as it was.
    expect({ row: await companyRow(old.id), team: await team(old.id) }).toEqual(before);
    expect(before.row.roofliCompanyId).toBeNull();
    await runAsSystem('test cleanup', () => db.delete(schema.teamMembers).where(eq(schema.teamMembers.companyId, old.id)));
  });

  it('changes nothing in company B when asked about company A', async () => {
    const a = await make();
    const locationOfB = `loc${randomUUID().replace(/-/g, '').slice(0, 17)}`;
    const b = await make({ members: [member(tag, 'owner', 'Robin Vale'), member(tag, 'crew', 'Kit Moss')], kynexproLocationId: locationOfB });
    const before = { row: await companyRow(b.id), team: await team(b.id) };
    expect(before.row.ghlLocationId).toBe(locationOfB);

    // A is renamed, loses its owner, gains two people, and is told B's location is its own.
    const r = await post({
      ...a.body,
      name: 'Entirely New Name',
      members: [member(tag, 'admin'), member(tag, 'office')],
      kynexproLocationId: locationOfB,
      plan: { keys: ['base'], active: false, trial: false },
    });
    expect(r.status).toBe(200);
    expect({ row: await companyRow(b.id), team: await team(b.id) }).toEqual(before);
    // The location already belongs to B, so A does not get it.
    expect((await companyRow(a.id)).ghlLocationId).toBeNull();
  });

  it('gives access to exactly the people in the list on a repeat', async () => {
    const owner = member(tag, 'owner');
    const leaving = member(tag, 'office', 'Sam Ortiz');
    const { body, id } = await make({ members: [owner, leaving] });
    const joining = member(tag, 'crew', 'Kit Moss');
    const r = await post({ ...body, members: [{ ...owner, role: 'admin', fullName: 'Dana W.' }, joining] });
    expect(r.status).toBe(200);
    const rows = await team(id);
    expect(rows.map((m) => [m.email, m.role, m.name, m.active, m.canLogin])).toEqual([
      [owner.email, 'admin', 'Dana W.', true, true],
      // Kept, so their history stays, but with no way in.
      [leaving.email, 'customer_service', 'Sam Ortiz', false, false],
      [joining.email, 'production', 'Kit Moss', true, true],
    ]);
    // Sent again later, the same person comes back as the same row.
    await post({ ...body, members: [owner, leaving] });
    const back = await team(id);
    expect(back.length).toBe(3);
    expect(back.find((m) => m.email === leaving.email)).toMatchObject({ active: true, canLogin: true, id: rows[1].id });
    expect(back.find((m) => m.email === joining.email)).toMatchObject({ active: false, canLogin: false });
  });

  it('leaves out, and names, anyone it cannot add, and still adds the rest', async () => {
    const good = member(tag, 'owner');
    const badRole = { ...member(tag, 'crew'), role: 'superuser' };
    const badEmail = { ...member(tag, 'office'), email: 'not an email' };
    const twin = { ...member(tag, 'admin'), email: good.email.toUpperCase() };
    const blocked = member(tag, 'office');
    process.env.LOGIN_BLOCKLIST = blocked.email;
    const { r, id } = await make({ members: [good, badRole, badEmail, twin, blocked] });
    expect(r.status).toBe(201);
    expect((await team(id)).map((m) => m.email)).toEqual([good.email]);
    expect(r.body.skipped.map((s: any) => s.authUserId).sort()).toEqual([badRole, badEmail, twin, blocked].map((m) => m.authUserId).sort());
    for (const s of r.body.skipped) expect(s.reason).toMatch(/^[A-Z][^{}[\]_]+\.$/);
  });

  it('keeps the company\'s KynexPro location as an id only, and only when it is free', async () => {
    const locationId = `loc${randomUUID().replace(/-/g, '').slice(0, 17)}`;
    const { body, id } = await make({ kynexproLocationId: null });
    expect((await companyRow(id)).ghlLocationId).toBeNull();
    await post({ ...body, kynexproLocationId: locationId });
    expect((await companyRow(id)).ghlLocationId).toBe(locationId);
    // Leaving it out later does not take it away, and nonsense is not stored.
    await post({ ...body });
    await post({ ...body, kynexproLocationId: 'not a location id; drop table' });
    expect((await companyRow(id)).ghlLocationId).toBe(locationId);
    // No credential was made for it: Archie still cannot call KynexPro for this company.
    const creds = await runAsCompany(id, () => db.select().from(schema.companyIntegrations));
    expect(creds).toEqual([]);
  });

  it('follows the plan: trial, paying, stopped, and never reopens a company closed for good', async () => {
    const { body, id } = await make({ plan: { keys: ['base'], active: true, trial: true } });
    expect((await companyRow(id)).status).toBe('trial');
    await post({ ...body, plan: { keys: ['base', 'search'], active: true, trial: false } });
    expect((await companyRow(id)).status).toBe('active');
    await post({ ...body, plan: { keys: ['base'], active: false, trial: false } });
    expect((await companyRow(id)).status).toBe('paused');
    // A sender that says nothing about the plan changes nothing about it.
    const { plan: _plan, ...silent } = body as typeof body & { plan?: unknown };
    await post(silent);
    expect((await companyRow(id)).status).toBe('paused');
    // Paying again brings a paused company back.
    await post({ ...body, plan: { keys: ['base'], active: true, trial: false } });
    expect((await companyRow(id)).status).toBe('active');
    await runAsSystem('test: close for good', () => db.update(schema.companies).set({ status: 'cancelled' }).where(eq(schema.companies.id, id)));
    const r = await post({ ...body, plan: { keys: ['base'], active: true, trial: false } });
    expect(r.status).toBe(200);
    expect(r.body.companyId).toBe(id);
    expect((await companyRow(id)).status).toBe('cancelled');
  });

  it('keeps what the company confirmed about itself, and drops what it has withdrawn', async () => {
    const facts = {
      identity: { legal_name: 'Summit Ridge Roofing LLC', founded: 2009 },
      contact: { phone: '(319) 555-0142', email: 'office@summitridge.example.test', website: 'https://summitridge.example.test' },
      service_area: { towns: ['Cedar Falls', 'Waterloo'] },
      services: {}, credentials: { state_license: 'Iowa contractor registration C123456' },
      warranties: { workmanship: '5 year workmanship warranty' },
      offers: {}, voice: {}, audiences: {}, preferences: { some_future_fact: { nested: [1, true, 'x'] } },
    };
    const { body, id } = await make({ facts });
    let row = await companyRow(id);
    expect(row.branding).toMatchObject({ legalName: 'Summit Ridge Roofing LLC', foundedYear: 2009, phone: '(319) 555-0142', email: 'office@summitridge.example.test', website: 'https://summitridge.example.test' });
    expect(row.settings).toMatchObject({ serviceArea: 'Cedar Falls, Waterloo', credentials: ['Iowa contractor registration C123456'], workmanshipWarranty: '5 year workmanship warranty' });
    // Everything confirmed is kept as data, including names Archie does not know.
    expect(row.settings.roofli?.facts).toEqual(facts);

    // Something an admin set in Archie itself survives; a withdrawn warranty and phone do not.
    await runAsSystem('test: admin sets a color', () => db.update(schema.companies)
      .set({ branding: { ...row.branding, primaryColor: '#225588' } }).where(eq(schema.companies.id, id)));
    await post({ ...body, facts: { ...facts, contact: { email: facts.contact.email }, warranties: {} } });
    row = await companyRow(id);
    expect(row.branding.primaryColor).toBe('#225588');
    expect(row.branding.phone).toBeUndefined();
    expect(row.branding.website).toBeUndefined();
    expect(row.settings.workmanshipWarranty).toBeUndefined();
    expect(row.branding.email).toBe(facts.contact.email);
  });

  it('never lets a company Roof Lee made use credentials held in Archie\'s own settings', async () => {
    const { resolveJobTreadCredentials } = await import('../../integrations/jobtread-connection');
    const { JobTreadClient } = await import('../../integrations/jobtread');
    const { GoHighLevelClient } = await import('../../integrations/gohighlevel');
    const { ghlConnection, GhlNotConnectedError } = await import('../../integrations/ghl/connection');
    const { EnvCredentialsUnavailableError, ownsEnvCredentials } = await import('../../tenant/per-company');
    const { clearProfileCache } = await import('../../tenant/profile');

    const { id } = await make({ kynexproLocationId: `loc${randomUUID().replace(/-/g, '').slice(0, 17)}` });
    const plain = await createCompany({ slug: `${tag}-plain`, name: 'Plain Roofing', status: 'active' });
    const fetchSpy = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);
    process.env.JOBTREAD_API_KEY = 'test-grant-key-not-real';

    // Even if someone points the deployment's own credentials at the Roof Lee company by mistake.
    process.env.ARCHIE_ENV_CREDENTIALS_COMPANY_ID = id;
    clearProfileCache();
    await runAsCompany(id, async () => {
      expect(ownsEnvCredentials()).toBe(false);
      await expect(resolveJobTreadCredentials()).rejects.toBeInstanceOf(EnvCredentialsUnavailableError);
      await expect(new JobTreadClient().getOrganizationId()).rejects.toBeInstanceOf(EnvCredentialsUnavailableError);
      // It holds a KynexPro location id, and still has nothing to call KynexPro with.
      await expect(ghlConnection()).rejects.toBeInstanceOf(GhlNotConnectedError);
      await expect(new GoHighLevelClient().location()).rejects.toBeInstanceOf(GhlNotConnectedError);
    });
    expect(fetchSpy).not.toHaveBeenCalled();

    // A company made in Archie itself that owns those credentials keeps them, as before.
    process.env.ARCHIE_ENV_CREDENTIALS_COMPANY_ID = plain.id;
    await runAsCompany(plain.id, async () => {
      expect(ownsEnvCredentials()).toBe(true);
      expect(await resolveJobTreadCredentials()).toMatchObject({ grantKey: 'test-grant-key-not-real', source: 'shared' });
    });
  });

  it('gives the people Roof Lee sent no way in by email: not a password, not a reset, not Google', async () => {
    const owner = member(tag, 'owner');
    const { id } = await make({ members: [owner] });
    expect((await team(id))[0]).toMatchObject({ email: owner.email, canLogin: true });
    // Every email sign-in route starts with this lookup. Their way in is Roof Lee's hand-off.
    expect(await findSignInMember(owner.email)).toBeUndefined();
    // Someone added in Archie itself is found as before.
    const plain = await createCompany({ slug: `${tag}-plain-signin`, name: 'Plain Roofing', status: 'active' });
    const email = `${tag}-plain-admin@example.test`;
    await runAsCompany(plain.id, () => db.insert(schema.teamMembers).values({ name: 'Pat', email, role: 'admin', canLogin: true }));
    expect((await findSignInMember(email))?.company.id).toBe(plain.id);
    await runAsSystem('test cleanup', () => db.delete(schema.teamMembers).where(eq(schema.teamMembers.companyId, plain.id)));
  });

  it('answers 400 to a body it cannot read, and makes nothing', async () => {
    const good = companyBody(tag);
    const bad: unknown[] = [
      {},
      { ...good, roofliCompanyId: 'not-a-uuid' },
      { ...good, name: '' },
      { ...good, name: 12 },
      { ...good, members: 'everyone' },
      { ...good, members: [{ email: 'x@example.test', role: 'owner' }] },
      { ...good, members: [{ ...good.members[0], authUserId: 'nope' }] },
    ];
    for (const body of bad) {
      const r = await post(body);
      expect(r.status, JSON.stringify(body).slice(0, 80)).toBe(400);
      expect(typeof r.body?.error).toBe('string');
    }
    expect(await byRoofli(good.roofliCompanyId)).toEqual([]);
  });

  it('treats fields it does not know as data, never as an error', async () => {
    const { r, id } = await make({ somethingNew: { a: 1 }, plan: { keys: ['base', 'a_future_plan'], active: true, trial: false, extra: 'x' }, members: [{ ...member(tag, 'owner'), nickname: 'D' }] });
    expect(r.status).toBe(201);
    expect((await companyRow(id)).status).toBe('active');
  });

  it('takes only the version 1 signature, and nothing at all with the door shut', async () => {
    const body = companyBody(tag);
    const v2 = await sisterSend(base, { method: 'POST', path: '/api/sister/v1/companies', json: body, version: 2 });
    expect(v2.status).toBe(401);
    dropSecret();
    const shut = await post(body);
    expect(shut.status).toBe(401);
    expect(shut.text).toBe('');
    expect(await byRoofli(body.roofliCompanyId)).toEqual([]);
  });
});
