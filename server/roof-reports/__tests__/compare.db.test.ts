/**
 * Comparing two reports (the old program's side-by-side view), through a real request path on the local test
 * database. No model is called. Both ids go through exactly the checks of opening a report: a report the person
 * may not see, another company's, an archived one and one that is not there are all the same "one of those could
 * not be found", and the answer then carries nothing of the other one: never a half comparison.
 * Fictional companies: Summit Ridge Roofing and Cedar Falls Roofing Two.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeReport } from '../../lib/roof-reports/__tests__/fixtures/report';
import { COMPARE_NOT_FOUND, COMPARE_NOT_READY, COMPARE_PICK_TWO } from '../../../shared/roof-reports';
import { localDb, startRoofApp, type Co } from './harness';

vi.mock('@vercel/functions', () => ({ waitUntil: () => {} }));

describe.skipIf(!localDb)('comparing two reports (database, no model)', async () => {
  const tag = `rrcompare-${process.pid}-${Date.now()}`;
  const { registerRoofReportsRoutes } = await import('../routes');
  const h = await startRoofApp(tag, (app) => registerRoofReportsRoutes(app));
  const { db, schema, runAsCompany } = h;
  const savedSwitch = process.env.ARCHIE_ROOF_REPORTS;
  let a: Co; let b: Co;

  const GOOD = makeReport({ roofConditionIndex: { overallScore: 81, grade: 'B', components: [] }, roofDetails: { squares: 24, pitch: '6/12' } });
  const WORSE = makeReport({
    roofConditionIndex: { overallScore: 44, grade: 'D', components: [] }, roofDetails: { squares: 31, pitch: '8/12' },
    repairEstimate: { lineItems: [], subtotal: 9000, multiplierApplied: 1, total: 9000, notes: [] },
  });
  async function make(co: Co, who: string | null, over: Record<string, unknown> = {}): Promise<string> {
    const [r] = await runAsCompany(co.id, () => db.insert(schema.roofReports).values({
      address: '12 Elm Street', city: 'Cedar Falls', state: 'IA', reportTypes: ['inspection'], status: 'ready', title: 'Roof report',
      createdByMemberId: who ? co.people[who].id : null, customerName: 'Dana Whitfield', customerEmail: 'dana@example.com', inspectorNotes: 'ZZ-INSPECTOR-NOTES',
      reportJson: GOOD, ...over,
    } as any).returning());
    return r.id;
  }
  const compare = (x: string, y: string) => h.get(`/api/roof-reports/compare?a=${encodeURIComponent(x)}&b=${encodeURIComponent(y)}`);

  beforeAll(async () => {
    process.env.ARCHIE_ROOF_REPORTS = 'on';
    a = await h.company('Summit Ridge Roofing', [['admin', 'admin'], ['csr', 'customer_service'], ['repa', 'sales'], ['repb', 'sales'], ['crew', 'production']]);
    b = await h.company('Cedar Falls Roofing Two', [['admin', 'admin']]);
  });
  beforeEach(() => { h.as(a, 'admin'); });
  afterAll(async () => {
    if (savedSwitch === undefined) delete process.env.ARCHIE_ROOF_REPORTS; else process.env.ARCHIE_ROOF_REPORTS = savedSwitch;
    await h.close();
  });

  it('puts two reports side by side: the condition, findings, storm events, cost and roof facts of each', async () => {
    const one = await make(a, 'repa', { address: '12 Elm Street' });
    const two = await make(a, 'repa', { address: '40 Birch Lane', reportJson: WORSE });
    const res = await compare(one, two);
    expect(res.status, res.text).toBe(200);
    expect(res.body.a).toMatchObject({ id: one, address: '12 Elm Street', city: 'Cedar Falls', condition: { score: 81, grade: 'B' }, cost: 340, measurements: { squares: 24, pitch: '6/12' } });
    expect(res.body.b).toMatchObject({ id: two, address: '40 Birch Lane', condition: { score: 44, grade: 'D' }, cost: 9000, measurements: { squares: 31, pitch: '8/12' } });
    expect(res.body.a.storm.events).toBe(15);
    expect(Object.keys(res.body).sort()).toEqual(['a', 'b']);
  });

  it('carries no customer, no notes, no photo and no share link', async () => {
    const one = await make(a, null);
    const token = `ZZ-SHARE-${tag}-ZZ`;
    const two = await make(a, null, { shareToken: token });
    const res = await compare(one, two);
    expect(res.status).toBe(200);
    for (const mark of ['Dana Whitfield', 'dana@example.com', 'ZZ-INSPECTOR-NOTES', token, 'customer', 'photos']) expect(res.text, mark).not.toContain(mark);
  });

  it('answers "not found" and nothing of the other, when one of the two is another company\'s', async () => {
    const mine = await make(a, null, { address: '12 Elm Street' });
    const theirs = await make(b, null, { address: '9 Oak Road', customerName: 'Pat Brown' });
    for (const [x, y] of [[mine, theirs], [theirs, mine]]) {
      const res = await compare(x, y);
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: COMPARE_NOT_FOUND });
      for (const mark of ['12 Elm Street', '9 Oak Road', 'Pat Brown', 'Dana Whitfield', mine, theirs, '81', '340']) expect(res.text, mark).not.toContain(mark);
    }
    h.as(b, 'admin');
    expect((await compare(mine, theirs)).status).toBe(404);
  });

  it('answers the same "not found" for a report the person may not see, an archived one, a missing one and a bad id', async () => {
    const own = await make(a, 'repa', { address: '12 Elm Street' });
    const notMine = await make(a, 'repb', { address: '77 Pine Court' });
    const archived = await make(a, 'repa', { status: 'archived', address: '5 Archived Way' });
    h.as(a, 'repa');
    for (const other of [notMine, archived, '00000000-0000-4000-8000-00000000dead', 'not-an-id', "1' or '1'='1"]) {
      for (const [x, y] of [[own, other], [other, own]]) {
        const res = await compare(x, y);
        expect(res.status, `${x} ${y}`).toBe(404);
        expect(res.body).toEqual({ error: COMPARE_NOT_FOUND });
        for (const mark of ['12 Elm Street', '77 Pine Court', '5 Archived Way', own, notMine]) expect(res.text, mark).not.toContain(mark);
      }
    }
    // The salesperson can compare two of their own.
    const own2 = await make(a, 'repa', { address: '3 Maple Drive' });
    expect((await compare(own, own2)).status).toBe(200);
  });

  it('refuses crew like a report that is not there, and the same for no one signed in', async () => {
    const one = await make(a, null); const two = await make(a, null);
    h.as(a, 'crew');
    expect((await compare(one, two)).status).toBe(404);
    h.signedOut();
    expect((await compare(one, two)).status).toBe(401);
  });

  it('asks for two different reports, and says so plainly when one is missing', async () => {
    const one = await make(a, null);
    for (const q of [`a=${one}&b=${one}`, `a=${one}`, `b=${one}`, '', `a=${one}&b=`, `a[]=${one}&b=${one}`]) {
      const res = await h.get(`/api/roof-reports/compare?${q}`);
      expect(res.status, q).toBe(400);
      expect(res.body.error, q).toBe(COMPARE_PICK_TWO);
    }
  });

  it('says plainly that a report still being made, or one that failed, cannot be compared yet', async () => {
    const ready = await make(a, null);
    const making = await make(a, null, { status: 'generating', reportJson: null });
    const failed = await make(a, null, { status: 'failed', reportJson: null, problem: 'ZZ-PROBLEM' });
    for (const other of [making, failed]) {
      const res = await compare(ready, other);
      expect(res.status).toBe(409);
      expect(res.body).toEqual({ error: COMPARE_NOT_READY });
      expect(res.text).not.toContain('ZZ-PROBLEM');
    }
  });

  it('makes no cost row and no use row: no model is called and nothing is counted', async () => {
    const one = await make(a, null); const two = await make(a, null);
    const costs = async () => (await runAsCompany(a.id, () => db.select().from(schema.modelCosts))).length;
    const uses = async () => (await runAsCompany(a.id, () => db.select().from(schema.roofReportUses))).length;
    const before = [await costs(), await uses()];
    expect((await compare(one, two)).status).toBe(200);
    expect([await costs(), await uses()]).toEqual(before);
  });

  it('is a bare 404 while the switch is off', async () => {
    const one = await make(a, null); const two = await make(a, null);
    process.env.ARCHIE_ROOF_REPORTS = 'off';
    try {
      const res = await compare(one, two);
      expect(res.status).toBe(404);
      expect(res.text).toBe('');
    } finally { process.env.ARCHIE_ROOF_REPORTS = 'on'; }
  });
});
