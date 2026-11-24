import { describe, expect, it } from 'vitest';
import {
  STEPS, checkWhere, countedPhotos, draftPhotosFromTiles, leftOutLine, photoCountLine, photoIdsForReport, photosReducer, planAdditions,
  photosInFlight, photosRemoving, progressLine, readRemoveError, tileLabel, tilesFromDraft, tryAdvance, type PhotoTile,
} from '../wizard-model';
import { NOT_FOUND, PHOTO_IN_REPORT } from '../../../../shared/roof-reports';
import { emptyDraft } from '../draft';

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const tile = (over: Partial<PhotoTile> = {}): PhotoTile => ({ key: 'k1', name: 'front.jpg', state: 'preparing', percent: 0, id: null, category: null, error: null, ...over });
const file = (name: string, type = 'image/jpeg') => ({ name, type });
const where = (over = {}) => ({ address: '12 Elm Street', city: 'Cedar Falls', state: 'IA', zip: '', job: null, ...over });

describe('the steps', () => {
  it('are Where, Photos, Roof, Damage, Review and Make, in that order', () => {
    expect(STEPS.map((s) => s.label)).toEqual(['Where', 'Photos', 'Roof', 'Damage', 'Review', 'Make']);
  });
});

describe('step 1, where the roof is', () => {
  it('asks for a street address, then a city and state, in plain words', () => {
    expect(checkWhere(where({ address: '  ' }))).toBe('Please enter the street address.');
    expect(checkWhere(where({ city: '' }))).toBe('Please enter the city and state as well.');
    expect(checkWhere(where({ state: '' }))).toBe('Please enter the city and state as well.');
    expect(checkWhere(where())).toBeNull();
  });

  it('takes a ZIP code only as five digits, or nine with a dash, and lets it be left empty', () => {
    expect(checkWhere(where({ zip: '50613' }))).toBeNull();
    expect(checkWhere(where({ zip: '50613-1234' }))).toBeNull();
    expect(checkWhere(where({ zip: '' }))).toBeNull();
    for (const bad of ['5061', 'abcde', '506130', '50613-12']) expect(checkWhere(where({ zip: bad })), bad).toBe('Please enter a 5 digit ZIP code.');
  });
});

describe('what goes on the photo step', () => {
  it('keeps pictures, leaves out other files, and says how many', () => {
    const plan = planAdditions(0, [file('a.jpg'), file('notes.pdf', 'application/pdf'), file('b.png', 'image/png'), file('c.txt', 'text/plain')]);
    expect(plan.accept.map((f) => f.name)).toEqual(['a.jpg', 'b.png']);
    expect(plan.leftOutNotPictures).toBe(2);
    expect(plan.leftOutFull).toBe(0);
  });

  it('takes a picture whose type the browser left blank when its name says it is one', () => {
    const plan = planAdditions(0, [file('IMG_0412.HEIC', ''), file('readme', '')]);
    expect(plan.accept.map((f) => f.name)).toEqual(['IMG_0412.HEIC']);
    expect(plan.leftOutNotPictures).toBe(1);
  });

  it('stops at 40 photos and counts the ones that did not fit', () => {
    const many = Array.from({ length: 10 }, (_, i) => file(`p${i}.jpg`));
    const plan = planAdditions(35, many);
    expect(plan.accept).toHaveLength(5);
    expect(plan.leftOutFull).toBe(5);
    expect(planAdditions(40, many)).toMatchObject({ accept: [], leftOutFull: 10 });
  });

  it('counts a photo that did not save as no photo at all', () => {
    const tiles = [tile({ key: 'a', state: 'done', id: ID(1) }), tile({ key: 'b', state: 'failed' }), tile({ key: 'c', state: 'uploading' })];
    expect(countedPhotos(tiles)).toBe(2);
  });

  it('states the cap, in plain words, as the count changes', () => {
    expect(photoCountLine(0)).toBe('A report holds up to 40 photos.');
    expect(photoCountLine(1)).toBe('1 photo added. 39 more fit.');
    expect(photoCountLine(12)).toBe('12 photos added. 28 more fit.');
    expect(photoCountLine(39)).toBe('39 photos added. 1 more fits.');
    expect(photoCountLine(40)).toBe('That is the most photos a report holds (40).');
  });

  it('says what was left out, and why', () => {
    expect(leftOutLine(0, 0)).toBe('');
    expect(leftOutLine(0, 3)).toBe('3 photos were left out because a report holds 40.');
    expect(leftOutLine(0, 1)).toBe('1 photo was left out because a report holds 40.');
    expect(leftOutLine(1, 0)).toBe('1 file was left out because it is not a picture.');
    expect(leftOutLine(2, 0)).toBe('2 files were left out because they are not pictures.');
    expect(leftOutLine(2, 3)).toBe('2 files were left out because they are not pictures. 3 photos were left out because a report holds 40.');
  });
});

