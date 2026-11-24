/**
 * What a satellite picture's answer must be before anything of it is used: a closed outline of a sane size inside
 * the picture, a few facets, a known roof type, a confidence in range. Anything else is nothing. And the map
 * address: only the one map host, only the one path, built here and never from what a person typed.
 * Fictional: 12 Elm Street, Cedar Falls (42.5349, -92.4453).
 */
import { describe, expect, it } from 'vitest';
import {
  IMAGE_HEIGHT, IMAGE_WIDTH, MAP_HOST, MAX_FACETS, MAX_VERTICES, assertMapUrl, metersPerPixel, readSatelliteAnswer, staticMapUrl, validCoordinates,
} from '../satellite-answer';

const LAT = 42.5349;
const rect = (x: number, y: number, w: number, h: number) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
const good = (over: Record<string, unknown> = {}) => ({
  outline: rect(440, 490, 400, 300),
  facets: [
    { vertices: rect(440, 490, 400, 150), estimatedPitch: '6:12', direction: 'north' },
    { vertices: rect(440, 640, 400, 150), estimatedPitch: '6/12', direction: 'south' },
  ],
  roofType: 'gable', confidence: 'high', notes: ['ZZ-FREE-TEXT-FROM-THE-MODEL'], ...over,
});
const read = (answer: unknown, lat = LAT) => readSatelliteAnswer(typeof answer === 'string' ? answer : JSON.stringify(answer), lat);

describe('the picture and where it is fetched from', () => {
  it('is one fixed address on the one map host, with the key only in the query', () => {
    const url = new URL(staticMapUrl(LAT, -92.4453, 'KEY-ZZ-123'));
    expect(MAP_HOST).toBe('maps.googleapis.com');
    expect(url.protocol).toBe('https:');
    expect(url.hostname).toBe('maps.googleapis.com');
    expect(url.pathname).toBe('/maps/api/staticmap');
    expect(url.port).toBe('');
    expect(Object.fromEntries(url.searchParams)).toEqual({ center: '42.5349,-92.4453', zoom: '20', size: '640x640', scale: '2', maptype: 'satellite', format: 'jpg', key: 'KEY-ZZ-123' });
    expect(IMAGE_WIDTH).toBe(1280);
    expect(IMAGE_HEIGHT).toBe(1280);
  });

  it('refuses any address that is not exactly that, before anything is fetched', () => {
    const ok = staticMapUrl(LAT, -92.4453, 'K');
    expect(() => assertMapUrl(ok)).not.toThrow();
    for (const bad of [
      'http://maps.googleapis.com/maps/api/staticmap?x=1', 'https://maps.googleapis.com.evil.example/maps/api/staticmap', 'https://evil.example/maps/api/staticmap',
      'https://maps.googleapis.com:8443/maps/api/staticmap', 'https://user:pw@maps.googleapis.com/maps/api/staticmap', 'https://maps.googleapis.com/maps/api/geocode/json',
      'https://maps.googleapis.com/maps/api/staticmap/../geocode/json', 'https://127.0.0.1/maps/api/staticmap', 'https://MAPS.GOOGLEAPIS.COM.evil.example/', 'not a url', '',
      'https://maps.googleapis.com/maps/api/staticmap#@evil.example', 'https://maps.googleapis.com\\@evil.example/maps/api/staticmap',
    ]) expect(() => assertMapUrl(bad), bad).toThrow();
  });

  it('takes only real coordinates', () => {
    expect(validCoordinates(42.5349, -92.4453)).toEqual({ lat: 42.5349, lng: -92.4453 });
    for (const [a, b] of [[NaN, 1], [1, Infinity], [91, 0], [-91, 0], [0, 181], [0, -181], ['42', '-92'], [null, null], [undefined, 5], [0, 0]]) expect(validCoordinates(a, b), `${a} ${b}`).toBeNull();
  });

  it('knows how big a pixel is at that latitude', () => {
    // 156543.03392 * cos(42.5349 deg) / 2^20 metres at one pixel of a 640 picture, half of that at the doubled size.
    expect(metersPerPixel(LAT)).toBeCloseTo(0.055, 4);
  });
});

