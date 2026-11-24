import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { WizardFrame, type WizardFrameProps } from '../Wizard';
import { WhereView, type WhereViewProps } from '../StepWhere';
import { PhotosView, type PhotosViewProps } from '../StepPhotos';
import type { PhotoTile } from '../wizard-model';

/** A long dash, a sparkle or a wand: none may appear on screen. Built from its code so this file holds none itself. */
const BANNED = new RegExp(`${String.fromCharCode(0x2014)}|✨|🪄`, 'u');

const noop = () => {};
const render = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);

const frame = (over: Partial<WizardFrameProps> = {}) => render(createElement(WizardFrame, {
  step: 1, error: null, restoredNote: null, saved: false, busy: false, onBack: noop, onNext: noop, onClose: noop, onStartOver: noop, ...over,
}, createElement('p', null, 'THE STEP')));

describe('the wizard frame', () => {
  it('names the wizard, the step and all six steps, marking the one you are on', () => {
    const h = frame({ step: 2 });
    expect(h).toContain('New roof report');
    expect(h).toContain('Step 2 of 6');
    for (const s of ['Where', 'Photos', 'Roof', 'Damage', 'Review', 'Make']) expect(h).toContain(s);
    expect(h.match(/aria-current="step"/g)).toHaveLength(1);
    expect(h).toContain('THE STEP');
  });

  it('has no Back on the first step, and Back and Next after it', () => {
    expect(frame({ step: 1 })).not.toContain('>Back<');
    const h = frame({ step: 3 });
    expect(h).toContain('>Back<');
    expect(h).toContain('>Next<');
  });

  it('shows six steps, and on the review step the button makes the report', () => {
    const h = frame({ step: 5 });
    expect(h).toContain('Step 5 of 6');
    for (const s of ['Where', 'Photos', 'Roof', 'Damage', 'Review', 'Make']) expect(h).toContain(s);
    expect(h).toContain('>Make the report<');
    expect(h).not.toContain('>Next<');
    expect(h).not.toContain('Save and close');
  });

  it('has no Back or Next once the report is being made: that step has its own buttons', () => {
    const h = frame({ step: 6 });
    expect(h).toContain('Step 6 of 6');
    expect(h).not.toContain('>Back<');
    expect(h).not.toContain('>Make the report<');
    expect(h).toContain('>Close<');
  });

  it('says an earlier report was replaced, when it was', () => {
    expect(frame({ notice: 'Your earlier unfinished report was replaced by this one.' })).toContain('Your earlier unfinished report was replaced by this one.');
  });

  it('says a draft was kept, from how long ago, and offers Start over', () => {
    const h = frame({ restoredNote: '2 hours ago' });
    expect(h).toContain('We kept your draft from 2 hours ago.');
    expect(h).toContain('Start over');
  });

  it('says where the draft is kept and for how long', () => {
    expect(frame({ saved: true })).toContain('Saved on this device. Kept for 24 hours.');
    expect(frame({ saved: false })).not.toContain('Saved on this device');
  });

  it('shows a refusal as a plain sentence a screen reader announces', () => {
    const h = frame({ error: 'Please enter the street address.' });
    expect(h).toContain('role="alert"');
    expect(h).toContain('Please enter the street address.');
  });

  it('says photos are still being removed when that is what it waits on', () => {
    expect(frame({ busy: true, busyNote: 'Photos are still being removed.' })).toContain('Photos are still being removed.');
  });

  it('will not close while photos are still being added, and says why', () => {
    const h = frame({ busy: true });
    expect(h).toMatch(/<button[^>]*disabled=""[^>]*>Close<\/button>/);
    expect(h).toContain('Photos are still being added.');
  });

  it('shows a focus ring on every button and uses no long dash', () => {
    const h = frame({ step: 2, restoredNote: '1 hour ago' });
    expect(h).toContain('focus-visible:ring-2');
    expect(h).not.toMatch(BANNED);
  });
});

