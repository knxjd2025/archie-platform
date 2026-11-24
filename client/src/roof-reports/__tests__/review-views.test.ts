import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { emptyDraft, type WizardDraft } from '../draft';
import { ReviewView, type ReviewViewProps } from '../StepReview';
import { GenerateView, type GenerateViewProps } from '../StepGenerate';
import type { PhotoTile } from '../wizard-model';
import { checkReview, reviewSummary, toggleKind } from '../wizard-model';
import { failureView } from '../generate-flow';
import { GEOCODE_FAILED, TOO_MANY_TODAY } from '../../../../shared/roof-reports';

const BANNED = new RegExp(`${String.fromCharCode(0x2014)}|✨|🪄`, 'u');
const noop = () => {};
const render = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);
const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const tile = (over: Partial<PhotoTile> = {}): PhotoTile => ({ key: 'k1', name: 'a.jpg', state: 'done', percent: 100, id: ID(1), category: null, error: null, ...over });

const filled = (): WizardDraft => ({
  ...emptyDraft(), step: 5,
  where: { address: '12 Elm Street', city: 'Cedar Falls', state: 'IA', zip: '50613', job: { externalId: 'job-77', label: 'Dana Whitfield, 12 Elm Street' } },
  roof: { squares: '25', pitch: '6/12', stories: '2', material: 'asphalt_shingle' }, damage: { wind: '4', hail: '8', general: '0' },
});

const review = (over: Partial<ReviewViewProps> = {}) => render(createElement(ReviewView, {
  draft: filled(), tiles: [tile({ key: 'a' }), tile({ key: 'b', id: ID(2) }), tile({ key: 'c', id: ID(3) })], onReview: noop, onGoTo: noop, ...over,
}));

describe('what the review sums up', () => {
  it('says the address, the job, the photos, the roof facts and the damage in plain sentences', () => {
    const s = reviewSummary(filled(), [tile({ key: 'a' }), tile({ key: 'b', id: ID(2) }), tile({ key: 'c', state: 'failed', id: null })]);
    expect(s).toEqual({
      address: '12 Elm Street, Cedar Falls, IA 50613', job: 'Linked to Dana Whitfield, 12 Elm Street', photos: '2 photos added.', photosNote: '1 photo did not save and will be left out.',
      roof: 'Roof facts: 25 squares, 6/12 pitch, 2 stories, Asphalt shingle.', damage: '12 damaged shingles counted.',
    });
  });

  it('says when nothing was given', () => {
    const s = reviewSummary(emptyDraft(), []);
    expect(s).toMatchObject({ photos: 'No photos added.', photosNote: '', roof: 'Roof facts: none given.', damage: 'No damaged shingles counted.', job: null });
    expect(reviewSummary({ ...filled(), damage: { wind: '1', hail: '0', general: '0' } }, []).damage).toBe('1 damaged shingle counted.');
  });
});

describe('what stops the report being made', () => {
  const base = filled().review;
  it('lets a good review through', () => { expect(checkReview(base, [tile()])).toBeNull(); });
  it('needs at least one kind, in the shared sentence', () => {
    expect(checkReview({ ...base, kinds: [] }, [])).toBe('Pick at least one: inspection, measurements or storm history.');
  });
  it('checks the customer email only when there is one', () => {
    expect(checkReview({ ...base, customerEmail: 'dana@example' }, [])).toBe('That email address doesn\'t look right.');
    expect(checkReview({ ...base, customerEmail: ' dana@example.com ' }, [])).toBeNull();
    expect(checkReview({ ...base, customerEmail: '' }, [])).toBeNull();
  });
  it('waits for photos still on their way or being removed', () => {
    expect(checkReview(base, [tile({ state: 'uploading', id: null })])).toBe('Photos are still being added. Please wait a moment.');
    expect(checkReview(base, [tile({ state: 'removing' })])).toBe('Photos are still being added. Please wait a moment.');
  });
  it('keeps the kinds in the order the list shows them', () => {
    expect(toggleKind(['storm'], 'inspection')).toEqual(['inspection', 'storm']);
    expect(toggleKind(['inspection', 'storm'], 'inspection')).toEqual(['storm']);
  });
});

