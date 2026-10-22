import { describe, it, expect } from 'vitest';
import { splitPhotosForAnalysis, renderPhotoAppendix, ANALYZE_LIMIT } from '../photo-selection';

const photos = (n: number) => Array.from({ length: n }, (_, i) => ({ url: `u${i}`, caption: `c${i}` }));

describe('splitPhotosForAnalysis', () => {
  it('analyses the rep\'s picks and keeps the rest for the appendix', () => {
    // The point of the feature: six photos show the damage, ninety show a
    // driveway. Analysing all of them is slow and dilutes the findings.
    const all = photos(100);
    const out = splitPhotosForAnalysis(all, ['u5', 'u10', 'u90']);
    expect(out.analyzed.map((p) => p.url)).toEqual(['u5', 'u10', 'u90']);
    expect(out.appendix).toHaveLength(97);
  });

  it('keeps every photo — nothing is dropped', () => {
    const all = photos(100);
    const out = splitPhotosForAnalysis(all, ['u1']);
    expect(out.analyzed.length + out.appendix.length).toBe(100);
  });

  it('caps the selection server-side, not just in the UI', () => {
    // A hand-made request must not be able to queue 100 images past the
    // vision time budget.
    const all = photos(100);
    const out = splitPhotosForAnalysis(all, all.map((p) => p.url));
    expect(out.analyzed).toHaveLength(ANALYZE_LIMIT);
    expect(out.appendix).toHaveLength(100 - ANALYZE_LIMIT);
  });

  it('takes the first batch when the rep picks nothing', () => {
    // Hitting generate without choosing must still produce a real report.
    const out = splitPhotosForAnalysis(photos(60));
    expect(out.analyzed).toHaveLength(ANALYZE_LIMIT);
    expect(out.appendix).toHaveLength(20);
  });

  it('falls back rather than analysing nothing when the picks are stale', () => {
    // Regenerating after JobTread reissues its URLs would otherwise produce a
    // report with no damage assessment at all.
    const out = splitPhotosForAnalysis(photos(50), ['gone-1', 'gone-2']);
    expect(out.analyzed).toHaveLength(ANALYZE_LIMIT);
  });

  it('handles a job with no photos', () => {
    expect(splitPhotosForAnalysis([], ['x'])).toEqual({ analyzed: [], appendix: [] });
  });

  it('does not pad the appendix when everything was picked', () => {
    const out = splitPhotosForAnalysis(photos(3), ['u0', 'u1', 'u2']);
    expect(out.appendix).toEqual([]);
  });

  it('allows 40 — the agreed limit', () => {
    expect(ANALYZE_LIMIT).toBe(40);
  });
});

describe('renderPhotoAppendix', () => {
  it('says plainly that these were not analysed', () => {
    // A customer seeing 90 photos would reasonably assume each was examined.
    const html = renderPhotoAppendix(photos(3));
    expect(html).toMatch(/not part of the damage analysis/i);
    expect(html).toMatch(/3 further photos/);
  });

  it('renders nothing when there is nothing left over', () => {
    expect(renderPhotoAppendix([])).toBe('');
  });

  it('escapes captions and urls', () => {
    // Captions come from JobTread file names, which are user-entered.
    const html = renderPhotoAppendix([{ url: 'u"x', caption: '<script>alert(1)</script>' }]);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('lazy-loads, so a 90-photo appendix does not stall the page', () => {
    expect(renderPhotoAppendix(photos(90))).toContain('loading="lazy"');
  });
});