const whereView = (over: Partial<WhereViewProps> = {}) => render(createElement(WhereView, {
  value: { address: '', city: '', state: '', zip: '', job: null }, onChange: noop,
  jobQuery: '', onJobQuery: noop, jobResults: [], jobSearching: false, jobError: null, onPickJob: noop, onRemoveJob: noop, ...over,
}));

describe('step 1, where the roof is', () => {
  it('labels every field and says which are optional', () => {
    const h = whereView();
    expect(h).toContain('Where is the roof?');
    for (const label of ['Street address', 'City', 'State', 'ZIP code (optional)', 'Search your jobs']) expect(h).toContain(label);
    expect(h).not.toMatch(/<(input|select)(?![^>]*\bid=)[^>]*>/);
    expect(h).toContain('autoComplete="street-address"');
  });

  it('offers the states and nothing that is not one', () => {
    const h = whereView();
    expect(h).toContain('<option value="IA">Iowa</option>');
    expect(h).toContain('<option value="" selected="">Choose a state</option>');
    expect((h.match(/<option/g) || []).length).toBe(1 + 51);
  });

  it('explains the job link, and that only jobs you can see can be picked', () => {
    const h = whereView();
    expect(h).toContain('Link to a job (optional)');
    expect(h).toContain('Pick a job to keep this report with it. You can only pick jobs you can see.');
  });

  it('lists jobs found, each as a button that says which job it links to', () => {
    const h = whereView({ jobQuery: 'whit', jobResults: [{ externalId: 'job-77', name: 'Dana Whitfield', location: '12 Elm Street' }] });
    expect(h).toContain('aria-label="Link to Dana Whitfield, 12 Elm Street"');
  });

  it('says when no job matches, and when the search itself failed, in plain sentences', () => {
    expect(whereView({ jobQuery: 'zzz', jobResults: [], jobSearching: false })).toContain('No jobs match that.');
    expect(whereView({ jobQuery: 'zzz', jobError: 'Jobs could not be searched. Please try again.' })).toContain('Jobs could not be searched. Please try again.');
  });

  it('shows the search is working while it looks, on the box being searched', () => {
    const h = whereView({ jobQuery: 'whit', jobSearching: true });
    expect(h).toContain('aria-busy="true"');
    expect(h).toContain('Looking...');
  });

  it('shows the linked job with a way to take the link off', () => {
    const h = whereView({ value: { address: '12 Elm Street', city: 'Cedar Falls', state: 'IA', zip: '', job: { externalId: 'job-77', label: 'Dana Whitfield, 12 Elm Street' } } });
    expect(h).toContain('Linked to Dana Whitfield, 12 Elm Street');
    expect(h).toContain('Remove link');
  });

});

const tile = (over: Partial<PhotoTile> = {}): PhotoTile => ({ key: 'k1', name: 'IMG_0412.jpg', state: 'done', percent: 100, id: '11111111-1111-4111-8111-111111111111', category: null, error: null, ...over });
const photos = (over: Partial<PhotosViewProps> = {}) => render(createElement(PhotosView, {
  tiles: [], kind: '', dragging: false, notice: '', onFiles: noop, onKind: noop, onRemove: noop, onRetry: noop, onDragging: noop, ...over,
}));

