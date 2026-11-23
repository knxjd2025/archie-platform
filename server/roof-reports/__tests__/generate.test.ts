/**
 * The generation service (Task B6), with every dependency faked: no storm
 * source, no model, no photo store, no database. Fictional customer: Dana
 * Whitfield, 12 Elm Street, Cedar Falls.
 *
 * Holds: one deadline shared by every step; photo analysis in batches of three
 * with a pause between; storm and photo analysis giving partial results rather
 * than throwing; the narrative and the labels never failing a report; photo
 * bytes, never addresses, handed to every dependency; nothing in the saved
 * report naming a place in the photo store.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  GenerateInputError, GeocodeFailedError, runGeneration, type GenerateDeps, type GenerateRequest,
} from '../generate';
import { GEOCODE_FAILED, TOO_MANY_PHOTOS, PICK_A_KIND, NEEDS_ADDRESS } from '../../../shared/roof-reports';
import type { RoofAnalysisResult } from '../../lib/roof-reports/groq-vision';
import type { StormReport } from '../../lib/roof-reports/storm-history-service';
import { analysis, fakeStorm } from './fakes';

const REPORT = 'a1b2c3d4-0000-4000-8000-000000000001';
const photoId = (i: number) => `00000000-0000-4000-8000-0000000000${String(i).padStart(2, '0')}`;
const ids = (n: number) => Array.from({ length: n }, (_, i) => photoId(i + 1));

interface Spy { deps: GenerateDeps; calls: Record<string, any[][]>; sleeps: number[]; running: { now: number; max: number } }

function makeDeps(over: Partial<GenerateDeps> = {}): Spy {
  const calls: Record<string, any[][]> = { storm: [], enhancedStorm: [], analyze: [], narrate: [], label: [], photoBytes: [] };
  const running = { now: 0, max: 0 };
  const deps: GenerateDeps = {
    storm: async (...a: any[]) => { calls.storm.push(a); return fakeStorm(); },
    enhancedStorm: ((s: StormReport) => { calls.enhancedStorm.push([s]); return { noaaEventPageUrls: [], nexradRadarImageUrls: [], countyStormDatabaseUrl: '', narratives: [], propertyProfile: null, hailSizeDistribution: {} }; }) as any,
    analyze: async (...a: any[]) => {
      calls.analyze.push(a);
      running.now++; running.max = Math.max(running.max, running.now);
      await new Promise((r) => setTimeout(r, 0));
      running.now--;
      return analysis();
    },
    narrate: async (...a: any[]) => { calls.narrate.push(a); return { findings: [{ id: 'finding-0', title: 'Missing shingles', severity: 'high', narrative: 'Shingles are missing.', relatedPhotoIds: [], repairAction: 'Replace', insuranceRelevant: true }], executiveSummary: 'A short summary.' }; },
    label: async (...a: any[]) => { calls.label.push(a); const out: Record<string, any[]> = {}; for (const i of a[0]) out[i.photoId] = [{ id: 'l1', text: 'Missing', position: 'center', severity: 'high' }]; return out; },
    photoBytes: async (...a: any[]) => { calls.photoBytes.push(a); return { bytes: Buffer.from([0xff, 0xd8, 0xff, 0xd9]), category: 'roof_surface' }; },
    now: () => new Date('2026-11-24T12:00:00Z'),
    sleep: async (ms: number) => { sleeps.push(ms); },
    ...over,
  };
  const sleeps: number[] = [];
  return { deps, calls, sleeps, running };
}

const base: GenerateRequest = {
  reportTypes: ['inspection', 'storm'], template: 'full',
  address: '12 Elm Street', city: 'Cedar Falls', state: 'IA', zip: '50613',
  photoIds: [], customer: { name: 'Dana Whitfield', email: 'dana@example.com' },
};

describe('a report with photos', () => {
  it('analyses them in batches of three with a pause between, from their bytes, and labels once', async () => {
    const s = makeDeps();
    const { report, warning } = await runGeneration(REPORT, { ...base, photoIds: ids(5) }, s.deps);
    expect(s.calls.analyze).toHaveLength(5);
    expect(s.running.max).toBe(3);
    expect(s.sleeps).toEqual([1000]);
    expect(s.calls.label).toHaveLength(1);
    expect(s.calls.narrate).toHaveLength(1);
    expect(warning).toBeNull();
    expect(report.id).toBe(REPORT);
    expect(report.damageAnalysis.photos.map((p) => p.id)).toEqual(ids(5));
    expect(report.damageAnalysis.totalPhotosAnalyzed).toBe(5);
    expect(report.photoLabels && Object.keys(report.photoLabels)).toEqual(ids(5));
    expect(report.structuredFindings?.[0].title).toBe('Missing shingles');
    expect(report.executiveSummary).toBe('A short summary.');
    expect(report.repairEstimate.lineItems.length).toBeGreaterThan(0);
    expect(report.roofDetails?.age_years).toBeGreaterThan(0);
  });

  it('puts the first batch of three in the air at once and never a fourth', async () => {
    const s = makeDeps();
    await runGeneration(REPORT, { ...base, photoIds: ids(7) }, s.deps);
    expect(s.running.max).toBe(3);
    expect(s.sleeps).toEqual([1000, 1000]);
  });

  it('hands the dependencies photo bytes and ids, never an address of any kind', async () => {
    const s = makeDeps();
    const { report } = await runGeneration(REPORT, { ...base, photoIds: ids(3) }, s.deps);
    for (const [photo] of s.calls.analyze) {
      expect(Buffer.isBuffer(photo.bytes)).toBe(true);
      expect(Object.keys(photo)).toEqual(['bytes']);
    }
    for (const input of s.calls.label[0][0]) {
      expect(Buffer.isBuffer(input.image.bytes)).toBe(true);
      expect(input.photoUrl).toBeUndefined();
    }
    const seen = JSON.stringify([s.calls.narrate, s.calls.label[0][0].map((i: any) => ({ ...i, image: undefined }))]);
    expect(seen).not.toMatch(/https?:\/\//);
    // Every call to read a photo names this report and a photo id, nothing else.
    for (const call of s.calls.photoBytes) expect(call).toEqual([REPORT, expect.stringMatching(/^00000000-/)]);
    // What is saved names a place in the app's own route, and no place in the store.
    const saved = JSON.stringify(report);
    expect(saved).not.toMatch(/\/rr\//);
    expect(saved).not.toMatch(/c\/[0-9a-f-]{36}/);
    expect(saved).not.toMatch(/https?:\/\/[^"]*\.(jpg|jpeg)/i);
    expect(report.damageAnalysis.photos[0].url).toBe(`/api/roof-reports/${REPORT}/photos/${photoId(1)}/working`);
    expect(report.damageAnalysis.photos[0].thumbnailUrl).toBe(`/api/roof-reports/${REPORT}/photos/${photoId(1)}/thumb`);
    expect(report.damageAnalysis.photos[0].photoCategory).toBe('roof_surface');
  });

  it('refuses more than forty photos with a plain sentence, before anything runs', async () => {
    const s = makeDeps();
    await expect(runGeneration(REPORT, { ...base, photoIds: ids(45) }, s.deps)).rejects.toThrow(TOO_MANY_PHOTOS);
    await expect(runGeneration(REPORT, { ...base, photoIds: ids(45) }, s.deps)).rejects.toBeInstanceOf(GenerateInputError);
    expect(s.calls.storm).toHaveLength(0);
    expect(s.calls.analyze).toHaveLength(0);
    expect(s.calls.photoBytes).toHaveLength(0);
  });

  it('refuses what a report cannot be made from, before anything runs', async () => {
    const s = makeDeps();
    await expect(runGeneration(REPORT, { ...base, reportTypes: [] }, s.deps)).rejects.toThrow(PICK_A_KIND);
    await expect(runGeneration(REPORT, { ...base, address: '  ' }, s.deps)).rejects.toThrow(NEEDS_ADDRESS);
    expect(s.calls.storm).toHaveLength(0);
  });
});

describe('when a step goes wrong the report still comes out', () => {
  it('saves a report with no narrative when the narrative throws, and is not worried about it', async () => {
    const s = makeDeps({ narrate: async () => { throw new Error('provider said: sk-secret-12345'); } });
    const { report, warning } = await runGeneration(REPORT, { ...base, photoIds: ids(2) }, s.deps);
    expect(report.structuredFindings).toBeUndefined();
    expect(report.damageAnalysis.photos).toHaveLength(2);
    expect(warning).toBeNull();
  });

  it('saves a report with no labels when the labels throw or come back empty', async () => {
    for (const label of [async () => { throw new Error('boom'); }, async () => null]) {
      const s = makeDeps({ label: label as any });
      const { report } = await runGeneration(REPORT, { ...base, photoIds: ids(2) }, s.deps);
      expect(report.photoLabels).toBeUndefined();
      expect(report.executiveSummary).toBe('A short summary.');
    }
  });

  it('says so in a plain sentence when not one photo could be analysed, and never claims there is no damage', async () => {
    const s = makeDeps({ analyze: async () => { throw new Error('upstream 500 with details'); } });
    const { report, warning } = await runGeneration(REPORT, { ...base, photoIds: ids(4) }, s.deps);
    expect(report.damageAnalysis.photos).toHaveLength(4);
    expect(report.damageAnalysis.photosWithDamage).toBe(0);
    expect(warning).toMatch(/could not be analysed/i);
    expect(warning).not.toMatch(/no damage|undamaged|good condition|nothing was found/i);
    expect(warning).not.toMatch(/upstream|500|details/);
    expect(report.damageAnalysis.photos.every((p) => !/upstream|500/.test(p.aiSummary))).toBe(true);
    expect(s.calls.narrate).toHaveLength(0);
  });

  it('keeps the photos it could analyse when some fail, and counts the rest', async () => {
    let n = 0;
    const s = makeDeps({ analyze: async () => { n++; return n % 2 === 0 ? analysis({ success: false, damages_detected: [] }) : analysis(); } });
    const { report, warning } = await runGeneration(REPORT, { ...base, photoIds: ids(4) }, s.deps);
    expect(report.damageAnalysis.photosWithDamage).toBe(2);
    expect(warning).toMatch(/2 of the 4 photos could not be analysed/);
  });

  it('includes a photo whose bytes cannot be read, as one that could not be analysed', async () => {
    const s = makeDeps({ photoBytes: async (_r: string, id: string) => (id === photoId(2) ? null : { bytes: Buffer.from([0xff, 0xd8, 0xff, 0xd9]), category: null }) });
    const { report, warning } = await runGeneration(REPORT, { ...base, photoIds: ids(3) }, s.deps);
    expect(report.damageAnalysis.photos).toHaveLength(3);
    expect(s.calls.analyze).toHaveLength(2);
    expect(warning).toMatch(/1 of the 3 photos could not be analysed/);
  });

  it('carries on with what the storm sources gave when the deadline cut them short, and says so', async () => {
    const s = makeDeps({ storm: async () => fakeStorm({ partial: true }) });
    const { report, warning } = await runGeneration(REPORT, { ...base, photoIds: [] }, s.deps);
    expect(report.stormHistory).toBeTruthy();
    expect(warning).toMatch(/storm/i);
    expect(warning).toMatch(/ran out of time|did not all answer/i);
  });

  it('answers with the plain address sentence when the address cannot be placed', async () => {
    const s = makeDeps({ storm: async () => { throw new Error('Unable to geocode address'); } });
    const run = runGeneration(REPORT, base, s.deps);
    await expect(run).rejects.toBeInstanceOf(GeocodeFailedError);
    await expect(run).rejects.toThrow(GEOCODE_FAILED);
    const s2 = makeDeps({ storm: async () => fakeStorm({ latitude: 0, longitude: 0, partial: true }) });
    await expect(runGeneration(REPORT, base, s2.deps)).rejects.toThrow(/could not be finished|ran out of time/i);
  });
});

describe('one deadline for the whole run', () => {
  it('hands the very same signal to the storm fetch, every photo, the narrative and the labels', async () => {
    const controller = new AbortController();
    const s = makeDeps({ deadline: () => controller.signal });
    await runGeneration(REPORT, { ...base, photoIds: ids(4) }, s.deps);
    const stormSignal = s.calls.storm[0][4].signal;
    expect(stormSignal).toBe(controller.signal);
    for (const [, ctx] of s.calls.analyze) expect(ctx.signal).toBe(controller.signal);
    // The narrative and the labels also have a minute of their own, but still stop with the deadline.
    for (const call of [s.calls.narrate[0][1], s.calls.label[0][1]]) {
      expect(call.signal).toBeInstanceOf(AbortSignal);
      expect(call.signal.aborted).toBe(false);
    }
    // The step's signal is the deadline's too: when the deadline fires it fires.
    let sawAborted: boolean | undefined;
    const stop = makeDeps({ deadline: () => controller.signal, narrate: async (_i: any, o: any) => { controller.abort(); sawAborted = o.signal.aborted; return null; } });
    await runGeneration(REPORT, { ...base, photoIds: ids(1) }, stop.deps);
    expect(sawAborted).toBe(true);
  });

  it('stops starting photos once the deadline has passed, keeps the ones it has, and says so', async () => {
    const controller = new AbortController();
    let n = 0;
    const s = makeDeps({
      deadline: () => controller.signal,
      analyze: async () => { n++; if (n === 3) controller.abort(); return analysis(); },
    });
    const { report, warning } = await runGeneration(REPORT, { ...base, photoIds: ids(9) }, s.deps);
    expect(n).toBe(3);
    expect(report.damageAnalysis.photos).toHaveLength(9);
    expect(report.damageAnalysis.photosWithDamage).toBe(3);
    expect(warning).toMatch(/ran out of time/i);
    expect(warning).toMatch(/6 of the 9 photos/);
  });

  it('gives the narrative and the labels a minute each, and moves on without them after that', async () => {
    vi.useFakeTimers();
    try {
      const never = () => new Promise<never>(() => {});
      const s = makeDeps({ narrate: never as any, label: never as any, sleep: async () => {} });
      const run = runGeneration(REPORT, { ...base, photoIds: ids(2) }, s.deps);
      await vi.advanceTimersByTimeAsync(61_000);
      const { report } = await run;
      expect(report.structuredFindings).toBeUndefined();
      expect(report.photoLabels).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('what each kind of report does', () => {
  it('asks only for storm history: no analysis, no estimate, no labels, and a ten year window', async () => {
    const s = makeDeps();
    const { report } = await runGeneration(REPORT, { ...base, reportTypes: ['storm'], photoIds: ids(3) }, s.deps);
    expect(s.calls.analyze).toHaveLength(0);
    expect(s.calls.label).toHaveLength(0);
    expect(s.calls.narrate).toHaveLength(0);
    expect(s.calls.photoBytes).toHaveLength(0);
    expect(s.calls.enhancedStorm).toHaveLength(1);
    expect(s.calls.storm[0][4]).toMatchObject({ yearsBack: 10, searchRadiusMiles: 5 });
    expect(report.repairEstimate.lineItems).toEqual([]);
    expect(report.reportTypes).toEqual(['storm']);
    expect(report.damageAnalysis.photos).toEqual([]);
  });

  it('uses a three year window beside an inspection, and still asks the storm source to place the address', async () => {
    const s = makeDeps();
    await runGeneration(REPORT, { ...base, reportTypes: ['inspection'] }, s.deps);
    expect(s.calls.storm).toHaveLength(1);
    expect(s.calls.storm[0].slice(0, 4)).toEqual(['12 Elm Street', 'Cedar Falls', 'IA', '50613']);
    expect(s.calls.storm[0][4]).toMatchObject({ yearsBack: 3 });
    expect(s.calls.enhancedStorm).toHaveLength(0);
  });

  it('adds replacement options only for an inspection with roof squares above zero', async () => {
    const withSquares = await runGeneration(REPORT, { ...base, reportTypes: ['inspection'], roofDetails: { squares: 28, pitch: '6/12', stories: 2, material: 'asphalt_shingle' } }, makeDeps().deps);
    expect(withSquares.report.replacementOptions?.length).toBeGreaterThan(0);
    const none = await runGeneration(REPORT, { ...base, reportTypes: ['inspection'], roofDetails: { squares: 0 } }, makeDeps().deps);
    expect(none.report.replacementOptions).toBeUndefined();
    const stormOnly = await runGeneration(REPORT, { ...base, reportTypes: ['storm'], roofDetails: { squares: 28 } }, makeDeps().deps);
    expect(stormOnly.report.replacementOptions).toBeUndefined();
  });

  it('builds the measurement section only when asked, from the figures it was given', async () => {
    const asked = await runGeneration(REPORT, {
      ...base, reportTypes: ['measurement'], roofDetails: { squares: 30, pitch: '6/12' },
      measurements: { segments: [{ name: 'Main', footprintSqFt: 1200, pitch: '6/12', adjustedSqFt: 1340 }], edgeLengths: { ridge: 40, eave: 120 } },
    }, makeDeps().deps);
    const m = asked.report.measurementReport!;
    expect(m.segments).toEqual([{ name: 'Main', footprintSqFt: 1200, pitch: '6/12', adjustedSqFt: 1340 }]);
    expect(m.totalAdjustedSqFt).toBe(1340);
    expect(m.totalSquares).toBe(30);
    expect(m.edgeLengths).toMatchObject({ ridge: 40, eave: 120, hip: 0, valley: 0 });
    expect(m.dataSource).toBe('manual');
    const notAsked = await runGeneration(REPORT, { ...base, reportTypes: ['inspection'], measurements: { segments: [] } }, makeDeps().deps);
    expect(notAsked.report.measurementReport).toBeUndefined();
  });

  it('carries what the person typed: notes, the template and the customer, without trusting a number that is text', async () => {
    const { report } = await runGeneration(REPORT, {
      ...base, template: 'insurance', inspectorNotes: 'Ladder was wet.',
      damageCounts: { windDamaged: 4, hailDamaged: 0, generalDamaged: 1 },
    }, makeDeps().deps);
    expect(report.inspectorNotes).toBe('Ladder was wet.');
    expect(report.reportTemplate).toBe('insurance');
    expect(report.damageCounts).toEqual({ windDamaged: 4, hailDamaged: 0, generalDamaged: 1 });
    expect(report.property).toMatchObject({ address: '12 Elm Street', city: 'Cedar Falls', state: 'IA', latitude: 42.5349 });
    const odd = await runGeneration(REPORT, { ...base, damageCounts: { windDamaged: '<img onerror=x>', hailDamaged: -3, generalDamaged: 2.7 } as any }, makeDeps().deps);
    expect(odd.report.damageCounts).toEqual({ windDamaged: 0, hailDamaged: 0, generalDamaged: 3 });
  });
});
