import { describe, expect, it } from 'vitest';
import { GEOCODE_FAILED, TOO_MANY_RECENT, TOO_MANY_TODAY, WARN_ALL_PHOTOS, WARN_OUT_OF_TIME, WARN_STORM_PARTIAL, warnSomePhotos } from '../../../../shared/roof-reports';
import { emptyDraft, type WizardDraft } from '../draft';
import {
  POLL_EVERY_MS, attemptFor, buildGenerateBody, failureView, fingerprintOf, lineAt, newAttemptKey, nextPollDelayMs, outcomeOf, partialNotes, readAnswer,
  refusalSentence, statusLines,
} from '../generate-flow';

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const filled = (): WizardDraft => ({
  ...emptyDraft(), step: 5,
  where: { address: ' 12 Elm Street ', city: 'Cedar Falls', state: 'IA', zip: '50613', job: { externalId: 'job-77', label: 'Dana Whitfield, 12 Elm Street' } },
  roof: { squares: '25', pitch: '6/12', stories: '2', material: 'asphalt_shingle' }, damage: { wind: '4', hail: '12', general: '0' },
  review: { kinds: ['inspection', 'storm'], template: 'insurance', notes: ' Ridge cap lifted. ', customerName: 'Dana Whitfield', customerEmail: 'dana@example.com', customerPhone: '', },
});

describe('the request the wizard sends', () => {
  it('holds everything that was entered, trimmed, with only the saved photos', () => {
    const body = buildGenerateBody(filled(), [ID(1), ID(2)]);
    expect(body).toEqual({
      reportTypes: ['inspection', 'storm'], template: 'insurance', address: '12 Elm Street', city: 'Cedar Falls', state: 'IA', zip: '50613',
      photoIds: [ID(1), ID(2)], roofDetails: { squares: 25, pitch: '6/12', stories: 2, material: 'asphalt_shingle' },
      damageCounts: { windDamaged: 4, hailDamaged: 12, generalDamaged: 0 }, inspectorNotes: 'Ridge cap lifted.',
      customer: { name: 'Dana Whitfield', email: 'dana@example.com', phone: '' }, jobExternalId: 'job-77',
    });
  });

  it('leaves out what was not given: no roof facts, no customer, no job', () => {
    const d = { ...filled(), where: { ...filled().where, job: null }, roof: { squares: '', pitch: '', stories: '', material: '' }, review: { ...filled().review, customerName: '', customerEmail: '' } };
    const body = buildGenerateBody(d, []);
    expect(body).not.toHaveProperty('roofDetails');
    expect(body).not.toHaveProperty('customer');
    expect(body).not.toHaveProperty('jobExternalId');
    expect(body.photoIds).toEqual([]);
  });

  it('never sends more photos than a report holds', () => {
    const many = Array.from({ length: 50 }, (_, i) => ID(i));
    expect(buildGenerateBody(filled(), many).photoIds).toHaveLength(40);
  });
});

describe('the one request key for each try', () => {
  it('is made once: the same request keeps its key, over a double click and over a refresh', () => {
    let made = 0;
    const make = () => `rr-key-${++made}`;
    const body = buildGenerateBody(filled(), [ID(1)]);
    const first = attemptFor(null, body, make);
    const again = attemptFor(first, buildGenerateBody(filled(), [ID(1)]), make);
    expect(again).toEqual(first);
    expect(made).toBe(1);
  });

  it('is new when anything that was asked for changed, because the server refuses one key for two requests', () => {
    let made = 0;
    const make = () => `rr-key-${++made}`;
    const first = attemptFor(null, buildGenerateBody(filled(), [ID(1)]), make);
    for (const changed of [
      buildGenerateBody(filled(), [ID(1), ID(2)]),
      buildGenerateBody({ ...filled(), review: { ...filled().review, template: 'quick' } }, [ID(1)]),
      buildGenerateBody({ ...filled(), review: { ...filled().review, notes: 'More notes' } }, [ID(1)]),
      buildGenerateBody({ ...filled(), where: { ...filled().where, address: '14 Elm Street' } }, [ID(1)]),
    ]) expect(attemptFor(first, changed, make).key).not.toBe(first.key);
  });

  it('makes keys the server accepts, and tells requests apart by a short fingerprint', () => {
    expect(newAttemptKey()).toMatch(/^[A-Za-z0-9_.:-]{8,200}$/);
    expect(newAttemptKey()).not.toBe(newAttemptKey());
    expect(fingerprintOf('a')).not.toBe(fingerprintOf('b'));
    expect(fingerprintOf('same')).toBe(fingerprintOf('same'));
    expect(fingerprintOf('x'.repeat(20_000)).length).toBeLessThan(40);
  });
});

