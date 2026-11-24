/**
 * Rewriting a finding or the summary (the two actions the old program had), through
 * a real request path on the local test database with a FAKE model: no model is ever called.
 *
 * Each call asks the model (role "rewrite", the one place model ids live) through
 * the metered caller, so it writes one cost row for the company that caused it. The
 * prompt holds that report's own finding or summary and the roof facts and nothing
 * else. What comes back is cleaned and cut, and stored only through the same
 * normalizer a hand edit goes through. A failure answers one plain sentence and
 * changes nothing. A report and a company have a daily limit that holds when the
 * requests arrive together. Same right as editing: crew refused, a salesperson only
 * on a report they may see, another company's report is "not found".
 * Fictional companies: Summit Ridge Roofing and Cedar Falls Roofing Two.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { makeReport } from '../../lib/roof-reports/__tests__/fixtures/report';
import type { ModelCaller, ModelCallRequest } from '../../lib/roof-reports/model-call';
import { ROOF_REPORT_MODELS } from '../../lib/roof-reports/models';
import { REWRITE_BUSY, REWRITE_CHANGED, REWRITE_COMPANY_CAPPED, REWRITE_FAILED, REWRITE_NOT_AVAILABLE, REWRITE_NOT_READY, REWRITE_NO_SUCH, REWRITE_REPORT_CAPPED } from '../../../shared/roof-reports';
import { localDb, startRoofApp, type Co } from './harness';

vi.mock('@vercel/functions', () => ({ waitUntil: () => {} }));

describe.skipIf(!localDb)('rewriting a finding or the summary (database, fake model)', async () => {
  const tag = `rrrewrite-${process.pid}-${Date.now()}`;
  const { registerRoofReportsRoutes } = await import('../routes');
  const { __resetRateLimits } = await import('../../lib/rate-limit');

  const requests: ModelCallRequest[] = [];
  let behaviour: 'ok' | 'throw' | 'empty' | 'null' | 'hang' | 'dirty' | 'long' | 'edit-meanwhile' | 'gate' = 'ok';
  /** A model that waits here (behaviour 'gate') so a test can hold a rewrite in flight and ask for another. */
  let gate: Promise<void> = Promise.resolve();
  let onThink: (() => Promise<void>) | null = null;
  let configured = true;
  const NEW_TEXT = 'Several shingles are missing near the ridge, which leaves the underlayment open to rain. A repair should be made soon.';
  const model: ModelCaller = async (request) => {
    requests.push(request);
    const usage = { inputTokens: 300, outputTokens: 80 };
    if (behaviour === 'hang') await new Promise<void>((_r, reject) => request.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
    if (behaviour === 'throw') throw Object.assign(new Error('The provider said: key sk-secret-123 is not valid for dana@example.com'), { status: 401 });
    if (behaviour === 'null') return { text: null as never };
    if (behaviour === 'empty') return { text: '   ', usage };
    if (behaviour === 'dirty') return { text: `"\`\`\`\n${NEW_TEXT}\u0000 — <script>alert(1)</script>\n\`\`\`"`, usage };
    if (behaviour === 'long') return { text: `${NEW_TEXT} `.repeat(200), usage };
    if (behaviour === 'edit-meanwhile') await onThink?.();
    if (behaviour === 'gate') await gate;
    return { text: NEW_TEXT, usage };
  };
  let caps = { perReport: 20, perCompany: 300 };
  const h = await startRoofApp(tag, (app) => registerRoofReportsRoutes(app, { rewriteModel: () => (configured ? model : null), rewriteCaps: () => caps, rewriteDeadlineMs: 400 }));
  const { db, schema, runAsCompany } = h;
  const savedSwitch = process.env.ARCHIE_ROOF_REPORTS;
  let a: Co; let b: Co;
  const OLD = 'Several shingles are missing near the ridge.';
  const FINDINGS = [
    { id: 'finding-0', title: 'Missing shingles', severity: 'high', narrative: OLD, relatedPhotoIds: [], repairAction: 'Replace the shingles', insuranceRelevant: true },
    { id: 'finding-1', title: 'Chimney flashing', severity: 'low', narrative: 'ZZ-OTHER-FINDING-TEXT', relatedPhotoIds: [], repairAction: 'Reseal', insuranceRelevant: false },
  ];
  const SUMMARY = 'The roof has wind damage near the ridge and should be repaired soon.';
  const rewriteFinding = (id: string, index: unknown = 0) => h.post(`/api/roof-reports/${id}/rewrite-finding`, { index });
  const rewriteSummary = (id: string) => h.post(`/api/roof-reports/${id}/rewrite-summary`, {});

  async function makeRow(co: Co, who: string | null, over: Record<string, unknown> = {}): Promise<string> {
    const [r] = await runAsCompany(co.id, () => db.insert(schema.roofReports).values({
      address: '12 Elm Street', city: 'Cedar Falls', state: 'IA', reportTypes: ['inspection'], status: 'ready', title: 'Roof report, 12 Elm Street',
      createdByMemberId: who ? co.people[who].id : null, customerName: 'Dana Whitfield', customerEmail: 'dana@example.com', inspectorNotes: 'ZZ-INSPECTOR-NOTES',
      reportJson: makeReport({ id: 'rewrite-report', executiveSummary: SUMMARY, structuredFindings: FINDINGS as never, roofDetails: { material: 'asphalt_shingle', squares: 24, pitch: '6/12' } }), ...over,
    } as any).returning());
    return r.id;
  }
  const rowOf = (co: Co, id: string) => runAsCompany(co.id, async () => (await db.select().from(schema.roofReports).where(eq(schema.roofReports.id, id)))[0]);
  const costsOf = (co: Co, id: string) => runAsCompany(co.id, async () => db.select().from(schema.modelCosts).where(and(eq(schema.modelCosts.ref, id), eq(schema.modelCosts.operation, 'rewrite'))));
  const liveUses = (co: Co) => runAsCompany(co.id, async () => (await db.select().from(schema.roofReportUses)).filter((u) => u.kind === 'rewrite').length);
  const report = async (co: Co, id: string) => (await rowOf(co, id)).reportJson as any;

  let logs: string[] = [];
  const spies: Array<ReturnType<typeof vi.spyOn>> = [];
  beforeAll(async () => {
    process.env.ARCHIE_ROOF_REPORTS = 'on';
    a = await h.company('Summit Ridge Roofing', [['admin', 'admin'], ['csr', 'customer_service'], ['repa', 'sales'], ['repb', 'sales'], ['crew', 'production']]);
    b = await h.company('Cedar Falls Roofing Two', [['admin', 'admin']]);
  });
  beforeEach(() => {
    __resetRateLimits(); requests.length = 0; behaviour = 'ok'; gate = Promise.resolve(); onThink = null; configured = true; caps = { perReport: 20, perCompany: 300 }; logs = [];
    for (const m of ['log', 'info', 'warn', 'error', 'debug'] as const) spies.push(vi.spyOn(console, m).mockImplementation((...args: unknown[]) => { logs.push(args.map((x) => (x instanceof Error ? `${x.name}: ${x.message}` : String(x))).join(' ')); }));
    h.as(a, 'admin');
  });
  afterEach(() => { for (const s of spies.splice(0)) s.mockRestore(); });
  afterAll(async () => {
    if (savedSwitch === undefined) delete process.env.ARCHIE_ROOF_REPORTS; else process.env.ARCHIE_ROOF_REPORTS = savedSwitch;
    await h.close();
  });

  it('rewrites one finding: only its words change, and the answer is the report as it now stands', async () => {
    const id = await makeRow(a, 'repa');
    const before = await rowOf(a, id);
    h.as(a, 'repa');
    const res = await rewriteFinding(id, 0);
    expect(res.status, res.text).toBe(200);
    const after = await report(a, id);
    expect(after.structuredFindings[0]).toEqual({ ...FINDINGS[0], narrative: NEW_TEXT });
    expect(after.structuredFindings[1]).toEqual(FINDINGS[1]);
    expect(after.executiveSummary).toBe(SUMMARY);
    expect(res.body.report.structuredFindings[0].narrative).toBe(NEW_TEXT);
    expect((await rowOf(a, id)).updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime());
    expect((await rowOf(a, id)).inspectorNotes).toBe('ZZ-INSPECTOR-NOTES');
  });

  it('rewrites the summary: only the summary changes', async () => {
    const id = await makeRow(a, 'repa');
    h.as(a, 'repa');
    const res = await rewriteSummary(id);
    expect(res.status, res.text).toBe(200);
    const after = await report(a, id);
    expect(after.executiveSummary).toBe(NEW_TEXT);
    expect(after.structuredFindings).toEqual(FINDINGS);
    expect(res.body.report.executiveSummary).toBe(NEW_TEXT);
  });

  it('asks the model for the rewrite role, once, and records the cost for the company that caused it, tagged with the report', async () => {
    const id = await makeRow(a, 'repa');
    await rewriteFinding(id, 0);
    expect(requests).toHaveLength(1);
    expect(requests[0].role).toBe('rewrite');
    expect(ROOF_REPORT_MODELS.rewrite.provider).toBe('anthropic');
    const costs = await costsOf(a, id);
    expect(costs).toHaveLength(1);
    expect(costs[0]).toMatchObject({ operation: 'rewrite', provider: 'anthropic', model: ROOF_REPORT_MODELS.rewrite.id, ref: id, companyId: a.id, inputTokens: 300, outputTokens: 80 });
    expect(await costsOf(b, id)).toHaveLength(0);
    // The summary is the same.
    await rewriteSummary(id);
    expect(await costsOf(a, id)).toHaveLength(2);
  });

  it('puts only that report\'s own finding and the roof facts in the prompt: no other finding, customer, address, staff or other company', async () => {
    const id = await makeRow(a, 'repa');
    const idB = await makeRow(b, null, { reportJson: makeReport({ structuredFindings: [{ ...FINDINGS[0], title: 'ZZ-OTHER-COMPANY-TITLE', narrative: 'ZZ-OTHER-COMPANY-TEXT' }] as never, executiveSummary: 'ZZ-OTHER-COMPANY-SUMMARY' }) });
    await rewriteFinding(id, 0);
    const finding = requests[0];
    const everything = `${finding.prompt}\n${finding.system ?? ''}`;
    expect(everything).toContain('Missing shingles');
    expect(everything).toContain(OLD);
    for (const mark of ['ZZ-OTHER-FINDING-TEXT', 'Chimney flashing', 'ZZ-INSPECTOR-NOTES', 'Dana', 'dana@example.com', 'Elm Street', 'Cedar Falls', a.people.repa.email, a.people.admin.email, 'ZZ-OTHER-COMPANY', idB, a.id, b.id, id]) expect(everything, mark).not.toContain(mark);
    expect(finding.image).toBeUndefined();

    requests.length = 0;
    await rewriteSummary(id);
    const summary = `${requests[0].prompt}\n${requests[0].system ?? ''}`;
    expect(summary).toContain('Missing shingles');
    expect(summary).toContain('ZZ-OTHER-FINDING-TEXT');
    expect(summary).toContain('asphalt_shingle');
    for (const mark of ['ZZ-INSPECTOR-NOTES', 'Dana', 'dana@example.com', 'Elm Street', 'Cedar Falls', a.people.repa.email, 'ZZ-OTHER-COMPANY', idB, a.id, id]) expect(summary, mark).not.toContain(mark);
  });

  it('cleans and cuts what the model wrote before it is stored', async () => {
    const id = await makeRow(a, 'repa');
    behaviour = 'dirty';
    expect((await rewriteFinding(id, 0)).status).toBe(200);
    const stored = (await report(a, id)).structuredFindings[0].narrative as string;
    expect(stored).toContain(NEW_TEXT.slice(0, 40));
    expect(stored).not.toMatch(/[\u0000—<>`"]/);
    behaviour = 'long';
    expect((await rewriteSummary(id)).status).toBe(200);
    const summary = (await report(a, id)).executiveSummary as string;
    expect(summary.length).toBeLessThanOrEqual(2000);
    expect(summary.endsWith('.')).toBe(true);
  });

  it('answers one plain sentence and changes nothing when the model fails, says nothing or says something that is not text', async () => {
    const id = await makeRow(a, 'repa');
    const before = await rowOf(a, id);
    for (const b of ['throw', 'empty', 'null'] as const) {
      behaviour = b;
      for (const res of [await rewriteFinding(id, 0), await rewriteSummary(id)]) {
        expect(res.status, b).toBe(502);
        expect(res.body, b).toEqual({ error: REWRITE_FAILED });
        expect(res.text, b).not.toMatch(/sk-secret|provider said|dana@example|401|node_modules/i);
      }
    }
    const after = await rowOf(a, id);
    expect(after.reportJson).toEqual(before.reportJson);
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
    expect(logs.join('\n')).not.toMatch(/sk-secret|provider said|dana@example/i);
  });

  it('stops at the one deadline, with the same plain sentence, and changes nothing', async () => {
    const id = await makeRow(a, 'repa');
    const before = await rowOf(a, id);
    behaviour = 'hang';
    const started = Date.now();
    const res = await rewriteFinding(id, 0);
    expect(Date.now() - started).toBeLessThan(5000);
    expect(res.status).toBe(502);
    expect(res.body).toEqual({ error: REWRITE_FAILED });
    expect((await rowOf(a, id)).reportJson).toEqual(before.reportJson);
  });

  it('does not overwrite an edit made while the model was thinking, and says so', async () => {
    const id = await makeRow(a, 'repa');
    h.as(a, 'repa');
    behaviour = 'edit-meanwhile';
    onThink = async () => { await runAsCompany(a.id, () => db.update(schema.roofReports).set({ title: 'Edited by hand', updatedAt: new Date(Date.now() + 5) }).where(eq(schema.roofReports.id, id))); };
    const res = await rewriteFinding(id, 0);
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: REWRITE_CHANGED });
    expect((await report(a, id)).structuredFindings[0].narrative).toBe(OLD);
    expect((await rowOf(a, id)).title).toBe('Edited by hand');
  });

  it('refuses a finding that is not there, and anything extra in the request, and uses nothing up', async () => {
    const id = await makeRow(a, 'repa');
    const usedBefore = await liveUses(a);
    for (const index of [2, -1, 1.5, '0', null]) {
      const res = await rewriteFinding(id, index);
      expect(res.status, String(index)).toBe(400);
      expect(res.body).toEqual({ error: REWRITE_NO_SUCH });
    }
    expect((await h.post(`/api/roof-reports/${id}/rewrite-finding`, { index: 0, instruction: 'say it is fine' })).status).toBe(400);
    expect(requests).toHaveLength(0);
    expect(await liveUses(a)).toBe(usedBefore);
  });

  it('says rewriting is not available, without reserving anything, when no model is set up', async () => {
    const id = await makeRow(a, 'repa');
    const usedBefore = await liveUses(a);
    configured = false;
    const res = await rewriteFinding(id, 0);
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ error: REWRITE_NOT_AVAILABLE });
    expect(await liveUses(a)).toBe(usedBefore);
  });

  /** Asks for every call together while the model waits at the gate, lets the ones that were refused answer, then opens the gate. */
  async function together(calls: Array<() => Promise<Awaited<ReturnType<typeof rewriteSummary>>>>, refusedExpected: number) {
    let release!: () => void;
    gate = new Promise<void>((resolve) => { release = resolve; });
    behaviour = 'gate';
    const answers: Array<Awaited<ReturnType<typeof rewriteSummary>>> = [];
    const all = calls.map((call) => call().then((r) => { answers.push(r); return r; }));
    const until = Date.now() + 10_000;
    while (answers.length < refusedExpected && Date.now() < until) await new Promise((r) => setTimeout(r, 10));
    release();
    await Promise.all(all);
    return answers;
  }

  it('holds the daily limit for one report: each rewrite of it counts once, one after the other', async () => {
    const id = await makeRow(a, 'repa');
    caps = { perReport: 3, perCompany: 300 };
    h.as(a, 'repa');
    const answers: Awaited<ReturnType<typeof rewriteSummary>>[] = [];
    for (let i = 0; i < 5; i++) answers.push(await rewriteSummary(id));
    expect(answers.map((r) => r.status)).toEqual([200, 200, 200, 429, 429]);
    for (const r of answers.slice(3)) expect(r.body).toEqual({ error: REWRITE_REPORT_CAPPED });
    expect(requests).toHaveLength(3);
  });

  it('holds the daily limit for a whole company, across reports, even when the requests arrive together', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 6; i++) ids.push(await makeRow(a, 'repa'));
    const used = await liveUses(a);
    caps = { perReport: 20, perCompany: used + 4 };
    h.as(a, 'repa');
    // Two asks for each of six reports at once. Four reports fit the company's day: each runs once and its second ask is busy.
    // The other two reports are over the company's limit, so both of their asks are refused for that.
    const answers = await together(Array.from({ length: 12 }, (_, i) => () => rewriteSummary(ids[i % 6])), 8);
    expect(answers.filter((r) => r.status === 200)).toHaveLength(4);
    const capped = answers.filter((r) => r.status === 429);
    expect(capped).toHaveLength(4);
    for (const r of capped) expect(r.body).toEqual({ error: REWRITE_COMPANY_CAPPED });
    expect(answers.filter((r) => r.status === 409 && r.body?.error === REWRITE_BUSY)).toHaveLength(4);
    expect(requests).toHaveLength(4);
    expect(await liveUses(a)).toBe(used + 4);
  });

  describe('two rewrites of the same report at once', () => {
    it('lets one run and refuses the other in plain words, so the cap counts one and the stored text is the one shown', async () => {
      const id = await makeRow(a, 'repa');
      caps = { perReport: 20, perCompany: 300 };
      h.as(a, 'repa');
      const usedBefore = await liveUses(a);
      const answers = await together([() => rewriteFinding(id, 0), () => rewriteSummary(id), () => rewriteFinding(id, 1)], 2);
      expect(REWRITE_BUSY).toBe('A rewrite of this report is already running.');
      const ok = answers.filter((r) => r.status === 200);
      const busy = answers.filter((r) => r.status === 409);
      expect(ok).toHaveLength(1);
      expect(busy).toHaveLength(2);
      for (const r of busy) expect(r.body).toEqual({ error: REWRITE_BUSY });
      // One model call, one counted use, one cost row, and what is stored is exactly what the one answer showed.
      expect(requests).toHaveLength(1);
      expect(await liveUses(a)).toBe(usedBefore + 1);
      expect(await costsOf(a, id)).toHaveLength(1);
      expect(await report(a, id)).toEqual(ok[0].body.report);
      // The refused ones changed nothing.
      const stored = await report(a, id);
      const changed = [stored.executiveSummary !== SUMMARY, stored.structuredFindings[0].narrative !== OLD, stored.structuredFindings[1].narrative !== 'ZZ-OTHER-FINDING-TEXT'].filter(Boolean);
      expect(changed).toHaveLength(1);
    }, 30_000);

    it('lets go as soon as the first one is done, whether it worked or not, so the next rewrite is allowed', async () => {
      const id = await makeRow(a, 'repa');
      h.as(a, 'repa');
      behaviour = 'throw';
      expect((await rewriteSummary(id)).status).toBe(502);
      behaviour = 'ok';
      expect((await rewriteSummary(id)).status).toBe(200);
      expect((await rewriteFinding(id, 0)).status).toBe(200);
    });

    it('does not hold up a different report of the same company, or the same report\'s next day', async () => {
      const one = await makeRow(a, 'repa');
      const two = await makeRow(a, 'repa');
      h.as(a, 'repa');
      const answers = await together([() => rewriteSummary(one), () => rewriteSummary(two)], 0);
      expect(answers.map((r) => r.status)).toEqual([200, 200]);
      expect(requests).toHaveLength(2);
    });

    it('does not let a rewrite that died hold the report for long: a left-behind one older than two minutes is let go of', async () => {
      const id = await makeRow(a, 'repa');
      h.as(a, 'repa');
      await runAsCompany(a.id, () => db.insert(schema.roofReportUses).values({ reportId: id, kind: 'rewrite', memberId: a.people.repa.id, status: 'reserved', createdAt: new Date(Date.now() - 3 * 60_000) } as any));
      expect((await rewriteSummary(id)).status).toBe(200);
      // A fresh one still holds it.
      await runAsCompany(a.id, () => db.insert(schema.roofReportUses).values({ reportId: id, kind: 'rewrite', memberId: a.people.repa.id, status: 'reserved', createdAt: new Date(Date.now() - 20_000) } as any));
      const busy = await rewriteSummary(id);
      expect(busy.status).toBe(409);
      expect(busy.body).toEqual({ error: REWRITE_BUSY });
    });

    it('says nothing a person should not see in the refusal', async () => {
      const id = await makeRow(a, 'repa');
      h.as(a, 'repa');
      const answers = await together([() => rewriteSummary(id), () => rewriteSummary(id)], 1);
      const busy = answers.find((r) => r.status === 409)!;
      expect(busy.text).toBe(JSON.stringify({ error: REWRITE_BUSY }));
    });
  });

  it('counts a rewrite that reached the model even when it did not work, but not one that never reached it', async () => {
    const id = await makeRow(a, 'repa');
    caps = { perReport: 2, perCompany: 300 };
    behaviour = 'throw';
    expect((await rewriteSummary(id)).status).toBe(502);
    expect((await rewriteSummary(id)).status).toBe(502);
    expect((await rewriteSummary(id)).status).toBe(429);
    const idTwo = await makeRow(a, 'repa');
    configured = false;
    expect((await rewriteSummary(idTwo)).status).toBe(503);
    configured = true; behaviour = 'ok';
    expect((await rewriteSummary(idTwo)).status).toBe(200);
  });

  it('is allowed to the same people as editing, and no one else', async () => {
    const mine = await makeRow(a, 'repa', { jobExternalId: null });
    const theirs = await makeRow(a, 'repb', { jobExternalId: null });
    h.as(a, 'repa');
    expect((await rewriteFinding(mine, 0)).status).toBe(200);
    expect((await rewriteFinding(theirs, 0)).status).toBe(404);
    expect((await rewriteSummary(theirs)).status).toBe(404);
    h.as(a, 'repb');
    expect((await rewriteSummary(mine)).status).toBe(404);
    h.as(a, 'crew');
    expect((await rewriteFinding(mine, 0)).status).toBe(404);
    expect((await rewriteSummary(mine)).status).toBe(404);
    h.as(a, 'csr');
    expect((await rewriteSummary(mine)).status).toBe(200);
    h.as(a, 'admin');
    expect((await rewriteFinding(theirs, 0)).status).toBe(200);
  });

  it('answers another company\'s person "not found" and calls and changes nothing', async () => {
    const id = await makeRow(a, 'repa');
    const before = await rowOf(a, id);
    h.as(b, 'admin');
    expect((await rewriteFinding(id, 0)).status).toBe(404);
    expect((await rewriteSummary(id)).status).toBe(404);
    expect(requests).toHaveLength(0);
    expect((await rowOf(a, id)).reportJson).toEqual(before.reportJson);
  });

  it('does not rewrite a report that is not finished, is archived or is not there', async () => {
    const making = await makeRow(a, 'repa', { status: 'generating', reportJson: null });
    const archived = await makeRow(a, 'repa', { status: 'archived' });
    for (const call of [rewriteFinding, rewriteSummary]) {
      const res = await call(making, 0);
      expect(res.status).toBe(409);
      expect(res.body).toEqual({ error: REWRITE_NOT_READY });
      expect((await call(archived, 0)).status).toBe(404);
      expect((await call('00000000-0000-4000-8000-00000000dead', 0)).status).toBe(404);
      expect((await call('not-an-id', 0)).status).toBe(404);
    }
    expect(requests).toHaveLength(0);
  });

  it('changes the report only through the normalizer when it is a finding too: a photo the report does not own never gets in, and the id is the report\'s own', async () => {
    const id = await makeRow(a, 'repa', { reportJson: makeReport({ id: 'someone-elses', structuredFindings: FINDINGS as never, executiveSummary: SUMMARY, damageAnalysis: { ...makeReport().damageAnalysis, photos: [{ id: 'not-this-reports-photo', url: 'https://evil.example/x.jpg', damages: [], overallSeverity: 'low', aiSummary: 'x', analyzedAt: '' }] } }) });
    expect((await rewriteFinding(id, 0)).status).toBe(200);
    const stored = await report(a, id);
    expect(stored.damageAnalysis.photos).toEqual([]);
    expect(JSON.stringify(stored)).not.toContain('evil.example');
    expect(stored.id).toBe(id);
    expect(stored.structuredFindings[0].narrative).toBe(NEW_TEXT);
  });

  it('changes the report only through the normalizer: a photo the report does not own never gets in', async () => {
    const id = await makeRow(a, 'repa', { reportJson: makeReport({ structuredFindings: FINDINGS as never, executiveSummary: SUMMARY, damageAnalysis: { ...makeReport().damageAnalysis, photos: [{ id: 'not-this-reports-photo', url: 'https://evil.example/x.jpg', damages: [], overallSeverity: 'low', aiSummary: 'x', analyzedAt: '' }] } }) });
    expect((await rewriteSummary(id)).status).toBe(200);
    const stored = await report(a, id);
    expect(stored.damageAnalysis.photos).toEqual([]);
    expect(JSON.stringify(stored)).not.toContain('evil.example');
    expect(stored.id).toBe(id);
  });
});
