import { describe, it, expect } from 'vitest';
import { PHASE_FILTERS, PHOTO_WORDS, photoDetails, photoPagePath, uploadSummary } from '../job-photos-view';

const KEY = `archie-${'b'.repeat(32)}`;

describe('the photo box for a job Archie keeps', () => {
  it('asks for one page at a time, with the filter and where the last page ended', () => {
    expect(photoPagePath(KEY, 'all')).toBe(`/api/clients/${KEY}/photos?limit=30`);
    expect(photoPagePath(KEY, 'after', 'abc')).toBe(`/api/clients/${KEY}/photos?limit=30&phase=after&before=abc`);
    expect(PHASE_FILTERS.map((f) => f.label)).toEqual(['All', 'Before', 'During', 'After']);
  });

  it('says how an upload went in plain words', () => {
    expect(uploadSummary(1, 0)).toBe('1 photo added to the job.');
    expect(uploadSummary(3, 0)).toBe('3 photos added to the job.');
    expect(uploadSummary(2, 1)).toBe('2 added, 1 didn\'t save. Tap one to try again.');
    expect(uploadSummary(0, 1)).toBe('The photo didn\'t save. Tap one to try again.');
    expect(uploadSummary(0, 4)).toBe('All 4 photos didn\'t save. Tap one to try again.');
  });

  it('describes a photo by what it is, when it was taken and who added it', () => {
    expect(photoDetails({ phase: 'before', category: 'flashing', takenAt: '2026-11-18T15:00:00Z', createdAt: '2026-11-19T15:00:00Z', uploadedByName: 'Rep Summit' }, 'UTC'))
      .toBe('Before · Flashing · Taken Nov 18, 2026 · Added Nov 19, 2026 by Rep Summit');
    expect(photoDetails({ phase: null, category: null, takenAt: null, createdAt: '2026-11-19T15:00:00Z', uploadedByName: null }, 'UTC'))
      .toBe('Added Nov 19, 2026');
  });

  it('names no other system, and uses no long dashes or codes', () => {
    const words = Object.values(PHOTO_WORDS).map((w) => (typeof w === 'function' ? w('before') : w));
    for (const w of [...words, uploadSummary(2, 1), uploadSummary(0, 3)]) {
      expect(w).not.toMatch(/[—–]|CRM|JobTread|CompanyCam|KynexPro|soon|_/);
    }
    expect(PHOTO_WORDS.saving).toBe('Saving...');
  });
});