describe('reading what the server said', () => {
  it('takes an answer about a report, and nothing else', () => {
    expect(readAnswer({ id: ID(7), status: 'generating', problem: null })).toEqual({ id: ID(7), status: 'generating', problem: null });
    expect(readAnswer({ id: ID(7), status: 'ready', problem: 'x' })).toEqual({ id: ID(7), status: 'ready', problem: 'x' });
    expect(readAnswer({ error: TOO_MANY_RECENT })).toBeNull();
    expect(readAnswer({ id: 'nope', status: 'ready' })).toBeNull();
    expect(readAnswer(null)).toBeNull();
    expect(refusalSentence({ error: TOO_MANY_RECENT })).toBe(TOO_MANY_RECENT);
    expect(refusalSentence({ id: ID(7) })).toBeNull();
  });

  it('says whether to stop, wait or fail', () => {
    expect(outcomeOf({ id: ID(1), status: 'ready', problem: null })).toBe('ready');
    expect(outcomeOf({ id: ID(1), status: 'generating', problem: null })).toBe('waiting');
    expect(outcomeOf({ id: ID(1), status: 'failed', problem: null })).toBe('failed');
    expect(outcomeOf({ id: ID(1), status: 'archived', problem: null })).toBe('failed');
  });
});

describe('what a failure says and offers', () => {
  it('gives the daily cap its own sentence, keeps the answers and offers no retry', () => {
    const v = failureView(new Error(TOO_MANY_TODAY));
    expect(v).toMatchObject({ kind: 'capped', sentence: 'Your company has made a lot of reports today. Please try again tomorrow.', canTryAgain: false, canChangeAddress: false, note: 'Your answers are kept on this device.' });
  });

  it('gives too many in a few minutes its own sentence, with a retry', () => {
    expect(failureView(new Error(TOO_MANY_RECENT))).toMatchObject({ kind: 'wait', canTryAgain: true });
    expect(failureView(new Error(TOO_MANY_RECENT)).sentence).toContain('Please wait a little');
  });

  it('sends a wrong address back to the address, not to a retry that would fail the same way', () => {
    const v = failureView(new Error(GEOCODE_FAILED));
    expect(v).toMatchObject({ kind: 'address', canTryAgain: false, canChangeAddress: true });
    expect(v.sentence).toBe(GEOCODE_FAILED);
  });

  it('shows the server\'s own plain sentence, and for anything else the one written here', () => {
    expect(failureView(new Error('That email address doesn\'t look right.')).sentence).toBe('That email address doesn\'t look right.');
    for (const raw of ['HTTP 500', 'Request timed out — try again.', 'TypeError: x is undefined', '{"error":"rate_limit"}', 'Failed to fetch']) {
      const v = failureView(new Error(raw));
      expect(v.sentence, raw).toBe('The report could not be finished. Please try again.');
      expect(v).toMatchObject({ kind: 'again', canTryAgain: true });
    }
    expect(failureView(null).sentence).toBe('The report could not be finished. Please try again.');
  });
});

describe('a report that is ready but partly missing', () => {
  it('says nothing for a whole report', () => {
    expect(partialNotes(null)).toEqual([]);
    expect(partialNotes('')).toEqual([]);
  });

  it('gives running out of time, photos and storm data each their own sentence', () => {
    const all = [WARN_OUT_OF_TIME, warnSomePhotos(2, 5), WARN_STORM_PARTIAL].join(' ');
    expect(partialNotes(all)).toEqual([
      { kind: 'time', sentence: 'Part of this report is missing because it took too long to finish.' },
      { kind: 'photos', sentence: '2 of the 5 photos could not be looked at, so they are not described in the report.' },
      { kind: 'storm', sentence: 'Some storm history sources were slow to answer, so the storm history may be missing some storms.' },
    ]);
    expect(partialNotes(WARN_ALL_PHOTOS)).toEqual([{ kind: 'photos', sentence: 'None of the photos could be looked at, so the report does not describe the roof\'s condition. Making it again may help.' }]);
    expect(partialNotes(WARN_STORM_PARTIAL).map((n) => n.kind)).toEqual(['storm']);
  });

  it('ignores a sentence it does not know, so nothing the server wrote reaches the screen unchanged', () => {
    expect(partialNotes('Something from inside the app.')).toEqual([]);
  });
});

describe('waiting', () => {
  it('asks again at 2, 3, 5 and 8 seconds, then every 10', () => {
    expect([0, 1, 2, 3, 4, 5, 50].map(nextPollDelayMs)).toEqual([2000, 3000, 5000, 8000, POLL_EVERY_MS, POLL_EVERY_MS, POLL_EVERY_MS]);
  });

  it('lists only the steps this report will really take, in order', () => {
    expect(statusLines(['inspection', 'storm'], 3)).toEqual(['Placing the address on the map...', 'Pulling storm history...', 'Looking at your photos...', 'Writing the findings...']);
    expect(statusLines(['inspection'], 0)).toEqual(['Placing the address on the map...', 'Pulling storm history...', 'Writing the findings...']);
    expect(statusLines(['measurement'], 5)).toEqual(['Placing the address on the map...', 'Writing the findings...']);
  });

  it('changes the line every 6 seconds and stays on the last', () => {
    const lines = statusLines(['inspection'], 2);
    expect(lineAt(lines, 0)).toBe(lines[0]);
    expect(lineAt(lines, 5999)).toBe(lines[0]);
    expect(lineAt(lines, 6000)).toBe(lines[1]);
    expect(lineAt(lines, 10 * 60 * 1000)).toBe(lines[lines.length - 1]);
    expect(lineAt([], 0)).toBe('');
  });
});
