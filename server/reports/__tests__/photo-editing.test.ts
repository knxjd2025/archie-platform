import { describe, it, expect } from 'vitest';
import { applyPhotoEdits, isSafeImageUrl, photosForEditing, withPhotos, MAX_CAPTION, type ReportPhoto } from '../photo-editing';

const photo = (id: string, over: Partial<ReportPhoto> = {}): ReportPhoto => ({
  id, url: `https://cdn/${id}.jpg`, caption: `cap ${id}`,
  damages: [{ id: 'd1', label: 'Missing shingles' }],
  overallSeverity: 'moderate', aiSummary: 'Analysis complete.', ...over,
});

describe('applyPhotoEdits', () => {
  it('edits a caption', () => {
    const out = applyPhotoEdits([photo('p1')], [{ id: 'p1', caption: 'North slope, creased tabs' }]);
    expect(out.photos[0].caption).toBe('North slope, creased tabs');
    expect(out.changed).toEqual(['caption on p1']);
  });

  it('clears a caption with an empty string', () => {
    expect(applyPhotoEdits([photo('p1')], [{ id: 'p1', caption: '' }]).photos[0].caption).toBeUndefined();
  });

  it('leaves the caption alone when the field is omitted', () => {
    // Omitted and empty must mean different things, or a swap-only edit would
    // silently wipe every caption.
    const out = applyPhotoEdits([photo('p1')], [{ id: 'p1', url: 'https://cdn/new.jpg' }]);
    expect(out.photos[0].caption).toBe('cap p1');
  });

  it('swaps the image', () => {
    const out = applyPhotoEdits([photo('p1')], [{ id: 'p1', url: 'https://cdn/better.jpg' }]);
    expect(out.photos[0].url).toBe('https://cdn/better.jpg');
    expect(out.changed).toContain('swapped image on p1');
  });

  it('CLEARS the findings when the image is replaced', () => {
    // The damage text described the old photo. Keeping it would caption a new
    // image with damage that was never in it — worse than the wrong photo.
    const out = applyPhotoEdits([photo('p1')], [{ id: 'p1', url: 'https://cdn/other.jpg' }]);
    expect(out.photos[0].damages).toEqual([]);
    expect(out.photos[0].overallSeverity).toBe('none');
    expect(out.photos[0].aiSummary).toMatch(/replaced by a team member/i);
    expect(out.clearedFindings).toEqual(['p1']);
  });

  it('keeps the findings when only the caption changes', () => {
    const out = applyPhotoEdits([photo('p1')], [{ id: 'p1', caption: 'new' }]);
    expect(out.photos[0].damages).toHaveLength(1);
    expect(out.clearedFindings).toEqual([]);
  });

  it('does not clear findings when the url is unchanged', () => {
    const p = photo('p1');
    const out = applyPhotoEdits([p], [{ id: 'p1', url: p.url }]);
    expect(out.photos[0].damages).toHaveLength(1);
    expect(out.changed).toEqual([]);
  });

  it('removes a photo', () => {
    const out = applyPhotoEdits([photo('p1'), photo('p2')], [{ id: 'p1', remove: true }]);
    expect(out.photos.map((p) => p.id)).toEqual(['p2']);
  });

  it('leaves untouched photos exactly as they were', () => {
    const all = [photo('p1'), photo('p2'), photo('p3')];
    const out = applyPhotoEdits(all, [{ id: 'p2', caption: 'x' }]);
    expect(out.photos[0]).toBe(all[0]);
    expect(out.photos[2]).toBe(all[2]);
  });

  it('ignores an edit for a photo that is not there', () => {
    const out = applyPhotoEdits([photo('p1')], [{ id: 'nope', caption: 'x' }]);
    expect(out.changed).toEqual([]);
    expect(out.photos).toHaveLength(1);
  });

  it('caps caption length', () => {
    const out = applyPhotoEdits([photo('p1')], [{ id: 'p1', caption: 'x'.repeat(MAX_CAPTION + 200) }]);
    expect(out.photos[0].caption!.length).toBe(MAX_CAPTION);
  });
});

describe('isSafeImageUrl', () => {
  it('accepts http and https', () => {
    expect(isSafeImageUrl('https://cdn.jobtread.com/a.jpg')).toBe(true);
    expect(isSafeImageUrl('http://example.com/a.png')).toBe(true);
  });

  it('rejects anything that is not a fetchable image url', () => {
    // This value lands in an <img src> on a document emailed to customers.
    for (const bad of ['javascript:alert(1)', 'data:image/png;base64,AAA', 'file:///etc/passwd', '', '   ', 'not a url', null, undefined]) {
      expect(isSafeImageUrl(bad as any), String(bad)).toBe(false);
    }
  });

  it('refuses an unsafe swap rather than applying it', () => {
    const out = applyPhotoEdits([photo('p1')], [{ id: 'p1', url: 'javascript:alert(1)' }]);
    expect(out.photos[0].url).toBe('https://cdn/p1.jpg');
    expect(out.changed).toEqual([]);
  });
});

describe('photosForEditing / withPhotos', () => {
  it('lists what the editor needs', () => {
    const rows = photosForEditing({ damageAnalysis: { photos: [photo('p1'), photo('p2', { aiSummary: 'Unable to analyze this image.' })] } });
    expect(rows[0]).toMatchObject({ id: 'p1', findings: 1, analyzed: true });
    expect(rows[1].analyzed).toBe(false);
  });

  it('is empty for a report with no photos', () => {
    expect(photosForEditing({})).toEqual([]);
  });

  it('round-trips through the report data', () => {
    const data = { damageAnalysis: { photos: [photo('p1')], aiSummary: 'keep me' }, other: 1 };
    const out = withPhotos(data, applyPhotoEdits(data.damageAnalysis.photos, [{ id: 'p1', caption: 'z' }]).photos);
    expect(out.damageAnalysis.photos[0].caption).toBe('z');
    expect(out.damageAnalysis.aiSummary).toBe('keep me');
    expect(out.other).toBe(1);
  });
});

import { applyPhotoAdds, orderPhotos } from '../photo-editing';
import { addedPhotoId } from '../../../shared/report-photos';

describe('applyPhotoAdds', () => {
  it('adds an unanalysed photo with a stable id the editor can predict', () => {
    const out = applyPhotoAdds([photo('p1')], [{ url: 'https://cdn/new.jpg', caption: 'Chimney' }]);
    expect(out.added).toEqual([addedPhotoId('https://cdn/new.jpg')]);
    expect(out.photos[1]).toMatchObject({ url: 'https://cdn/new.jpg', caption: 'Chimney', damages: [], overallSeverity: 'none' });
  });
  it('skips unsafe urls and photos already on the report', () => {
    const out = applyPhotoAdds([photo('p1')], [{ url: 'javascript:alert(1)' }, { url: 'https://cdn/p1.jpg' }]);
    expect(out.added).toEqual([]);
    expect(out.photos).toHaveLength(1);
  });
});

describe('orderPhotos', () => {
  it('puts listed ids first and keeps the rest in their order', () => {
    const out = orderPhotos([photo('a'), photo('b'), photo('c')], ['c', 'zzz']);
    expect(out.photos.map((p) => p.id)).toEqual(['c', 'a', 'b']);
    expect(out.changed).toBe(true);
  });
  it('reports no change for the current order', () => {
    expect(orderPhotos([photo('a'), photo('b')], ['a', 'b']).changed).toBe(false);
  });
});