describe('an answer that can be used', () => {
  it('is cleaned into a new object: the outline, the facets, the roof type, the confidence, and no free text', () => {
    const r = read(good())!;
    expect(r).not.toBeNull();
    expect(r.finding.outline).toEqual(rect(440, 490, 400, 300));
    expect(r.finding.facets).toEqual([
      { vertices: rect(440, 490, 400, 150), pitch: '6/12', direction: 'north' },
      { vertices: rect(440, 640, 400, 150), pitch: '6/12', direction: 'south' },
    ]);
    expect(r.finding.roofType).toBe('gable');
    expect(r.finding.confidence).toBe('high');
    expect(JSON.stringify(r)).not.toContain('ZZ-FREE-TEXT');
  });

  it('works out an estimate: footprint from the outline and the picture scale, then the pitch the facets agree on', () => {
    const r = read(good())!;
    // 400 by 300 pixels at 0.055 m per pixel is about 363 square metres, 3,908 square feet of footprint;
    // a 6 in 12 pitch makes the roof 1.118 times that, 4,369 square feet, which is 43.7 squares.
    expect(r.estimate.pitch).toBe('6/12');
    expect(r.estimate.squares).toBeCloseTo(43.7, 1);
  });

  it('gives only the footprint, and no pitch, when the facets do not name one the form offers', () => {
    const flat = read(good({ facets: [{ vertices: rect(440, 490, 400, 300), estimatedPitch: 'flat', direction: 'north' }] }))!;
    expect(flat.estimate.pitch).toBeNull();
    expect(flat.estimate.squares).toBeCloseTo(39.1, 1);
    const none = read(good({ facets: undefined }))!;
    expect(none.finding.facets).toEqual([]);
    expect(none.estimate.pitch).toBeNull();
    // 11 in 12 is a real pitch the form has no choice for: it is not offered.
    expect(read(good({ facets: [{ vertices: rect(440, 490, 400, 300), estimatedPitch: '11:12', direction: 'east' }] }))!.estimate.pitch).toBeNull();
  });

  it('uses the pitch that covers the most roof', () => {
    const r = read(good({ facets: [
      { vertices: rect(440, 490, 400, 60), estimatedPitch: '4:12', direction: 'north' },
      { vertices: rect(440, 550, 400, 240), estimatedPitch: '8:12', direction: 'south' },
    ] }))!;
    expect(r.estimate.pitch).toBe('8/12');
  });

  it('reads a fenced answer, a closing vertex that repeats the first, a number for confidence and the old word for the outline', () => {
    expect(read('```json\n' + JSON.stringify(good()) + '\n```')).not.toBeNull();
    expect(read(good({ outline: [...rect(440, 490, 400, 300), { x: 440, y: 490 }] }))!.finding.outline).toHaveLength(4);
    expect(read(good({ confidence: 0.9 }))!.finding.confidence).toBe('high');
    expect(read(good({ confidence: 0.5 }))!.finding.confidence).toBe('medium');
    expect(read(good({ confidence: 0.1 }))!.finding.confidence).toBe('low');
    expect(read(good({ confidence: 'medium' }))!.finding.confidence).toBe('medium');
  });
});

