import { describe, expect, it } from 'vitest';
import { SATELLITE_ESTIMATE_NOTE, SATELLITE_NOT_FOUND, ROOF_PITCH_CHOICES } from '../../../../shared/roof-reports';
import { PITCH_OPTIONS } from '../wizard-model';
import { applyEstimate, editedRoof, estimateNote, readEstimate, useEstimate, whereBody } from '../satellite-model';
import { cleanRoof, emptyDraft, readDraft, writeDraft, type RoofDraft } from '../draft';

const roof = (over: Partial<RoofDraft> = {}): RoofDraft => ({ squares: '', pitch: '', stories: '', material: '', ...over });
const est = { squares: 43.7, pitch: '6/12' as string | null };

describe('what is asked of the satellite', () => {
  it('is only the address from the draft, never a job, a customer or a number', () => {
    const body = whereBody({ address: ' 12 Elm Street ', city: 'Cedar Falls', state: 'IA', zip: '50613', job: { externalId: 'J-1', label: 'Dana Whitfield' } });
    expect(body).toEqual({ address: '12 Elm Street', city: 'Cedar Falls', state: 'IA', zip: '50613' });
    expect(Object.keys(whereBody({ address: 'a', city: 'b', state: 'c', zip: '', job: null })).sort()).toEqual(['address', 'city', 'state', 'zip']);
  });

  it('offers only the pitches the form already has', () => {
    expect([...ROOF_PITCH_CHOICES]).toEqual([...PITCH_OPTIONS]);
  });
});

describe('filling the roof step from an estimate', () => {
  it('fills what is empty and marks it as an estimate, and asks about nothing', () => {
    const r = applyEstimate(roof({ stories: '2' }), est);
    expect(r.roof).toEqual({ squares: '43.7', pitch: '6/12', stories: '2', material: '', estimate: { squares: '43.7', pitch: '6/12' } });
    expect(r.pending).toBeNull();
  });

  it('never overwrites a number the person typed: it keeps it and asks', () => {
    const typed = roof({ squares: '30', pitch: '8/12' });
    const r = applyEstimate(typed, est);
    expect(r.roof.squares).toBe('30');
    expect(r.roof.pitch).toBe('8/12');
    expect(r.roof.estimate).toBeUndefined();
    expect(r.pending).toEqual({ squares: '43.7', pitch: '6/12' });
  });

  it('fills the empty field and asks only about the one that was typed', () => {
    const r = applyEstimate(roof({ squares: '30' }), est);
    expect(r.roof).toMatchObject({ squares: '30', pitch: '6/12', estimate: { squares: '', pitch: '6/12' } });
    expect(r.pending).toEqual({ squares: '43.7' });
  });

  it('does not ask when the typed number already is the estimate', () => {
    const r = applyEstimate(roof({ squares: '43.7', pitch: '6/12' }), est);
    expect(r.pending).toBeNull();
    expect(r.roof.estimate).toBeUndefined();
  });

  it('leaves the pitch alone when the picture gave none', () => {
    const r = applyEstimate(roof({ pitch: '9/12' }), { squares: 20, pitch: null });
    expect(r.roof).toMatchObject({ squares: '20', pitch: '9/12' });
    expect(r.pending).toBeNull();
  });

  it('replaces what was typed only when the person chooses to, and then marks it', () => {
    const asked = applyEstimate(roof({ squares: '30', pitch: '8/12' }), est);
    const used = useEstimate(asked.roof, asked.pending!);
    expect(used).toMatchObject({ squares: '43.7', pitch: '6/12', estimate: { squares: '43.7', pitch: '6/12' } });
  });
});

