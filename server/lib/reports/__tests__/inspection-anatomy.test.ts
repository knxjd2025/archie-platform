import { describe, it, expect } from 'vitest';
import { shingleRoofAnatomy } from '../sections/roof-anatomy-shingle';
import { flatRoofAnatomy } from '../sections/roof-anatomy-flat';
import { residentialGlance, commercialGlance, fold } from '../sections/inspection-glance';
import { statusFromRating, photosMatching } from '../sections/anatomy';
import { EXAMPLE_IMAGES } from '../sections/anatomy-examples';
import { existsSync } from 'fs';
import { join } from 'path';

const res = (over: Record<string, any> = {}): any => ({
  answers: {
    'Roof Covering Type': 'Asphalt Shingle - Architectural', 'Drip edge': 'No', 'Felt or underlayment type': 'Synthetic',
    'Ice and water shield': 'Yes - eaves only', 'Valley type': 'Metal', 'Starter course present': 'Yes - eaves and rakes',
    'Pipe jacks and exhaust caps': '3 jacks, one cracked', 'Chimney': 'None', 'Skylights': 'None',
    'Wind damage found': 'No', 'Soft metal hits found': 'Yes', 'Hail hits per test square by slope': 'North 4, South 11',
    'Leaks or water damage in the attic or interior': 'No', 'Gutters and downspouts': '5 inch K-style',
    ...over,
  },
});
const photos = [
  { url: 'https://cdn.example.com/1.jpg', caption: 'Cracked pipe boot' },
  { url: 'https://cdn.example.com/2.jpg', caption: 'No drip edge at front eave' },
  { url: 'https://cdn.example.com/3.jpg', caption: 'Front of house' },
];

describe('the pitched-roof drawing', () => {
  it('grades each part from the checklist and numbers only what is drawn', () => {
    const html = shingleRoofAnatomy(res(), photos);
    expect(html).toContain('data-anat');
    expect(html).toMatch(/id="anat-drip-edge"[^]*?anat-chip--attention/); // no drip edge
    expect(html).toMatch(/id="anat-underlayment"[^]*?anat-chip--good/);
    expect(html).toMatch(/id="anat-ice-water"[^]*?anat-chip--attention/); // eaves only
    expect(html).toMatch(/id="anat-covering"[^]*?anat-chip--attention/); // hail hits counted
    expect(html).toContain('https://cdn.example.com/1.jpg'); // the pipe boot photo, by its caption
    expect(html).not.toContain('data-layer="flashing"'); // no chimney: not drawn
    expect(html).not.toContain('data-layer="skylight"');
    const hot = [...html.matchAll(/data-hot="([^"]+)"/g)].map((m) => m[1]);
    expect(hot).not.toContain('valley'); // listed, not drawn
    expect(html).toContain('id="anat-valley"');
  });
  it('draws a chimney and a skylight only when the house has them', () => {
    const html = shingleRoofAnatomy(res({ Chimney: '32 x 24', Skylights: '1 Velux' }), photos);
    expect(html).toContain('data-layer="flashing"');
    expect(html).toContain('data-layer="skylight"');
  });
  it('invents nothing without a checklist', () => {
    expect(shingleRoofAnatomy(null, photos)).toBe('');
  });
  it('shows manufacturer photos only as labelled examples, apart from the job photos', () => {
    const html = shingleRoofAnatomy(res(), photos);
    const card = html.slice(html.indexOf('id="anat-starter"'), html.indexOf('id="anat-covering"'));
    expect(card).toContain('class="anat-ex"');
    expect(card).toContain('not your roof');
    expect(card).toContain('alt="Example: Starter shingles (CertainTeed)"');
    for (const m of html.matchAll(/<img[^>]*roof-systems\/[^>]*>/g)) expect(m[0]).toContain('alt="Example: ');
    // the job's own photos never sit in the example box
    const boxes = [...html.matchAll(/<div class="anat-ex">[^]*?<\/div>\s*<\/div>/g)].map((m) => m[0]).join('');
    expect(boxes).not.toContain('cdn.example.com');
    // no photo on file for a deck or a gutter, so none is stood in
    expect(html.slice(html.indexOf('id="anat-deck"'), html.indexOf('id="anat-ice-water"'))).not.toContain('anat-ex');
  });
  it('shows metal panels, not shingles, as the example on a metal roof', () => {
    const html = shingleRoofAnatomy(res({ 'Roof Covering Type': 'Standing Seam Metal' }), photos);
    expect(html).toContain('union/sl175.jpg');
    expect(html).not.toContain('certainteed/landmark.jpg');
  });
});