describe('step 5 as drawn', () => {
  it('shows what was entered, each row with a button that names what it changes', () => {
    const h = review();
    for (const word of ['Review your report', '12 Elm Street, Cedar Falls, IA 50613', 'Linked to Dana Whitfield, 12 Elm Street', '3 photos added.', 'Roof facts: 25 squares, 6/12 pitch, 2 stories, Asphalt shingle.', '12 damaged shingles counted.']) expect(h).toContain(word);
    for (const what of ['the address', 'the photos', 'the roof facts', 'the damage counts']) expect(h).toContain(`aria-label="Change ${what}"`);
  });

  it('offers the three kinds as labelled checkboxes with what each covers, Inspection chosen to start', () => {
    const h = review();
    expect(h).toContain('What should the report cover?');
    for (const word of ['Inspection', 'Measurements', 'Storm history', 'What the photos show: the damage found, repair costs and replacement options.', 'The roof&#x27;s size and the materials it would need, from the numbers you entered.', 'Hail and wind reported near the address in recent years.']) expect(h).toContain(word);
    expect((h.match(/type="checkbox"/g) || []).length).toBe(3);
    expect(h).toMatch(/<input[^>]*id="rr-kind-inspection"[^>]*checked=""|<input[^>]*checked=""[^>]*id="rr-kind-inspection"/);
    expect(h).not.toMatch(/<input[^>]*id="rr-kind-storm"[^>]*checked=""/);
  });

  it('offers the four styles as labelled radio buttons, Full report chosen to start', () => {
    const h = review();
    for (const word of ['Insurance claim', 'Homeowner', 'Full report', 'Quick summary', 'Every section included. The complete report.']) expect(h).toContain(word);
    expect((h.match(/type="radio"/g) || []).length).toBe(4);
    expect(h).toMatch(/<input[^>]*id="rr-template-full"[^>]*checked=""|<input[^>]*checked=""[^>]*id="rr-template-full"/);
  });

  it('has labelled customer fields that say nothing is sent, and a labelled notes box', () => {
    const h = review();
    for (const word of ['Customer (optional)', 'Nothing is sent to the customer. These only go on the report.', 'Customer name', 'Customer email', 'Customer phone', 'Inspector notes (optional)', 'Anything you saw that the photos do not show.']) expect(h).toContain(word);
    expect(h).not.toMatch(/<(input|select|textarea)(?![^>]*\bid=)[^>]*>/);
    expect(h).toMatch(/<label[^>]*for="rr-notes"/);
    expect(h).toContain('maxLength="20000"');
  });

  it('warns, gently, when an inspection has no photos to look at', () => {
    expect(review({ tiles: [] })).toContain('No photos were added. An inspection works best with photos.');
    expect(review()).not.toContain('No photos were added.');
    expect(review({ tiles: [], draft: { ...filled(), review: { ...filled().review, kinds: ['storm'] } } })).not.toContain('An inspection works best with photos.');
  });

  it('says which photos will be left out', () => {
    expect(review({ tiles: [tile(), tile({ key: 'x', state: 'failed', id: null })] })).toContain('1 photo did not save and will be left out.');
  });

  it('has a visible focus ring and uses no long dash, sparkle or wand', () => {
    expect(review()).toContain('focus-visible:ring-2');
    expect(review()).not.toMatch(BANNED);
  });
});

const gen = (over: Partial<GenerateViewProps> = {}) => render(createElement(GenerateView, {
  flow: { phase: 'making', reportId: null }, line: 'Pulling storm history...', onTryAgain: noop, onBackToReview: noop, onChangeAddress: noop, onGoToReports: noop, trying: false, ...over,
}));

describe('step 6, the wait', () => {
  it('says in plain words what is happening, in a region a screen reader announces', () => {
    const h = gen();
    expect(h).toContain('role="status"');
    expect(h).toContain('Making your report...');
    expect(h).toContain('This usually takes a minute or two. You can close this page; the report will show in your list as Being made.');
    expect(h).toContain('If you refresh, we pick up where we left off.');
    expect(h).toContain('Pulling storm history...');
  });

  it('shows a thin moving bar and no sparkle or wand', () => {
    const h = gen();
    expect(h).toContain('animate-pulse');
    expect(h).not.toMatch(BANNED);
    expect(h).not.toMatch(/sparkle|wand|magic/i);
  });

  it('says "Trying again..." when the person pressed Try again', () => {
    expect(gen({ trying: true })).toContain('Trying again...');
  });

  it('says the report is ready, and that it is opening', () => {
    expect(gen({ flow: { phase: 'ready', reportId: ID(9), problem: null } })).toContain('Your report is ready. Opening it...');
  });

  it('shows a report that could not finish, with Try again and a way back, and nothing a person should not see', () => {
    const h = gen({ flow: { phase: 'failed', reportId: ID(9), view: failureView(new Error('HTTP 500 {"error":"x"}')) } });
    expect(h).toContain('The report could not be finished. Please try again.');
    expect(h).toContain('role="alert"');
    expect(h).toContain('>Try again<');
    expect(h).toContain('aria-label="Try making the report again"');
    expect(h).toContain('Back to the review');
    expect(h).not.toMatch(/HTTP|500|\{/);
  });

  it('gives a wrong address "Change the address" instead of Try again', () => {
    const h = gen({ flow: { phase: 'failed', reportId: ID(9), view: failureView(new Error(GEOCODE_FAILED)) } });
    expect(h).toContain('We couldn&#x27;t find that address on the map. Check the street, city and ZIP.');
    expect(h).toContain('Change the address');
    expect(h).not.toContain('>Try again<');
  });

  it('gives the daily cap its own sentence, says the answers are kept and offers no retry', () => {
    const h = gen({ flow: { phase: 'failed', reportId: null, view: failureView(new Error(TOO_MANY_TODAY)) } });
    expect(h).toContain('Your company has made a lot of reports today. Please try again tomorrow.');
    expect(h).toContain('Your answers are kept on this device.');
    expect(h).not.toContain('>Try again<');
    expect(h).toContain('Back to the review');
  });

  it('says it is taking long, and that the list will show the result', () => {
    const h = gen({ flow: { phase: 'slow', reportId: ID(9) } });
    expect(h).toContain('This is taking longer than usual. You can leave this page. The report will show in your list when it finishes, or say it could not be finished.');
    expect(h).toContain('Go to my reports');
  });

  it('shows the same on a screen of any size: buttons are real buttons with a focus ring', () => {
    const h = gen({ flow: { phase: 'failed', reportId: ID(9), view: failureView(null) } });
    expect(h).toMatch(/<button[^>]*type="button"/);
    expect(h).toContain('focus-visible:ring-2');
  });
});
