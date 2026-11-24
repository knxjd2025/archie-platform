import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  DAMAGE_ROWS, MATERIAL_OPTIONS, PITCH_OPTIONS, STORIES_OPTIONS, bumpCount, checkDamage, checkRoof, damageTotal, squareFeetLine, toDamageCounts, toRoofDetails,
  totalLine, tryAdvance,
} from '../wizard-model';
import { emptyDraft } from '../draft';
import { MeasurementsView } from '../StepMeasurements';
import { DamageView } from '../StepDamage';

/** A long dash, a sparkle or a wand: none may appear on screen. Built from its code so this file holds none itself. */
const BANNED = new RegExp(`${String.fromCharCode(0x2014)}|✨|🪄`, 'u');

const roof = (over = {}) => ({ squares: '', pitch: '', stories: '', material: '', ...over });
const damage = (over = {}) => ({ wind: '0', hail: '0', general: '0', ...over });

describe('step 3, the roof\'s size and shape', () => {
  it('lets every fact be left out', () => {
    expect(checkRoof(roof())).toBeNull();
    expect(toRoofDetails(roof())).toBeUndefined();
  });

  it('takes a size in squares between more than 0 and 1,000, with a decimal or a comma', () => {
    for (const ok of ['25', '25.5', ' 30 ', '1000', '1,000', '0.5']) expect(checkRoof(roof({ squares: ok })), ok).toBeNull();
  });

  it('says in plain words when the size is not a number of squares', () => {
    for (const bad of ['0', '-5', 'abc', '12x', '1000.1', '1,000.5', '25 sq', '1e3', '.']) {
      expect(checkRoof(roof({ squares: bad })), bad).toBe('Roof size must be more than 0 and no more than 1,000 squares.');
    }
  });

  it('works out the square feet for the person to see', () => {
    expect(squareFeetLine('25')).toBe('About 2,500 square feet.');
    expect(squareFeetLine('25.5')).toBe('About 2,550 square feet.');
    expect(squareFeetLine('1,000')).toBe('About 100,000 square feet.');
    for (const none of ['', 'abc', '0', '-1', '5000']) expect(squareFeetLine(none), none).toBe('');
  });

  it('sends only the facts that were given, as the numbers and words the server reads', () => {
    expect(toRoofDetails(roof({ squares: '25', pitch: '6/12', stories: '2', material: 'asphalt_shingle' })))
      .toEqual({ squares: 25, pitch: '6/12', stories: 2, material: 'asphalt_shingle' });
    expect(toRoofDetails(roof({ squares: '1,000.0', stories: '1.5' }))).toEqual({ squares: 1000, stories: 1.5 });
    expect(toRoofDetails(roof({ pitch: '8/12' }))).toEqual({ pitch: '8/12' });
  });

  it('offers pitches, stories and materials in plain words', () => {
    expect(PITCH_OPTIONS).toEqual(['3/12', '4/12', '5/12', '6/12', '7/12', '8/12', '9/12', '10/12', '12/12']);
    expect(STORIES_OPTIONS.map((s) => s.value)).toEqual(['1', '1.5', '2', '2.5', '3']);
    expect(MATERIAL_OPTIONS.map((m) => m.label)).toEqual(['Asphalt shingle', 'Metal', 'Tile', 'Slate', 'Wood shake', 'TPO membrane', 'EPDM (rubber)', 'Flat membrane (other)', 'Modified bitumen', 'Other']);
    expect(MATERIAL_OPTIONS.map((m) => m.value)).toEqual(['asphalt_shingle', 'metal', 'tile', 'slate', 'wood_shake', 'flat_tpo', 'flat_epdm', 'flat_membrane', 'modified_bitumen', 'other']);
  });
});

describe('step 4, the damaged shingles', () => {
  it('has three counts, in the order the page shows them', () => {
    expect(DAMAGE_ROWS.map((r) => r.field)).toEqual(['wind', 'hail', 'general']);
    expect(DAMAGE_ROWS.map((r) => r.label)).toEqual(['Wind damage', 'Hail damage', 'Other damage']);
  });

  it('takes whole numbers from 0 to 9,999, and a blank as none', () => {
    for (const ok of ['0', '12', '9999', '', ' 7 ']) expect(checkDamage(damage({ wind: ok })), ok).toBeNull();
    for (const bad of ['-1', '3.5', '10000', 'abc', '1e2']) {
      expect(checkDamage(damage({ hail: bad })), bad).toBe('Each count must be a whole number from 0 to 9,999.');
    }
  });

  it('sends the counts as whole numbers, a blank as 0', () => {
    expect(toDamageCounts(damage({ wind: '4', hail: '12', general: '' }))).toEqual({ windDamaged: 4, hailDamaged: 12, generalDamaged: 0 });
  });

  it('adds and takes off by 1 or 5 and stays between 0 and 9,999', () => {
    expect(bumpCount('4', 5)).toBe('9');
    expect(bumpCount('9998', 5)).toBe('9999');
    expect(bumpCount('2', -5)).toBe('0');
    expect(bumpCount('', 1)).toBe('1');
    expect(bumpCount('abc', 1)).toBe('1');
    expect(bumpCount('10', -1)).toBe('9');
  });

  it('adds the counts up in plain words', () => {
    expect(damageTotal(damage({ wind: '4', hail: '12', general: '3' }))).toBe(19);
    expect(damageTotal(damage({ wind: 'abc' }))).toBe(0);
    expect(totalLine(0)).toBe('No damaged shingles counted yet.');
    expect(totalLine(1)).toBe('1 damaged shingle in all.');
    expect(totalLine(12)).toBe('12 damaged shingles in all.');
  });
});

