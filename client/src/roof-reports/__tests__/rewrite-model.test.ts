import { describe, expect, it } from 'vitest';
import { REWRITE_FAILED, REWRITE_REPORT_CAPPED } from '../../../../shared/roof-reports';
import { idleRewrite, initialRewrites, rewriteBusy, rewriteReducer, rewriteStateOf, submitRewrite, type RewriteMap } from '../rewrite-model';
import { RR } from '../words';

const step = (s: RewriteMap, ...actions: Parameters<typeof rewriteReducer>[1][]) => actions.reduce(rewriteReducer, s);

describe('the Rewrite buttons: what is drawn after each step', () => {
  it('starts with nothing rewriting and nothing to undo', () => {
    expect(initialRewrites()).toEqual({});
    expect(rewriteStateOf(initialRewrites(), 'summary')).toEqual(idleRewrite());
    expect(rewriteBusy(initialRewrites())).toBe(false);
  });

  it('says Rewriting on that field alone, at once', () => {
    const s = step(initialRewrites(), { type: 'start', key: 'finding:1' });
    expect(rewriteStateOf(s, 'finding:1')).toMatchObject({ phase: 'rewriting', error: null });
    expect(rewriteStateOf(s, 'finding:0').phase).toBe('idle');
    expect(rewriteStateOf(s, 'summary').phase).toBe('idle');
    expect(rewriteBusy(s)).toBe(true);
  });

  it('keeps the old text to undo to once a rewrite has landed', () => {
    const s = step(initialRewrites(), { type: 'start', key: 'summary' }, { type: 'done', key: 'summary', previous: 'Old summary.' });
    expect(rewriteStateOf(s, 'summary')).toEqual({ phase: 'done', error: null, previous: 'Old summary.' });
    expect(rewriteBusy(s)).toBe(false);
  });

  it('puts the field back with a sentence when it failed, and keeps nothing to undo', () => {
    const s = step(initialRewrites(), { type: 'start', key: 'summary' }, { type: 'failed', key: 'summary', error: REWRITE_FAILED });
    expect(rewriteStateOf(s, 'summary')).toEqual({ phase: 'failed', error: REWRITE_FAILED, previous: null });
  });

  it('a rewrite that fails after an earlier one keeps the earlier undo', () => {
    const done = step(initialRewrites(), { type: 'start', key: 'summary' }, { type: 'done', key: 'summary', previous: 'First.' });
    const s = step(done, { type: 'start', key: 'summary' }, { type: 'failed', key: 'summary', error: REWRITE_FAILED });
    expect(rewriteStateOf(s, 'summary').previous).toBe('First.');
  });

  it('forgets the undo once the person types in the field themselves, or the undo is done', () => {
    const done = step(initialRewrites(), { type: 'start', key: 'finding:0' }, { type: 'done', key: 'finding:0', previous: 'Old.' });
    expect(rewriteStateOf(step(done, { type: 'clear', key: 'finding:0' }), 'finding:0')).toEqual(idleRewrite());
    expect(rewriteStateOf(step(done, { type: 'clear', key: 'finding:1' }), 'finding:0').previous).toBe('Old.');
  });

  it('forgets everything when the report is opened again', () => {
    expect(step(step(initialRewrites(), { type: 'start', key: 'summary' }), { type: 'reset' })).toEqual({});
  });

  it('has plain words, no icon words, and no em dash', () => {
    expect(RR.rewrite.button).toBe('Rewrite');
    expect(RR.rewrite.rewriting).toBe('Rewriting...');
    expect(RR.rewrite.undo).toBe('Undo rewrite');
    for (const w of [RR.rewrite.button, RR.rewrite.rewriting, RR.rewrite.undo, RR.rewrite.done, RR.rewrite.failed, RR.rewrite.unsavedFirst]) {
      expect(w).not.toContain('—');
      expect(w).not.toMatch(/sparkle|wand|magic|\bAI\b/i);
    }
  });
});

describe('asking for a rewrite', () => {
  const report = { executiveSummary: 'New.' };

  it('lands the new text and the report as the server now holds it', async () => {
    const action = await submitRewrite({ call: async () => ({ status: 'rewritten', text: 'New.', report }) }, 'summary', 'Old.');
    expect(action).toEqual({ type: 'done', key: 'summary', previous: 'Old.', text: 'New.', report });
  });

  it('gives the server\'s plain sentence when it refuses, and the standard one for anything that is not plain', async () => {
    expect(await submitRewrite({ call: async () => { throw new Error(REWRITE_REPORT_CAPPED); } }, 'summary', 'Old.')).toEqual({ type: 'failed', key: 'summary', error: REWRITE_REPORT_CAPPED });
    for (const message of ['HTTP 500', 'TypeError: Failed to fetch', '{"error":"x"}', 'ECONNRESET', '']) {
      expect(await submitRewrite({ call: async () => { throw new Error(message); } }, 'finding:0', 'Old.'), message).toEqual({ type: 'failed', key: 'finding:0', error: RR.rewrite.failed });
    }
  });

  it('does not take an answer that is not a rewrite as one', async () => {
    for (const answer of [null, {}, { status: 'rewritten' }, { status: 'rewritten', text: '', report }, { status: 'rewritten', text: 5, report }, { status: 'rewritten', text: 'New.', report: null }, { status: 'maybe', text: 'New.', report }]) {
      expect(await submitRewrite({ call: async () => answer }, 'summary', 'Old.'), JSON.stringify(answer)).toEqual({ type: 'failed', key: 'summary', error: RR.rewrite.failed });
    }
  });
});