describe('the commercial exploded drawing', () => {
  const a = {
    'Deck type': 'Steel (metal deck)', 'Deck condition': 'Good', 'Insulation type': 'Polyiso', 'Insulation thickness (in)': 2,
    'Membrane type': 'EPDM', 'Membrane field condition': 'Poor', 'Seams and laps': 'Failed', 'Parapet walls': 'None — edge metal only',
    'Perimeter edge metal (fascia, gravel stop, drip edge)': 'Poor', 'Drains and strainers': 'Fair', 'Skylights, hatches and smoke vents': 'N/A',
    'Estimated wet insulation (% of roof area)': 8,
  };
  it('stacks the recorded layers and rates each part from the inspector', () => {
    const html = flatRoofAnatomy({ answers: a } as any, [{ url: 'https://cdn.example.com/s.jpg', caption: 'x', component: 'seams', scanned: true } as any]);
    expect(html).toContain('data-layer="layer-deck"');
    expect(html).toContain('data-layer="layer-membrane"');
    expect(html).toMatch(/id="anat-seams"[^]*?anat-chip--failed/);
    expect(html).toMatch(/id="anat-layer-insulation"[^]*?anat-chip--attention[^]*?About 8% wet/);
    expect(html).toContain('https://cdn.example.com/s.jpg'); // the scan sorted it to the seams
    expect(html).not.toContain('id="anat-coping"'); // no parapet
    expect(html).not.toContain('id="anat-skylights"'); // N/A
    expect(html).toContain('gaf/polyiso.jpg'); // an example of the insulation
    expect(html).not.toMatch(/tpo-membrane|duro-last\/membrane/); // EPDM: no membrane photo on file, none stood in
  });
  it('shows the membrane example that matches the recorded membrane', () => {
    expect(flatRoofAnatomy({ answers: { ...a, 'Membrane type': 'TPO' } } as any, [])).toContain('gaf/tpo-membrane.jpg');
    expect(flatRoofAnatomy({ answers: { ...a, 'Membrane type': 'PVC' } } as any, [])).toContain('duro-last/membrane.jpg');
  });
  it('every example image is on disk', () => {
    for (const img of EXAMPLE_IMAGES) expect(existsSync(join(__dirname, '../../../../client/public/roof-systems', img)), img).toBe(true);
  });
});

describe('At a Glance', () => {
  it('counts what needs attention and links each card to its part', () => {
    const html = residentialGlance(res(), photos);
    expect(html).toContain('Hail hits on the roof');
    expect(html).toContain('data-anat-go="drip-edge"');
    expect(html).toContain('No wind damage');
    expect(html).toContain('gl-seg--bad');
  });
  it('puts the commercial cards in plain words', () => {
    const html = commercialGlance({ answers: { 'Seams and laps': 'Failed', 'Drains and strainers': 'Good' } } as any, []);
    expect(html).toContain('Seams: Failed');
    expect(html).toContain('Most flat-roof leaks start here.');
    expect(html).not.toContain('fishmouthed');
  });
  it('folds long reference sections, and folds nothing empty', () => {
    expect(fold('Show it', '<p>x</p>')).toContain('<details class="fold">');
    expect(fold('Show it', '')).toBe('');
  });
});

describe('helpers', () => {
  it('maps ratings and matches photos by their own caption', () => {
    expect(statusFromRating('Poor')).toBe('attention');
    expect(statusFromRating('N/A')).toBeNull();
    expect(photosMatching(photos, /pipe/i)).toHaveLength(1);
    expect(photosMatching(photos, null)).toEqual([]);
  });
});
