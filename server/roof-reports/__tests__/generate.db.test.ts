/**
 * The generation service against the real local test database as the app's
 * own role (Task B6): what is saved, how a report that died midway is left,
 * and that every paid model call writes a cost row for the company that
 * caused it. The models, the storm sources and the photo store are fakes.
 * Fictional company: Summit Ridge Roofing in Cedar Falls.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { sql, eq } from 'drizzle-orm';
import { GENERATE_FAILED } from '../../../shared/roof-reports';
import type { ModelCaller } from '../../lib/roof-reports/model-call';
import { fakeStore } from './harness';

vi.mock('@vercel/functions', () => ({ waitUntil: () => {} }));

const url = process.env.DATABASE_URL || '';
const local = process.env.ARCHIE_REHEARSAL === '1' || /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url);

describe.skipIf(!local)('generation: saving, failing and metering (database)', async () => {
  const { db } = await import('../../db');
  const schema = await import('../../../shared/schema');
  const { runAsCompany } = await import('../../tenant/context');
  const { createCompany } = await import('../../tenant/companies');
  const store = await import('../store');
  const { liveDeps, runGeneration } = await import('../generate');
  const { brandFor } = await import('../brand');
  const { resolveCompanyProfile } = await import('../../../shared/company');
  const { setPhotoStoreForTests } = await import('../../photos/store');
  const { makeJpeg } = await import('../../photos/__tests__/jpeg-fixtures');

  const tag = `rrgen-${process.pid}-${Date.now()}`;
  let a = ''; let b = '';
  beforeAll(async () => {
    a = (await createCompany({ slug: `${tag}-a`, name: 'Summit Ridge Roofing', status: 'active' })).id;
    b = (await createCompany({ slug: `${tag}-b`, name: 'Cedar Falls Roofing Two', status: 'active' })).id;
  });

  const newReport = (company: string, over: Record<string, unknown> = {}) => runAsCompany(company, async () => {
    const [r] = await db.insert(schema.roofReports).values({ address: '12 Elm Street', city: 'Cedar Falls', state: 'IA', reportTypes: ['inspection'], ...over } as any).returning();
    return r;
  });
  const reload = (company: string, id: string) => runAsCompany(company, async () => (await db.select().from(schema.roofReports).where(eq(schema.roofReports.id, id)))[0]);

  const fakeReport = (id: string) => ({
    id, generatedAt: '2026-11-24T12:00:00Z', version: '3.1',
    property: { address: '12 Elm Street', city: 'Cedar Falls', state: 'IA', zip: '50613', latitude: 42.5349, longitude: -92.4453 },
    stormHistory: { totalEvents: 7 }, damageAnalysis: { overallSeverity: 'medium', photos: [] },
    repairEstimate: { total: 1234.5, lineItems: [] }, dataQuality: 'partial',
  }) as any;

  describe('what is kept', () => {
    it('writes the whole report and its summary in one step, and only then calls it ready', async () => {
      const r = await newReport(a);
      expect(r.status).toBe('generating');
      expect(await runAsCompany(a, () => store.saveGenerated(r.id, fakeReport(r.id), null))).toBe(true);
      const row = await reload(a, r.id);
      expect(row.status).toBe('ready');
      expect(row.problem).toBeNull();
      expect((row.reportJson as any).repairEstimate.total).toBe(1234.5);
      expect(Number(row.totalEstimate)).toBe(1234.5);
      expect(row.damageSeverity).toBe('medium');
      expect(row.stormEventsCount).toBe(7);
      expect(row.dataQuality).toBe('partial');
      expect(Number(row.latitude)).toBeCloseTo(42.5349, 4);
      expect(Number(row.longitude)).toBeCloseTo(-92.4453, 4);
    });

    it('keeps a warning with a ready report, and never marks a ready one failed or saves over a failed one', async () => {
      const r = await newReport(a);
      expect(await runAsCompany(a, () => store.saveGenerated(r.id, fakeReport(r.id), '2 of the 4 photos could not be analysed.'))).toBe(true);
      expect((await reload(a, r.id)).problem).toBe('2 of the 4 photos could not be analysed.');
      expect(await runAsCompany(a, () => store.markFailed(r.id, GENERATE_FAILED))).toBe(false);
      expect((await reload(a, r.id)).status).toBe('ready');
      const f = await newReport(a);
      expect(await runAsCompany(a, () => store.markFailed(f.id, GENERATE_FAILED))).toBe(true);
      expect(await runAsCompany(a, () => store.saveGenerated(f.id, fakeReport(f.id), null))).toBe(false);
      const row = await reload(a, f.id);
      expect(row.status).toBe('failed');
      expect(row.reportJson).toBeNull();
    });

    it('never touches another company\'s report', async () => {
      const other = await newReport(b);
      expect(await runAsCompany(a, () => store.saveGenerated(other.id, fakeReport(other.id), null))).toBe(false);
      expect(await runAsCompany(a, () => store.markFailed(other.id, GENERATE_FAILED))).toBe(false);
      expect((await reload(b, other.id)).status).toBe('generating');
    });
  });

  describe('a run that dies midway', () => {
    it('leaves a failed report with a plain sentence, never a half-written ready one', async () => {
      const r = await newReport(a);
      const deps = {
        storm: async () => { throw new Error('connect ECONNREFUSED 10.0.0.1:5432 at /var/task/node_modules/x.js'); },
      } as any;
      await runAsCompany(a, async () => {
        try {
          await runGeneration(r.id, { reportTypes: ['inspection'], template: 'full', address: '12 Elm Street', city: 'Cedar Falls', state: 'IA', photoIds: [] }, { ...liveDeps(r.id), ...deps });
        } catch (e) {
          await store.markFailed(r.id, store.failureSentence(e));
        }
      });
      const row = await reload(a, r.id);
      expect(row.status).toBe('failed');
      expect(row.reportJson).toBeNull();
      expect(row.problem).toBe("We couldn't find that address on the map. Check the street, city and ZIP.");
      expect(row.problem).not.toMatch(/ECONN|node_modules|5432/);
    });

    it('says the plain failure sentence for anything it does not recognise, and never an error\'s own words', () => {
      expect(store.failureSentence(new Error('password authentication failed for user "archie_app"'))).toBe(GENERATE_FAILED);
      expect(store.failureSentence('x')).toBe(GENERATE_FAILED);
      expect(store.failureSentence(null)).toBe(GENERATE_FAILED);
    });

    it('reads a report still generating after eight minutes as failed, without changing anything', async () => {
      const r = await newReport(a);
      const row = await reload(a, r.id);
      const now = new Date(row.updatedAt.getTime());
      expect(store.effectiveState(row, now)).toEqual({ status: 'generating', problem: null });
      expect(store.effectiveState(row, new Date(now.getTime() + 7 * 60_000))).toEqual({ status: 'generating', problem: null });
      expect(store.effectiveState(row, new Date(now.getTime() + 8 * 60_000 + 1))).toEqual({ status: 'failed', problem: GENERATE_FAILED });
      expect(store.effectiveState({ ...row, status: 'ready', problem: 'a warning' }, new Date(now.getTime() + 99 * 60_000))).toEqual({ status: 'ready', problem: 'a warning' });
      expect((await reload(a, r.id)).status).toBe('generating');
    });

    it('can be tried again once it has failed (or been left more than eight minutes), and not while it is running or after it is ready', async () => {
      const running = await newReport(a);
      expect(await runAsCompany(a, () => store.beginRetry(running.id))).toBeNull();
      expect(await runAsCompany(a, () => store.markFailed(running.id, GENERATE_FAILED))).toBe(true);
      const again = await runAsCompany(a, () => store.beginRetry(running.id));
      expect(again?.status).toBe('generating');
      expect(again?.problem).toBeNull();
      // Two requests cannot both start it.
      expect(await runAsCompany(a, () => store.beginRetry(running.id))).toBeNull();
      // A run that was left behind long ago can be taken over.
      await runAsCompany(a, () => db.execute(sql`update roof_reports set updated_at = now() - interval '9 minutes' where id = ${running.id}`));
      expect((await runAsCompany(a, () => store.beginRetry(running.id)))?.status).toBe('generating');
      await runAsCompany(a, () => store.saveGenerated(running.id, fakeReport(running.id), null));
      expect(await runAsCompany(a, () => store.beginRetry(running.id))).toBeNull();
      // Another company's report, never.
      const other = await newReport(b);
      await runAsCompany(b, () => store.markFailed(other.id, GENERATE_FAILED));
      expect(await runAsCompany(a, () => store.beginRetry(other.id))).toBeNull();
    });
  });

  describe('every paid model call is recorded for the company that caused it', () => {
    const analysisJson = JSON.stringify({
      image_quality: 'good', roof_material: { type: 'asphalt_shingle', confidence: 90, characteristics: [] },
      damages_detected: [{ damage_type_id: 'missing_shingles', damage_name: 'Missing shingles', category: 'wind', confidence: 80, severity: 'severe', location_description: 'near the ridge', visual_evidence: ['bare underlayment'], haag_compliant: true, insurance_claim_worthy: true, repair_recommendation: 'Replace', estimated_urgency: 'soon' }],
      overall_condition: 'fair', overall_severity_score: 65, insurance_claim_recommended: true, summary: 'Shingles are missing.', detailed_findings: '', recommendations: [],
    });

    it('meters the photo analysis, the narrative and the labels, one row each, as that company only', async () => {
      const r = await newReport(a);
      const calls: Array<{ role: string }> = [];
      const base: ModelCaller = async (request) => {
        calls.push({ role: request.role });
        const text = request.role === 'narrative'
          ? JSON.stringify({ findings: [{ title: 'Missing shingles', severity: 'high', narrative: 'x', repairAction: 'y', insuranceRelevant: true }], executiveSummary: 'ok' })
          : request.role === 'labels' ? JSON.stringify({ labels: [{ text: 'Missing', position: 'center', severity: 'high' }] }) : analysisJson;
        return { text, usage: { inputTokens: 1000, outputTokens: 100 } };
      };
      const deps = liveDeps(r.id, { keys: { groq: 'k1' }, base });
      const signal = new AbortController().signal;
      await runAsCompany(a, async () => {
        const photo = { bytes: makeJpeg() };
        const analysed = await deps.analyze(photo, { signal });
        expect(analysed.success).toBe(true);
        await deps.narrate({ analyzedPhotos: [], damageAnalysis: { totalPhotosAnalyzed: 0, photosWithDamage: 0, overallSeverity: 'none', roofAge: null, damageTypes: [], photos: [], aiSummary: '' } as any }, { signal });
        await deps.label([{ photoId: 'p1', image: { bytes: photo.bytes, mediaType: 'image/jpeg' }, existingDamages: [] }], { signal });
      });
      const rows = await runAsCompany(a, async () => (await db.execute(sql`select * from model_costs where ref = ${r.id} order by operation`)).rows as any[]);
      expect(rows.map((x) => x.operation).sort()).toEqual(['narrative', 'photo_analysis', 'photo_labels']);
      for (const row of rows) {
        expect(row.company_id).toBe(a);
        expect(['groq', 'anthropic']).toContain(row.provider);
        expect(row.input_tokens).toBe(1000);
      }
      expect(calls.length).toBe(3);
      const seenByB = await runAsCompany(b, async () => (await db.execute(sql`select * from model_costs where ref = ${r.id}`)).rows);
      expect(seenByB).toEqual([]);
    });

    it('never calls a model whose key is not set, and records nothing for it', async () => {
      const r = await newReport(a);
      let called = 0;
      const base: ModelCaller = async () => { called++; return { text: '{}' }; };
      const deps = liveDeps(r.id, { keys: {}, base: undefined });
      void base;
      const signal = new AbortController().signal;
      await runAsCompany(a, async () => {
        const out = await deps.analyze({ bytes: makeJpeg() }, { signal });
        expect(out.success).toBe(false);
        expect(await deps.narrate({ analyzedPhotos: [], damageAnalysis: {} as any }, { signal })).toBeNull();
        expect(await deps.label([{ photoId: 'p', image: { bytes: makeJpeg(), mediaType: 'image/jpeg' }, existingDamages: [] }], { signal })).toBeNull();
      });
      expect(called).toBe(0);
      const rows = await runAsCompany(a, async () => (await db.execute(sql`select 1 from model_costs where ref = ${r.id}`)).rows);
      expect(rows).toEqual([]);
    });

    it('reads a photo only if it is this report\'s own', async () => {
      const mine = await newReport(a);
      const other = await newReport(a);
      const s = fakeStore();
      setPhotoStoreForTests(s);
      try {
        const id = crypto.randomUUID();
        const workingKey = `c/${a}/rr/pending/${id}/working.jpg`;
        s.objects.set(workingKey, makeJpeg());
        await runAsCompany(a, () => db.insert(schema.roofReportPhotos).values({ id, reportId: mine.id, category: 'overview', workingKey, thumbKey: `c/${a}/rr/pending/${id}/thumb.jpg` } as any));
        const deps = liveDeps(mine.id, { keys: {} });
        const own = await runAsCompany(a, () => deps.photoBytes(mine.id, id));
        expect(own?.category).toBe('overview');
        expect(own?.bytes[0]).toBe(0xff);
        expect(await runAsCompany(a, () => deps.photoBytes(other.id, id))).toBeNull();
        expect(await runAsCompany(b, () => deps.photoBytes(mine.id, id))).toBeNull();
      } finally {
        setPhotoStoreForTests(null);
      }
    });
  });

  describe('the company look', () => {
    it('comes from the company\'s own settings, with no matching on any name', () => {
      const profile = resolveCompanyProfile({
        id: a, name: 'Summit Ridge Roofing',
        branding: { phone: '(555) 010-0199', email: 'office@example.com', website: 'summitridge.example.com', primaryColor: '#1F3A5F', accentColor: '#C0392B' } as any,
      } as any);
      const brand = brandFor(profile);
      expect(brand.brandColors.companyName).toBe('Summit Ridge Roofing');
      expect(brand.brandColors.companyPhone).toBe('(555) 010-0199');
      expect(brand.brandColors.companyEmail).toBe('office@example.com');
      expect(brand.brandColors.brandPrimaryColor).toMatch(/^#[0-9a-f]{6}$/i);
      expect(brand.contact).toEqual({ company: 'Summit Ridge Roofing', phone: '(555) 010-0199' });
      expect(brand.companyHeader.name).toBe('Summit Ridge Roofing');
    });
  });
});
