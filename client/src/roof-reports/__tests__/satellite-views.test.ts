import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MeasurementsView, type SatelliteView } from '../StepMeasurements';
import { applyEstimate } from '../satellite-model';
import type { RoofDraft } from '../draft';
import { SATELLITE_NOT_FOUND } from '../../../../shared/roof-reports';

const BANNED = new RegExp(`${String.fromCharCode(0x2014)}|✨|🪄`, 'u');
const roof = (over: Partial<RoofDraft> = {}): RoofDraft => ({ squares: '', pitch: '', stories: '', material: '', ...over });
const noop = () => {};
const sat = (over: Partial<SatelliteView> = {}): SatelliteView => ({ state: { phase: 'idle' }, onFind: noop, onUse: noop, onKeep: noop, ...over });
const view = (value: RoofDraft, satellite?: SatelliteView) => renderToStaticMarkup(createElement(MeasurementsView, { value, onChange: noop, satellite }));

describe('the roof step with the satellite button', () => {
  it('offers "Find it from the satellite" and says what it does, in plain words', () => {
    const h = view(roof(), sat());
    expect(h).toContain('Find it from the satellite');
    expect(h).toContain('We look at a satellite picture of the address');
    expect(h).toMatch(/<button[^>]*type="button"[^>]*>Find it from the satellite<\/button>/);
    expect(h).not.toContain('disabled=""');
  });

  it('has no button at all where the step is shown on its own, as before', () => {
    expect(view(roof())).not.toContain('satellite');
  });

  it('says "Looking at the satellite picture..." at once, with the button waiting', () => {
    const h = view(roof(), sat({ state: { phase: 'looking' } }));
    expect(h).toContain('Looking at the satellite picture...');
    expect(h).toContain('role="status"');
    expect(h).toContain('aria-busy="true"');
    expect(h).toMatch(/disabled=""[^>]*>Find it from the satellite</);
  });

  it('marks the numbers as an estimate to check, while they are one, and leaves the note off a roof the person typed', () => {
    const filled = applyEstimate(roof(), { squares: 43.7, pitch: '6/12' }).roof;
    const h = view(filled, sat());
    expect(h).toContain('Estimated from a satellite picture. Check these numbers.');
    expect(h).toContain('value="43.7"');
    expect(view(roof({ squares: '25' }), sat())).not.toContain('Estimated from a satellite picture');
    // Said without the button too, so the note is never lost.
    expect(view(filled)).toContain('Estimated from a satellite picture. Check these numbers.');
  });

  it('asks before it replaces anything that was typed, and names what it would put there', () => {
    const asked = applyEstimate(roof({ squares: '30' }), { squares: 43.7, pitch: '6/12' });
    const h = view(asked.roof, sat({ state: { phase: 'choose', pending: asked.pending! } }));
    expect(h).toContain('You already typed a size.');
    expect(h).toContain('43.7');
    expect(h).toContain('Use the satellite numbers');
    expect(h).toContain('Keep what I typed');
    expect(h).toContain('value="30"');
  });

  it('says plainly that the roof was not found, and what to do', () => {
    const h = view(roof(), sat({ state: { phase: 'failed', message: SATELLITE_NOT_FOUND } }));
    expect(h).toContain('We could not find the roof in the satellite picture. Enter the measurements by hand.');
    expect(h).toContain('role="alert"');
    expect(h).toContain('Find it from the satellite');
  });

  it('warns when the picture was not clear, and uses no long dash, sparkle or wand', () => {
    const filled = applyEstimate(roof(), { squares: 43.7, pitch: '6/12' }).roof;
    const unclear = view(filled, sat({ state: { phase: 'idle' }, confidence: 'low' }));
    expect(unclear).toContain('The picture was not very clear');
    expect(view(filled, sat({ confidence: 'high' }))).not.toContain('not very clear');
    for (const h of [view(roof(), sat()), unclear, view(roof(), sat({ state: { phase: 'looking' } }))]) expect(h).not.toMatch(BANNED);
  });
});