describe('a photo\'s tile', () => {
  it('starts as soon as the photo is picked, and moves through its states', () => {
    let tiles = photosReducer([], { type: 'add', tiles: [tile({ key: 'a' }), tile({ key: 'b', name: 'back.jpg' })] });
    expect(tiles.map((t) => t.state)).toEqual(['preparing', 'preparing']);
    tiles = photosReducer(tiles, { type: 'progress', key: 'a', percent: 45 });
    expect(tiles[0]).toMatchObject({ state: 'uploading', percent: 45 });
    tiles = photosReducer(tiles, { type: 'done', key: 'a', id: ID(1) });
    expect(tiles[0]).toMatchObject({ state: 'done', percent: 100, id: ID(1), error: null });
    tiles = photosReducer(tiles, { type: 'failed', key: 'b', error: 'The photo couldn\'t be saved. Please try again.' });
    expect(tiles[1]).toMatchObject({ state: 'failed', error: 'The photo couldn\'t be saved. Please try again.' });
    tiles = photosReducer(tiles, { type: 'retry', key: 'b' });
    expect(tiles[1]).toMatchObject({ state: 'preparing', percent: 0, error: null });
  });

  it('never goes backwards: a late progress report does not undo a finished photo', () => {
    let tiles = photosReducer([], { type: 'add', tiles: [tile({ key: 'a' })] });
    tiles = photosReducer(tiles, { type: 'done', key: 'a', id: ID(1) });
    expect(photosReducer(tiles, { type: 'progress', key: 'a', percent: 30 })[0].state).toBe('done');
    expect(photosReducer(tiles, { type: 'failed', key: 'a', error: 'x' })[0].state).toBe('done');
  });

  it('is removed, whatever state it is in, and nothing else changes', () => {
    const tiles = [tile({ key: 'a' }), tile({ key: 'b', state: 'done', id: ID(2) })];
    expect(photosReducer(tiles, { type: 'remove', key: 'a' }).map((t) => t.key)).toEqual(['b']);
    expect(photosReducer(tiles, { type: 'remove', key: 'nope' })).toEqual(tiles);
  });

  it('says "Removing..." while the server takes a saved photo back, still counts it, and puts it back with a sentence if that fails', () => {
    let tiles = [tile({ key: 'a', state: 'done', id: ID(1) }), tile({ key: 'b', state: 'failed' })];
    tiles = photosReducer(tiles, { type: 'removing', key: 'a' });
    expect(tiles[0].state).toBe('removing');
    expect(tileLabel(tiles[0])).toBe('Removing...');
    expect(photosRemoving(tiles)).toBe(true);
    expect(photosInFlight(tiles)).toBe(false);
    expect(countedPhotos(tiles)).toBe(1);
    expect(draftPhotosFromTiles(tiles)).toEqual([]);
    expect(photoIdsForReport(tiles)).toEqual([]);
    expect(progressLine([tile({ state: 'removing', id: ID(1) }), tile({ state: 'done', id: ID(2) })])).toBe('2 of 2 photos added.');
    const failed = photosReducer(tiles, { type: 'removeFailed', key: 'a', error: 'The photo could not be removed. Please try again.' });
    expect(failed[0]).toMatchObject({ state: 'done', error: 'The photo could not be removed. Please try again.' });
    expect(photosRemoving(failed)).toBe(false);
    expect(photosReducer(failed, { type: 'remove', key: 'a' }).map((t) => t.key)).toEqual(['b']);
  });

  it('only asks the server to take back a photo the server has', () => {
    const tiles = [tile({ key: 'a', state: 'uploading' }), tile({ key: 'b', state: 'failed' })];
    expect(photosReducer(tiles, { type: 'removing', key: 'a' })).toEqual(tiles);
    expect(photosReducer(tiles, { type: 'removing', key: 'b' })).toEqual(tiles);
    expect(photosReducer(tiles, { type: 'removeFailed', key: 'a', error: 'x' })).toEqual(tiles);
  });

  it('reads the answer to a removal: a photo the server no longer has is gone, a refusal is a plain sentence, anything else is the fallback', () => {
    expect(readRemoveError(new Error(NOT_FOUND))).toEqual({ gone: true });
    expect(readRemoveError(new Error(PHOTO_IN_REPORT))).toEqual({ gone: false, error: PHOTO_IN_REPORT });
    expect(readRemoveError(new Error('HTTP 502'))).toEqual({ gone: false, error: 'The photo could not be removed. Please try again.' });
    expect(readRemoveError(new Error('Request timed out — try again.'))).toEqual({ gone: false, error: 'The photo could not be removed. Please try again.' });
    expect(readRemoveError(null)).toEqual({ gone: false, error: 'The photo could not be removed. Please try again.' });
  });

  it('names its state in plain words', () => {
    expect(tileLabel(tile({ state: 'preparing' }))).toBe('Getting ready...');
    expect(tileLabel(tile({ state: 'uploading', percent: 45 }))).toBe('Uploading 45%');
    expect(tileLabel(tile({ state: 'done' }))).toBe('Added');
    expect(tileLabel(tile({ state: 'failed' }))).toBe('Not saved');
  });

  it('says how the photos are going', () => {
    expect(progressLine([])).toBe('');
    expect(progressLine([tile({ state: 'done' }), tile({ state: 'uploading' }), tile({ state: 'preparing' })])).toBe('1 of 3 photos added.');
    expect(progressLine([tile({ state: 'done' }), tile({ state: 'done' })])).toBe('2 of 2 photos added.');
    expect(progressLine([tile({ state: 'done' }), tile({ state: 'failed' }), tile({ state: 'failed' })])).toBe('2 photos did not save and will be left out.');
    expect(progressLine([tile({ state: 'failed' })])).toBe('1 photo did not save and will be left out.');
  });
});

