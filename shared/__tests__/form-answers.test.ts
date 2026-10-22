import { describe, it, expect } from 'vitest';
import { mergeAnswers } from '../form-answers';

describe('mergeAnswers', () => {
  it('keeps answers a save did not carry', () => {
    // A second tab (or a late save) that only knows about one field must not
    // wipe the ones it never saw.
    expect(mergeAnswers({ a: 'one', b: 'two' }, { b: 'TWO' })).toEqual({ a: 'one', b: 'TWO' });
  });

  it('still lets a field be cleared', () => {
    const stored = { notes: 'call back', photo: 'x.jpg', agreed: true };
    expect(mergeAnswers(stored, { notes: '', photo: null, agreed: false })).toEqual({ notes: '', photo: null, agreed: false });
  });

  it('never lets a save rewrite a locked key, nor drop it', () => {
    const stored = { __formKind: 'commercial', a: 1 };
    expect(mergeAnswers(stored, { __formKind: 'residential', a: 2 }, ['__formKind'])).toEqual({ __formKind: 'commercial', a: 2 });
    expect(mergeAnswers(stored, {}, ['__formKind'])).toEqual(stored);
  });

  it('copes with nothing stored yet, and does not touch its inputs', () => {
    expect(mergeAnswers(null, { a: 1 })).toEqual({ a: 1 });
    const stored = Object.freeze({ a: 1 });
    const patch = Object.freeze({ b: 2 });
    expect(mergeAnswers(stored, patch)).toEqual({ a: 1, b: 2 });
  });
});