describe('saying it is an estimate for as long as it is one', () => {
  it('says so while an estimated number is still in its field, and not after it is changed', () => {
    const filled = applyEstimate(roof(), est).roof;
    expect(estimateNote(filled)).toBe(SATELLITE_ESTIMATE_NOTE);
    expect(SATELLITE_ESTIMATE_NOTE).toBe('Estimated from a satellite picture. Check these numbers.');
    const sizeChanged = editedRoof(filled, { squares: '45' });
    expect(sizeChanged.estimate).toEqual({ squares: '', pitch: '6/12' });
    expect(estimateNote(sizeChanged)).toBe(SATELLITE_ESTIMATE_NOTE);
    const bothChanged = editedRoof(sizeChanged, { pitch: '8/12' });
    expect(bothChanged.estimate).toBeUndefined();
    expect(estimateNote(bothChanged)).toBeNull();
  });

  it('is not said when the field no longer holds the text the mark was made for, however it came to differ', () => {
    expect(estimateNote(roof({ squares: '30', pitch: '8/12', estimate: { squares: '43.7', pitch: '6/12' } }))).toBeNull();
    expect(estimateNote(roof({ squares: '43.7', pitch: '8/12', estimate: { squares: '43.7', pitch: '6/12' } }))).toBe(SATELLITE_ESTIMATE_NOTE);
  });

  it('is not said for a roof that came from nowhere but the person', () => {
    expect(estimateNote(roof({ squares: '25', pitch: '6/12' }))).toBeNull();
  });

  it('keeps the mark on a field that was not touched, and on one that is set back to the same text', () => {
    const filled = applyEstimate(roof(), est).roof;
    expect(editedRoof(filled, { material: 'metal' }).estimate).toEqual({ squares: '43.7', pitch: '6/12' });
    expect(editedRoof(filled, { squares: '43.7' }).estimate).toEqual({ squares: '43.7', pitch: '6/12' });
  });
});

describe('what the server said', () => {
  const ok = { estimate: { squares: 43.7, pitch: '6/12' }, confidence: 'high' };
  it('is read only when it holds an estimate this form can use', () => {
    expect(readEstimate(ok)).toEqual({ ok: true, estimate: { squares: 43.7, pitch: '6/12' }, confidence: 'high' });
    expect(readEstimate({ estimate: { squares: 20, pitch: null }, confidence: 'low' })).toEqual({ ok: true, estimate: { squares: 20, pitch: null }, confidence: 'low' });
    for (const bad of [null, {}, 'x', { estimate: null }, { estimate: { squares: 0, pitch: null } }, { estimate: { squares: -2, pitch: null } }, { estimate: { squares: 5000, pitch: null } },
      { estimate: { squares: NaN, pitch: null } }, { estimate: { squares: '20', pitch: null } }, { estimate: { squares: 20, pitch: '11/12' } }, { estimate: { squares: 20, pitch: 6 } }]) {
      expect(readEstimate(bad), JSON.stringify(bad)).toEqual({ ok: false, message: SATELLITE_NOT_FOUND });
    }
  });
});

describe('the draft keeps the mark', () => {
  const storage = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); } }; };
  const KEY = 'archie.roofReportDraft.v1.co.dana@example.com';

  it('brings it back after a refresh, cut to what it may hold', () => {
    const s = storage();
    const d = { ...emptyDraft(), roof: applyEstimate(roof(), est).roof };
    expect(writeDraft(s, KEY, d)).toBe(true);
    expect(readDraft(s, KEY)!.draft.roof).toEqual({ squares: '43.7', pitch: '6/12', stories: '', material: '', estimate: { squares: '43.7', pitch: '6/12' } });
  });

  it('is not there for a draft with no estimate, so an old draft reads exactly as before', () => {
    const s = storage();
    writeDraft(s, KEY, { ...emptyDraft(), roof: roof({ squares: '25' }) });
    expect(readDraft(s, KEY)!.draft.roof).toEqual({ squares: '25', pitch: '', stories: '', material: '' });
    expect('estimate' in readDraft(s, KEY)!.draft.roof).toBe(false);
  });

  it('drops a mark that is not two short texts, or that marks nothing', () => {
    for (const bad of [null, 'x', 5, [], {}, { squares: '', pitch: '' }, { squares: 5, pitch: 6 }]) {
      const out = cleanRoof({ squares: '25', pitch: '', stories: '', material: '', estimate: bad });
      expect('estimate' in out, JSON.stringify(bad)).toBe(false);
    }
    expect(cleanRoof({ squares: '25', estimate: { squares: '25', pitch: 7 } }).estimate).toEqual({ squares: '25', pitch: '' });
    // A text that is too long is cut to what a field holds, never kept whole.
    expect(cleanRoof({ squares: '25', estimate: { squares: 'x'.repeat(100), pitch: '' } }).estimate!.squares).toHaveLength(12);
  });
});