describe('going on from the roof and damage steps', () => {
  it('stops on a size that cannot be right', () => {
    const d = { ...emptyDraft(), step: 3, roof: roof({ squares: 'lots' }) };
    expect(tryAdvance(d, [])).toEqual({ ok: false, error: 'Roof size must be more than 0 and no more than 1,000 squares.' });
    expect(tryAdvance({ ...d, roof: roof({ squares: '25' }) }, [])).toEqual({ ok: true, step: 4 });
  });

  it('stops on a count that cannot be right, and lets a good set through to the review', () => {
    const d = { ...emptyDraft(), step: 4, damage: damage({ hail: '2.5' }) };
    expect(tryAdvance(d, [])).toEqual({ ok: false, error: 'Each count must be a whole number from 0 to 9,999.' });
    expect(tryAdvance({ ...d, damage: damage({ hail: '2' }) }, [])).toEqual({ ok: true, step: 5 });
  });
});

const render = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);
const noop = () => {};

describe('the roof step as drawn', () => {
  const h = (value = roof()) => render(createElement(MeasurementsView, { value, onChange: noop }));

  it('labels every field, explains a square, and shows the square feet once a size is typed', () => {
    const html = h(roof({ squares: '25' }));
    for (const word of ['About the roof', 'Size in squares', 'One square is 100 square feet.', 'About 2,500 square feet.', 'Pitch', 'Stories', 'Roof material']) expect(html).toContain(word);
    expect(html).not.toMatch(/<(input|select)(?![^>]*\bid=)[^>]*>/);
    expect(html).toContain('inputMode="decimal"');
    expect(html).toContain('aria-describedby="rr-squares-help rr-squares-feet"');
    expect(h()).not.toContain('About 0');
  });

  it('offers Not sure on each list, and every pitch, story count and material', () => {
    const html = h();
    expect((html.match(/>Not sure</g) || []).length).toBe(3);
    for (const word of ['6/12', '1.5', 'Asphalt shingle', 'EPDM (rubber)']) expect(html).toContain(word);
  });

  it('uses no long dash, sparkle or wand', () => {
    expect(h()).not.toMatch(BANNED);
  });
});

describe('the damage step as drawn', () => {
  const h = (value = damage()) => render(createElement(DamageView, { value, onChange: noop }));

  it('names the three counts and says what each means', () => {
    const html = h();
    for (const word of ['Damaged shingles', 'Count the shingles you can see.', 'Wind damage', 'Hail damage', 'Other damage', 'Creased, lifted or missing shingles', 'Bruised, cracked or losing granules', 'Cracked, curling or worn']) expect(html).toContain(word);
  });

  it('gives each count a labelled box and buttons that name the count they change', () => {
    const html = h();
    expect(html).toMatch(/<label[^>]*for="rr-damage-wind"[^>]*>Wind damage<\/label>/);
    expect(html).not.toMatch(/<input(?![^>]*\bid=)[^>]*>/);
    for (const row of ['wind damage', 'hail damage', 'other damage']) {
      expect(html).toContain(`aria-label="Add 1 to ${row}"`);
      expect(html).toContain(`aria-label="Add 5 to ${row}"`);
      expect(html).toContain(`aria-label="Take off 1 from ${row}"`);
    }
    expect(html).toContain('inputMode="numeric"');
  });

  it('shows the total and a way to start the counts again', () => {
    expect(h(damage({ wind: '4', hail: '12', general: '3' }))).toContain('19 damaged shingles in all.');
    expect(h()).toContain('No damaged shingles counted yet.');
    expect(h()).toContain('>Reset<');
    expect(h()).toContain('aria-live="polite"');
  });

  it('shows a visible focus ring and uses no long dash, sparkle or wand', () => {
    expect(h()).toContain('focus-visible:ring-2');
    expect(h()).not.toMatch(BANNED);
  });
});
