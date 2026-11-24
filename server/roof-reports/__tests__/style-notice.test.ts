/**
 * The plain sentence the editor shows when a look could not be used and the
 * report is shown as a document. Said in the person's words: how many photos or
 * chapters it has, and how many the look needs. No code, no id, no long dash.
 */
import { describe, it, expect } from 'vitest';
import { styleNotice } from '../../../shared/roof-reports';

describe('the sentence for a look that could not be used', () => {
  it('says how many photos a flight is short of, in the plan\'s words', () => {
    expect(styleNotice({ kind: 'flight', have: 2, need: 3 })).toBe('This report has only 2 photos, so it is shown as a document. A flight needs 3 or more.');
    expect(styleNotice({ kind: 'flight', have: 1, need: 3 })).toBe('This report has only 1 photo, so it is shown as a document. A flight needs 3 or more.');
    expect(styleNotice({ kind: 'flight', have: 0, need: 3 })).toBe('This report has no photos, so it is shown as a document. A flight needs 3 or more.');
  });

  it('says how many chapters a presentation is short of', () => {
    expect(styleNotice({ kind: 'presentation', have: 3, need: 4 })).toBe('This report has only 3 chapters of content, so it is shown as a document. A presentation needs 4 or more.');
    expect(styleNotice({ kind: 'presentation', have: 1, need: 4 })).toBe('This report has only 1 chapter of content, so it is shown as a document. A presentation needs 4 or more.');
    expect(styleNotice({ kind: 'presentation', have: 0, need: 4 })).toBe('This report has no chapters of content, so it is shown as a document. A presentation needs 4 or more.');
  });

  it('says nothing when nothing was downgraded, and never uses a long dash', () => {
    expect(styleNotice(undefined)).toBeNull();
    expect(styleNotice({ kind: 'flight', have: 2, need: 3 })).not.toContain(String.fromCharCode(0x2014));
  });
});