describe('step 2, photos', () => {
  it('says what the step is, that photos are optional, and what the cap is', () => {
    const h = photos();
    expect(h).toContain('Add photos (optional)');
    expect(h).toContain('A report holds up to 40 photos.');
    expect(h).toContain('Photos are kept private. Location data is removed.');
  });

  it('has a drop zone that works by keyboard: real file controls with labels, and a visible focus ring', () => {
    const h = photos();
    expect(h).toContain('Drag photos here, or press to choose them.');
    expect(h).toContain('Choose photos');
    expect(h).toContain('Take a photo');
    expect(h).toMatch(/<input[^>]*type="file"[^>]*accept="image\/\*"[^>]*multiple/);
    expect(h).toMatch(/<input[^>]*accept="image\/\*"[^>]*capture="environment"/);
    expect(h).toContain('focus-within:ring-2');
    expect(h).toContain('role="group"');
    expect(h).toContain('aria-label="Photo drop area. Drag pictures here, or use the Choose photos button."');
    expect(h).toMatch(/<label[^>]*for="rr-photo-files"/);
    expect(h).toMatch(/<label[^>]*for="rr-photo-camera"/);
    expect(h).not.toMatch(/<input(?![^>]*\bid=)[^>]*>/);
  });

  it('lets the person say what the next photos show, before they are added', () => {
    const h = photos();
    expect(h).toContain('What the next photos show');
    for (const label of ['Not sure', 'Whole roof', 'Roof surface', 'Flashing', 'Vents and pipes', 'Chimney', 'Gutters', 'Inside the house', 'Close up', 'Something else']) expect(h).toContain(label);
  });

  it('shows each photo as its own tile, with its own state', () => {
    const h = photos({ tiles: [tile({ key: 'a', name: 'a.jpg' }), tile({ key: 'b', name: 'b.jpg', state: 'uploading', percent: 45, id: null }), tile({ key: 'c', name: 'c.jpg', state: 'preparing', percent: 0, id: null })] });
    expect(h).toContain('Added');
    expect(h).toContain('Uploading 45%');
    expect(h).toContain('Getting ready...');
    expect(h).toContain('role="progressbar"');
    expect(h).toContain('aria-valuenow="45"');
    expect(h).toContain('1 of 3 photos added.');
    expect(h).toContain('aria-live="polite"');
  });

  it('lets a photo be removed, and names which photo the button is about', () => {
    const h = photos({ tiles: [tile({ name: 'IMG_0412.jpg' })] });
    expect(h).toContain('aria-label="Remove photo IMG_0412.jpg"');
  });

  it('shows a photo being taken back with "Removing...", dimmed, with its remove button off', () => {
    const h = photos({ tiles: [tile({ name: 'IMG_0412.jpg', state: 'removing' })] });
    expect(h).toContain('Removing...');
    expect(h).toContain('aria-busy="true"');
    expect(h).toMatch(/<button[^>]*disabled=""[^>]*aria-label="Remove photo IMG_0412.jpg"|<button[^>]*aria-label="Remove photo IMG_0412.jpg"[^>]*disabled=""/);
    expect(h).not.toContain('>Added<');
  });

  it('says why a photo could not be taken back, on that photo, and keeps its remove button', () => {
    const h = photos({ tiles: [tile({ name: 'IMG_0412.jpg', state: 'done', error: 'The photo could not be removed. Please try again.' })] });
    expect(h).toContain('The photo could not be removed. Please try again.');
    expect(h).toContain('role="alert"');
    expect(h).not.toMatch(/<button[^>]*disabled=""[^>]*aria-label="Remove photo/);
  });

  it('shows a photo that did not save, why, and how to try again or drop it', () => {
    const h = photos({ tiles: [tile({ name: 'IMG_0412.jpg', state: 'failed', id: null, error: 'That photo is too large. Please try again.' })] });
    expect(h).toContain('Not saved');
    expect(h).toContain('That photo is too large. Please try again.');
    expect(h).toContain('aria-label="Try again with photo IMG_0412.jpg"');
    expect(h).toContain('role="alert"');
  });

  it('says what was left out, and the cap once it is reached', () => {
    const h = photos({ notice: '3 photos were left out because a report holds 40.', tiles: Array.from({ length: 40 }, (_, i) => tile({ key: `k${i}`, name: `p${i}.jpg` })) });
    expect(h).toContain('3 photos were left out because a report holds 40.');
    expect(h).toContain('That is the most photos a report holds (40).');
  });

  it('keeps a photo tile without a picture when the photo came back from the draft', () => {
    const h = photos({ tiles: [tile({ name: 'front-slope.jpg' })] });
    expect(h).toContain('front-slope.jpg');
  });

  it('uses no long dash, sparkle or wand', () => {
    expect(photos({ tiles: [tile()] })).not.toMatch(BANNED);
  });
});
