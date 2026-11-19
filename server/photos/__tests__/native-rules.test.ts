import { describe, it, expect } from 'vitest';
import {
  mayDeletePhoto, mayEditPhoto, parsePhotoFields, parseTakenAt, isPhotoId,
  PICK_PHASE, PICK_CATEGORY, CAPTION_TOO_LONG, CAPTION_NOT_TEXT, PHOTO_STORE_OFF, EDIT_NOT_ALLOWED, DELETE_NOT_ALLOWED,
  PHOTO_NOT_JPEG, PHOTO_MISSING, PHOTO_UNREADABLE, PHOTO_TOO_LARGE, PHOTO_NOT_SAVED,
} from '../native';
import { photoDisplayName, MAX_CAPTION_CHARS, PHOTO_CATEGORIES } from '../../../shared/job-photos';

const rep = { email: 'rep@example.test', name: 'Rep Summit', role: 'sales' as const };
const office = { email: 'office@example.test', name: 'Office Summit', role: 'customer_service' as const };
const leader = { email: 'lead@example.test', name: 'Lead Summit', role: 'manager' as const };
const owner = { email: 'owner@example.test', name: 'Owner Summit', role: 'admin' as const };

describe('what a person may send about a photo', () => {
  it('takes the three phases, a category from the list and a caption', () => {
    expect(parsePhotoFields({ phase: 'before', category: 'flashing', caption: '  Chimney flashing, north side  ' }))
      .toEqual({ ok: true, fields: { phase: 'before', category: 'flashing', caption: 'Chimney flashing, north side' } });
    for (const phase of ['before', 'during', 'after']) expect(parsePhotoFields({ phase }).ok).toBe(true);
    expect(PHOTO_CATEGORIES).toContain('checklist');
  });

  it('leaves out what was not sent, and clears what was sent empty', () => {
    expect(parsePhotoFields({})).toEqual({ ok: true, fields: {} });
    expect(parsePhotoFields({ phase: '', category: null, caption: '   ' })).toEqual({ ok: true, fields: { phase: null, category: null, caption: null } });
  });

  it('refuses anything else in plain words', () => {
    expect(parsePhotoFields({ phase: 'later' })).toEqual({ ok: false, error: PICK_PHASE });
    expect(parsePhotoFields({ category: 'selfie' })).toEqual({ ok: false, error: PICK_CATEGORY });
    expect(parsePhotoFields({ caption: 'x'.repeat(MAX_CAPTION_CHARS + 1) })).toEqual({ ok: false, error: CAPTION_TOO_LONG });
    expect(parsePhotoFields({ caption: 'x'.repeat(MAX_CAPTION_CHARS) }).ok).toBe(true);
    expect(parsePhotoFields({ caption: 42 })).toEqual({ ok: false, error: CAPTION_NOT_TEXT });
  });

  it('keeps the date the photo was taken only when it reads as a real one', () => {
    const now = new Date('2026-11-19T15:00:00Z');
    expect(parseTakenAt('2026-11-18T09:30:00', now)).toEqual(new Date('2026-11-18T09:30:00'));
    for (const bad of ['', 'yesterday', '1970-01-01T00:00:00Z', '2027-01-01T00:00:00Z', 12, null, undefined]) {
      expect(parseTakenAt(bad, now)).toBeNull();
    }
  });

  it('knows a photo id when it sees one', () => {
    expect(isPhotoId('7d3e2c10-1a2b-4c3d-8e9f-0a1b2c3d4e5f')).toBe(true);
    for (const bad of ['', '22', 'jt-file-1', '7d3e2c10-1a2b-4c3d-8e9f-0a1b2c3d4e5f/../x']) expect(isPhotoId(bad)).toBe(false);
  });
});

describe('who may change or delete a photo', () => {
  const photo = { uploadedBy: 'Rep@Example.test', createdAt: new Date('2026-11-19T14:00:00Z') };
  const tz = 'America/Chicago';

  it('lets the person who added it, or a manager and up, change it', () => {
    expect(mayEditPhoto(rep, photo)).toBe(true);
    expect(mayEditPhoto(leader, photo)).toBe(true);
    expect(mayEditPhoto(owner, photo)).toBe(true);
    expect(mayEditPhoto(office, photo)).toBe(false);
    expect(mayEditPhoto({ ...rep, email: 'other@example.test' }, photo)).toBe(false);
  });

  it('lets the person who added it delete it on the same day in the company\'s time zone, and a manager always', () => {
    expect(mayDeletePhoto(rep, photo, new Date('2026-11-20T05:59:00Z'), tz)).toBe(true);  // 11:59 pm the same day in Chicago
    expect(mayDeletePhoto(rep, photo, new Date('2026-11-20T06:01:00Z'), tz)).toBe(false); // just after midnight
    expect(mayDeletePhoto(leader, photo, new Date('2026-12-30T12:00:00Z'), tz)).toBe(true);
    expect(mayDeletePhoto(owner, photo, new Date('2027-06-01T12:00:00Z'), tz)).toBe(true);
    expect(mayDeletePhoto(office, photo, new Date('2026-11-19T15:00:00Z'), tz)).toBe(false);
  });
});

describe('the words', () => {
  it('names a photo by its caption, else by what it is', () => {
    expect(photoDisplayName({ caption: 'Drip edge', phase: 'after' })).toBe('Drip edge');
    expect(photoDisplayName({ caption: null, phase: 'before' })).toBe('Before photo');
    expect(photoDisplayName({ caption: '', phase: null })).toBe('Job photo');
    expect(photoDisplayName({ caption: 'y'.repeat(200) }).length).toBeLessThanOrEqual(80);
  });

  it('are plain English with no dashes standing in for punctuation', () => {
    for (const said of [PICK_PHASE, PICK_CATEGORY, CAPTION_TOO_LONG, CAPTION_NOT_TEXT, PHOTO_STORE_OFF, EDIT_NOT_ALLOWED, DELETE_NOT_ALLOWED,
      PHOTO_NOT_JPEG, PHOTO_MISSING, PHOTO_UNREADABLE, PHOTO_TOO_LARGE, PHOTO_NOT_SAVED]) {
      expect(said).not.toMatch(/[—–]|\b(soon|JobTread|CRM|R2|S3|bucket|Exif)\b/);
      expect(said).toMatch(/\.$/);
    }
    expect(PHOTO_STORE_OFF).toBe('Photo storage isn\'t switched on yet. Please try again later.');
  });
});
