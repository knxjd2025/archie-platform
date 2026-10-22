import { describe, it, expect } from 'vitest';
import { findingKey, consolidateFindings, occurrenceLabel, isRoofLocation, usefulLocations } from '../consolidate-findings';

const d = (id: string, label: string, over: Record<string, any> = {}) =>
  ({ id, label, type: 'shingle_damage', severity: 'minor', description: `desc ${id}`, ...over });

describe('findingKey', () => {
  it('collapses the granule-loss wordings that appeared on one real report', () => {
    // Twelve findings, four wordings, one problem.
    const variants = [
      'Localized granule loss',
      'Minor granule loss on shingles',
      'Localized granule loss on shingles',
      'Localized granule loss on single shingle',
    ];
    const keys = new Set(variants.map((v) => findingKey(v, 'shingle')));
    expect(keys.size).toBe(1);
  });

  it('ignores degree words, which describe severity not the problem', () => {
    expect(findingKey('Severe cracking')).toBe(findingKey('Minor cracking'));
  });

  it('ignores plurality', () => {
    expect(findingKey('Curled shingle edges')).toBe(findingKey('Curled shingle edge'));
  });

  it('does NOT merge genuinely different problems', () => {
    const keys = new Set([
      findingKey('Missing shingles', 'shingle'),
      findingKey('Granule loss', 'shingle'),
      findingKey('Cracked chimney crown', 'chimney'),
      findingKey('Damaged flashing', 'flashing'),
    ]);
    expect(keys.size).toBe(4);
  });

  it('keeps different damage types apart even with the same words', () => {
    expect(findingKey('cracking', 'chimney')).not.toBe(findingKey('cracking', 'shingle'));
  });

  it('never keys to an empty string', () => {
    // A label made entirely of qualifiers would otherwise bucket every
    // unrelated finding together.
    expect(findingKey('minor localized slight')).toBeTruthy();
    expect(findingKey('minor')).toBeTruthy();
  });
});

describe('consolidateFindings', () => {
  const photos = [
    { id: 'p1', damages: [d('a', 'Localized granule loss'), d('b', 'Missing shingles', { severity: 'moderate' })] },
    { id: 'p2', damages: [d('c', 'Minor granule loss on shingles')] },
    { id: 'p3', damages: [d('e', 'Localized granule loss on single shingle', { severity: 'moderate' })] },
    { id: 'p4', damages: [d('f', 'Cracked chimney crown', { type: 'chimney', severity: 'severe' })] },
  ];

  it('groups one problem seen across photos into one finding', () => {
    const out = consolidateFindings(photos);
    const granule = out.find((f) => /granule/i.test(f.label))!;
    expect(granule.occurrences).toBe(3);
    expect(granule.photoIds).toEqual(['p1', 'p2', 'p3']);
  });

  it('cuts a padded list down to the real problems', () => {
    // 5 raw findings -> 3 distinct problems.
    expect(consolidateFindings(photos)).toHaveLength(3);
  });

  it('keeps the worst severity seen — a problem is as bad as its worst instance', () => {
    expect(consolidateFindings(photos).find((f) => /granule/i.test(f.label))!.severity).toBe('moderate');
  });

  it('keeps the most specific wording, which is what a rep can defend', () => {
    const out = consolidateFindings([
      { id: 'p1', damages: [d('a', 'Cracked chimney crown', { type: 'chimney' })] },
      { id: 'p2', damages: [d('b', 'Cracked and deteriorated chimney crown', { type: 'chimney' })] },
    ]);
    expect(out[0].label).toBe('Cracked and deteriorated chimney crown');
  });

  it('orders worst-first, then most-seen', () => {
    const out = consolidateFindings(photos);
    expect(out[0].label).toBe('Cracked chimney crown'); // severe
  });

  it('collects distinct locations without repeating them', () => {
    const out = consolidateFindings([
      { id: 'p1', damages: [d('a', 'Granule loss', { location: 'north slope' })] },
      { id: 'p2', damages: [d('b', 'Granule loss', { location: 'north slope' })] },
      { id: 'p3', damages: [d('c', 'Granule loss', { location: 'south slope' })] },
    ]);
    expect(out[0].locations).toEqual(['north slope', 'south slope']);
  });

  it('counts a photo once even if it lists the same problem twice', () => {
    const out = consolidateFindings([{ id: 'p1', damages: [d('a', 'Granule loss'), d('b', 'Granule loss')] }]);
    expect(out[0].photoIds).toEqual(['p1']);
    expect(out[0].occurrences).toBe(2);
  });

  it('drops findings with no label rather than grouping them together', () => {
    expect(consolidateFindings([{ id: 'p1', damages: [d('a', ''), d('b', '   ')] }])).toEqual([]);
  });

  it('handles photos with no damages, and no photos at all', () => {
    expect(consolidateFindings([{ id: 'p1' }, { id: 'p2', damages: [] }])).toEqual([]);
    expect(consolidateFindings([])).toEqual([]);
  });
});

describe('occurrenceLabel', () => {
  it('says how many photos showed it', () => {
    expect(occurrenceLabel({ occurrences: 8 } as any)).toBe('seen in 8 photos');
  });

  it('stays quiet for a one-off — "seen in 1 photos" reads like a bug', () => {
    expect(occurrenceLabel({ occurrences: 1 } as any)).toBe('');
  });
});

describe('roof locations vs image positions', () => {
  it('keeps places a homeowner can walk outside and look at', () => {
    for (const l of ['North slope', 'Surrounding chimney base', 'Front elevation', 'Near the ridge', 'Left valley']) {
      expect(isRoofLocation(l), l).toBe(true);
    }
  });

  it('drops positions inside a photo', () => {
    // The vision model says where in the FRAME it saw something. A customer
    // cannot go and look at "center of image".
    for (const l of ['Center of image', 'Center and upper portions of image', 'Top right corner of the photo', 'foreground of image']) {
      expect(isRoofLocation(l), l).toBe(false);
    }
  });

  it('drops frame corners, which a roof does not have', () => {
    // These matched only because they contain "left"/"right".
    for (const l of ['Top left corner near debris accumulation', 'Top right corner', 'Bottom left corner']) {
      expect(isRoofLocation(l), l).toBe(false);
    }
  });

  it('drops a sentence pretending to be a location', () => {
    expect(isRoofLocation('Scattered across the roof surface, more noticeable in the center and lower sections')).toBe(false);
    // …while keeping the short, real one.
    expect(isRoofLocation('North slope near ridge')).toBe(true);
  });

  it('drops locations that name no place at all', () => {
    for (const l of ['', '   ', 'on third shingle row from top', 'visible area']) {
      expect(isRoofLocation(l), l).toBe(false);
    }
  });

  it('dedupes case-insensitively and caps the list', () => {
    const f = { locations: ['North slope', 'north slope', 'South slope', 'Chimney base'] };
    expect(usefulLocations(f)).toEqual(['North slope', 'South slope']);
  });

  it('returns nothing when every location was image-relative', () => {
    expect(usefulLocations({ locations: ['Center of image', 'Top of frame'] })).toEqual([]);
  });
});