describe('photos in the draft and in the report', () => {
  it('keeps only saved photos, as ids, in the draft, and brings them back as saved', () => {
    const tiles = [tile({ key: 'a', state: 'done', id: ID(1), name: 'one.jpg', category: 'overview' }), tile({ key: 'b', state: 'uploading' }), tile({ key: 'c', state: 'failed' })];
    expect(draftPhotosFromTiles(tiles)).toEqual([{ id: ID(1), name: 'one.jpg', category: 'overview' }]);
    const back = tilesFromDraft([{ id: ID(1), name: 'one.jpg', category: 'overview' }]);
    expect(back).toHaveLength(1);
    expect(back[0]).toMatchObject({ state: 'done', percent: 100, id: ID(1), name: 'one.jpg', category: 'overview', error: null });
  });

  it('sends the report the saved photos in the order they sit, and no others', () => {
    const tiles = [tile({ key: 'a', state: 'done', id: ID(1) }), tile({ key: 'b', state: 'failed' }), tile({ key: 'c', state: 'done', id: ID(3) }), tile({ key: 'd', state: 'uploading' })];
    expect(photoIdsForReport(tiles)).toEqual([ID(1), ID(3)]);
  });
});

describe('going on to the next step', () => {
  it('stops on step 1 until the address is whole, with the sentence to show', () => {
    const d = { ...emptyDraft(), step: 1 };
    expect(tryAdvance(d, [])).toEqual({ ok: false, error: 'Please enter the street address.' });
    expect(tryAdvance({ ...d, where: where() }, [])).toEqual({ ok: true, step: 2 });
  });

  it('waits on the photo step while photos are still being added, and lets none at all through', () => {
    const d = { ...emptyDraft(), step: 2, where: where() };
    expect(tryAdvance(d, [tile({ state: 'uploading' })])).toEqual({ ok: false, error: 'Photos are still being added. Please wait a moment.' });
    expect(tryAdvance(d, [tile({ state: 'preparing' })])).toMatchObject({ ok: false });
    expect(tryAdvance(d, [])).toEqual({ ok: true, step: 3 });
    expect(tryAdvance(d, [tile({ state: 'failed' }), tile({ state: 'done', id: ID(1) })])).toEqual({ ok: true, step: 3 });
  });
});
