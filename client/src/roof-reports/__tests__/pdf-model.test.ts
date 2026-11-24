import { describe, expect, it } from 'vitest';
import { initialPdf, pdfFileName, pdfReducer, photoPathFor, runPdf, type PdfState } from '../pdf-model';
import { RR } from '../words';

const ID = '00000000-0000-4000-8000-0000000000aa';
const PH = '11111111-1111-4111-8111-111111111111';

describe('the Download PDF button: what is drawn', () => {
  it('starts idle', () => { expect(initialPdf()).toEqual({ phase: 'idle', error: null }); });

  it('says Preparing at once on the press, and clears an old failure', () => {
    const failed = pdfReducer(pdfReducer(initialPdf(), { type: 'start' }), { type: 'failed', error: RR.pdf.failed });
    expect(failed).toEqual({ phase: 'failed', error: RR.pdf.failed });
    expect(pdfReducer(failed, { type: 'start' })).toEqual({ phase: 'preparing', error: null });
  });

  it('goes back to idle when the file is made', () => {
    expect(pdfReducer(pdfReducer(initialPdf(), { type: 'start' }), { type: 'done' })).toEqual({ phase: 'idle', error: null });
  });

  it('ignores a second press while it is preparing', () => {
    const preparing: PdfState = { phase: 'preparing', error: null };
    expect(pdfReducer(preparing, { type: 'start' })).toBe(preparing);
  });

  it('has plain words and no em dash', () => {
    expect(RR.pdf.button).toBe('Download PDF');
    expect(RR.pdf.preparing).toBe('Preparing PDF...');
    for (const w of [RR.pdf.button, RR.pdf.preparing, RR.pdf.failed, RR.pdf.help]) expect(w).not.toContain('—');
    expect(RR.pdf.failed).toBe('The PDF could not be made. Please try again.');
  });
});

describe('the file', () => {
  it('is named from the address and the day, in plain letters', () => {
    expect(pdfFileName('12 Elm Street', new Date('2026-11-24T15:00:00Z'))).toBe('roof-report-12-elm-street-2026-11-24.pdf');
    expect(pdfFileName('<b>"x"/../etc\\passwd\r\n', new Date('2026-11-24T15:00:00Z'))).toMatch(/^roof-report-[a-z0-9-]{1,50}-2026-11-24\.pdf$/);
    expect(pdfFileName('', new Date('2026-11-24T15:00:00Z'))).toBe('roof-report-2026-11-24.pdf');
    expect(pdfFileName('x'.repeat(300), new Date('2026-11-24T15:00:00Z')).length).toBeLessThan(80);
  });
});

describe('the photos', () => {
  it('are fetched only from this report\'s own signed-in photo route', () => {
    expect(photoPathFor(ID, `/api/roof-reports/${ID}/photos/${PH}/thumb`)).toBe(`/api/roof-reports/${ID}/photos/${PH}/thumb`);
    expect(photoPathFor(ID, `/api/roof-reports/${ID}/photos/${PH}/working`)).toBe(`/api/roof-reports/${ID}/photos/${PH}/working`);
    for (const bad of ['https://evil.example/x.jpg', `//evil.example/api/roof-reports/${ID}/photos/${PH}/thumb`, `/api/roof-reports/${ID}/photos/${PH}/thumb?x=1`, `/api/roof-reports/other/photos/${PH}/thumb`,
      `/api/roof-reports/${ID}/photos/${PH}/../../x`, `/api/roof-reports/${ID}/photos/not-an-id/thumb`, 'data:image/png;base64,AAAA', 'javascript:alert(1)', '', `/api/roof-reports/00000000-0000-4000-8000-0000000000bb/photos/${PH}/thumb`]) {
      expect(photoPathFor(ID, bad), bad).toBeNull();
    }
    expect(photoPathFor(ID, 5 as never)).toBeNull();
  });
});

describe('making the file', () => {
  it('saves what was built, under its name, and says done', async () => {
    const saved: Array<[unknown, string]> = [];
    const blob = new Blob(['%PDF-1.7'], { type: 'application/pdf' });
    const action = await runPdf({ build: async () => blob, save: (b, n) => { saved.push([b, n]); } }, 'roof-report.pdf');
    expect(action).toEqual({ type: 'done' });
    expect(saved).toEqual([[blob, 'roof-report.pdf']]);
  });

  it('says the plain sentence when it fails, whatever the failure said, and saves nothing', async () => {
    for (const message of ['Failed to fetch', 'TypeError: x is not a function', '{"error":"x"}', 'ECONNRESET', '']) {
      const saved: unknown[] = [];
      const action = await runPdf({ build: async () => { throw new Error(message); }, save: (b) => { saved.push(b); } }, 'a.pdf');
      expect(action, message).toEqual({ type: 'failed', error: RR.pdf.failed });
      expect(saved).toHaveLength(0);
    }
  });

  it('says it failed when the file could not be handed over', async () => {
    const action = await runPdf({ build: async () => new Blob(['x']), save: () => { throw new Error('blocked'); } }, 'a.pdf');
    expect(action).toEqual({ type: 'failed', error: RR.pdf.failed });
  });

  it('refuses to save something that is not a PDF', async () => {
    const saved: unknown[] = [];
    const action = await runPdf({ build: async () => new Blob(['<html>'], { type: 'text/html' }), save: (b) => { saved.push(b); } }, 'a.pdf');
    expect(action).toEqual({ type: 'failed', error: RR.pdf.failed });
    expect(saved).toHaveLength(0);
  });
});
