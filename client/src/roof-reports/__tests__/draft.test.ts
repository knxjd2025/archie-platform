import { describe, expect, it } from 'vitest';
import { DRAFT_TTL_MS, agoText, clearDraft, draftKey, emptyDraft, readDraft, writeDraft, type StorageLike, type WizardDraft } from '../draft';

const memory = (): StorageLike & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); }, removeItem: (k) => { data.delete(k); } };
};
const COMPANY = '5b0f3f0e-1f0a-4a3e-8a37-2f7f4b5a8a11';
const OTHER_COMPANY = '9c1d2e3f-4a5b-4c6d-8e7f-0a1b2c3d4e5f';
const PHOTO = '11111111-1111-4111-8111-111111111111';
const NOW = Date.parse('2026-11-24T15:00:00Z');

const filled = (): WizardDraft => ({
  ...emptyDraft(), step: 3,
  where: { address: '12 Elm Street', city: 'Cedar Falls', state: 'IA', zip: '50613', job: { externalId: 'job-77', label: 'Dana Whitfield, 12 Elm Street' } },
  photos: [{ id: PHOTO, name: 'front-slope.jpg', category: 'roof_surface' }], photoKind: 'closeup',
  roof: { squares: '25', pitch: '6/12', stories: '2', material: 'asphalt_shingle' }, damage: { wind: '4', hail: '12', general: '0' },
});

describe('the key a draft is kept under', () => {
  it('is different for every person and every company, so two people on one machine never meet', () => {
    const a = draftKey(COMPANY, 'dana@example.com')!;
    expect(a).toBe(`archie.roofReportDraft.v1.${COMPANY}.dana@example.com`);
    expect(draftKey(COMPANY, 'DANA@Example.com')).toBe(a);
    expect(draftKey(COMPANY, 'lee@example.com')).not.toBe(a);
    expect(draftKey(OTHER_COMPANY, 'dana@example.com')).not.toBe(a);
  });

  it('is nothing when the person or the company is not known yet, so nothing is kept for nobody', () => {
    expect(draftKey('', 'dana@example.com')).toBeNull();
    expect(draftKey(null, 'dana@example.com')).toBeNull();
    expect(draftKey(COMPANY, '')).toBeNull();
    expect(draftKey(COMPANY, undefined)).toBeNull();
  });
});

