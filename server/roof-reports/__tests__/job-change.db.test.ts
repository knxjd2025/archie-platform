/**
 * Changing or removing a report's job, through the real request path: it needs
 * the right to see that job AND being the report's maker or a role that sees
 * everything. Anyone else gets the plain "not found" the access table uses,
 * and nothing changes. Fictional company: Summit Ridge Roofing in Cedar Falls.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NOT_FOUND } from '../../../shared/roof-reports';
import { setPhotoStoreForTests } from '../../photos/store';
import { fakeStore, localDb, startRoofApp, type Co } from './harness';

vi.mock('@vercel/functions', () => ({ waitUntil: () => {} }));

describe.skipIf(!localDb)('changing a report\'s job (database)', async () => {
  const tag = `rrjob-${process.pid}-${Date.now()}`;
  const { registerRoofReportsRoutes } = await import('../routes');
  const { __resetRateLimits } = await import('../../lib/rate-limit');
  const { eq } = await import('drizzle-orm');
  const h = await startRoofApp(tag, (app) => registerRoofReportsRoutes(app));
  const { db, schema, runAsCompany } = h;
  const savedSwitch = process.env.ARCHIE_ROOF_REPORTS;
  let co: Co;
  const jobA = `${tag}-jobA`; const jobB = `${tag}-jobB`;

  const seed = (maker: string, job: string | null, over: Record<string, unknown> = {}) => runAsCompany(co.id, async () => (await db.insert(schema.roofReports).values({
    address: '12 Elm Street', city: 'Cedar Falls', state: 'IA', reportTypes: ['inspection'], status: 'ready',
    createdByMemberId: co.people[maker].id, jobExternalId: job, ...over,
  } as any).returning())[0].id as string);
  const jobOf = (id: string) => runAsCompany(co.id, async () => (await db.select().from(schema.roofReports).where(eq(schema.roofReports.id, id)))[0].jobExternalId);

  beforeAll(async () => {
    process.env.ARCHIE_ROOF_REPORTS = 'on';
    setPhotoStoreForTests(fakeStore());
    co = await h.company('Summit Ridge Roofing', [['admin', 'admin'], ['csr', 'customer_service'], ['manager', 'manager'], ['repA', 'sales'], ['repB', 'sales']]);
    await runAsCompany(co.id, async () => {
      await db.insert(schema.leads).values([
        { externalId: jobA, source: 'jobtread', firstName: 'Dana', jtSalesRep: 'Rep repA' },
        { externalId: jobB, source: 'jobtread', firstName: 'Lee', jtSalesRep: 'Rep repB' },
      ] as any);
    });
  });
  beforeEach(() => { __resetRateLimits(); });
  afterAll(async () => {
    setPhotoStoreForTests(null);
    if (savedSwitch === undefined) delete process.env.ARCHIE_ROOF_REPORTS; else process.env.ARCHIE_ROOF_REPORTS = savedSwitch;
    await h.close();
  });

  const put = (who: string, id: string, body: object) => { h.as(co, who); return h.put(`/api/roof-reports/${id}`, body); };

  it('refuses a salesperson who takes a colleague\'s report off its job, with the plain "not found", and changes nothing', async () => {
    const id = await seed('csr', jobA);
    const r = await put('repA', id, { jobExternalId: null });
    expect(r.status).toBe(404);
    expect(r.body).toEqual({ error: NOT_FOUND });
    expect(await jobOf(id)).toBe(jobA);
  });

  it('refuses a salesperson who moves a colleague\'s report to another job they may see', async () => {
    const id = await seed('csr', jobA);
    expect((await put('repA', id, { jobExternalId: jobA })).status).toBe(200); // not a change
    expect(await jobOf(id)).toBe(jobA);
    await runAsCompany(co.id, async () => { await db.insert(schema.leads).values({ externalId: `${tag}-jobA2`, source: 'jobtread', firstName: 'Kim', jtSalesRep: 'Rep repA' } as any); });
    const r = await put('repA', id, { jobExternalId: `${tag}-jobA2` });
    expect(r.status).toBe(404);
    expect(r.body).toEqual({ error: NOT_FOUND });
    expect(await jobOf(id)).toBe(jobA);
  });

  it('lets a salesperson take their own report off its job, or move it to another of their jobs', async () => {
    const id = await seed('repA', jobA);
    const moved = await put('repA', id, { jobExternalId: `${tag}-jobA2` });
    expect(moved.status).toBe(200);
    expect(moved.body.jobExternalId).toBe(`${tag}-jobA2`);
    const removed = await put('repA', id, { jobExternalId: null });
    expect(removed.status).toBe(200);
    expect(removed.body.jobExternalId).toBeNull();
    expect(await jobOf(id)).toBeNull();
  });

  it('still refuses their own report being moved to a job they may not see', async () => {
    const id = await seed('repA', jobA);
    const r = await put('repA', id, { jobExternalId: jobB });
    expect(r.status).toBe(404);
    expect(await jobOf(id)).toBe(jobA);
  });

  it('lets a role that sees everything change or remove any report\'s job', async () => {
    const id = await seed('repA', jobA);
    expect((await put('csr', id, { jobExternalId: jobB })).status).toBe(200);
    expect(await jobOf(id)).toBe(jobB);
    expect((await put('admin', id, { jobExternalId: null })).status).toBe(200);
    expect(await jobOf(id)).toBeNull();
  });

  it('refuses a manager changing the job of their rep\'s report, and lets them change one they made', async () => {
    await runAsCompany(co.id, async () => {
      await db.update(schema.teamMembers).set({ reportsTo: co.people.manager.id }).where(eq(schema.teamMembers.id, co.people.repA.id));
    });
    const theirs = await seed('repA', jobA);
    const refused = await put('manager', theirs, { jobExternalId: null });
    expect(refused.status).toBe(404);
    expect(refused.body).toEqual({ error: NOT_FOUND });
    expect(await jobOf(theirs)).toBe(jobA);
    const mine = await seed('manager', jobA);
    expect((await put('manager', mine, { jobExternalId: null })).status).toBe(200);
  });

  it('does not stand in the way of any other change a salesperson may make to a colleague\'s report', async () => {
    const id = await seed('csr', jobA);
    const r = await put('repA', id, { title: 'Roof report, 12 Elm Street, second look', jobExternalId: jobA });
    expect(r.status).toBe(200);
    expect(r.body.title).toBe('Roof report, 12 Elm Street, second look');
    expect((await put('repA', id, { title: 'Another title' })).status).toBe(200);
  });

  it('lets anyone who may see an address report put it on a job they may see', async () => {
    const id = await seed('repA', null);
    expect((await put('repA', id, { jobExternalId: jobA })).status).toBe(200);
    const addr = await seed('repA', null);
    expect((await put('repA', addr, { jobExternalId: jobB })).status).toBe(404);
  });
});
