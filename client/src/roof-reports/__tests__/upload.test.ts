import { describe, expect, it } from 'vitest';
import { photoPath, readUploadAnswer, runLimited } from '../upload';

describe('sending a photo', () => {
  it('names what the photo shows in the address, only when it was said', () => {
    expect(photoPath(null)).toBe('/api/roof-reports/photos');
    expect(photoPath('')).toBe('/api/roof-reports/photos');
    expect(photoPath('roof_surface')).toBe('/api/roof-reports/photos?category=roof_surface');
  });

  it('takes the id from a good answer', () => {
    expect(readUploadAnswer(200, '{"id":"11111111-1111-4111-8111-111111111111"}')).toEqual({ ok: true, id: '11111111-1111-4111-8111-111111111111' });
  });

  it('shows the server\'s own sentence when it sent one that reads as a sentence', () => {
    expect(readUploadAnswer(429, '{"error":"You have a lot of photos waiting. Please put them in a report first."}'))
      .toEqual({ ok: false, error: 'You have a lot of photos waiting. Please put them in a report first.' });
    expect(readUploadAnswer(503, '{"error":"Photo storage isn\'t switched on yet. Please try again later."}'))
      .toEqual({ ok: false, error: 'Photo storage isn\'t switched on yet. Please try again later.' });
  });

  it('never shows a status code, a page of markup or a missing answer: it says the photo did not save', () => {
    const generic = 'The photo couldn\'t be saved. Please try again.';
    for (const [status, body] of [[500, ''], [502, '<html><body>Bad gateway</body></html>'], [400, '{"error":"HTTP 400"}'], [200, 'not json'], [200, '{}'], [200, '{"id":"nope"}'], [413, '']] as const) {
      expect(readUploadAnswer(status, body), `${status} ${body}`).toEqual({ ok: false, error: generic });
    }
  });
});

describe('sending several at once', () => {
  it('never has more than three going, and does them all', async () => {
    let running = 0; let most = 0; const done: number[] = [];
    await runLimited([1, 2, 3, 4, 5, 6, 7, 8], 3, async (n) => {
      running++; most = Math.max(most, running);
      await new Promise((r) => setTimeout(r, 5));
      running--; done.push(n);
    });
    expect(most).toBe(3);
    expect(done.sort()).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('keeps going when one fails', async () => {
    const done: number[] = [];
    await runLimited([1, 2, 3, 4], 2, async (n) => { if (n === 2) throw new Error('boom'); done.push(n); });
    expect(done.sort()).toEqual([1, 3, 4]);
  });
});
