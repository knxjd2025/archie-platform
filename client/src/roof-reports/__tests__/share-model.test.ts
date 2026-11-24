import { describe, expect, it } from 'vitest';
import { copyLink, initialShare, shareReducer, turnLinkOff, type ShareState } from '../share-model';
import { RR } from '../words';

const URL1 = 'https://app.example.test/r/roof/' + 'a'.repeat(64);
const step = (s: ShareState, ...actions: Parameters<typeof shareReducer>[1][]) => actions.reduce(shareReducer, s);

describe('the share link controls: what is drawn after each click', () => {
  it('starts from what the server said: a link is on or it is not', () => {
    expect(initialShare(true)).toEqual({ on: true, phase: 'idle', url: null, error: null });
    expect(initialShare(false)).toEqual({ on: false, phase: 'idle', url: null, error: null });
  });

  it('shows the work in the frame of the click: making the link', () => {
    expect(step(initialShare(false), { type: 'making' })).toMatchObject({ phase: 'making', error: null });
  });

  it('says the link was copied, and that a link is now on', () => {
    expect(step(initialShare(false), { type: 'making' }, { type: 'copied', url: URL1 })).toEqual({ on: true, phase: 'copied', url: URL1, error: null });
  });

  it('shows the link to copy by hand when the browser would not copy it, still on', () => {
    expect(step(initialShare(false), { type: 'making' }, { type: 'manual', url: URL1 })).toEqual({ on: true, phase: 'manual', url: URL1, error: null });
  });

  it('puts the state back with a sentence when the link could not be made', () => {
    expect(step(initialShare(false), { type: 'making' }, { type: 'failed', error: RR.share.makeFailed })).toEqual({ on: false, phase: 'idle', url: null, error: RR.share.makeFailed });
  });

  it('shows turning off at once, then that it is off, and forgets the link', () => {
    const on = step(initialShare(false), { type: 'making' }, { type: 'copied', url: URL1 });
    const turning = step(on, { type: 'turningOff' });
    expect(turning).toMatchObject({ on: true, phase: 'turningOff', error: null });
    expect(step(turning, { type: 'off' })).toEqual({ on: false, phase: 'off', url: null, error: null });
  });

  it('keeps the link on, with a sentence, when it could not be turned off', () => {
    const on = initialShare(true);
    expect(step(on, { type: 'turningOff' }, { type: 'offFailed', error: RR.share.offFailed })).toEqual({ on: true, phase: 'idle', url: null, error: RR.share.offFailed });
  });
});

describe('copyLink', () => {
  it('makes the link and copies it', async () => {
    const written: string[] = [];
    expect(await copyLink({ create: async () => ({ url: URL1 }), write: async (t) => { written.push(t); } })).toEqual({ type: 'copied', url: URL1 });
    expect(written).toEqual([URL1]);
  });

  it('hands the link over to be copied by hand when the browser refuses to copy', async () => {
    expect(await copyLink({ create: async () => ({ url: URL1 }), write: async () => { throw new Error('NotAllowedError'); } })).toEqual({ type: 'manual', url: URL1 });
  });

  it('refuses an answer that is not a link on this app, rather than show or copy it', async () => {
    for (const url of ['javascript:alert(1)', 'https://elsewhere.example/r/roof/' + 'a'.repeat(64), '', 5, null]) {
      const r = await copyLink({ create: async () => ({ url: url as never }), write: async () => {}, origin: 'https://app.example.test' });
      expect(r, String(url)).toEqual({ type: 'failed', error: RR.share.makeFailed });
    }
  });

  it('says a plain sentence when the link could not be made: the server\'s own, or the one written for it', async () => {
    expect(await copyLink({ create: async () => { throw new Error('A link can be made once the report is finished.'); }, write: async () => {} })).toEqual({ type: 'failed', error: 'A link can be made once the report is finished.' });
    expect(await copyLink({ create: async () => { throw new Error('HTTP 500'); }, write: async () => {} })).toEqual({ type: 'failed', error: RR.share.makeFailed });
  });
});

describe('turnLinkOff', () => {
  it('turns it off', async () => {
    expect(await turnLinkOff({ revoke: async () => ({ shareLinkOn: false }) })).toEqual({ type: 'off' });
  });
  it('says why when it could not', async () => {
    expect(await turnLinkOff({ revoke: async () => { throw new Error('Failed to fetch'); } })).toEqual({ type: 'offFailed', error: RR.share.offFailed });
  });
});