describe('an answer that is nothing', () => {
  it('is not JSON, not an object, or empty', () => {
    for (const raw of ['', 'I could not see a roof.', '[]', '"roof"', 'null', '42', '{', '{"outline": ', undefined, null, 5, {}]) expect(readSatelliteAnswer(raw as never, LAT), String(raw)).toBeNull();
    expect(read({})).toBeNull();
    expect(readSatelliteAnswer('x'.repeat(200_000), LAT)).toBeNull();
  });

  it('has an outline that is not a closed shape of a sane size inside the picture', () => {
    const bad: Array<[string, unknown]> = [
      ['missing', undefined], ['not a list', 'north'], ['two points', [{ x: 1, y: 1 }, { x: 5, y: 5 }]], ['empty', []],
      ['too many', Array.from({ length: MAX_VERTICES + 1 }, (_v, i) => ({ x: 400 + (i % 2) * 200 + i, y: 400 + i * 5 }))],
      ['outside the picture', rect(1200, 1200, 200, 200)], ['negative', rect(-50, 100, 300, 300)],
      ['not numbers', [{ x: '1', y: '2' }, { x: '100', y: '2' }, { x: '100', y: '100' }]], ['NaN', [{ x: NaN, y: 1 }, { x: 5, y: 1 }, { x: 5, y: 9 }]],
      ['points not objects', [[1, 2], [3, 4], [5, 6]]],
      ['a bow tie that crosses itself', [{ x: 440, y: 490 }, { x: 840, y: 790 }, { x: 840, y: 490 }, { x: 440, y: 790 }]],
      // Its two long sides cross, yet its area is not zero, so only a check for crossing can refuse it.
      ['a shape that crosses itself and still has an area', [{ x: 440, y: 490 }, { x: 840, y: 490 }, { x: 440, y: 790 }, { x: 900, y: 650 }]],
      ['all on one line', [{ x: 440, y: 490 }, { x: 640, y: 490 }, { x: 840, y: 490 }]],
      ['a repeated point', [{ x: 440, y: 490 }, { x: 440, y: 490 }, { x: 840, y: 490 }, { x: 840, y: 790 }]],
      ['smaller than a shed', rect(600, 600, 8, 8)],
      ['the whole picture', rect(0, 0, 1280, 1280)],
    ];
    for (const [name, outline] of bad) expect(read(good({ outline })), name).toBeNull();
  });

  it('has facets that are too many or not valid', () => {
    const facet = { vertices: rect(440, 490, 100, 100), estimatedPitch: '6:12', direction: 'north' };
    expect(read(good({ facets: Array.from({ length: MAX_FACETS + 1 }, () => facet) }))).toBeNull();
    expect(read(good({ facets: Array.from({ length: MAX_FACETS }, () => facet) }))).not.toBeNull();
    for (const badFacet of [
      { ...facet, estimatedPitch: '99:12' }, { ...facet, estimatedPitch: 'steep' }, { ...facet, estimatedPitch: undefined }, { ...facet, estimatedPitch: '6:13' },
      { ...facet, direction: 'up' }, { ...facet, direction: undefined }, { ...facet, vertices: [{ x: 1, y: 1 }] }, { ...facet, vertices: rect(2000, 2000, 10, 10) }, 'facet', null, [],
    ]) expect(read(good({ facets: [badFacet] })), JSON.stringify(badFacet)).toBeNull();
    expect(read(good({ facets: 'many' }))).toBeNull();
  });

  it('names a roof type or a confidence that is not known', () => {
    for (const roofType of ['castle', '', undefined, 5, null, 'GABLE ']) expect(read(good({ roofType })), String(roofType)).toBeNull();
    for (const confidence of ['certain', '', undefined, 1.5, -0.1, NaN, null, 'high ', { a: 1 }]) expect(read(good({ confidence })), String(confidence)).toBeNull();
    for (const roofType of ['gable', 'hip', 'flat', 'shed', 'mansard', 'gambrel', 'complex']) expect(read(good({ roofType })), roofType).not.toBeNull();
  });

  it('is not changed by keys that only try to change the shape of an object', () => {
    const polluted = '{"__proto__":{"polluted":true},"constructor":{"prototype":{"x":1}},"outline":' + JSON.stringify(rect(440, 490, 400, 300)) + ',"roofType":"gable","confidence":"high"}';
    const r = readSatelliteAnswer(polluted, LAT);
    expect(r).not.toBeNull();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.keys(r!.finding).sort()).toEqual(['confidence', 'facets', 'outline', 'roofType']);
  });
});
