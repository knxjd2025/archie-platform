/**
 * The one place that decides how a report is shown: `chooseStyle`, which
 * `renderReportHtml` itself uses, so what a person is TOLD about the look is
 * always what the page is. A flight needs 3 photos and a presentation needs 4
 * chapters of real content; anything thinner is shown as a document, and the
 * reason is handed back as numbers (the server turns them into a plain sentence).
 */
import { describe, it, expect } from 'vitest';
import { chooseStyle, renderReportHtml } from '../render-report-html';
import { MIN_FLIGHT_PHOTOS } from '../scroll-flight-report';
import { MIN_PRESENTATION_CHAPTERS } from '../scroll-presentation-report';
import type { AnalyzedPhoto, ComprehensiveRoofReport } from '../comprehensive-roof-report';
import { richBrand, richReport } from './fixtures/injection';
import { makeReport } from './fixtures/report';

const photo = (i: number) => ({ id: `p${i}`, url: `https://photos.example.test/p${i}.jpg`, damages: [], overallSeverity: 'none', aiSummary: 'Looks sound.', analyzedAt: '2026-09-05T00:00:00.000Z' }) as unknown as AnalyzedPhoto;
const withPhotos = (n: number, style: 'flight' | 'presentation' | 'formal' = 'flight'): ComprehensiveRoofReport => {
  const base = richReport('full');
  return { ...base, reportVisualStyle: style, damageAnalysis: { ...base.damageAnalysis, photos: Array.from({ length: n }, (_, i) => photo(i)) } };
};
/** A report with almost nothing found in it: no storm events, no photos, no damage, no work to price. Too thin for a presentation (3 chapters). */
const thin = (): ComprehensiveRoofReport => {
  const r = makeReport({ reportVisualStyle: 'presentation' });
  return {
    ...r,
    stormHistory: { ...r.stormHistory, totalEvents: 0, hailEvents: 0, windEvents: 0, tornadoEvents: 0, eventsByYear: {} },
    damageAnalysis: { ...r.damageAnalysis, totalPhotosAnalyzed: 0, photosWithDamage: 0, damageTypes: [], roofAge: undefined, photos: [], aiSummary: '' },
    repairEstimate: { ...r.repairEstimate, lineItems: [], total: 0 },
    replacementTiers: undefined,
  } as unknown as ComprehensiveRoofReport;
};

describe('chooseStyle', () => {
  it('shows a flight as a document, with the counts, when it has fewer photos than a flight needs', async () => {
    for (const n of [0, 1, 2]) {
      const c = await chooseStyle(withPhotos(n));
      expect(c.style, `${n} photos`).toBe('formal');
      expect(c.downgrade, `${n} photos`).toEqual({ kind: 'flight', have: n, need: MIN_FLIGHT_PHOTOS });
    }
  });

  it('shows a flight as a flight at the least it needs', async () => {
    const c = await chooseStyle(withPhotos(MIN_FLIGHT_PHOTOS));
    expect(c).toEqual({ style: 'flight' });
  });

  it('counts only photos with a usable address', async () => {
    const r = withPhotos(5);
    r.damageAnalysis.photos = r.damageAnalysis.photos.map((p, i) => (i < 3 ? { ...p, url: '' } : p));
    expect((await chooseStyle(r)).downgrade).toEqual({ kind: 'flight', have: 2, need: MIN_FLIGHT_PHOTOS });
  });

  it('shows a presentation as a document, with the counts, when the report is too thin to fill one', async () => {
    const c = await chooseStyle(thin());
    expect(c.style).toBe('formal');
    expect(c.downgrade?.kind).toBe('presentation');
    expect(c.downgrade?.need).toBe(MIN_PRESENTATION_CHAPTERS);
    expect(c.downgrade!.have).toBeLessThan(MIN_PRESENTATION_CHAPTERS);
  });

  it('shows a presentation as a presentation when the report fills one, and a document as a document, with no reason', async () => {
    expect(await chooseStyle(withPhotos(4, 'presentation'))).toEqual({ style: 'presentation' });
    expect(await chooseStyle(withPhotos(0, 'formal'))).toEqual({ style: 'formal' });
  });

  it('is what renderReportHtml does: the same style and the same reason, for every case', async () => {
    for (const r of [withPhotos(0), withPhotos(2), withPhotos(3), withPhotos(4, 'presentation'), withPhotos(1, 'formal'), thin()]) {
      const chosen = await chooseStyle(r);
      const out = await renderReportHtml(r, richBrand() as never);
      expect(out.style).toBe(chosen.style);
      expect(out.downgrade).toEqual(chosen.downgrade);
      expect(Boolean(out.downgradeReason)).toBe(Boolean(chosen.downgrade));
    }
  });
});