describe('keeping a draft in the browser', () => {
  it('keeps what was typed and brings it back', () => {
    const s = memory();
    const key = draftKey(COMPANY, 'dana@example.com')!;
    expect(writeDraft(s, key, filled(), NOW)).toBe(true);
    const back = readDraft(s, key, NOW + 60_000)!;
    expect(back.draft).toEqual(filled());
    expect(back.savedAt).toBe(NOW);
  });

  it('keeps the photos only as the server\'s ids and the file names, never any picture data', () => {
    const s = memory();
    const key = draftKey(COMPANY, 'dana@example.com')!;
    const withBytes = { ...filled(), photos: [{ id: PHOTO, name: 'a.jpg', category: null, dataUrl: 'data:image/jpeg;base64,AAAA', preview: 'blob:http://x/1', bytes: [1, 2, 3] }] } as unknown as WizardDraft;
    writeDraft(s, key, withBytes, NOW);
    const raw = s.data.get(key)!;
    expect(raw).not.toMatch(/data:image|blob:|base64|bytes|dataUrl|preview/);
    expect(readDraft(s, key, NOW)!.draft.photos).toEqual([{ id: PHOTO, name: 'a.jpg', category: null }]);
  });

  it('forgets a draft after 24 hours, and clears it from storage', () => {
    const s = memory();
    const key = draftKey(COMPANY, 'dana@example.com')!;
    writeDraft(s, key, filled(), NOW);
    expect(readDraft(s, key, NOW + DRAFT_TTL_MS - 1)).not.toBeNull();
    expect(readDraft(s, key, NOW + DRAFT_TTL_MS)).toBeNull();
    expect(s.data.has(key)).toBe(false);
    expect(DRAFT_TTL_MS).toBe(24 * 60 * 60 * 1000);
  });

  it('does not show one person\'s draft to another person or company', () => {
    const s = memory();
    writeDraft(s, draftKey(COMPANY, 'dana@example.com')!, filled(), NOW);
    expect(readDraft(s, draftKey(COMPANY, 'lee@example.com')!, NOW)).toBeNull();
    expect(readDraft(s, draftKey(OTHER_COMPANY, 'dana@example.com')!, NOW)).toBeNull();
  });

  it('reads garbage, the wrong shape or a draft from the future as no draft, and removes it', () => {
    const s = memory();
    const key = draftKey(COMPANY, 'dana@example.com')!;
    for (const raw of ['not json', '{"v":2}', '[]', 'null', JSON.stringify({ v: 1, savedAt: NOW + 10 * 86_400_000, draft: filled() }), JSON.stringify({ v: 1, savedAt: 'x', draft: filled() })]) {
      s.setItem(key, raw);
      expect(readDraft(s, key, NOW), raw).toBeNull();
      expect(s.data.has(key), raw).toBe(false);
    }
  });

  it('cleans what it reads: odd photo ids, long text and a step that does not exist', () => {
    const s = memory();
    const key = draftKey(COMPANY, 'dana@example.com')!;
    s.setItem(key, JSON.stringify({
      v: 1, savedAt: NOW,
      draft: { ...filled(), step: 99, where: { ...filled().where, address: 'x'.repeat(500) },
        photos: [{ id: 'not-an-id', name: 'a.jpg' }, { id: PHOTO, name: 'ok.jpg', category: 'made-up' }, { id: PHOTO, name: 'dup.jpg' }] },
    }));
    const d = readDraft(s, key, NOW)!.draft;
    expect(d.step).toBe(4);
    expect(d.where.address.length).toBe(200);
    expect(d.photos).toEqual([{ id: PHOTO, name: 'ok.jpg', category: null }]);
  });

  it('never keeps more photos than a report holds', () => {
    const s = memory();
    const key = draftKey(COMPANY, 'dana@example.com')!;
    const many = Array.from({ length: 50 }, (_, i) => ({ id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, name: `p${i}.jpg`, category: null }));
    writeDraft(s, key, { ...filled(), photos: many }, NOW);
    expect(readDraft(s, key, NOW)!.draft.photos).toHaveLength(40);
  });

  it('is cleared by Start over', () => {
    const s = memory();
    const key = draftKey(COMPANY, 'dana@example.com')!;
    writeDraft(s, key, filled(), NOW);
    clearDraft(s, key);
    expect(readDraft(s, key, NOW)).toBeNull();
  });

  it('copes with storage that is missing, blocked or full, without a word to the person', () => {
    const throwing: StorageLike = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('full'); }, removeItem: () => { throw new Error('blocked'); } };
    const key = draftKey(COMPANY, 'dana@example.com')!;
    expect(readDraft(throwing, key, NOW)).toBeNull();
    expect(writeDraft(throwing, key, filled(), NOW)).toBe(false);
    expect(() => clearDraft(throwing, key)).not.toThrow();
    expect(readDraft(null, key, NOW)).toBeNull();
    expect(writeDraft(null, key, filled(), NOW)).toBe(false);
    expect(() => clearDraft(null, key)).not.toThrow();
  });
});

describe('saying how old a draft is', () => {
  it('uses plain words', () => {
    expect(agoText(NOW - 20_000, NOW)).toBe('just now');
    expect(agoText(NOW - 5 * 60_000, NOW)).toBe('5 minutes ago');
    expect(agoText(NOW - 60 * 60_000, NOW)).toBe('1 hour ago');
    expect(agoText(NOW - 2 * 3_600_000, NOW)).toBe('2 hours ago');
    expect(agoText(NOW - 23 * 3_600_000, NOW)).toBe('23 hours ago');
  });
});
