import { describe, it, expect } from 'vitest';
import { isImage, MAX_PHOTOS } from '../job-context';

describe('report job context', () => {
  it('detects images by mime type', () => {
    expect(isImage('image/jpeg')).toBe(true);
    expect(isImage('image/png')).toBe(true);
    expect(isImage('application/pdf')).toBe(false);
    expect(isImage('')).toBe(false);
  });

  it('falls back to the file extension when the mime type is missing', () => {
    expect(isImage('', 'roof-front.JPG')).toBe(true);
    expect(isImage('', 'IMG_0042.heic')).toBe(true);
    expect(isImage('', 'estimate.pdf')).toBe(false);
    // A .pdf named with "jpeg" inside must not slip through as an image.
    expect(isImage('application/pdf', 'jpeg-summary.pdf')).toBe(false);
  });

  it('allows a whole job\'s photos, not a token sample', () => {
    // Was 8 while live jobs carry 99, 100 and 97 images — a report written
    // from under a tenth of the evidence. The limit that actually binds is
    // the 300s function budget, enforced in the vision pass, not a count.
    expect(MAX_PHOTOS).toBeGreaterThanOrEqual(100);
    expect(MAX_PHOTOS).toBeLessThanOrEqual(400);
  });
});
