import { describe, expect, it } from 'vitest';
import { photoAnswerIds } from '../job-photos';
import { PRECON_CHECKLIST_FIELDS } from '../preconstruction-checklist';
import { WALKTHROUGH_FIELDS } from '../final-walkthrough';

describe('photoAnswerIds', () => {
  it('takes the ids from photo fields only, in the order they were given', () => {
    const answers = {
      'Material drop location': [{ fileId: 'a', name: 'drop.jpg' }, { fileId: 'b', name: 'drop2.jpg' }],
      'Dumpster location': [{ fileId: 'c', name: 'dump.jpg' }],
      // Not photo fields, even holding something that looks like one.
      'Risk notes': [{ fileId: 'not-a-photo', name: 'x' }],
      'Rep Name': 'Dana',
      'Rep Signature': 'data:image/png;base64,iVBORw0KGgo=',
    };
    expect(photoAnswerIds(PRECON_CHECKLIST_FIELDS, answers)).toEqual(['a', 'b', 'c']);
  });

  it('gives an empty id for an entry with no id, so it can never pass as a saved photo', () => {
    const answers = { 'Aerial view of home': [{ name: 'no id.jpg' }, null, 'abc', { fileId: 42 }, { fileId: 'd' }] };
    expect(photoAnswerIds(PRECON_CHECKLIST_FIELDS, answers)).toEqual(['', '', '', '', 'd']);
  });

  it('skips a photo field that holds no list, and an empty or missing answer set', () => {
    expect(photoAnswerIds(PRECON_CHECKLIST_FIELDS, { 'Risk / hazard items': 'none' })).toEqual([]);
    expect(photoAnswerIds(PRECON_CHECKLIST_FIELDS, {})).toEqual([]);
    expect(photoAnswerIds(PRECON_CHECKLIST_FIELDS, null as any)).toEqual([]);
  });

  it('reads the walkthrough\'s photo fields the same way', () => {
    const answers = {
      'Nails and debris collected': [{ fileId: 'n1', name: 'haul.jpg' }],
      'Completed roof — every slope': [{ fileId: 's1', name: 'north.jpg' }, { fileId: 's2', name: 'south.jpg' }],
      'Magnetic sweep — driveway, walkways, garage apron': { state: 'ok' },
    };
    expect(photoAnswerIds(WALKTHROUGH_FIELDS, answers)).toEqual(['n1', 's1', 's2']);
  });
});
